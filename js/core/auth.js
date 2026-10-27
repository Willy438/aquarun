import { supabase } from '../config/supabaseClient.js';
import { ROLE_HOME } from './constants.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_CACHE_KEY = 'aquarun_profile_cache';

export function getCachedProfile() {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedProfile(profile) {
  try {
    if (profile) {
      sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

// Accepts "09171234567", "0917 123 4567" or "+63 917 123 4567". Returns 09XXXXXXXXX or null.
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/[^\d+]/g, '');
  if (/^\+639\d{9}$/.test(digits)) return '0' + digits.slice(3);
  if (/^09\d{9}$/.test(digits)) return digits;
  return null;
}

// Splits a free-text signup address into street, barangay, and city so NOT NULL columns in 01_schema.sql are satisfied.
export function parseAddressParts(rawAddress) {
  const parts = String(rawAddress ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 3) {
    const city = parts.pop();
    const barangay = parts.pop();
    const street = parts.join(', ');
    return { street, barangay, city };
  }
  if (parts.length === 2) {
    return { street: parts[0], barangay: 'N/A', city: parts[1] };
  }
  return { street: parts[0] || String(rawAddress ?? '').trim(), barangay: 'N/A', city: 'Caloocan' };
}

async function ensureInitialAddress(user) {
  const rawAddress = user?.user_metadata?.address;
  if (!rawAddress) return false;
  const { count } = await supabase
    .from('addresses')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', user.id);
  if (count && count > 0) return true;

  const { street, barangay, city } = parseAddressParts(rawAddress);
  const { error } = await supabase.from('addresses').insert({
    customer_id: user.id,
    label: 'Home',
    street,
    barangay,
    city,
    is_default: true,
  });
  return !error;
}

export async function ensureActiveSession() {
  try {
    const getSessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Session timeout')), 3000));
    const { data: { session }, error } = await Promise.race([getSessionPromise, timeoutPromise]).catch(() => ({ data: { session: null }, error: true }));

    if (error || !session) {
      const refreshPromise = supabase.auth.refreshSession();
      const { data: refreshData, error: refreshErr } = await Promise.race([
        refreshPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 3000))
      ]).catch(() => ({ data: {}, error: true }));
      if (refreshErr || !refreshData?.session) {
        return null;
      }
      return refreshData.session;
    }

    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt && Date.now() > expiresAt - 120000) {
      const refreshPromise = supabase.auth.refreshSession();
      const { data: refreshData } = await Promise.race([
        refreshPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 2500))
      ]).catch(() => ({ data: { session } }));
      return refreshData?.session || session;
    }
    return session;
  } catch {
    return null;
  }
}

export async function getCurrentProfile() {
  try {
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    const user = session?.user;
    if (!user) {
      setCachedProfile(null);
      return null;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role, is_active, is_available')
      .eq('id', user.id)
      .single();
    if (error) {
      const cached = getCachedProfile();
      if (cached && cached.id === user.id) {
        return cached;
      }
      throw error;
    }
    const profile = { ...data, email: user.email ?? '' };
    setCachedProfile(profile);
    return profile;
  } catch (err) {
    const cached = getCachedProfile();
    if (cached) return cached;
    throw err;
  }
}

export function homeFor(role) {
  return ROLE_HOME[role] ?? 'login.html';
}

export async function logIn(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(cleanEmail)) throw new Error('Enter a valid email address.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) {
    if (/confirm/i.test(error.message)) throw new Error('Please confirm your email first. Check your inbox.');
    throw new Error('Wrong email or password.');
  }
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut().catch(() => {});
    setCachedProfile(null);
    throw new Error('This account is not active. Please contact the station.');
  }
  if (profile.role === 'customer' && data?.user) {
    await ensureInitialAddress(data.user).catch(() => {});
  }
  return profile.role;
}

export async function signUpCustomer({ fullName, phone, email, address = null, password }) {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(cleanEmail)) throw new Error('Enter a valid email address.');
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Enter a valid mobile number, for example 0917 123 4567.');

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    // The role is never sent from the browser. New accounts are customers by default in the database.
    options: { data: { full_name: fullName, phone: normalized, ...(address ? { address } : {}) } },
  });
  if (error) {
    if (/registered|already/i.test(error.message)) throw new Error('This email already has an account. Try logging in.');
    throw new Error(error.message);
  }

  // Supabase returns empty identities array when user already exists
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('This email is already registered. Please log in instead.');
  }

  // If "Confirm email" is turned on in Supabase there is no session yet.
  if (!data.session) return { needsConfirmation: true, addressSaved: false };

  const addressSaved = await ensureInitialAddress(data.user);
  await getCurrentProfile().catch(() => {});
  return { needsConfirmation: false, addressSaved };
}

export async function logOut() {
  try {
    setCachedProfile(null);
    sessionStorage.clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase') || key.startsWith('aquarun_'))) {
        localStorage.removeItem(key);
      }
    }
    await Promise.race([
      supabase.auth.signOut(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SignOut timeout')), 1200))
    ]).catch(() => {});
  } catch (err) {
    console.warn('Logout notice:', err);
  } finally {
    window.location.replace('/login.html');
  }
}
