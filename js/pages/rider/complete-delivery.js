import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { confirmModal, escapeHtml, formatPeso, setBusy, showToast } from '../../core/ui.js';
import {
  checkOrderDeliveryTiming,
  isOrderItemNewContainer,
  promptDeliveryTimingModal,
  recordDeliveryTimingNote,
  summarizeOrderItems,
} from '../../services/ordersService.js';
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
const ALERT_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

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
    const newGallonsInOrder = (order.items || []).reduce(
      (sum, it) => (isOrderItemNewContainer(it) ? sum + Number(it.quantity || 0) : sum),
      0
    );
    const swapGallonsInOrder = Math.max(0, returnableQty - newGallonsInOrder);
    const expectedEmpties = Math.min(swapGallonsInOrder, balanceBefore);
    const hasNoReturnableItems = returnableQty === 0;

    if (pageTitle) pageTitle.textContent = 'Complete delivery';
    if (pageSub) {
      pageSub.textContent = `Order #${order.order_number} · ${customerName} · ${itemsSummary}`;
    }
    if (topbarRight) {
      topbarRight.innerHTML = `<span class="pill pill-blue">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>`;
    }

    // Strict 1-to-1 swap rule: both delivered and empties collected are automatic from the order & swap count
    const bottlesDelivered = hasNoReturnableItems ? 0 : returnableQty;
    const emptiesCollected = hasNoReturnableItems ? 0 : expectedEmpties;
    let paymentReceived = true;
    let noteText = '';
    const timing = checkOrderDeliveryTiming(order);

    function renderFormState() {
      const delivEl = document.querySelector('#val-delivered');
      const empEl = document.querySelector('#val-empties');
      const payBox = document.querySelector('#payment-box');
      const payCircle = document.querySelector('#payment-circle');

      if (delivEl) delivEl.textContent = String(bottlesDelivered);
      if (empEl) empEl.textContent = String(emptiesCollected);

      if (payBox && payCircle) {
        payBox.classList.toggle('is-checked', paymentReceived);
        payCircle.style.background = paymentReceived ? 'var(--blue-app)' : '#fff';
        payCircle.style.borderColor = paymentReceived ? 'var(--blue-app)' : '#cbd5e1';
        payCircle.style.color = paymentReceived ? '#fff' : 'transparent';
      }
    }

    content.innerHTML = `
      ${
        timing.isEarly
          ? `<div class="notice notice-warning" style="margin-bottom: 14px; background: #fef3c7; border-color: #fde68a; color: #92400e; padding: 12px 14px; border-radius: 8px;">
              <strong>${ALERT_SVG} Early Delivery Notice:</strong> ${escapeHtml(timing.warningText)} Please verify that the customer is present and agrees to receive the delivery ahead of their requested window.
            </div>`
          : ''
      }
      <div class="grid-split">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Bottle count</h2>
            <span class="pill pill-neutral">Automatic · 1-to-1 swap</span>
          </div>

          ${
            hasNoReturnableItems
              ? `<div class="notice" id="no-returnable-notice">No returnable items in this order</div>`
              : newGallonsInOrder > 0
                ? `<div class="notice">Deliver <strong>${returnableQty}</strong> filled ${
                    returnableQty === 1 ? 'gallon' : 'gallons'
                  } (${swapGallonsInOrder} swap + ${newGallonsInOrder} w/ new gallon). Collect <strong>${expectedEmpties}</strong> empty ${
                    expectedEmpties === 1 ? 'gallon' : 'gallons'
                  }.</div>`
                : ''
          }

          <div class="big-counter-grid">
            <div class="big-counter-col">
              <p class="big-counter-label">Bottles delivered</p>
              <div class="big-counter-controls">
                <span class="big-counter-val" id="val-delivered">${bottlesDelivered}</span>
              </div>
              <p class="big-counter-hint">${
                newGallonsInOrder > 0
                  ? `${swapGallonsInOrder} swap + ${newGallonsInOrder} new gallon`
                  : 'From order quantity'
              }</p>
            </div>

            <div class="big-counter-col">
              <p class="big-counter-label">Empties collected</p>
              <div class="big-counter-controls">
                <span class="big-counter-val" id="val-empties">${emptiesCollected}</span>
              </div>
              <p class="big-counter-hint" id="expected-empties-hint">${
                expectedEmpties === 0
                  ? 'No empty return needed (new gallon)'
                  : `1-to-1 swap (${expectedEmpties} ${expectedEmpties === 1 ? 'empty' : 'empties'} required)`
              }</p>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="delivery-ledger-note">Note (optional)</label>
            <textarea class="input textarea" id="delivery-ledger-note" placeholder="Optional delivery note"></textarea>
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

    content.querySelector('#payment-box')?.addEventListener('click', () => {
      paymentReceived = !paymentReceived;
      renderFormState();
    });

    content.querySelector('#delivery-ledger-note')?.addEventListener('input', (e) => {
      noteText = e.target.value;
    });

    content.querySelector('#submit-delivery-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;

      let timingReason = null;
      if (timing.isEarly || timing.isLate) {
        const timingModalRes = await promptDeliveryTimingModal({
          actionType: 'deliver',
          timing,
          order,
        });
        if (!timingModalRes.confirmed) return;
        timingReason = timingModalRes.reason;
      }

      const confirmed = await confirmModal({
        title: `Submit Delivery #${order.order_number}?`,
        message: paymentReceived
          ? `Record delivery of ${bottlesDelivered} ${bottlesDelivered === 1 ? 'gallon' : 'gallons'} (${emptiesCollected} empties collected) and collection of ${formatPeso(order.total)} cash?`
          : `Record delivery of ${bottlesDelivered} ${bottlesDelivered === 1 ? 'gallon' : 'gallons'} (${emptiesCollected} empties collected) with cash payment marked pending for station review?`,
        confirmText: 'Yes, record delivery',
        cancelText: 'Back to review',
      });
      if (!confirmed) return;

      setBusy(btn, true, 'Submitting...');
      try {
        if (order.status === 'rider_assigned') {
          await riderStartDelivery(order.id);
        }
        if (timingReason) {
          await recordDeliveryTimingNote(order.id, 'deliver', timingReason, timing);
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
