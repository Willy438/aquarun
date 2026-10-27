import { bootCustomerPage, navigateCustomerSpa, updateCustomerActiveOrderBadge } from '../../core/nav.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  formatPeso,
  formatTimeShort,
  getTodayManila,
  invalidateDataCache,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  getActiveProducts,
  getServiceCharge,
  getStationOpenStatus,
} from '../../services/productsService.js';
import { getCustomerAddresses } from '../../services/addressesService.js';
import { getSlotAvailability } from '../../services/slotsService.js';
import {
  createOrder,
  formatAddressFull,
  getCustomerOrders,
  isOrderItemEmptyContainer,
  isOrderItemNewContainer,
} from '../../services/ordersService.js';
import { getCustomerBottleBalance } from '../../services/ledgerService.js';
import { checkAddressWithinDeliveryRadius } from '../../services/settingsService.js';

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
  if (product.is_returnable === false) {
    return `per ${product.unit || 'item'} · sold outright`;
  }
  const newPrice = Number(product.new_container_price ?? Number(product.price || 25) + 125);
  return `${formatPeso(product.price)} swap · ${formatPeso(newPrice)} w/ new gallon`;
}

export async function mount(me) {
  const content = document.querySelector('#content');
  let products = [];
  let addresses = [];
  let slots = [];
  let serviceCharge = 20;
  let bottleBalanceInfo = null;
  let customerOrders = null;
  let isStationOpen = true;
  const cart = new Map();

  let selectedAddressId = '';
  let selectedDate = getTodayManila();
  let selectedSlotId = '';
  let deliveryNote = '';

  function getSwapAllowance() {
    if (!bottleBalanceInfo || !Array.isArray(customerOrders)) {
      return { loaded: false, isFirstOrder: false, availableSwaps: 0, ledgerBalance: 0, activeCommittedSwaps: 0 };
    }
    const nonCancelledOrders = customerOrders.filter((o) => o.status !== 'cancelled');
    const isFirstOrder = nonCancelledOrders.length === 0;
    const ledgerBalance = Math.max(0, Number(bottleBalanceInfo.balance ?? 0));

    const activeStatuses = [
      'submitted',
      'confirmed',
      'refilling',
      'ready',
      'rider_assigned',
      'out_for_delivery',
    ];

    const activeOrders = nonCancelledOrders.filter((o) => activeStatuses.includes(o.status));

    // Swaps already committed in active (undelivered) orders
    const activeCommittedSwaps = activeOrders.reduce((sum, o) => {
      const orderSwaps = (o.items || []).reduce((s, it) => {
        if (it.product?.is_returnable === false) return s;
        if (!isOrderItemNewContainer(it) && !isOrderItemEmptyContainer(it)) {
          return s + Number(it.quantity || 0);
        }
        return s;
      }, 0);
      return sum + orderSwaps;
    }, 0);

    // Bottles physically available to swap right now:
    // Bottles held in possession from delivered orders minus bottles already promised to existing active orders.
    const availableSwaps = Math.max(0, ledgerBalance - activeCommittedSwaps);

    return {
      loaded: true,
      isFirstOrder,
      availableSwaps,
      ledgerBalance,
      activeCommittedSwaps,
    };
  }

  function renderPolicyBanner() {
    const pillEl = document.querySelector('#swap-limit-pill');
    if (!pillEl) return;
    const { loaded, isFirstOrder, availableSwaps, ledgerBalance, activeCommittedSwaps } = getSwapAllowance();
    if (!loaded) {
      pillEl.hidden = true;
      return;
    }
    pillEl.hidden = false;
    if (isFirstOrder && ledgerBalance === 0) {
      pillEl.textContent = '1st order · Includes new gallon';
      pillEl.className = 'pill pill-info';
    } else if (availableSwaps === 0 && activeCommittedSwaps > 0) {
      pillEl.textContent = `0 swaps available (${activeCommittedSwaps} ${activeCommittedSwaps === 1 ? 'bottle' : 'bottles'} committed to active order)`;
      pillEl.className = 'pill pill-warning';
    } else if (availableSwaps === 0) {
      pillEl.textContent = '0 bottle swaps available · Includes new gallon';
      pillEl.className = 'pill pill-neutral';
    } else {
      pillEl.textContent = `Swap limit: ${availableSwaps} ${availableSwaps === 1 ? 'gallon' : 'gallons'}${activeCommittedSwaps > 0 ? ` (${activeCommittedSwaps} in active order)` : ''}`;
      pillEl.className = 'pill pill-info';
    }
  }
  function isSlotPassed(slot, dateStr) {
    const today = getTodayManila();
    if (dateStr !== today) return false;
    if (!slot?.end_time) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [h, m] = slot.end_time.split(':').map(Number);
    const slotMinutes = h * 60 + (m || 0);
    return currentMinutes >= slotMinutes;
  }

  async function refreshSlotsForDate(dateStr) {
    slots = await getSlotAvailability(dateStr);
    const stillAvailable = slots.find(
      (s) => s.slot_id === selectedSlotId && !s.is_closed && !s.is_full && !isSlotPassed(s, dateStr)
    );
    if (!stillAvailable) {
      const firstOpen = slots.find((s) => !s.is_closed && !s.is_full && !isSlotPassed(s, dateStr));
      selectedSlotId = firstOpen ? firstOpen.slot_id : '';
    }
  }

  let activeCategory = 'all'; // 'all' | 'refill' | 'empty'

  function renderProductsSection() {
    const grid = document.querySelector('#product-grid');
    if (!grid) return;

    if (!products.length) {
      grid.innerHTML = `<div class="empty-state">No active products available right now.</div>`;
      return;
    }

    const refillProducts = products.filter((p) => p.is_returnable !== false);
    const extraProducts = products.filter((p) => p.is_returnable === false);

    const refillItems = refillProducts.map((p) => {
      const swapPrice = Number(p.price || 0);
      const newWaterPrice = Math.max(
        swapPrice,
        Number(p.new_container_price ?? swapPrice + 125)
      );
      return {
        key: p.id,
        category: 'refill',
        name: p.name,
        badgeText: 'Water refill',
        badgeClass: 'badge-water',
        subtitle: `${formatPeso(swapPrice)} swap · ${formatPeso(newWaterPrice)} w/ new gallon`,
        displayPrice: formatPeso(swapPrice),
        priceAlt: `or ${formatPeso(newWaterPrice)} w/ new gallon`,
        photoUrl: p.photo_url,
        icon: getProductIcon(p.name),
      };
    });

    let emptyItems = [];
    if (extraProducts.length > 0) {
      emptyItems = extraProducts.map((p) => ({
        key: p.id,
        category: 'empty',
        name: p.name,
        badgeText: 'Empty bottle only',
        badgeClass: 'badge-empty',
        subtitle: 'Clean container only · Adds +1 to your empty bottle balance',
        displayPrice: formatPeso(Number(p.price || 125)),
        priceAlt: 'Sold outright · No water',
        photoUrl: p.photo_url,
        icon: getProductIcon(p.name),
      }));
    } else if (refillProducts.length > 0) {
      const seenShapes = new Set();
      for (const p of refillProducts) {
        const isSlim = /slim/i.test(p.name);
        const shape = isSlim ? 'Slim' : 'Round';
        if (seenShapes.has(shape)) continue;
        seenShapes.add(shape);

        const swapPrice = Number(p.price || 0);
        const newWaterPrice = Math.max(
          swapPrice,
          Number(p.new_container_price ?? swapPrice + 125)
        );
        const emptyPrice = Math.max(25, newWaterPrice - swapPrice);

        emptyItems.push({
          key: `${p.id}:empty`,
          category: 'empty',
          name: `Empty 5-Gallon Container (${shape})`,
          badgeText: 'Empty bottle only',
          badgeClass: 'badge-empty',
          subtitle: 'Clean dry bottle · Sold outright (+1 to balance)',
          displayPrice: formatPeso(emptyPrice),
          priceAlt: 'Sold outright · No water',
          photoUrl: p.photo_url,
          icon: isSlim ? ICONS.slimGallon : ICONS.roundGallon,
        });
      }
    }

    const countAllEl = document.querySelector('#count-all');
    const countRefillEl = document.querySelector('#count-refill');
    const countEmptyEl = document.querySelector('#count-empty');
    if (countAllEl) countAllEl.textContent = String(refillItems.length + emptyItems.length);
    if (countRefillEl) countRefillEl.textContent = String(refillItems.length);
    if (countEmptyEl) countEmptyEl.textContent = String(emptyItems.length);

    document.querySelectorAll('#category-tabs .category-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.cat === activeCategory);
    });

    let visibleItems = [...refillItems, ...emptyItems];
    if (activeCategory === 'refill') {
      visibleItems = refillItems;
    } else if (activeCategory === 'empty') {
      visibleItems = emptyItems;
    }

    if (!visibleItems.length) {
      grid.innerHTML = `<div class="empty-state">No items found in this category.</div>`;
      return;
    }

    grid.innerHTML = visibleItems
      .map((item) => {
        const qty = cart.get(item.key) || 0;
        return `
          <div class="product-card${qty > 0 ? ' is-selected' : ''}" data-product-card="${escapeHtml(item.key)}">
            <div class="product-thumb">
              ${item.photoUrl ? `<img src="${escapeHtml(item.photoUrl)}" alt="${escapeHtml(item.name)}">` : item.icon}
            </div>
            <div class="product-body">
              <div>
                <span class="product-badge ${item.badgeClass}">${item.badgeText}</span>
                <h3 class="product-name">${escapeHtml(item.name)}</h3>
                <p class="product-meta">${escapeHtml(item.subtitle)}</p>
              </div>
              <div class="product-foot">
                <div class="product-price-stack">
                  <span class="product-price">${escapeHtml(item.displayPrice)}</span>
                  <span class="product-price-alt">${escapeHtml(item.priceAlt)}</span>
                </div>
                ${
                  qty > 0
                    ? `<div class="qty-counter">
                        <button type="button" class="qty-btn" data-prod-delta="${escapeHtml(item.key)}" data-delta="-1" aria-label="Decrease quantity">−</button>
                        <span class="qty-num">${qty}</span>
                        <button type="button" class="qty-btn" data-prod-delta="${escapeHtml(item.key)}" data-delta="1" aria-label="Increase quantity">+</button>
                      </div>`
                    : `<button type="button" class="btn btn-sm btn-light" data-prod-add="${escapeHtml(item.key)}">+ Add</button>`
                }
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('[data-prod-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.prodAdd;
        cart.set(id, 1);
        renderProductsSection();
        renderCartSection();
      });
    });

    grid.querySelectorAll('[data-prod-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.prodDelta;
        const delta = Number(btn.dataset.delta);
        const current = cart.get(id) || 0;
        const next = current + delta;
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

  function renderSlotsSelect() {
    const select = document.querySelector('#slot-select');
    if (!select) return;

    if (!slots.length) {
      select.innerHTML = `<option value="">No active delivery slots</option>`;
      select.disabled = true;
      return;
    }

    const hasAnyOpen = slots.some((s) => !s.is_closed && !s.is_full && !isSlotPassed(s, selectedDate));
    if (!hasAnyOpen && selectedDate === getTodayManila()) {
      select.innerHTML = `<option value="">All delivery windows for today have passed or are full — please select tomorrow</option>`;
      select.disabled = true;
      selectedSlotId = '';
      return;
    }

    select.disabled = false;
    select.innerHTML = slots
      .map((slot) => {
        const isPassed = isSlotPassed(slot, selectedDate);
        const disabled = slot.is_closed || slot.is_full || isPassed;
        const suffix = slot.is_closed
          ? ' (Closed for date)'
          : slot.is_full
          ? ' (Full)'
          : isPassed
          ? ' (Window passed)'
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
    const swapRowEl = document.querySelector('#cart-swap-row');
    const swapSubtotalEl = document.querySelector('#cart-swap-subtotal');
    const newGallonRowEl = document.querySelector('#cart-new-gallon-row');
    const newGallonLabelEl = document.querySelector('#cart-new-gallon-label');
    const newGallonSubtotalEl = document.querySelector('#cart-new-gallon-subtotal');
    const chargeEl = document.querySelector('#cart-charge');
    const totalEl = document.querySelector('#cart-total');
    const submitBtn = document.querySelector('#place-order-btn');

    const { loaded: balanceLoaded, availableSwaps } = getSwapAllowance();
    let remainingSwaps = balanceLoaded ? availableSwaps : 0;

    let totalGallons = 0;
    let totalSwapGallons = 0;
    let totalNewGallons = 0;
    let totalEmptyContainers = 0;
    let swapSubtotal = 0;
    let newGallonSubtotal = 0;
    let subtotal = 0;

    // Sort items: returnable refills first (higher price first), then empty containers
    const activeProducts = [];
    for (const [key, qty] of cart.entries()) {
      if (qty <= 0) continue;
      if (key.includes(':empty')) {
        const [prodId] = key.split(':');
        const product = products.find((p) => p.id === prodId);
        if (product) {
          const isSlim = /slim/i.test(product.name);
          const shape = isSlim ? 'Slim' : 'Round';
          const swapPrice = Number(product.price || 0);
          const newWaterPrice = Math.max(
            swapPrice,
            Number(product.new_container_price ?? swapPrice + 125)
          );
          const emptyPrice = Math.max(25, newWaterPrice - swapPrice);
          activeProducts.push({
            key,
            product: {
              ...product,
              name: `Empty 5-Gallon Container (${shape})`,
              price: emptyPrice,
              is_returnable: false,
            },
            qty,
            isEmptyOnly: true,
            unitPrice: emptyPrice,
          });
        }
      } else {
        const product = products.find((p) => p.id === key);
        if (product) {
          activeProducts.push({
            key,
            product,
            qty,
            isEmptyOnly: product.is_returnable === false,
            unitPrice: Number(product.price || 0),
          });
        }
      }
    }

    activeProducts.sort((a, b) => {
      const retA = !a.isEmptyOnly && a.product.is_returnable !== false ? 1 : 0;
      const retB = !b.isEmptyOnly && b.product.is_returnable !== false ? 1 : 0;
      if (retA !== retB) return retB - retA;
      return Number(b.product.price || 0) - Number(a.product.price || 0);
    });

    const activeEntries = [];
    for (const item of activeProducts) {
      const { key, product, qty, isEmptyOnly, unitPrice } = item;
      const isReturnable = !isEmptyOnly && product.is_returnable !== false;
      const swapPrice = Number(product.price || 0);
      const newWaterPrice = Math.max(
        swapPrice,
        Number(product.new_container_price ?? swapPrice + 125)
      );

      if (isReturnable) {
        // Automatic balance scan
        const itemSwapQty = Math.min(qty, remainingSwaps);
        const itemNewQty = Math.max(0, qty - itemSwapQty);
        remainingSwaps = Math.max(0, remainingSwaps - itemSwapQty);

        const itemSwapTotal = itemSwapQty * swapPrice;
        const itemNewTotal = itemNewQty * newWaterPrice;
        const lineTotal = itemSwapTotal + itemNewTotal;

        totalSwapGallons += itemSwapQty;
        totalNewGallons += itemNewQty;
        swapSubtotal += itemSwapTotal;
        newGallonSubtotal += itemNewTotal;
        subtotal += lineTotal;
        totalGallons += qty;

        let modeLabel = '';
        if (itemSwapQty > 0 && itemNewQty > 0) {
          modeLabel = `${itemSwapQty}x Swap (${formatPeso(swapPrice)}) + ${itemNewQty}x New gallon (${formatPeso(newWaterPrice)})`;
        } else if (itemSwapQty > 0) {
          modeLabel = `${itemSwapQty}x Swap refill · ${formatPeso(swapPrice)} ea`;
        } else {
          modeLabel = `${itemNewQty}x New gallon + water · ${formatPeso(newWaterPrice)} ea`;
        }

        activeEntries.push({
          key,
          product,
          qty,
          modeLabel,
          lineTotal,
        });
      } else {
        // Empty container only or non-returnable product
        const lineTotal = qty * unitPrice;
        subtotal += lineTotal;
        totalEmptyContainers += qty;

        activeEntries.push({
          key,
          product,
          qty,
          modeLabel: `${qty}x Empty container · ${formatPeso(unitPrice)} ea (No water, +1 balance)`,
          lineTotal,
        });
      }
    }

    const totalOrderItems = totalGallons + totalEmptyContainers;
    const effectiveCharge = totalOrderItems > 0 ? serviceCharge : 0;
    const grandTotal = subtotal + effectiveCharge;

    if (cartCountEl) {
      cartCountEl.textContent = `${totalOrderItems} ${totalOrderItems === 1 ? 'item' : 'items'}`;
    }

    const mobileBarEl = document.querySelector('#mobile-checkout-bar');
    const mobileBarCountEl = document.querySelector('#mobile-bar-count');
    const mobileBarTotalEl = document.querySelector('#mobile-bar-total');
    if (mobileBarEl) {
      if (totalOrderItems > 0 && isStationOpen) {
        mobileBarEl.hidden = false;
        if (mobileBarCountEl) {
          mobileBarCountEl.textContent = `${totalOrderItems} ${totalOrderItems === 1 ? 'item' : 'items'}`;
        }
        if (mobileBarTotalEl) {
          mobileBarTotalEl.textContent = formatPeso(grandTotal);
        }
      } else {
        mobileBarEl.hidden = true;
      }
    }

    const drawerCartItemsEl = document.querySelector('#drawer-cart-items');
    const drawerCartCountEl = document.querySelector('#drawer-cart-count');
    const drawerSubtotalEl = document.querySelector('#drawer-subtotal');
    const drawerChargeEl = document.querySelector('#drawer-charge');
    const drawerTotalEl = document.querySelector('#drawer-total');
    const drawerPlaceOrderBtn = document.querySelector('#drawer-place-order-btn');

    const mobileFabEl = document.querySelector('#mobile-cart-fab');
    const mobileFabBadgeEl = document.querySelector('#mobile-cart-fab-badge');
    const mobileFabTotalEl = document.querySelector('#mobile-cart-fab-total');

    if (mobileFabEl) {
      if (totalOrderItems > 0) {
        if (mobileFabBadgeEl) {
          mobileFabBadgeEl.textContent = String(totalOrderItems);
          mobileFabBadgeEl.hidden = false;
        }
        if (mobileFabTotalEl) {
          mobileFabTotalEl.textContent = formatPeso(grandTotal);
          mobileFabTotalEl.hidden = false;
        }
      } else {
        if (mobileFabBadgeEl) mobileFabBadgeEl.hidden = true;
        if (mobileFabTotalEl) mobileFabTotalEl.hidden = true;
      }
    }

    const itemsHtml = !activeEntries.length
      ? `
        <div class="empty-state">
          Click <strong>+ Add</strong> on any refill option to build your order.
        </div>
      `
      : activeEntries
          .map(
            ({ key, product, qty, modeLabel, lineTotal }) => `
            <div class="cart-item">
              <div class="cart-item-left">
                <span class="cart-item-icon">${getProductIcon(product.name)}</span>
                <div>
                  <p class="cart-item-title">${escapeHtml(product.name)}</p>
                  <p class="cart-item-sub">${escapeHtml(modeLabel)}</p>
                </div>
              </div>
              <div class="cart-item-right">
                <div class="counter">
                  <button type="button" class="counter-btn" data-cart-delta="${escapeHtml(key)}" data-delta="-1" aria-label="Decrease quantity">−</button>
                  <span class="counter-value">${qty}</span>
                  <button type="button" class="counter-btn" data-cart-delta="${escapeHtml(key)}" data-delta="1" aria-label="Increase quantity">+</button>
                </div>
                <span class="cart-item-total">${escapeHtml(formatPeso(lineTotal))}</span>
              </div>
            </div>
          `
          )
          .join('');

    if (cartItemsEl) cartItemsEl.innerHTML = itemsHtml;
    if (drawerCartItemsEl) drawerCartItemsEl.innerHTML = itemsHtml;

    document.querySelectorAll('[data-cart-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cartDelta;
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

    if (swapRowEl && swapSubtotalEl && newGallonRowEl && newGallonSubtotalEl) {
      if (totalNewGallons > 0 || totalEmptyContainers > 0) {
        swapRowEl.hidden = totalSwapGallons === 0;
        swapSubtotalEl.textContent = formatPeso(swapSubtotal);
        newGallonRowEl.hidden = false;
        if (newGallonLabelEl) {
          const parts = [];
          if (totalNewGallons > 0) parts.push(`${totalNewGallons} w/ water`);
          if (totalEmptyContainers > 0) parts.push(`${totalEmptyContainers} empty`);
          newGallonLabelEl.textContent = `New containers (${parts.join(', ')})`;
        }
        newGallonSubtotalEl.textContent = formatPeso(newGallonSubtotal + totalEmptyContainers * 125);
      } else {
        swapRowEl.hidden = true;
        newGallonRowEl.hidden = true;
      }
    }

    if (subtotalEl) subtotalEl.textContent = formatPeso(subtotal);
    if (chargeEl) chargeEl.textContent = formatPeso(effectiveCharge);
    if (totalEl) totalEl.textContent = formatPeso(grandTotal);

    if (drawerCartCountEl) drawerCartCountEl.textContent = `${totalOrderItems} ${totalOrderItems === 1 ? 'item' : 'items'}`;
    if (drawerSubtotalEl) drawerSubtotalEl.textContent = formatPeso(subtotal);
    if (drawerChargeEl) drawerChargeEl.textContent = formatPeso(effectiveCharge);
    if (drawerTotalEl) drawerTotalEl.textContent = formatPeso(grandTotal);

    const btnText = totalOrderItems > 0 ? `Place order · ${formatPeso(grandTotal)}` : 'Place order';
    const isBtnDisabled = totalOrderItems === 0 || !selectedAddressId || !selectedSlotId;

    if (submitBtn) {
      submitBtn.textContent = btnText;
      submitBtn.disabled = isBtnDisabled;
    }
    if (drawerPlaceOrderBtn) {
      drawerPlaceOrderBtn.textContent = btnText;
      drawerPlaceOrderBtn.disabled = isBtnDisabled;
    }

    const swapNoticeEl = document.querySelector('#bottle-swap-notice');
    if (swapNoticeEl) {
      if (totalSwapGallons > 0 && totalNewGallons > 0) {
        swapNoticeEl.className = 'notice';
        swapNoticeEl.innerHTML = `Prepare exactly <strong>${totalSwapGallons} empty ${
          totalSwapGallons === 1 ? 'bottle' : 'bottles'
        }</strong> for the 1-to-1 swap. <strong>${totalNewGallons} new ${
          totalNewGallons === 1 ? 'gallon' : 'gallons'
        }</strong> added automatically because you have ${availableSwaps} swaps on record.`;
        swapNoticeEl.hidden = false;
      } else if (totalSwapGallons > 0) {
        swapNoticeEl.className = 'notice';
        swapNoticeEl.innerHTML = `Prepare exactly <strong>${totalSwapGallons} empty ${
          totalSwapGallons === 1 ? 'bottle' : 'bottles'
        }</strong> for the 1-to-1 swap at your door.`;
        swapNoticeEl.hidden = false;
      } else if (totalNewGallons > 0) {
        swapNoticeEl.className = 'notice';
        const { activeCommittedSwaps, ledgerBalance } = getSwapAllowance();
        const reasonText =
          activeCommittedSwaps > 0
            ? `Your ${ledgerBalance === 1 ? '1 bottle' : `${ledgerBalance} bottles`} on hold ${ledgerBalance === 1 ? 'is' : 'are'} already committed to an active delivery. `
            : '';
        swapNoticeEl.innerHTML = `<strong>No empty bottles needed!</strong> ${reasonText}Brand-new containers will be delivered (+${totalNewGallons} added to your bottle balance upon delivery).`;
        swapNoticeEl.hidden = false;
      } else if (totalEmptyContainers > 0) {
        swapNoticeEl.className = 'notice';
        swapNoticeEl.innerHTML = `Clean dry containers will be delivered (+${totalEmptyContainers} added to your bottle balance upon delivery).`;
        swapNoticeEl.hidden = false;
      } else {
        swapNoticeEl.hidden = true;
        swapNoticeEl.textContent = '';
      }
    }
  }

  try {
    [products, addresses, serviceCharge, bottleBalanceInfo, customerOrders, isStationOpen] =
      await Promise.all([
        getActiveProducts({ forceRefresh: true }),
        getCustomerAddresses(me.id),
        getServiceCharge(),
        getCustomerBottleBalance(me.id).catch(() => null),
        getCustomerOrders(me.id, { limit: 50 }).catch(() => null),
        getStationOpenStatus().catch(() => true),
      ]);

    const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
    selectedAddressId = defaultAddr ? defaultAddr.id : '';

    await refreshSlotsForDate(selectedDate);

    // Cart starts empty so customer explicitly chooses products

    const addressOptionsHtml = addresses.length
      ? addresses
          .map(
            (a) =>
              `<option value="${escapeHtml(a.id)}"${a.id === selectedAddressId ? ' selected' : ''}>${escapeHtml(a.label)} · ${escapeHtml(formatAddressFull(a))}</option>`
          )
          .join('')
      : `<option value="">No saved address yet — add one in Saved addresses</option>`;

    content.innerHTML = `
      ${
        addresses.length === 0
          ? `
            <div class="order-no-address-banner">
              <div class="order-no-address-left">
                <span class="order-no-address-icon">${ICONS.pin}</span>
                <div>
                  <div class="order-no-address-title">No delivery address set up yet</div>
                  <p class="order-no-address-sub">Please set up your delivery address first so we can verify delivery radius coverage and schedule your refills.</p>
                </div>
              </div>
              <a href="addresses.html" class="btn btn-primary" style="white-space: nowrap;">+ Add delivery address</a>
            </div>
          `
          : ''
      }

      <div class="grid-split">
        <div class="stack">
          <!-- Step 1: Delivery details & schedule (AT TOP FOR INSTANT VISIBILITY) -->
          <div class="card" id="delivery-details-card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.pin}</span>
                <h2 class="card-title">1. Delivery details &amp; schedule</h2>
              </div>
              ${
                addresses.length === 0
                  ? `<a class="card-link" href="addresses.html">+ Add address</a>`
                  : `<a class="card-link" href="addresses.html">Manage addresses</a>`
              }
            </div>

            <div class="form-stack">
              <div class="field">
                <label class="field-label" for="address-select">Delivery address</label>
                <select class="select" id="address-select" ${addresses.length === 0 ? 'disabled' : ''}>
                  ${addressOptionsHtml}
                </select>
                <p class="field-hint" id="address-distance-hint" style="margin-top: 4px; font-size: 12px;" hidden></p>
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
                <input class="input" id="delivery-note" type="text" placeholder="Landmark or gate/unit instructions" value="${escapeHtml(deliveryNote)}">
              </div>
            </div>
          </div>

          <!-- Step 2: Choose your items -->
          <div class="card" id="choose-items-card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.drop}</span>
                <h2 class="card-title">2. Choose your items</h2>
              </div>
              <span class="pill pill-info" id="swap-limit-pill" hidden></span>
            </div>

            <!-- Category Filter Tabs -->
            <div class="category-tabs" id="category-tabs" role="tablist">
              <button type="button" class="category-tab is-active" data-cat="all">
                All items <span class="tab-count" id="count-all">0</span>
              </button>
              <button type="button" class="category-tab" data-cat="refill">
                Water refills <span class="tab-count" id="count-refill">0</span>
              </button>
              <button type="button" class="category-tab" data-cat="empty">
                Empty bottles only <span class="tab-count" id="count-empty">0</span>
              </button>
            </div>

            <div class="product-grid" id="product-grid"></div>
          </div>
        </div>

        <!-- Sticky Cart Sidebar -->
        <div class="card cart-card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.cart}</span>
              <h2 class="card-title">Your order</h2>
            </div>
            <span class="cart-count" id="cart-count">0 items</span>
          </div>


          <div class="cart-items" id="cart-items"></div>

          <div class="cart-summary">
            <div class="cart-summary-row" id="cart-swap-row" hidden>
              <span>Swap refills (water only)</span>
              <strong id="cart-swap-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row" id="cart-new-gallon-row" hidden>
              <span id="cart-new-gallon-label">New gallon + water</span>
              <strong id="cart-new-gallon-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row">
              <span>Items subtotal</span>
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

          ${
            !isStationOpen
              ? `<div class="notice cart-notice" style="border-color: #fca5a5; background: #fef2f2; color: #991b1b;">
                   <strong>Station Closed:</strong> We are currently closed for new orders. Please check back later.
                 </div>`
              : ''
          }

          <div class="notice cart-notice" id="radius-outside-notice" style="border-color: #fca5a5; background: #fef2f2; color: #991b1b;" hidden></div>

          <div class="notice cart-notice">
            <strong>Preferred slot:</strong> The station may adjust your delivery window based on current orders. You can cancel only while the order is Submitted.
          </div>

          <button
            type="button"
            class="btn btn-primary btn-block"
            id="place-order-btn"
            ${!isStationOpen || addresses.length === 0 ? 'disabled' : ''}
          >
            ${!isStationOpen ? 'Station closed' : addresses.length === 0 ? 'Add delivery address first' : 'Place order'}
          </button>
        </div>
      </div>

      <!-- Mobile Sticky Checkout Bar (< 1024px) -->
      <div class="mobile-checkout-bar" id="mobile-checkout-bar" hidden>
        <div class="mobile-checkout-info">
          <span class="mobile-checkout-count" id="mobile-bar-count">0 items</span>
          <span class="mobile-checkout-total" id="mobile-bar-total">₱0</span>
        </div>
        <button type="button" class="btn btn-primary mobile-checkout-btn" id="mobile-bar-review-btn">
          Review & Order →
        </button>
      </div>

      <!-- Mobile Floating Cart Button FAB (< 1024px) -->
      <button type="button" class="mobile-cart-fab" id="mobile-cart-fab" aria-label="Open cart">
        <span class="mobile-cart-fab-icon">${ICONS.cart}</span>
        <span class="mobile-cart-fab-badge" id="mobile-cart-fab-badge" hidden>0</span>
        <span class="mobile-cart-fab-total" id="mobile-cart-fab-total" hidden>₱0</span>
      </button>

      <!-- Mobile Cart Bottom Sheet Drawer (< 1024px) -->
      <div class="mobile-cart-drawer-backdrop" id="mobile-cart-backdrop"></div>
      <div class="mobile-cart-drawer" id="mobile-cart-drawer">
        <div class="mobile-cart-drawer-header">
          <div class="mobile-cart-drawer-title-group">
            <span class="card-icon">${ICONS.cart}</span>
            <h2 class="card-title">Your order</h2>
            <span class="cart-count" id="drawer-cart-count">0 items</span>
          </div>
          <button type="button" class="drawer-close-btn" id="mobile-cart-close" aria-label="Close cart">×</button>
        </div>

        <div class="mobile-cart-drawer-body">
          <div class="cart-items" id="drawer-cart-items"></div>

          <div class="cart-summary">
            <div class="cart-summary-row" id="drawer-swap-row" hidden>
              <span>Swap refills (water only)</span>
              <strong id="drawer-swap-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row" id="drawer-new-gallon-row" hidden>
              <span id="drawer-new-gallon-label">New gallon + water</span>
              <strong id="drawer-new-gallon-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row">
              <span>Items subtotal</span>
              <strong id="drawer-subtotal">₱0</strong>
            </div>
            <div class="cart-summary-row">
              <span>Delivery service charge</span>
              <strong id="drawer-charge">${escapeHtml(formatPeso(serviceCharge))}</strong>
            </div>
            <div class="cart-summary-row">
              <span>Payment</span>
              <strong>Cash on delivery</strong>
            </div>
            <div class="cart-summary-row cart-summary-total">
              <span>Total</span>
              <strong id="drawer-total">₱0</strong>
            </div>
          </div>

          <div class="notice cart-notice" id="drawer-swap-notice" hidden></div>
          <div class="notice cart-notice" id="drawer-radius-notice" style="border-color: #fca5a5; background: #fef2f2; color: #991b1b;" hidden></div>

          <button
            type="button"
            class="btn btn-primary btn-block"
            id="drawer-place-order-btn"
            ${!isStationOpen || addresses.length === 0 ? 'disabled' : ''}
          >
            ${!isStationOpen ? 'Station closed' : addresses.length === 0 ? 'Add delivery address first' : 'Place order'}
          </button>
        </div>
      </div>
    `;

    let addressDistanceCheck = null;

    async function refreshAddressRadiusCheck() {
      const selAddr = addresses.find((a) => a.id === selectedAddressId);
      addressDistanceCheck = selAddr
        ? await checkAddressWithinDeliveryRadius(selAddr).catch(() => null)
        : null;
      const distanceHintEl = document.querySelector('#address-distance-hint');
      const radiusNoticeEl = document.querySelector('#radius-outside-notice');
      const placeBtn = document.querySelector('#place-order-btn');

      if (distanceHintEl) {
        if (
          addressDistanceCheck?.distanceKm !== null &&
          addressDistanceCheck?.distanceKm !== undefined
        ) {
          if (addressDistanceCheck.isWithin) {
            distanceHintEl.innerHTML = `<span style="color:#16a34a; font-weight:600;">Within delivery radius (${addressDistanceCheck.distanceKm} km from station)</span>`;
            distanceHintEl.hidden = false;
          } else {
            distanceHintEl.innerHTML = `<span style="color:#dc2626; font-weight:700;">Outside delivery radius (${addressDistanceCheck.distanceKm} km · Max: ${addressDistanceCheck.maxRadiusKm} km)</span>`;
            distanceHintEl.hidden = false;
          }
        } else {
          distanceHintEl.hidden = true;
        }
      }

      if (radiusNoticeEl) {
        if (addressDistanceCheck && !addressDistanceCheck.isWithin) {
          radiusNoticeEl.innerHTML = `<strong>Outside Delivery Area:</strong> This address is <strong>${addressDistanceCheck.distanceKm} km</strong> from our station. Our maximum delivery radius is <strong>${addressDistanceCheck.maxRadiusKm} km</strong>.`;
          radiusNoticeEl.hidden = false;
        } else {
          radiusNoticeEl.hidden = true;
        }
      }

      if (placeBtn && isStationOpen) {
        if (addresses.length === 0) {
          placeBtn.disabled = true;
          placeBtn.textContent = 'Add delivery address first';
        } else if (addressDistanceCheck && !addressDistanceCheck.isWithin) {
          placeBtn.disabled = true;
          placeBtn.textContent = 'Address outside delivery radius';
        } else {
          placeBtn.disabled = false;
          placeBtn.textContent = 'Place order';
        }
      }

      
    }

    renderPolicyBanner();
    renderProductsSection();
    renderSlotsSelect();
    renderCartSection();
    refreshAddressRadiusCheck();
    

    document.querySelector('#category-tabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.category-tab');
      if (!tab) return;
      activeCategory = tab.dataset.cat || 'all';
      renderProductsSection();
    });

    document.querySelector('#address-select')?.addEventListener('change', (e) => {
      selectedAddressId = e.target.value;
      refreshAddressRadiusCheck();
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

    function openMobileCartDrawer() {
      const drawer = document.querySelector('#mobile-cart-drawer');
      const backdrop = document.querySelector('#mobile-cart-backdrop');
      if (drawer && backdrop) {
        drawer.classList.add('is-open');
        backdrop.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      }
    }

    function closeMobileCartDrawer() {
      const drawer = document.querySelector('#mobile-cart-drawer');
      const backdrop = document.querySelector('#mobile-cart-backdrop');
      if (drawer && backdrop) {
        drawer.classList.remove('is-open');
        backdrop.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    }

    document.querySelector('#mobile-cart-fab')?.addEventListener('click', openMobileCartDrawer);
    document.querySelector('#mobile-bar-review-btn')?.addEventListener('click', openMobileCartDrawer);
    document.querySelector('#mobile-cart-close')?.addEventListener('click', closeMobileCartDrawer);
    document.querySelector('#mobile-cart-backdrop')?.addEventListener('click', closeMobileCartDrawer);

  async function handlePlaceOrder(btn) {
      if (!isStationOpen) {
        showToast('The station is currently closed for new orders.', 'error');
        return;
      }
      if (addressDistanceCheck && !addressDistanceCheck.isWithin) {
        showToast(
          `This address is ${addressDistanceCheck.distanceKm} km away (outside our ${addressDistanceCheck.maxRadiusKm} km delivery radius).`,
          'error'
        );
        return;
      }
      const itemsPayload = [];
      for (const [key, quantity] of cart.entries()) {
        if (quantity > 0) {
          if (key.includes(':empty')) {
            const [productId] = key.split(':');
            itemsPayload.push({ product_id: productId, quantity, mode: 'empty_only' });
          } else {
            itemsPayload.push({ product_id: key, quantity });
          }
        }
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

      const selectedAddr = addresses.find((a) => a.id === selectedAddressId);
      const selectedSlot = slots.find((s) => s.slot_id === selectedSlotId);
      const slotText = selectedSlot?.label ? selectedSlot.label.replace(/\s*-\s*/g, '–') : 'Scheduled window';
      const grandTotalText = document.querySelector('#cart-total')?.textContent || '';

      const confirmed = await confirmModal({
        title: 'Confirm your order?',
        message: `Place this order for ${grandTotalText} (Cash on Delivery) to be delivered to "${selectedAddr?.label || 'Address'}" on ${selectedDate} (${slotText})?`,
        confirmText: 'Yes, place order',
        cancelText: 'Back to review',
      });
      if (!confirmed) return;

      setBusy(btn, true, 'Placing order...');
      try {
        const orderId = await createOrder({
          addressId: selectedAddressId,
          deliveryDate: selectedDate,
          slotId: selectedSlotId,
          notes: deliveryNote.trim(),
          items: itemsPayload,
        });
        updateCustomerActiveOrderBadge(me.id).catch(() => {});
        showToast('Order placed!', 'success');
        navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(orderId)}`);
      } catch (err) {
        showToast(err.message || 'Could not place order.', 'error');
        setBusy(btn, false);
        await refreshSlotsForDate(selectedDate).catch(() => {});
        renderSlotsSelect();
        renderCartSection();
      }
    }

        document.querySelector('#place-order-btn')?.addEventListener('click', (e) => handlePlaceOrder(e.currentTarget));
    document.querySelector('#drawer-place-order-btn')?.addEventListener('click', (e) => handlePlaceOrder(e.currentTarget));

    // Realtime listener: instantly reflect product edits, disabling, and price changes
    const refreshCatalogState = async () => {
      try {
        invalidateDataCache('products:');
        invalidateDataCache('settings:');
        const [freshProducts, freshCharge, freshBalance, freshOrders] = await Promise.all([
          getActiveProducts({ forceRefresh: true }),
          getServiceCharge(),
          getCustomerBottleBalance(me.id).catch(() => null),
          getCustomerOrders(me.id, { limit: 50 }).catch(() => null),
        ]);
        const changed =
          JSON.stringify(freshProducts) !== JSON.stringify(products) ||
          Number(freshCharge) !== Number(serviceCharge);
        if (!changed) return;

        products = freshProducts;
        serviceCharge = freshCharge;
        if (freshBalance) bottleBalanceInfo = freshBalance;
        if (freshOrders) customerOrders = freshOrders;

        // Auto-prune any items in cart that were disabled or removed by admin
        let cartPruned = false;
        for (const [key, quantity] of Array.from(cart.entries())) {
          if (quantity > 0) {
            const rawId = key.includes(':') ? key.split(':')[0] : key;
            const stillActive = products.some((p) => String(p.id) === String(rawId));
            if (!stillActive) {
              cart.delete(key);
              cartPruned = true;
            }
          }
        }

        renderPolicyBanner();
        renderProductsSection();
        renderCartSection();

        if (cartPruned) {
          showToast('A product in your cart was updated or is no longer available.', 'info');
        }
      } catch (err) {
        console.warn('[Customer order-new realtime refresh error]:', err);
      }
    };

    const unsubRealtime = subscribeCustomerOrders(me.id, refreshCatalogState);
    window.addEventListener('aquarun:sync', refreshCatalogState);
    const syncInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshCatalogState();
      }
    }, 3000);

    window.addEventListener('beforeunload', () => {
      unsubRealtime();
      window.removeEventListener('aquarun:sync', refreshCatalogState);
      clearInterval(syncInterval);
    }, { once: true });
  } catch (err) {
    showToast(err.message || 'Could not load order form.', 'error');
  }
  return null;
}

bootCustomerPage('new-order', mount);
