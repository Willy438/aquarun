import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { escapeHtml, formatPeso, setBusy, showToast } from '../../core/ui.js';
import { summarizeOrderItems } from '../../services/ordersService.js';
import {
  getCustomerBalanceForOrder,
  getOrderReturnableQty,
} from '../../services/ledgerService.js';
import {
  getRiderCurrentOrder,
  riderRecordDelivery,
  riderStartDelivery,
} from '../../services/deliveryService.js';

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export async function mount(me) {
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  const params = new URLSearchParams(window.location.search);
  let targetOrderId = params.get('id');

  try {
    const order = await getRiderCurrentOrder(me.id, targetOrderId);
    if (!order) {
      content.innerHTML = `
        <div class="card empty-state">
          <h3>No active delivery to complete</h3>
          <p>Select an active delivery from My deliveries first.</p>
          <div style="margin-top: 16px;">
            <a class="btn btn-primary" href="my-deliveries.html">Back to My deliveries</a>
          </div>
        </div>
      `;
      return null;
    }

    targetOrderId = order.id;
    const customerName = order.customer?.full_name || 'Customer';
    const itemsSummary = summarizeOrderItems(order.items);

    const [returnableInfo, customerBalance] = await Promise.all([
      getOrderReturnableQty(order.id),
      getCustomerBalanceForOrder(order.id),
    ]);
    const returnableQty = Math.max(0, Number(returnableInfo?.returnable_qty ?? 0));
    const balanceBefore = Math.max(0, Number(customerBalance ?? 0));
    const expectedEmpties = Math.min(returnableQty, balanceBefore);
    const hasNoReturnableItems = returnableQty === 0;

    if (pageTitle) pageTitle.textContent = 'Complete delivery';
    if (pageSub) {
      pageSub.textContent = `Order #${order.order_number} · ${customerName} · ${itemsSummary}`;
    }
    if (topbarRight) {
      topbarRight.innerHTML = `<span class="pill pill-blue">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>`;
    }

    let bottlesDelivered = hasNoReturnableItems ? 0 : returnableQty;
    let emptiesCollected = 0;
    let paymentReceived = true;
    let noteText = '';

    function renderFormState() {
      const delivEl = document.querySelector('#val-delivered');
      const empEl = document.querySelector('#val-empties');
      const warnEl = document.querySelector('#diff-warning');
      const payBox = document.querySelector('#payment-box');
      const payCircle = document.querySelector('#payment-circle');

      if (delivEl) delivEl.textContent = String(bottlesDelivered);
      if (empEl) empEl.textContent = String(emptiesCollected);

      if (warnEl) {
        if (hasNoReturnableItems || emptiesCollected >= expectedEmpties) {
          warnEl.hidden = true;
          warnEl.textContent = '';
        } else {
          warnEl.hidden = false;
          const shortBy = expectedEmpties - emptiesCollected;
          const bottleWord = shortBy === 1 ? '1 bottle' : `${shortBy} bottles`;
          const diff = bottlesDelivered - emptiesCollected;
          const balanceEffect =
            diff > 0
              ? `The customer balance will increase by ${diff}.`
              : diff < 0
                ? `The customer balance will decrease by ${Math.abs(diff)}.`
                : 'The customer balance will stay the same.';
          warnEl.textContent = `Empties collected is ${bottleWord} below expected (${expectedEmpties}). ${balanceEffect} Add a note if needed.`;
        }
      }

      if (payBox && payCircle) {
        payBox.classList.toggle('is-checked', paymentReceived);
        payCircle.style.background = paymentReceived ? 'var(--blue-app)' : '#fff';
        payCircle.style.borderColor = paymentReceived ? 'var(--blue-app)' : '#cbd5e1';
        payCircle.style.color = paymentReceived ? '#fff' : 'transparent';
      }
    }

    content.innerHTML = `
      <div class="grid-split">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Bottle count</h2>
          </div>

          ${
            hasNoReturnableItems
              ? `<div class="notice" id="no-returnable-notice">No returnable items in this order</div>`
              : ''
          }

          <div class="big-counter-grid">
            <div class="big-counter-col">
              <p class="big-counter-label">Bottles delivered</p>
              <div class="big-counter-controls">
                <button type="button" class="big-counter-btn" data-counter="delivered" data-delta="-1" aria-label="Decrease delivered" ${hasNoReturnableItems ? 'disabled' : ''}>−</button>
                <span class="big-counter-val" id="val-delivered">${bottlesDelivered}</span>
                <button type="button" class="big-counter-btn" data-counter="delivered" data-delta="1" aria-label="Increase delivered" ${hasNoReturnableItems ? 'disabled' : ''}>+</button>
              </div>
              <p class="big-counter-hint">Prefilled from returnable items</p>
            </div>

            <div class="big-counter-col">
              <p class="big-counter-label">Empties collected</p>
              <div class="big-counter-controls">
                <button type="button" class="big-counter-btn" data-counter="empties" data-delta="-1" aria-label="Decrease empties" ${hasNoReturnableItems ? 'disabled' : ''}>−</button>
                <span class="big-counter-val" id="val-empties">${emptiesCollected}</span>
                <button type="button" class="big-counter-btn" data-counter="empties" data-delta="1" aria-label="Increase empties" ${hasNoReturnableItems ? 'disabled' : ''}>+</button>
              </div>
              <p class="big-counter-hint" id="expected-empties-hint">Expected empties: ${expectedEmpties}</p>
            </div>
          </div>

          <div class="notice notice-warning" id="diff-warning" hidden></div>

          <div class="field">
            <label class="field-label" for="delivery-ledger-note">Note (optional)</label>
            <textarea class="input textarea" id="delivery-ledger-note" placeholder="e.g. Customer will return 1 empty tomorrow."></textarea>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Payment</h2>
            </div>

            <div class="payment-select-box is-checked" id="payment-box" role="checkbox" aria-checked="true" tabindex="0">
              <span class="checklist-circle" id="payment-circle">${CHECK_SVG}</span>
              <div>
                <p class="payment-select-title">Payment received</p>
                <p class="payment-select-sub">Cash on delivery</p>
              </div>
            </div>

            <div class="kv-row" style="border-bottom: none; padding-top: 4px;">
              <span class="kv-label">Cash collected</span>
              <span class="rider-cash-total">${escapeHtml(formatPeso(order.total))}</span>
            </div>

            <p class="proc-action-hint" style="margin-top: 6px; line-height: 1.5;">
              Ticking this sends the order straight to Completed. Leave it empty if you could not collect cash. Staff will confirm payment later.
            </p>
          </div>

          <div class="card" style="display: flex; flex-direction: column; gap: 10px;">
            <button type="button" class="btn btn-primary btn-block" id="submit-delivery-btn">
              Submit delivery record
            </button>
            <a class="btn btn-light btn-block" href="delivery-details.html?id=${encodeURIComponent(order.id)}">
              Cancel
            </a>
          </div>
        </div>
      </div>
    `;

    renderFormState();

    content.querySelectorAll('[data-counter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (hasNoReturnableItems) return;
        const type = btn.dataset.counter;
        const delta = Number(btn.dataset.delta);
        if (type === 'delivered') {
          bottlesDelivered = Math.max(0, bottlesDelivered + delta);
        } else {
          emptiesCollected = Math.max(0, emptiesCollected + delta);
        }
        renderFormState();
      });
    });

    content.querySelector('#payment-box')?.addEventListener('click', () => {
      paymentReceived = !paymentReceived;
      renderFormState();
    });

    content.querySelector('#delivery-ledger-note')?.addEventListener('input', (e) => {
      noteText = e.target.value;
    });

    content.querySelector('#submit-delivery-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Submitting...');
      try {
        if (order.status === 'rider_assigned') {
          await riderStartDelivery(order.id);
        }
        await riderRecordDelivery({
          orderId: order.id,
          bottlesDelivered,
          emptiesCollected,
          note: noteText,
          paymentReceived,
        });
        showToast(
          paymentReceived
            ? 'Delivery and payment recorded! Order completed.'
            : 'Delivery recorded! Payment is marked pending for staff confirmation.',
          'success'
        );
        await renderNav(me, 'my-deliveries');
        navigateRiderSpa('my-deliveries.html');
      } catch (err) {
        showToast(err.message || 'Could not record delivery.', 'error');
        setBusy(btn, false);
      }
    });
  } catch (err) {
    showToast(err.message || 'Could not load complete delivery screen.', 'error');
  }

  return null;
}

bootRiderPage('complete-delivery', mount);
