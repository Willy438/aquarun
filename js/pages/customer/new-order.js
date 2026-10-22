import { bootCustomerPage, navigateCustomerSpa } from '../../core/nav.js';
import { escapeHtml, formatPeso, getTodayManila, setBusy, showToast } from '../../core/ui.js';
import { getActiveProducts, getServiceCharge } from '../../services/productsService.js';
import { getCustomerAddresses } from '../../services/addressesService.js';
import { getSlotAvailability } from '../../services/slotsService.js';
import { createOrder, formatAddressFull, getCustomerOrders } from '../../services/ordersService.js';
import { getCustomerBottleBalance } from '../../services/ledgerService.js';

const ICONS = {
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>`,
  roundGallon: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="19" y="5" width="10" height="5" rx="2"/><path d="M20 10v4l-7 5.5a5 5 0 0 0-2 4V38a5 5 0 0 0 5 5h16a5 5 0 0 0 5-5V23.5a5 5 0 0 0-2-4L28 14v-4"/><line x1="13" y1="26" x2="35" y2="26"/><line x1="13" y1="33" x2="35" y2="33"/></svg>`,
  slimGallon: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="20" y="5" width="8" height="4" rx="1.5"/><rect x="14" y="13" width="20" height="30" rx="4"/><path d="M18 13V9h12v4"/><path d="M24 21v12"/></svg>`,
};

function getProductIcon(name = '') {
  return /slim/i.test(name) ? ICONS.slimGallon : ICONS.roundGallon;
}

function getProductSubtitle(product) {
  if (/slim/i.test(product.name)) return `5-${product.unit || 'gallon'} slim · per refill`;
  if (/round/i.test(product.name)) return `5-${product.unit || 'gallon'} round · per refill`;
  return `per ${product.unit || 'gallon'} · refill`;
}

export async function mount(me) {
  const content = document.querySelector('#content');
  let products = [];
  let addresses = [];
  let slots = [];
  let serviceCharge = 20;
  let bottleBalanceInfo = null;
  let customerOrders = null;
  const cart = new Map();

  let selectedAddressId = '';
  let selectedDate = getTodayManila();
  let selectedSlotId = '';
  let deliveryNote = '';

  async function refreshSlotsForDate(dateStr) {
    slots = await getSlotAvailability(dateStr);
    const stillAvailable = slots.find(
      (s) => s.slot_id === selectedSlotId && !s.is_closed && !s.is_full
    );
    if (!stillAvailable) {
      const firstOpen = slots.find((s) => !s.is_closed && !s.is_full);
      selectedSlotId = firstOpen ? firstOpen.slot_id : '';
    }
  }

  function renderProductsSection() {
    const grid = document.querySelector('#product-grid');
    if (!grid) return;

    if (!products.length) {
      grid.innerHTML = `<div class="empty-state">No active refill products available right now.</div>`;
      return;
    }

    grid.innerHTML = products
      .map((p) => {
        const qty = cart.get(p.id) || 0;
        const isAdded = qty > 0;
        return `
          <div class="product-card${isAdded ? ' is-selected' : ''}" data-product-card="${escapeHtml(p.id)}">
            <div class="product-thumb">
              ${p.photo_url ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.name)}">` : getProductIcon(p.name)}
            </div>
            <div class="product-body">
              <div>
                <h3 class="product-name">${escapeHtml(p.name)}</h3>
                <p class="product-meta">${escapeHtml(getProductSubtitle(p))}</p>
              </div>
              <div class="product-foot">
                <span class="product-price">${escapeHtml(formatPeso(p.price))}</span>
                <button
                  type="button"
                  class="btn btn-sm ${isAdded ? 'btn-primary' : 'btn-light'}"
                  data-add-product="${escapeHtml(p.id)}"
                >
                  ${isAdded ? 'Added' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('[data-add-product]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.addProduct;
        const current = cart.get(id) || 0;
        cart.set(id, current + 1);
        renderProductsSection();
        renderCartSection();
      });
    });
  }

  function renderSlotsSelect() {
    const select = document.querySelector('#slot-select');
    if (!select) return;

    if (!slots.length) {
      select.innerHTML = `<option value="">No active delivery slots</option>`;
      select.disabled = true;
      return;
    }

    select.disabled = false;
    select.innerHTML = slots
      .map((slot) => {
        const disabled = slot.is_closed || slot.is_full;
        const suffix = slot.is_closed
          ? ' (Closed for date)'
          : slot.is_full
          ? ' (Full)'
          : '';
        const label = slot.label.replace(/\s*-\s*/g, '–') + suffix;
        const selected = slot.slot_id === selectedSlotId ? ' selected' : '';
        return `<option value="${escapeHtml(slot.slot_id)}"${disabled ? ' disabled' : ''}${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderCartSection() {
    const cartItemsEl = document.querySelector('#cart-items');
    const cartCountEl = document.querySelector('#cart-count');
    const subtotalEl = document.querySelector('#cart-subtotal');
    const chargeEl = document.querySelector('#cart-charge');
    const totalEl = document.querySelector('#cart-total');
    const submitBtn = document.querySelector('#place-order-btn');

    let totalGallons = 0;
    let subtotal = 0;
    const activeEntries = [];

    for (const [productId, qty] of cart.entries()) {
      if (qty <= 0) continue;
      const product = products.find((p) => p.id === productId);
      if (!product) continue;
      const lineTotal = Number(product.price) * qty;
      totalGallons += qty;
      subtotal += lineTotal;
      activeEntries.push({ product, qty, lineTotal });
    }

    const effectiveCharge = totalGallons > 0 ? serviceCharge : 0;
    const grandTotal = subtotal + effectiveCharge;

    if (cartCountEl) {
      cartCountEl.textContent = `${totalGallons} ${totalGallons === 1 ? 'gallon' : 'gallons'}`;
    }

    if (cartItemsEl) {
      if (!activeEntries.length) {
        cartItemsEl.innerHTML = `
          <div class="empty-state">
            Click <strong>Add</strong> on any refill option to build your order.
          </div>
        `;
      } else {
        cartItemsEl.innerHTML = activeEntries
          .map(
            ({ product, qty, lineTotal }) => `
            <div class="cart-item">
              <div class="cart-item-left">
                <span class="cart-item-icon">${getProductIcon(product.name)}</span>
                <div>
                  <p class="cart-item-title">${escapeHtml(product.name)}</p>
                  <p class="cart-item-sub">${escapeHtml(formatPeso(product.price))} each</p>
                </div>
              </div>
              <div class="cart-item-right">
                <div class="counter">
                  <button type="button" class="counter-btn" data-qty-change="${escapeHtml(product.id)}" data-delta="-1" aria-label="Decrease quantity">−</button>
                  <span class="counter-value">${qty}</span>
                  <button type="button" class="counter-btn" data-qty-change="${escapeHtml(product.id)}" data-delta="1" aria-label="Increase quantity">+</button>
                </div>
                <span class="cart-item-total">${escapeHtml(formatPeso(lineTotal))}</span>
              </div>
            </div>
          `
          )
          .join('');

        cartItemsEl.querySelectorAll('[data-qty-change]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.qtyChange;
            const delta = Number(btn.dataset.delta);
            const next = (cart.get(id) || 0) + delta;
            if (next <= 0) {
              cart.delete(id);
            } else {
              cart.set(id, next);
            }
            renderProductsSection();
            renderCartSection();
          });
        });
      }
    }

    if (subtotalEl) subtotalEl.textContent = formatPeso(subtotal);
    if (chargeEl) chargeEl.textContent = formatPeso(effectiveCharge);
    if (totalEl) totalEl.textContent = formatPeso(grandTotal);
    if (submitBtn) {
      submitBtn.textContent =
        totalGallons > 0 ? `Place order · ${formatPeso(grandTotal)}` : 'Place order';
      submitBtn.disabled = totalGallons === 0 || !selectedAddressId || !selectedSlotId;
    }

    const swapNoticeEl = document.querySelector('#bottle-swap-notice');
    if (swapNoticeEl) {
      const hasReturnableInCart = activeEntries.some(
        ({ product, qty }) => qty > 0 && product.is_returnable !== false
      );
      if (!hasReturnableInCart || !bottleBalanceInfo || !Array.isArray(customerOrders)) {
        swapNoticeEl.hidden = true;
        swapNoticeEl.textContent = '';
      } else {
        const currentBalance = Number(bottleBalanceInfo.balance ?? 0);
        const hasEarlierDeliveredOrder = customerOrders.some(
          (o) => o.status === 'delivered' || o.status === 'completed' || Boolean(o.delivered_at)
        );
        if (currentBalance > 0) {
          swapNoticeEl.textContent =
            'Please have your empty gallons ready. The rider will swap them when your order arrives.';
          swapNoticeEl.hidden = false;
        } else if (!hasEarlierDeliveredOrder) {
          swapNoticeEl.textContent = 'First order: no empty gallons needed.';
          swapNoticeEl.hidden = false;
        } else {
          swapNoticeEl.hidden = true;
          swapNoticeEl.textContent = '';
        }
      }
    }
  }

  try {
    [products, addresses, serviceCharge, bottleBalanceInfo, customerOrders] = await Promise.all([
      getActiveProducts(),
      getCustomerAddresses(me.id),
      getServiceCharge(),
      getCustomerBottleBalance(me.id).catch(() => null),
      getCustomerOrders(me.id, { limit: 50 }).catch(() => null),
    ]);

    const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
    selectedAddressId = defaultAddr ? defaultAddr.id : '';

    await refreshSlotsForDate(selectedDate);

    if (products.length > 0 && cart.size === 0) {
      cart.set(products[0].id, 1);
    }

    const addressOptionsHtml = addresses.length
      ? addresses
          .map(
            (a) =>
              `<option value="${escapeHtml(a.id)}"${a.id === selectedAddressId ? ' selected' : ''}>${escapeHtml(a.label)} · ${escapeHtml(formatAddressFull(a))}</option>`
          )
          .join('')
      : `<option value="">No saved address yet — add one in Saved addresses</option>`;

    content.innerHTML = `
      <div class="grid-split">
        <div class="stack">
          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.drop}</span>
                <h2 class="card-title">1. Choose your refills</h2>
              </div>
            </div>
            <div class="product-grid" id="product-grid"></div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.pin}</span>
                <h2 class="card-title">2. Delivery details</h2>
              </div>
              ${
                addresses.length === 0
                  ? `<a class="card-link" href="addresses.html">+ Add address</a>`
                  : `<a class="card-link" href="addresses.html">Manage addresses</a>`
              }
            </div>

            <div class="form-stack">
              <div class="field">
                <label class="field-label" for="address-select">Saved address</label>
                <select class="select" id="address-select" ${addresses.length === 0 ? 'disabled' : ''}>
                  ${addressOptionsHtml}
                </select>
              </div>

              <div class="field-row">
                <div class="field">
                  <label class="field-label" for="delivery-date">Delivery date</label>
                  <input class="input" id="delivery-date" type="date" min="${escapeHtml(getTodayManila())}" value="${escapeHtml(selectedDate)}">
                </div>
                <div class="field">
                  <label class="field-label" for="slot-select">Preferred time slot</label>
                  <select class="select" id="slot-select"></select>
                </div>
              </div>

              <div class="field">
                <label class="field-label" for="delivery-note">Delivery note (optional)</label>
                <input class="input" id="delivery-note" type="text" placeholder="Landmark or instruction" value="${escapeHtml(deliveryNote)}">
              </div>
            </div>
          </div>
        </div>

        <div class="card cart-card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.cart}</span>
              <h2 class="card-title">Your order</h2>
            </div>
            <span class="cart-count" id="cart-count">0 gallons</span>
          </div>

          <div class="cart-items" id="cart-items"></div>

          <div class="cart-summary">
            <div class="cart-summary-row">
              <span>Refill subtotal</span>
              <strong id="cart-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row">
              <span>Delivery service charge</span>
              <strong id="cart-charge">${escapeHtml(formatPeso(serviceCharge))}</strong>
            </div>
            <div class="cart-summary-row">
              <span>Payment</span>
              <strong>Cash on delivery</strong>
            </div>
            <div class="cart-summary-row cart-summary-total">
              <span>Total</span>
              <strong id="cart-total">₱0</strong>
            </div>
          </div>

          <div class="notice cart-notice" id="bottle-swap-notice" hidden></div>

          <div class="notice cart-notice">
            <strong>Preferred slot:</strong> The station may adjust your delivery window based on current orders. You can cancel only while the order is Submitted.
          </div>

          <button type="button" class="btn btn-primary btn-block" id="place-order-btn">
            Place order
          </button>
        </div>
      </div>
    `;

    renderProductsSection();
    renderSlotsSelect();
    renderCartSection();

    document.querySelector('#address-select')?.addEventListener('change', (e) => {
      selectedAddressId = e.target.value;
      renderCartSection();
    });

    document.querySelector('#delivery-date')?.addEventListener('change', async (e) => {
      selectedDate = e.target.value;
      try {
        await refreshSlotsForDate(selectedDate);
        renderSlotsSelect();
        renderCartSection();
      } catch (err) {
        showToast(err.message || 'Could not load time slots for that date.', 'error');
      }
    });

    document.querySelector('#slot-select')?.addEventListener('change', (e) => {
      selectedSlotId = e.target.value;
      renderCartSection();
    });

    document.querySelector('#delivery-note')?.addEventListener('input', (e) => {
      deliveryNote = e.target.value;
    });

    document.querySelector('#place-order-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const itemsPayload = [];
      for (const [product_id, quantity] of cart.entries()) {
        if (quantity > 0) itemsPayload.push({ product_id, quantity });
      }
      if (!itemsPayload.length) {
        showToast('Add at least one refill product to your order.', 'error');
        return;
      }
      if (!selectedAddressId) {
        showToast('Please add and select a delivery address first.', 'error');
        return;
      }
      if (!selectedSlotId) {
        showToast('Please select an available delivery time slot.', 'error');
        return;
      }

      setBusy(btn, true, 'Placing order...');
      try {
        const orderId = await createOrder({
          addressId: selectedAddressId,
          deliveryDate: selectedDate,
          slotId: selectedSlotId,
          notes: deliveryNote.trim(),
          items: itemsPayload,
        });
        showToast('Order placed!', 'success');
        navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(orderId)}`);
      } catch (err) {
        showToast(err.message || 'Could not place order.', 'error');
        setBusy(btn, false);
        await refreshSlotsForDate(selectedDate).catch(() => {});
        renderSlotsSelect();
        renderCartSection();
      }
    });
  } catch (err) {
    showToast(err.message || 'Could not load order form.', 'error');
  }
  return null;
}

bootCustomerPage('new-order', mount);
