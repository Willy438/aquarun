import { getCachedProfile, getCurrentProfile } from './auth.js';
import { ROLE_HOME } from './constants.js';

// Absolute address of the site root, so redirects work from any folder depth.
const ROOT = new URL('../../', import.meta.url);

// Call at the top of every role page: const me = await requireRole('customer');
// Uses sessionStorage cache first for instant tab switches, while verifying in the background.
export async function requireRole(...allowed) {
  const cached = getCachedProfile();
  if (cached && cached.is_active && allowed.includes(cached.role)) {
    // Revalidate in the background so tab navigation doesn't block on network latency
    getCurrentProfile()
      .then((fresh) => {
        if (!fresh || !fresh.is_active) {
          window.location.replace(new URL('login.html', ROOT));
        } else if (!allowed.includes(fresh.role)) {
          window.location.replace(new URL(ROLE_HOME[fresh.role], ROOT));
        }
      })
      .catch(() => {});
    return cached;
  }

  let profile = null;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    console.error('Could not load profile', error);
  }

  if (!profile || !profile.is_active) {
    window.location.replace(new URL('login.html', ROOT));
    return new Promise(() => {}); // stop the page script while redirecting
  }
  if (!allowed.includes(profile.role)) {
    window.location.replace(new URL(ROLE_HOME[profile.role], ROOT));
    return new Promise(() => {});
  }
  return profile;
}
