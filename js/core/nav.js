import { getCachedProfile, getCurrentProfile, logOut } from './auth.js';
import { requireRole } from './guard.js';
import { getInitials, escapeHtml, confirmModal } from './ui.js';
import { supabase } from '../config/supabaseClient.js';

const BADGE_CACHE_KEY = 'aquarun_active_badge';
const STAFF_BADGE_CACHE_KEY = 'aquarun_staff_orders_badge';
const STAFF_REMITTANCE_BADGE_CACHE_KEY = 'aquarun_staff_remittance_badge';
const RIDER_BADGE_CACHE_KEY = 'aquarun_rider_current_badge';
const RIDER_REMITTANCE_BADGE_CACHE_KEY = 'aquarun_rider_remittance_badge';

const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1V9.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  cube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`,
  logoDrop: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5C12 2.5 5.5 9.8 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 9.8 12 2.5 12 2.5Zm-1.5 14.2a2.8 2.8 0 0 1-2.2-2.7c0-.4.3-.7.7-.7s.7.3.7.7c0 .7.4 1.2 1 1.4.4.1.6.5.5.9-.1.3-.4.5-.7.4Z"/></svg>`,
  panelCollapse: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9-3 3 3 3"/></svg>`,
  panelExpand: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m11 9 3 3-3 3"/></svg>`,
};

const NAV_SECTIONS = {
  customer: [
    {
      heading: null,
      items: [{ key: 'home', label: 'Home', icon: 'home' }],
    },
    {
      heading: 'Orders',
      items: [
        { key: 'new-order', label: 'New order', icon: 'plus' },
        { key: 'track-order', label: 'Track order', icon: 'pin', badgeId: 'nav-track-badge' },
        { key: 'order-history', label: 'Order history', icon: 'clock' },
      ],
    },
    {
      heading: 'Account',
      items: [
        { key: 'bottle-balance', label: 'Bottle balance', icon: 'drop' },
        { key: 'addresses', label: 'Saved addresses', icon: 'bookmark' },
        { key: 'profile', label: 'Profile', icon: 'user' },
      ],
    },
  ],
  staff: [
    {
      heading: 'Operations',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'home' },
        { key: 'orders', label: 'Orders', icon: 'cart', badgeId: 'nav-staff-orders-badge' },
        { key: 'order-processing', label: 'Order processing', icon: 'check' },
        { key: 'remittance', label: 'Cash & sales', icon: 'cash', badgeId: 'nav-staff-remittance-badge' },
        { key: 'bottle-ledger', label: 'Container ledger', icon: 'bookmark' },
        { key: 'customers', label: 'Customers', icon: 'user' },
      ],
    },
    {
      heading: 'Account',
      items: [{ key: 'profile', label: 'Profile', icon: 'user' }],
    },
  ],
  rider: [
    {
      heading: 'Deliveries',
      items: [
        { key: 'my-deliveries', label: 'My deliveries', icon: 'truck' },
        { key: 'delivery-details', label: 'Current delivery', icon: 'cube', badgeId: 'nav-rider-current-badge' },
        { key: 'delivery-history', label: 'Delivery history', icon: 'clock' },
        { key: 'remittance', label: 'Cash record', icon: 'cash', badgeId: 'nav-rider-remittance-badge' },
      ],
    },
    {
      heading: 'Account',
      items: [{ key: 'profile', label: 'Profile', icon: 'user' }],
    },
  ],
  admin: [
    {
      heading: 'Overview',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'home' },
        { key: 'reports', label: 'Reports', icon: 'chart' },
      ],
    },
    {
      heading: 'Monitor',
      items: [{ key: 'all-orders', label: 'All orders', icon: 'list' }],
    },
    {
      heading: 'Manage',
      items: [
        { key: 'users', label: 'Users', icon: 'user' },
        { key: 'products', label: 'Products & prices', icon: 'tag' },
        { key: 'time-slots', label: 'Time slots', icon: 'clock' },
        { key: 'settings', label: 'Station settings', icon: 'gear' },
      ],
    },
  ],
};

const CUSTOMER_PAGE_META = {
  home: { title: 'Home', docTitle: 'Home | AquaRun', sub: '' },
  'new-order': {
    title: 'Place a refill order',
    docTitle: 'New order | AquaRun',
    sub: 'Add one or more refills, then pick a delivery slot.',
  },
  'track-order': {
    title: 'Track order',
    docTitle: 'Track order | AquaRun',
    sub: 'Status updates come from the station and rider, not live GPS.',
  },
  'order-history': {
    title: 'Order history',
    docTitle: 'Order history | AquaRun',
    sub: 'All your refill orders.',
  },
  'bottle-balance': {
    title: 'Bottle balance',
    docTitle: 'Bottle balance | AquaRun',
    sub: 'Gallons delivered to you and empties returned.',
  },
  addresses: {
    title: 'Saved addresses',
    docTitle: 'Saved addresses | AquaRun',
    sub: 'Add and manage your delivery addresses.',
  },
  profile: {
    title: 'Profile',
    docTitle: 'Profile | AquaRun',
    sub: 'Update your details and password.',
  },
};

const STAFF_PAGE_META = {
  dashboard: {
    title: 'Station dashboard',
    docTitle: 'Station dashboard | AquaRun',
    sub: 'Start with the oldest order that needs action.',
  },
  orders: {
    title: 'Orders',
    docTitle: 'Orders | AquaRun',
    sub: 'Filter the queue and open an order for its next required action.',
  },
  'order-processing': {
    title: 'Order processing',
    docTitle: 'Order processing | AquaRun',
    sub: 'One main action per status keeps each order moving.',
  },
  remittance: {
    title: 'Cash & sales',
    docTitle: 'Cash & sales | AquaRun',
    sub: 'Verify rider cash turnovers and track reconciled sales.',
  },
  'bottle-ledger': {
    title: 'Container ledger',
    docTitle: 'Container ledger | AquaRun',
    sub: 'Container movements recorded per delivered order and customer.',
  },
  customers: {
    title: 'Customers',
    docTitle: 'Customers | AquaRun',
    sub: 'Customer records and current bottle balances.',
  },
  profile: {
    title: 'Profile',
    docTitle: 'Profile | AquaRun',
    sub: 'Update your details and password.',
  },
};

const RIDER_PAGE_META = {
  'my-deliveries': {
    title: 'My deliveries',
    docTitle: 'My deliveries | AquaRun',
    sub: '',
  },
  'delivery-details': {
    title: 'Delivery details',
    docTitle: 'Delivery details | AquaRun',
    sub: '',
  },
  'complete-delivery': {
    title: 'Complete delivery',
    docTitle: 'Complete delivery | AquaRun',
    sub: '',
  },
  'delivery-history': {
    title: 'Delivery history',
    docTitle: 'Delivery history | AquaRun',
    sub: 'Your past deliveries with counts and payment',
  },
  remittance: {
    title: 'Cash record',
    docTitle: 'Cash record | AquaRun',
    sub: 'Track your collected cash, submitted turnovers, and approved records',
  },
  profile: {
    title: 'Profile',
    docTitle: 'Profile | AquaRun',
    sub: 'Update your details and availability',
  },
};

const ADMIN_PAGE_META = {
  dashboard: {
    title: 'Dashboard',
    docTitle: 'Dashboard | AquaRun',
    sub: '',
  },
  reports: {
    title: 'Reports',
    docTitle: 'Reports | AquaRun',
    sub: '',
  },
  'all-orders': {
    title: 'All orders',
    docTitle: 'All orders | AquaRun',
    sub: 'Monitoring only. Staff process orders.',
  },
  users: {
    title: 'Manage users',
    docTitle: 'Manage users | AquaRun',
    sub: 'Add, edit or deactivate staff and rider accounts',
  },
  products: {
    title: 'Products & prices',
    docTitle: 'Products & prices | AquaRun',
    sub: 'Refill types, photos, per-gallon prices and service charge',
  },
  'time-slots': {
    title: 'Time slots',
    docTitle: 'Time slots | AquaRun',
    sub: 'Set slot times and capacity per slot',
  },
  settings: {
    title: 'Station settings',
    docTitle: 'Settings | AquaRun',
    sub: 'Station reference location, delivery radius, and store controls',
  },
};

const ROLE_LABELS = {
  customer: 'Customer',
  staff: 'Station staff',
  rider: 'Delivery rider',
  admin: 'Owner · Admin',
};

const BRAND_SUBTITLES = {
  customer: 'Refill and delivery',
  staff: 'Station staff',
  rider: 'Rider workspace',
  admin: 'Owner workspace',
};

let activeCleanup = null;
let currentProfile = null;
let spaListenersAttached = false;
let currentSpaRole = null;
let currentActivePageKey = null;

const MODULE_CACHE = new Map();

function normalizeNavKey(rawKey) {
  const clean = String(rawKey || '').replace(/\.html$/i, '');
  return clean === 'complete-delivery' ? 'delivery-details' : clean;
}

function preloadRoleModules(role, me = null) {
  const metaMap = getPageMetaMap(role);
  const keys = Object.keys(metaMap || {});
  setTimeout(() => {
    keys.forEach((k) => {
      const cacheKey = `${role}/${k}`;
      if (!MODULE_CACHE.has(cacheKey)) {
        import(`../pages/${role}/${k}.js`)
          .then((m) => MODULE_CACHE.set(cacheKey, m))
          .catch(() => {});
      }
    });
  }, 100);
}

export async function updateCustomerActiveOrderBadge(customerId) {
  const badge = document.querySelector('#nav-track-badge');
  if (!badge || !customerId) return;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .not('status', 'in', '("completed","cancelled")');
  const num = Number(count || 0);
  try {
    sessionStorage.setItem(BADGE_CACHE_KEY, String(num));
  } catch {}
  if (num > 0) {
    badge.textContent = String(num);
    badge.hidden = false;
    badge.removeAttribute('hidden');
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.hidden = true;
    badge.setAttribute('hidden', '');
    badge.style.display = 'none';
  }
}

export async function updateStaffOrdersBadge() {
  const badge = document.querySelector('#nav-staff-orders-badge');
  if (!badge) return;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['submitted', 'confirmed', 'refilling', 'ready']);
  const num = Number(count || 0);
  try {
    sessionStorage.setItem(STAFF_BADGE_CACHE_KEY, String(num));
  } catch {}
  if (num > 0) {
    badge.textContent = String(num);
    badge.hidden = false;
    badge.removeAttribute('hidden');
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.hidden = true;
    badge.setAttribute('hidden', '');
    badge.style.display = 'none';
  }
}

export async function updateRiderCurrentBadge(riderId) {
  const badge = document.querySelector('#nav-rider-current-badge');
  if (!badge || !riderId) return;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', riderId)
    .in('status', ['rider_assigned', 'out_for_delivery']);
  const num = Number(count || 0);
  try {
    sessionStorage.setItem(RIDER_BADGE_CACHE_KEY, String(num));
  } catch {}
  if (num > 0) {
    badge.textContent = String(num);
    badge.hidden = false;
    badge.removeAttribute('hidden');
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.hidden = true;
    badge.setAttribute('hidden', '');
    badge.style.display = 'none';
  }
}

export async function updateStaffRemittanceBadge(overrideCount = null) {
  const badge = document.querySelector('#nav-staff-remittance-badge');
  if (!badge) return;
  try {
    let num = overrideCount;
    if (typeof num !== 'number') {
      let { data, error } = await supabase
        .from('orders')
        .select('id, rider_id, remittance_status, slot_note, rider_remitted, status')
        .in('status', ['delivered', 'completed']);

      if (error) {
        const fallback = await supabase
          .from('orders')
          .select('id, rider_id, slot_note, status')
          .in('status', ['delivered', 'completed']);
        data = fallback.data;
      }

      const awaitingKeys = new Set();
      for (const o of data || []) {
        const note = String(o.slot_note || '');
        const isSettled =
          Boolean(o.rider_remitted) ||
          note.includes('[REMITTED]') ||
          o.remittance_status === 'approved';
        const isSubmitted =
          !isSettled &&
          (o.remittance_status === 'submitted' || note.includes('[REMITTANCE_SUBMITTED]'));

        if (isSubmitted) {
          awaitingKeys.add(o.rider_id || o.id);
        }
      }
      num = awaitingKeys.size;
    }

    try {
      sessionStorage.setItem(STAFF_REMITTANCE_BADGE_CACHE_KEY, String(num));
    } catch {}

    if (num > 0) {
      badge.textContent = String(num);
      badge.hidden = false;
      badge.removeAttribute('hidden');
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.hidden = true;
      badge.setAttribute('hidden', '');
      badge.style.display = 'none';
    }
  } catch {}
}

export async function updateRiderRemittanceBadge(riderId, overrideCount = null) {
  const badge = document.querySelector('#nav-rider-remittance-badge');
  if (!badge || !riderId) return;
  try {
    let count = overrideCount;
    if (typeof count !== 'number') {
      let { data, error } = await supabase
        .from('orders')
        .select('id, remittance_status, slot_note, rider_remitted, status')
        .eq('rider_id', riderId)
        .in('status', ['delivered', 'completed']);

      if (error) {
        const fallback = await supabase
          .from('orders')
          .select('id, slot_note, status')
          .eq('rider_id', riderId)
          .in('status', ['delivered', 'completed']);
        data = fallback.data;
      }

      count = 0;
      for (const o of data || []) {
        const note = String(o.slot_note || '');
        const isSettled =
          Boolean(o.rider_remitted) ||
          note.includes('[REMITTED]') ||
          o.remittance_status === 'approved';
        if (!isSettled) {
          count++;
        }
      }
    }

    try {
      sessionStorage.setItem(RIDER_REMITTANCE_BADGE_CACHE_KEY, String(count));
    } catch {}

    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
      badge.removeAttribute('hidden');
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.hidden = true;
      badge.setAttribute('hidden', '');
      badge.style.display = 'none';
    }
  } catch {}
}

let shellRealtimeSub = null;
let shellHeartbeatTimer = null;

export function startShellRealtimeSync(role, profile) {
  if (shellRealtimeSub) return;
  const channelName = `shell-sync-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (role === 'staff') {
    shellRealtimeSub = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        updateStaffOrdersBadge().catch(() => {});
        updateStaffRemittanceBadge().catch(() => {});
      })
      .subscribe();
    shellHeartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        updateStaffOrdersBadge().catch(() => {});
        updateStaffRemittanceBadge().catch(() => {});
      }
    }, 45000);
  } else if (role === 'rider' && profile?.id) {
    shellRealtimeSub = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        updateRiderCurrentBadge(profile.id).catch(() => {});
        updateRiderRemittanceBadge(profile.id).catch(() => {});
      })
      .subscribe();
    shellHeartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        updateRiderCurrentBadge(profile.id).catch(() => {});
        updateRiderRemittanceBadge(profile.id).catch(() => {});
      }
    }, 45000);
  } else if (role === 'customer' && profile?.id) {
    shellRealtimeSub = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        () => {
          updateCustomerActiveOrderBadge(profile.id).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_status_log',
        },
        () => {
          updateCustomerActiveOrderBadge(profile.id).catch(() => {});
        }
      )
      .subscribe();
    shellHeartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        updateCustomerActiveOrderBadge(profile.id).catch(() => {});
      }
    }, 15000);
  }
}

export function closeMobileSidebarMenu() {
  const container = document.querySelector('#sidebar') || document.querySelector('#app-nav');
  document.body.classList.remove('is-drawer-open');
  if (!container) return;
  container.classList.remove('is-menu-open');
  const toggleBtn = container.querySelector('#sidebar-menu-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = ICONS.menu;
  }
}

export function openMobileSidebarMenu() {
  const container = document.querySelector('#sidebar') || document.querySelector('#app-nav');
  if (!container) return;
  container.classList.add('is-menu-open');
  document.body.classList.add('is-drawer-open');
  const toggleBtn = container.querySelector('#sidebar-menu-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.innerHTML = ICONS.close;
  }
}

export function setActiveNavKey(activeKey) {
  const container = document.querySelector('#sidebar') || document.querySelector('#app-nav');
  if (!container) return;
  const normalizedKey = normalizeNavKey(activeKey);
  container.querySelectorAll('.sidebar-link').forEach((link) => {
    const key = link.dataset.navKey;
    link.classList.toggle('is-active', key === normalizedKey);
  });
  closeMobileSidebarMenu();
}

// Renders the sidebar into #sidebar (or #app-nav). If already rendered for the same user, just updates the active state.
export async function renderNav(profileOrRole, activeKey) {
  const container = document.querySelector('#sidebar') || document.querySelector('#app-nav');
  if (!container) return;

  let profile = typeof profileOrRole === 'object' && profileOrRole !== null ? profileOrRole : getCachedProfile();
  if (!profile) {
    try {
      profile = await getCurrentProfile();
    } catch {
      profile = { role: typeof profileOrRole === 'string' ? profileOrRole : 'customer', full_name: 'User' };
    }
  }
  currentProfile = profile;

  const role = profile?.role || 'customer';
  const defaultRoleName =
    role === 'rider'
      ? 'Rider'
      : role === 'staff'
        ? 'Staff'
        : role === 'admin'
          ? 'Admin'
          : 'Customer';
  const fullName = (profile?.full_name || '').trim() || defaultRoleName;

  if (container.dataset.renderedRole === role) {
    const nameEl = container.querySelector('.sidebar-user-name');
    const avatarEl = container.querySelector('.sidebar-avatar');
    if (nameEl) nameEl.textContent = fullName;
    if (avatarEl) avatarEl.textContent = getInitials(fullName);
    setActiveNavKey(activeKey);
    if (role === 'customer' && profile?.id) {
      updateCustomerActiveOrderBadge(profile.id).catch(() => {});
    } else if (role === 'staff') {
      updateStaffOrdersBadge().catch(() => {});
      updateStaffRemittanceBadge().catch(() => {});
    } else if (role === 'rider' && profile?.id) {
      updateRiderCurrentBadge(profile.id).catch(() => {});
      updateRiderRemittanceBadge(profile.id).catch(() => {});
    }
    return;
  }

  const sections = NAV_SECTIONS[role] ?? NAV_SECTIONS.customer;
  const cachedCustomerBadge = Number(sessionStorage.getItem(BADGE_CACHE_KEY) || 0);
  const cachedStaffBadge = Number(sessionStorage.getItem(STAFF_BADGE_CACHE_KEY) || 0);
  const cachedStaffRemittanceBadge = Number(sessionStorage.getItem(STAFF_REMITTANCE_BADGE_CACHE_KEY) || 0);
  const cachedRiderBadge = Number(sessionStorage.getItem(RIDER_BADGE_CACHE_KEY) || 0);
  const cachedRiderRemittanceBadge = Number(sessionStorage.getItem(RIDER_REMITTANCE_BADGE_CACHE_KEY) || 0);
  const normalizedKey = normalizeNavKey(activeKey);

  const sectionsHtml = sections
    .map((section) => {
      const headingHtml = section.heading
        ? `<p class="sidebar-group-label">${escapeHtml(section.heading)}</p>`
        : '';
      const linksHtml = section.items
        .map((item) => {
          const isActive = item.key === normalizedKey;
          let badgeVal = 0;
          if (item.badgeId === 'nav-track-badge') badgeVal = cachedCustomerBadge;
          if (item.badgeId === 'nav-staff-orders-badge') badgeVal = cachedStaffBadge;
          if (item.badgeId === 'nav-staff-remittance-badge') badgeVal = cachedStaffRemittanceBadge;
          if (item.badgeId === 'nav-rider-current-badge') badgeVal = cachedRiderBadge;
          if (item.badgeId === 'nav-rider-remittance-badge') badgeVal = cachedRiderRemittanceBadge;
          const badgeHtml = item.badgeId
            ? `<span class="sidebar-badge" id="${item.badgeId}" ${badgeVal > 0 ? '' : 'hidden'}>${badgeVal > 0 ? badgeVal : ''}</span>`
            : '';
          return `
            <a class="sidebar-link${isActive ? ' is-active' : ''}" href="${item.key}.html" data-nav-key="${escapeHtml(item.key)}" title="${escapeHtml(item.label)}">
              <span class="sidebar-icon">${ICONS[item.icon] || ''}</span>
              <span class="sidebar-label">${escapeHtml(item.label)}</span>
              ${badgeHtml}
            </a>
          `;
        })
        .join('');
      return `<div class="sidebar-group">${headingHtml}${linksHtml}</div>`;
    })
    .join('');

  const isSavedCollapsed = localStorage.getItem('aquarun_sidebar_collapsed') === 'true';
  if (isSavedCollapsed) {
    container.classList.add('is-collapsed');
    document.querySelector('.shell')?.classList.add('is-collapsed');
  }

  container.dataset.renderedRole = role;
  container.innerHTML = `
    <div class="sidebar-top">
      <div class="sidebar-brand-row">
        <a class="sidebar-brand" href="${sections[0]?.items[0]?.key || 'home'}.html" title="AquaRun">
          <span class="sidebar-brand-mark">${ICONS.logoDrop}</span>
          <span class="sidebar-brand-text">
            <span class="sidebar-brand-title">Aqua<span>Run</span></span>
            <span class="sidebar-brand-sub">${escapeHtml(BRAND_SUBTITLES[role] || 'Refill and delivery')}</span>
          </span>
        </a>
        <button
          type="button"
          class="sidebar-collapse-btn"
          id="sidebar-collapse-btn"
          title="${isSavedCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}"
          aria-label="Toggle sidebar minimization"
        >
          ${isSavedCollapsed ? ICONS.panelExpand : ICONS.panelCollapse}
        </button>
        <button
          type="button"
          class="sidebar-hamburger"
          id="sidebar-menu-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded="false"
          aria-controls="sidebar-collapsible"
        >
          ${ICONS.menu}
        </button>
      </div>
      <div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div>
      <div class="sidebar-collapsible" id="sidebar-collapsible" role="dialog" aria-label="Navigation menu">
        <div class="sidebar-drawer-head">
          <a class="sidebar-brand" href="${sections[0]?.items[0]?.key || 'home'}.html">
            <span class="sidebar-brand-mark">${ICONS.logoDrop}</span>
            <span class="sidebar-brand-text">
              <span class="sidebar-brand-title">Aqua<span>Run</span></span>
              <span class="sidebar-brand-sub">${escapeHtml(BRAND_SUBTITLES[role] || 'Refill and delivery')}</span>
            </span>
          </a>
          <button
            type="button"
            class="sidebar-drawer-close"
            id="sidebar-drawer-close"
            aria-label="Close navigation menu"
          >
            ${ICONS.close}
          </button>
        </div>
        <nav class="sidebar-nav" aria-label="Main navigation">
          ${sectionsHtml}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <span class="sidebar-avatar">${escapeHtml(getInitials(fullName))}</span>
            <div class="sidebar-user-meta">
              <p class="sidebar-user-name">${escapeHtml(fullName)}</p>
              <p class="sidebar-user-role">${escapeHtml(ROLE_LABELS[role] || 'Customer')}</p>
            </div>
          </div>
          <button type="button" class="sidebar-logout" id="sidebar-logout-btn" title="Log out" aria-label="Log out">
            ${ICONS.logout}
          </button>
        </div>
      </div>
    </div>
  `;

  const collapseBtn = container.querySelector('#sidebar-collapse-btn');
  collapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willBeCollapsed = !container.classList.contains('is-collapsed');
    if (willBeCollapsed) {
      container.classList.add('is-collapsed');
      document.querySelector('.shell')?.classList.add('is-collapsed');
      collapseBtn.innerHTML = ICONS.panelExpand;
      collapseBtn.title = 'Expand sidebar';
      localStorage.setItem('aquarun_sidebar_collapsed', 'true');
    } else {
      container.classList.remove('is-collapsed');
      document.querySelector('.shell')?.classList.remove('is-collapsed');
      collapseBtn.innerHTML = ICONS.panelCollapse;
      collapseBtn.title = 'Minimize sidebar';
      localStorage.setItem('aquarun_sidebar_collapsed', 'false');
    }
  });

  container.querySelector('#sidebar-logout-btn')?.addEventListener('click', async () => {
    const confirmed = await confirmModal({
      title: 'Log out?',
      message: 'Are you sure you want to end your current session and log out?',
      confirmText: 'Log out',
      cancelText: 'Stay logged in',
    });
    if (confirmed) {
      const logoutBtn = container.querySelector('#sidebar-logout-btn');
      if (logoutBtn) {
        logoutBtn.style.pointerEvents = 'none';
        logoutBtn.style.opacity = '0.5';
      }
      await logOut();
    }
  });
  const toggleBtn = container.querySelector('#sidebar-menu-toggle');
  const closeDrawerBtn = container.querySelector('#sidebar-drawer-close');
  const backdropEl = container.querySelector('#sidebar-backdrop');

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (container.classList.contains('is-menu-open')) {
      closeMobileSidebarMenu();
    } else {
      openMobileSidebarMenu();
    }
  });

  closeDrawerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMobileSidebarMenu();
  });

  backdropEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMobileSidebarMenu();
  });

  container.querySelectorAll('.sidebar-link, .sidebar-brand').forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileSidebarMenu();
    });
  });

  if (role === 'customer' && profile?.id) {
    updateCustomerActiveOrderBadge(profile.id).catch(() => {});
  } else if (role === 'staff') {
    updateStaffOrdersBadge().catch(() => {});
    updateStaffRemittanceBadge().catch(() => {});
  } else if (role === 'rider' && profile?.id) {
    updateRiderCurrentBadge(profile.id).catch(() => {});
    updateRiderRemittanceBadge(profile.id).catch(() => {});
  }
}

function getPageMetaMap(role) {
  if (role === 'staff') return STAFF_PAGE_META;
  if (role === 'rider') return RIDER_PAGE_META;
  if (role === 'admin') return ADMIN_PAGE_META;
  return CUSTOMER_PAGE_META;
}

function getRolePageKeyFromUrl(urlObj, role) {
  const metaMap = getPageMetaMap(role);
  const folder = role;
  const folderRegex = new RegExp(`\\/${folder}\\/([a-z0-9-]+)(?:\\.html)?$`, 'i');
  const match = urlObj.pathname.match(folderRegex);
  if (match && metaMap[match[1]]) return match[1];
  const fileMatch = urlObj.pathname.match(/\/?([a-z0-9-]+)(?:\.html)?$/i);
  if (fileMatch && metaMap[fileMatch[1]]) return fileMatch[1];
  return null;
}

function updateTopbarForRolePage(role, pageKey) {
  const meta = getPageMetaMap(role)[pageKey];
  if (!meta) return;
  document.title = meta.docTitle;
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  let titleEl = topbar.querySelector('#page-title');
  let subEl = topbar.querySelector('#page-sub');
  let rightEl = topbar.querySelector('#topbar-right');

  if (!titleEl || !subEl || !rightEl) {
    topbar.innerHTML = `
      <div class="topbar-left">
        <h1 id="page-title">${escapeHtml(meta.title)}</h1>
        <p class="topbar-sub text-muted" id="page-sub">${escapeHtml(meta.sub || '')}</p>
      </div>
      <div class="topbar-right" id="topbar-right"></div>
    `;
  } else {
    titleEl.textContent = meta.title;
    subEl.textContent = meta.sub || '';
    rightEl.innerHTML = '';
  }
}

function triggerSmoothContentEnter() {
  const content = document.querySelector('#content');
  if (!content) return;
  content.classList.remove('spa-view-enter');
  void content.offsetWidth;
  content.classList.add('spa-view-enter');
}

function ensureRolePageStylesheet(role, pageKey) {
  if (typeof document === 'undefined') return;
  const linkId = `page-style-${role}-${pageKey}`;
  if (document.getElementById(linkId)) return;
  const existing = document.querySelector(`link[href*="css/pages/${role}/${pageKey}.css"]`);
  if (existing) {
    existing.id = linkId;
    return;
  }
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `../css/pages/${role}/${pageKey}.css?v=20261028`;
  document.head.appendChild(link);
}

let currentNavToken = 0;

export async function navigateRoleSpa(role, targetUrl, { push = true } = {}) {
  const resolved = new URL(targetUrl, window.location.href);
  const pageKey = getRolePageKeyFromUrl(resolved, role);
  if (!pageKey) {
    window.location.href = resolved.href;
    return;
  }

  const navToken = ++currentNavToken;

  if (push && resolved.href !== window.location.href) {
    window.history.pushState({ role, pageKey }, '', resolved.href);
  }

  if (typeof activeCleanup === 'function') {
    try {
      activeCleanup();
    } catch {}
    activeCleanup = null;
  }

  currentActivePageKey = pageKey;
  const profile = currentProfile || getCachedProfile() || (await requireRole(role));
  currentProfile = profile;

  setActiveNavKey(pageKey);
  updateTopbarForRolePage(role, pageKey);

  // Immediately clear old page DOM to avoid stale tables/forms popping up or lingering
  const content = document.querySelector('#content');
  if (content) {
    content.innerHTML = `
      <div class="spa-nav-skeleton" style="padding: 3rem 1rem; text-align: center;">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div class="text-muted" style="font-size: 13px; font-weight: 500;">Loading...</div>
      </div>
    `;
  }
  triggerSmoothContentEnter();
  ensureRolePageStylesheet(role, pageKey);

  const moduleKey = `${role}/${pageKey}`;
  let mod = MODULE_CACHE.get(moduleKey);
  if (!mod) {
    mod = await import(`../pages/${role}/${pageKey}.js?v=20261028`);
    MODULE_CACHE.set(moduleKey, mod);
  }

  if (typeof mod.mount === 'function') {
    const cleanup = await mod.mount(profile);
    // If another navigation occurred while awaiting mount, discard and clean up immediately
    if (navToken !== currentNavToken || currentActivePageKey !== pageKey) {
      if (typeof cleanup === 'function') {
        try { cleanup(); } catch {}
      }
      return;
    }
    activeCleanup = cleanup;
  }
  if (role === 'customer' && profile?.id) {
    updateCustomerActiveOrderBadge(profile.id).catch(() => {});
  } else if (role === 'staff') {
    updateStaffOrdersBadge().catch(() => {});
    updateStaffRemittanceBadge().catch(() => {});
  } else if (role === 'rider' && profile?.id) {
    updateRiderCurrentBadge(profile.id).catch(() => {});
    updateRiderRemittanceBadge(profile.id).catch(() => {});
  }
}

export async function navigateCustomerSpa(targetUrl, options) {
  return navigateRoleSpa('customer', targetUrl, options);
}

export async function navigateStaffSpa(targetUrl, options) {
  return navigateRoleSpa('staff', targetUrl, options);
}

export async function navigateRiderSpa(targetUrl, options) {
  return navigateRoleSpa('rider', targetUrl, options);
}

export async function navigateAdminSpa(targetUrl, options) {
  return navigateRoleSpa('admin', targetUrl, options);
}

function attachRoleSpaListeners(role) {
  if (spaListenersAttached && currentSpaRole === role) return;
  spaListenersAttached = true;
  currentSpaRole = role;

  document.addEventListener('click', (e) => {
    const sidebarEl = document.querySelector('#sidebar');
    if (sidebarEl && sidebarEl.classList.contains('is-menu-open') && !sidebarEl.contains(e.target)) {
      closeMobileSidebarMenu();
    }

    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;

    const resolved = new URL(link.getAttribute('href'), window.location.href);
    if (resolved.origin !== window.location.origin) return;

    const pageKey = getRolePageKeyFromUrl(resolved, currentSpaRole);
    if (!pageKey) return;

    e.preventDefault();
    closeMobileSidebarMenu();
    navigateRoleSpa(currentSpaRole, resolved.href, { push: true });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileSidebarMenu();
    }
  });

  window.addEventListener('popstate', () => {
    closeMobileSidebarMenu();
    navigateRoleSpa(currentSpaRole, window.location.href, { push: false });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      closeMobileSidebarMenu();
    }
  });
}

export async function bootCustomerPage(pageKey, mountFn) {
  if (window.__AQUARUN_SPA_BOOTED__) return;
  window.__AQUARUN_SPA_BOOTED__ = true;

  const cleanKey = normalizeNavKey(pageKey);
  currentActivePageKey = cleanKey;
  attachRoleSpaListeners('customer');
  preloadRoleModules('customer');

  const cached = getCachedProfile();
  if (cached && cached.role === 'customer') {
    renderNav(cached, cleanKey);
  }

  const me = await requireRole('customer');
  currentProfile = me;
  preloadRoleModules('customer', me);
  await renderNav(me, cleanKey);
  startShellRealtimeSync('customer', me);
  if (currentActivePageKey === cleanKey) {
    const cleanup = await mountFn(me);
    if (currentActivePageKey === cleanKey) {
      activeCleanup = cleanup;
    } else if (typeof cleanup === 'function') {
      try { cleanup(); } catch {}
    }
  }
}

export async function bootStaffPage(pageKey, mountFn) {
  if (window.__AQUARUN_SPA_BOOTED__) return;
  window.__AQUARUN_SPA_BOOTED__ = true;

  const cleanKey = normalizeNavKey(pageKey);
  currentActivePageKey = cleanKey;
  attachRoleSpaListeners('staff');
  preloadRoleModules('staff');

  const cached = getCachedProfile();
  if (cached && cached.role === 'staff') {
    renderNav(cached, cleanKey);
  }

  const me = await requireRole('staff');
  currentProfile = me;
  preloadRoleModules('staff', me);
  await renderNav(me, cleanKey);
  startShellRealtimeSync('staff', me);
  if (currentActivePageKey === cleanKey) {
    const cleanup = await mountFn(me);
    if (currentActivePageKey === cleanKey) {
      activeCleanup = cleanup;
    } else if (typeof cleanup === 'function') {
      try { cleanup(); } catch {}
    }
  }
}

export async function bootRiderPage(pageKey, mountFn) {
  if (window.__AQUARUN_SPA_BOOTED__) return;
  window.__AQUARUN_SPA_BOOTED__ = true;

  const cleanKey = normalizeNavKey(pageKey);
  currentActivePageKey = cleanKey;
  attachRoleSpaListeners('rider');
  preloadRoleModules('rider');

  const cached = getCachedProfile();
  if (cached && cached.role === 'rider') {
    renderNav(cached, cleanKey);
  }

  const me = await requireRole('rider');
  currentProfile = me;
  preloadRoleModules('rider', me);
  await renderNav(me, cleanKey);
  startShellRealtimeSync('rider', me);
  if (currentActivePageKey === cleanKey) {
    const cleanup = await mountFn(me);
    if (currentActivePageKey === cleanKey) {
      activeCleanup = cleanup;
    } else if (typeof cleanup === 'function') {
      try { cleanup(); } catch {}
    }
  }
}

export async function bootAdminPage(pageKey, mountFn) {
  if (window.__AQUARUN_SPA_BOOTED__) return;
  window.__AQUARUN_SPA_BOOTED__ = true;

  const cleanKey = normalizeNavKey(pageKey);
  currentActivePageKey = cleanKey;
  attachRoleSpaListeners('admin');
  preloadRoleModules('admin');

  const cached = getCachedProfile();
  if (cached && cached.role === 'admin') {
    renderNav(cached, cleanKey);
  }

  const me = await requireRole('admin');
  currentProfile = me;
  preloadRoleModules('admin', me);
  await renderNav(me, cleanKey);
  if (currentActivePageKey === cleanKey) {
    const cleanup = await mountFn(me);
    if (currentActivePageKey === cleanKey) {
      activeCleanup = cleanup;
    } else if (typeof cleanup === 'function') {
      try { cleanup(); } catch {}
    }
  }
}
