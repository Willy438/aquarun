import { bootCustomerPage, navigateCustomerSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateHeading,
  formatDateShort,
  formatPeso,
  getGreeting,
  showToast,
} from '../../core/ui.js';
import {
  getCustomerActiveOrders,
  getCustomerOrders,
  renderCustomerOrderHero,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import { getCustomerBottleBalance } from '../../services/ledgerService.js';
import { getCustomerAddresses } from '../../services/addressesService.js';
import { getActiveProducts } from '../../services/productsService.js';

const ICONS = {
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

export async function mount(me) {
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const content = document.querySelector('#content');

  if (pageTitle) pageTitle.textContent = getGreeting(me.full_name, me.role || 'customer');
  if (pageSub) pageSub.textContent = formatDateHeading();

  let selectedActiveOrderId = null;

  async function loadAndRender() {
    try {
      const [activeOrders, allOrders, balance, addresses, products] = await Promise.all([
        getCustomerActiveOrders(me.id),
        getCustomerOrders(me.id, { limit: 6 }),
        getCustomerBottleBalance(me.id),
        getCustomerAddresses(me.id),
        getActiveProducts(),
      ]);

      const activeOrder =
        activeOrders.find((o) => o.id === selectedActiveOrderId) || activeOrders[0] || null;
      if (activeOrder) {
        selectedActiveOrderId = activeOrder.id;
      }

      const defaultAddr = addresses.find((a) => a.is_default) || addresses[0] || null;
      const minPrice = products.length ? Math.min(...products.map((p) => Number(p.price))) : 25;
      const maxPrice = products.length ? Math.max(...products.map((p) => Number(p.price))) : 30;
      const priceLabel =
        minPrice === maxPrice
          ? `${formatPeso(minPrice)} each`
          : `${formatPeso(minPrice)}–${formatPeso(maxPrice)} each`;

      const recentOrders = allOrders.slice(0, 4);

      const switcherHtml =
        activeOrders.length > 1
          ? `
            <div class="track-switcher-bar" role="region" aria-label="Active orders shortcut">
              <div class="track-switcher-head">
                <span>Active orders</span>
                <span class="track-switcher-count">${activeOrders.length}</span>
              </div>
              <div class="track-switcher-list">
                ${activeOrders
                  .map((o) => {
                    const isCurrent = activeOrder && o.id === activeOrder.id;
                    return `
                      <button
                        type="button"
                        class="track-switcher-btn${isCurrent ? ' is-active' : ''}"
                        data-home-switch-order="${escapeHtml(o.id)}"
                      >
                        <span class="track-switcher-order">#${escapeHtml(o.order_number)}</span>
                        <span class="track-switcher-meta">${escapeHtml(summarizeOrderItems(o.items))}</span>
                        <span class="pill status-${escapeHtml(o.status)}">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `
          : '';

      const heroHtml = activeOrder
        ? `${switcherHtml}${renderCustomerOrderHero(activeOrder, { showTrackButton: true })}`
        : `
          <div class="hero-banner">
            <div class="hero-top">
              <div>
                <div class="hero-meta-line"><span>AquaRun Refill &amp; Delivery</span></div>
                <h2 class="hero-status-title">No active delivery right now</h2>
                <p class="hero-status-sub">Running low on water? Place a refill order and pick your preferred delivery slot.</p>
              </div>
              <a class="btn btn-white btn-sm" href="new-order.html">Order refill</a>
            </div>
          </div>
        `;

      const recentCardsHtml = recentOrders.length
        ? recentOrders
            .map(
              (order) => `
              <div class="recent-order-card is-clickable" data-order-id="${escapeHtml(order.id)}">
                <div class="recent-order-card-head">
                  <span class="recent-order-num">#${escapeHtml(order.order_number)}</span>
                  <span class="pill status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>
                </div>
                <div class="recent-order-card-items">${escapeHtml(summarizeOrderItems(order.items))}</div>
                <div class="recent-order-card-foot">
                  <span class="recent-order-date">${escapeHtml(formatDateShort(order.delivery_date || order.created_at))}</span>
                  <span class="recent-order-total">${escapeHtml(formatPeso(order.total))}</span>
                </div>
              </div>
            `
            )
            .join('')
        : `
          <div class="empty-state" style="padding: 24px 14px; text-align: center; color: #64748b;">
            No orders yet. Your refill orders will appear here.
          </div>
        `;

      const recentRowsHtml = recentOrders.length
        ? recentOrders
            .map(
              (order) => `
              <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
                <td class="table-order-id">#${escapeHtml(order.order_number)}</td>
                <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
                <td>${escapeHtml(formatDateShort(order.delivery_date || order.created_at))}</td>
                <td class="table-strong">${escapeHtml(formatPeso(order.total))}</td>
                <td><span class="pill status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span></td>
              </tr>
            `
            )
            .join('')
        : `
          <tr>
            <td colspan="5" class="empty-state">No orders yet. Your refill orders will appear here.</td>
          </tr>
        `;

      content.innerHTML = `
        ${heroHtml}

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.drop}</span>
                <h2 class="card-title">Bottle balance</h2>
              </div>
              <a class="card-link" href="bottle-balance.html">View ledger</a>
            </div>
            <div class="balance-hero">
              <span class="balance-hero-num">${escapeHtml(balance.balance)}</span>
              <span class="balance-hero-label">bottles with you</span>
            </div>
            <div class="balance-split">
              <div class="balance-box">
                <p class="balance-box-val">${escapeHtml(balance.bottles_delivered)}</p>
                <p class="balance-box-sub">Delivered</p>
              </div>
              <div class="balance-box">
                <p class="balance-box-val">${escapeHtml(balance.empties_collected)}</p>
                <p class="balance-box-sub">Returned</p>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.plus}</span>
                <h2 class="card-title">Need more water?</h2>
              </div>
            </div>
            <div class="kv-list">
              <div class="kv-row">
                <span class="kv-label">Round / Slim gallon refill</span>
                <span class="kv-value">${escapeHtml(priceLabel)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Deliver to default address</span>
                <span class="kv-value">${escapeHtml(defaultAddr ? defaultAddr.label : 'Add in Addresses')}</span>
              </div>
            </div>
            <div class="quick-order-cta">
              <a class="btn btn-primary btn-block" href="new-order.html">New order</a>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.clock}</span>
              <h2 class="card-title">Recent orders</h2>
            </div>
            <a class="card-link" href="order-history.html">View all</a>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Items</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recentRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `;

      content.querySelectorAll('[data-home-switch-order]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedActiveOrderId = btn.getAttribute('data-home-switch-order');
          loadAndRender();
        });
      });

      content.querySelectorAll('[data-order-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const id = row.dataset.orderId;
          const target = allOrders.find((o) => o.id === id);
          if (target && ['completed', 'cancelled'].includes(target.status)) {
            navigateCustomerSpa(`order-history.html?viewOrder=${encodeURIComponent(id)}`);
          } else {
            navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(id)}`);
          }
        });
      });
    } catch (err) {
      showToast(err.message || 'Could not load dashboard.', 'error');
    }
  }

  await loadAndRender();
  const unsub = subscribeCustomerOrders(me.id, () => {
    loadAndRender();
    renderNav(me, 'home');
  });

  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAndRender();
    }
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootCustomerPage('home', mount);
