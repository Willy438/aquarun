// Phone, Email and Password Verification Services for AquaRun

// Valid Philippine Mobile Network Prefixes (NTC assignments for Globe, Smart, DITO, TM, TNT, Sun, GOMO)
const PH_MOBILE_PREFIXES = new Set([
  // Globe, TM, GOMO
  '0817', '0904', '0905', '0906', '0915', '0916', '0917', '0926', '0927',
  '0935', '0936', '0945', '0953', '0954', '0955', '0956', '0965', '0966',
  '0967', '0975', '0976', '0977', '0978', '0979', '0995', '0996', '0997',
  // Smart, TNT, Sun
  '0813', '0900', '0907', '0908', '0909', '0910', '0911', '0912', '0913',
  '0914', '0918', '0919', '0920', '0921', '0922', '0923', '0924', '0925',
  '0928', '0929', '0930', '0931', '0932', '0933', '0934', '0938', '0939',
  '0940', '0941', '0942', '0943', '0946', '0947', '0948', '0949', '0950',
  '0951', '0961', '0962', '0963', '0964', '0968', '0969', '0970', '0971',
  '0972', '0981', '0982', '0985', '0989', '0992', '0998', '0999',
  // DITO
  '0895', '0896', '0897', '0898', '0991', '0992', '0993', '0994',
]);

const DUMMY_SEQUENCES = new Set([
  '09000000000', '09111111111', '09222222222', '09333333333',
  '09444444444', '09555555555', '09666666666', '09777777777',
  '09888888888', '09999999999', '09123456789', '09987654321',
]);

// Reserved IANA documentation/placeholder domains and disposable services
const BLOCKED_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu',
  'test.com', 'test.org', 'test.net', 'sample.com', 'sample.org',
  'invalid.com', 'invalid.org', 'fake.com', 'temp.com', 'none.com',
  'noemail.com', 'mailinator.com', '10minutemail.com', 'guerrillamail.com',
  'trashmail.com', 'tempmail.com', 'sharklasers.com', 'yopmail.com'
]);

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates password strength:
 * - Minimum 8 characters
 * - At least 1 letter (a-z or A-Z)
 * - At least 1 number (0-9)
 * - At least 1 special character (!@#$%^&* etc.)
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character (!@#$%^&* etc.).' };
  }
  return { valid: true };
}

/**
 * Validates and normalizes Philippine mobile phone numbers.
 * Verifies format, NTC carrier prefix, and non-dummy sequences.
 */
export function verifyPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, message: 'Mobile number is required.' };
  }

  // Strip all non-digit and non-plus characters
  let clean = phone.trim().replace(/[\s\-\(\)\.]/g, '');

  // Normalize +63 prefix to 09
  if (clean.startsWith('+63')) {
    clean = '0' + clean.slice(3);
  } else if (clean.startsWith('63') && clean.length === 12) {
    clean = '0' + clean.slice(2);
  } else if (clean.length === 10 && clean.startsWith('9')) {
    clean = '0' + clean;
  }

  if (!/^09\d{9}$/.test(clean)) {
    return {
      valid: false,
      message: 'Enter a valid 11-digit Philippine mobile number starting with 09 (e.g. 0917 123 4567).',
    };
  }

  if (DUMMY_SEQUENCES.has(clean)) {
    return {
      valid: false,
      message: 'Please enter your real personal mobile number.',
    };
  }

  const prefix = clean.slice(0, 4);
  if (!PH_MOBILE_PREFIXES.has(prefix)) {
    return {
      valid: false,
      message: `The mobile prefix "${prefix}" is not a recognized Philippine carrier prefix. Check for typos.`,
    };
  }

  // Determine carrier label
  let carrier = 'Philippine Mobile';
  if (['0817', '0905', '0906', '0915', '0916', '0917', '0926', '0927', '0935', '0936', '0945', '0953', '0954', '0955', '0956', '0965', '0966', '0967', '0975', '0976', '0977', '0978', '0979', '0995', '0996', '0997'].includes(prefix)) {
    carrier = 'Globe / TM / GOMO';
  } else if (['0813', '0900', '0907', '0908', '0909', '0910', '0911', '0912', '0913', '0914', '0918', '0919', '0920', '0921', '0922', '0923', '0924', '0925', '0928', '0929', '0930', '0931', '0932', '0933', '0934', '0938', '0939', '0940', '0941', '0942', '0943', '0946', '0947', '0948', '0949', '0950', '0951', '0961', '0962', '0963', '0964', '0968', '0969', '0970', '0971', '0972', '0981', '0982', '0985', '0989', '0992', '0998', '0999'].includes(prefix)) {
    carrier = 'Smart / TNT / Sun';
  } else if (['0895', '0896', '0897', '0898', '0991', '0992', '0993', '0994'].includes(prefix)) {
    carrier = 'DITO Telecommunity';
  }

  return {
    valid: true,
    normalized: clean,
    carrier,
  };
}

/**
 * Validates email address format, checks against disposable email API,
 * blocks placeholder/reserved domains, and verifies DNS MX mail server records.
 */
export async function verifyEmailAddress(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: 'Email address is required.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return { valid: false, message: 'Please enter a valid email address (e.g. name@gmail.com).' };
  }

  const domain = cleanEmail.split('@')[1];
  if (!domain || !domain.includes('.')) {
    return { valid: false, message: 'Email domain is incomplete.' };
  }

  // 1. Block placeholder / test / reserved domains
  if (
    BLOCKED_DOMAINS.has(domain) ||
    domain.endsWith('.example') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost')
  ) {
    return {
      valid: false,
      message: `The domain "@${domain}" is a test/placeholder domain and cannot receive email. Please use a real email address (e.g. @gmail.com, @yahoo.com).`,
    };
  }

  // 2. Common typo checks
  const commonTypos = {
    'gnail.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'hotmial.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'outlok.com': 'outlook.com',
  };

  if (commonTypos[domain]) {
    return {
      valid: false,
      message: `Did you mean @${commonTypos[domain]}? Please check your email spelling.`,
    };
  }

  // 3. API Check: Disposable email check via Debounce public API
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const dispRes = await fetch(`https://disposable.debounce.io/?email=${encodeURIComponent(cleanEmail)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (dispRes.ok) {
      const dispData = await dispRes.json();
      if (dispData?.disposable === 'true') {
        return {
          valid: false,
          message: 'Disposable or temporary email addresses are not permitted. Please use your personal or work email.',
        };
      }
    }
  } catch {
    // Non-blocking if API offline
  }

  // 4. API Check: DNS MX / Mail server verification via Google DNS-over-HTTPS
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const dnsRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (dnsRes.ok) {
      const dnsData = await dnsRes.json();
      // Status 3 is NXDOMAIN (domain does not exist)
      if (dnsData.Status === 3) {
        return {
          valid: false,
          message: `The domain "@${domain}" does not exist. Please check for typos.`,
        };
      }

      // Check for Null MX (RFC 7505) or empty answer
      const mxRecords = (dnsData.Answer || []).filter((a) => a.type === 15);
      const validMx = mxRecords.filter((a) => {
        const target = String(a.data || '').trim();
        return target && target !== '0 .' && target !== '.' && target !== '0';
      });

      if (mxRecords.length > 0 && validMx.length === 0) {
        return {
          valid: false,
          message: `The domain "@${domain}" explicitly does not accept incoming email.`,
        };
      }

      if (dnsData.Status === 0 && (!dnsData.Answer || dnsData.Answer.length === 0)) {
        // Fallback check for A record
        try {
          const aRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
          const aData = await aRes.json();
          if (aData.Status === 3 || (!aData.Answer && !aData.Authority)) {
            return {
              valid: false,
              message: `The domain "@${domain}" has no active mail server configured.`,
            };
          }
        } catch {
          // ignore fallback error
        }
      }
    }
  } catch {
    // Non-blocking if Google DNS is temporarily unreachable
  }

  return { valid: true, email: cleanEmail };
}
