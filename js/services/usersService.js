// Profiles, rider availability, and admin user management. Pages never call Supabase directly, they call this file.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { supabase } from '../config/supabaseClient.js';
import { normalizePhone } from '../core/auth.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

const SUPABASE_URL = 'https://vphksdvpyjqlidtvdvws.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4W-dtTaeuzivlzSEvzInXQ_V23xHLxu';

export async function updateOwnProfile(userId, { fullName, phone, email, currentEmail }) {
  const cleanName = String(fullName ?? '').trim();
  if (!cleanName) throw new Error('Enter your full name.');

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Enter a valid contact number, for example 0917 555 0101.');
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      full_name: cleanName,
      phone: normalizedPhone,
    })
    .eq('id', userId);

  if (profileError) throw new Error(profileError.message || 'Could not update profile.');

  const cleanEmail = String(email ?? '').trim().toLowerCase();
  let emailUpdated = false;
  if (cleanEmail && currentEmail && cleanEmail !== currentEmail.toLowerCase()) {
    const { error: emailError } = await supabase.auth.updateUser({ email: cleanEmail });
    if (emailError) throw new Error(emailError.message || 'Profile saved, but could not update email.');
    emailUpdated = true;
  }

  invalidateDataCache('users:');
  return { fullName: cleanName, phone: normalizedPhone, emailUpdated };
}

export async function updateOwnPassword(newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Use at least 8 characters for your password.');
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message || 'Could not update password.');
}

export async function getAvailableRiders() {
  return cachedQuery('users:available_riders', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, is_available, is_active')
      .eq('role', 'rider')
      .eq('is_active', true)
      .eq('is_available', true)
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  });
}

export async function setRiderAvailability(riderId, isAvailable) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_available: Boolean(isAvailable) })
    .eq('id', riderId)
    .select('id, full_name, phone, role, is_active, is_available')
    .single();

  if (error) throw new Error(error.message || 'Could not update availability.');
  invalidateDataCache('users:');
  return data;
}

export async function getStaffAndRidersForAdmin() {
  return cachedQuery('users:staff_riders', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role, is_active, is_available, created_at')
      .in('role', ['staff', 'rider'])
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  });
}

export async function updateUserByAdmin(userId, { fullName, phone, role, isActive }) {
  const cleanName = String(fullName ?? '').trim();
  if (!cleanName) throw new Error('Enter the user full name.');
  const normalizedPhone = phone ? normalizePhone(phone) || String(phone).trim() : null;

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: cleanName,
      phone: normalizedPhone,
      role,
      is_active: Boolean(isActive),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Could not update user account.');
  invalidateDataCache('users:');
  return data;
}

export async function createStaffOrRiderAccount({ fullName, phone, email, password, role }) {
  const cleanName = String(fullName ?? '').trim();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const normalizedPhone = normalizePhone(phone);

  if (!cleanName) throw new Error('Enter a full name.');
  if (!normalizedPhone) throw new Error('Enter a valid mobile number (e.g. 0917 555 0121).');
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid email address.');
  }
  if (!password || password.length < 8) {
    throw new Error('Use a password with at least 8 characters.');
  }
  if (!['staff', 'rider'].includes(role)) {
    throw new Error('Select Staff or Rider as the role.');
  }

  // Use a non-persisting client so the Admin session is not replaced
  const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: signUpData, error: signUpErr } = await tempClient.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: { full_name: cleanName, phone: normalizedPhone },
    },
  });

  if (signUpErr) {
    throw new Error(signUpErr.message || 'Could not create user login.');
  }

  const newUserId = signUpData?.user?.id;
  if (!newUserId) {
    throw new Error('User created, but could not read user ID.');
  }

  // Promote the newly created profile to staff or rider using the Admin's authenticated client
  const { data: updatedProfile, error: updateErr } = await supabase
    .from('profiles')
    .update({
      full_name: cleanName,
      phone: normalizedPhone,
      role,
      is_active: true,
      is_available: role === 'rider',
    })
    .eq('id', newUserId)
    .select()
    .single();

  if (updateErr) {
    throw new Error(updateErr.message || 'Account created, but could not assign role.');
  }

  invalidateDataCache('users:');
  return updatedProfile;
}
