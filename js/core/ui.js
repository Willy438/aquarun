// Toast, modal, date and peso formatting.
export function formatPeso(value, { decimals = false } = {}) {
  const num = Number(value ?? 0);
  const hasCents = Math.round(num * 100) % 100 !== 0;
  const digits = decimals || hasCents ? 2 : 0;
  return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDateShort(dateValue) {
  if (!dateValue) return '—';
  const d = typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Date(dateValue + 'T00:00:00')
    : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return String(dateValue);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}

export function formatDateHeading(dateValue = new Date()) {
  const d = new Date(dateValue);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export function formatTimeShort(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

export function getTodayManila() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

export function getGreeting(fullName = '', role = 'customer') {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Manila',
    }).format(new Date())
  );
  const roleDefault =
    role === 'rider'
      ? 'Rider'
      : role === 'staff'
        ? 'Staff'
        : role === 'admin'
          ? 'Admin'
          : 'Customer';
  const clean = String(fullName || '').trim();
  const firstName = clean ? clean.split(/\s+/)[0] : roleDefault;
  if (hour < 12) return `Good morning, ${firstName}`;
  if (hour < 18) return `Good afternoon, ${firstName}`;
  return `Good evening, ${firstName}`;
}

export function getInitials(fullName = '') {
  const parts = String(fullName || 'Customer').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CU';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function showToast(message, type = 'info') {
  let root = document.querySelector('.toast-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'toast-root';
    document.body.append(root);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  root.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}

const EYE_OPEN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a16.8 16.8 0 0 1-2.7 3.6"/><path d="M6.6 6.7C4 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

export function enablePasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.closest('.password-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'password-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.title = 'Show password';
    btn.innerHTML = EYE_OPEN_SVG;

    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE_OPEN_SVG : EYE_OFF_SVG;
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.title = showing ? 'Show password' : 'Hide password';
    });

    wrapper.append(btn);
  });
}

export function confirmModal({
  title = 'Confirm action',
  message = 'Are you sure you want to continue?',
  confirmText = 'Confirm',
  cancelText = 'Keep it',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        <p class="modal-body">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-light" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-action="cancel"]')) close(false);
      if (e.target.closest('[data-action="confirm"]')) close(true);
    });
    document.body.append(backdrop);
  });
}

// Fast in-memory + sessionStorage cache for 0ms SPA tab switching (stale-while-revalidate)
const MEMORY_CACHE = new Map();
const CACHE_PREFIX = 'aquarun_swr_';

export async function cachedQuery(key, fetcher, { ttlMs = 45000, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && MEMORY_CACHE.has(key)) {
    const entry = MEMORY_CACHE.get(key);
    if (now - entry.ts < ttlMs) {
      return entry.data;
    }
    // Return stale data immediately while refreshing in background
    Promise.resolve()
      .then(() => fetcher())
      .then((fresh) => {
        MEMORY_CACHE.set(key, { data: fresh, ts: Date.now() });
        try {
          sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data: fresh, ts: Date.now() }));
        } catch {}
      })
      .catch(() => {});
    return entry.data;
  }

  if (!forceRefresh) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data !== undefined && now - Number(parsed.ts || 0) < ttlMs * 2) {
          MEMORY_CACHE.set(key, parsed);
          if (now - Number(parsed.ts || 0) >= ttlMs) {
            Promise.resolve()
              .then(() => fetcher())
              .then((fresh) => {
                MEMORY_CACHE.set(key, { data: fresh, ts: Date.now() });
                try {
                  sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data: fresh, ts: Date.now() }));
                } catch {}
              })
              .catch(() => {});
          }
          return parsed.data;
        }
      }
    } catch {}
  }

  const data = await fetcher();
  const record = { data, ts: Date.now() };
  MEMORY_CACHE.set(key, record);
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(record));
  } catch {}
  return data;
}

export function invalidateDataCache(prefix = '') {
  for (const k of Array.from(MEMORY_CACHE.keys())) {
    if (!prefix || k.startsWith(prefix)) {
      MEMORY_CACHE.delete(k);
    }
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX + prefix)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {}
}

/**
 * Paginates an in-memory array of items.
 * @param {Array} items
 * @param {number} page 1-based page index
 * @param {number} pageSize items per page
 * @returns {{ items: Array, currentPage: number, totalPages: number, totalItems: number, startIndex: number, endIndex: number }}
 */
export function paginateList(items, page = 1, pageSize = 10) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    currentPage,
    totalPages,
    totalItems,
    startIndex: totalItems === 0 ? 0 : startIndex + 1,
    endIndex,
  };
}

/**
 * Renders numbered pagination buttons (e.g. < Prev 1 2 3 4 Next >).
 * @param {{ currentPage: number, totalPages: number, totalItems: number, startIndex: number, endIndex: number }} meta
 * @returns {string} HTML string
 */
export function renderPaginationHtml({ currentPage, totalPages, totalItems, startIndex, endIndex }) {
  if (totalItems === 0) return '';

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const buttonsHtml = pages
    .map((p) => {
      if (p === '...') {
        return `<span class="pagination-ellipsis">&hellip;</span>`;
      }
      const isActive = p === currentPage;
      return `
        <button type="button" class="pagination-btn ${isActive ? 'is-active' : ''}" data-page="${p}" aria-label="Page ${p}">
          ${p}
        </button>
      `;
    })
    .join('');

  return `
    <div class="pagination-bar">
      <div class="pagination-info">
        Showing <strong>${startIndex}</strong> to <strong>${endIndex}</strong> of <strong>${totalItems}</strong> entries
      </div>
      <div class="pagination-controls">
        <button type="button" class="pagination-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Previous page">
          &larr; Prev
        </button>
        ${buttonsHtml}
        <button type="button" class="pagination-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Next page">
          Next &rarr;
        </button>
      </div>
    </div>
  `;
}

