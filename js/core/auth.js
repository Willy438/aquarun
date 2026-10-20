import { supabase } from '../config/supabaseClient.js';
import { LOGIN_EMAIL_DOMAIN, ROLE_HOME } from './constants.js';

// Accepts "09171234567", "0917 123 4567" or "+63 917 123 4567". Returns 09XXXXXXXXX or null.
export function normalizePhone(value) {
  const digits = value.replace(/[^\d+]/g, '');
  if (/^\+639\d{9}$/.test(digits)) return '0' + digits.slice(3);
  if (/^09\d{9}$/.test(digits)) return digits;
  return null;
}

// What the person types on the login form -> the email Supabase Auth uses.
export function toLoginEmail(identifier) {
  const text = identifier.trim();
  if (text.includes('@')) return text.toLowerCase();
  const phone = normalizePhone(text);
  return phone ? `${phone}@${LOGIN_EMAIL_DOMAIN}` : null;
}

export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export function homeFor(role) {
  return ROLE_HOME[role] ?? 'login.html';
}

export async function logIn(identifier, password) {
  const email = toLoginEmail(identifier);
  if (!email) throw new Error('Enter a valid mobile number (09XX XXX XXXX) or email.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Wrong mobile number, email or password.');
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    throw new Error('This account is not active. Please contact the station.');
  }
  return profile.role;
}

export async function signUpCustomer({ fullName, phone, contactEmail, address, password }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Enter a valid mobile number, for example 0917 123 4567.');
  const { data, error } = await supabase.auth.signUp({
    email: `${normalized}@${LOGIN_EMAIL_DOMAIN}`,
    password,
    // The role is never sent from the browser. New accounts are customers by default in the database.
    options: { data: { full_name: fullName, phone: normalized, contact_email: contactEmail || null } },
  });
  if (error) {
    if (/registered|already/i.test(error.message)) throw new Error('This mobile number already has an account. Try logging in.');
    throw new Error(error.message);
  }
  if (!data.session) throw new Error('Account created, but email confirmation is still on in Supabase. Turn off "Confirm email" in Authentication settings.');

  // Save the first delivery address. Column names follow 01_schema.sql: adjust here if yours differ.
  const { error: addressError } = await supabase.from('addresses').insert({
    customer_id: data.user.id, label: 'Home', street: address, is_default: true,
  });
  return { addressSaved: !addressError };
}

export async function logOut() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}
