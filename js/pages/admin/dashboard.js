// Admin dashboard: stat cards, modern hourly activity chart with interactive period text, order pipeline, riders, slot capacity, pending payments.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateHeading,
  formatDateShort,
  formatPeso,
  getGreeting,
  getInitials,
  getTodayManila,
  showToast,
} from '../../core/ui.js';
import { getAllOrdersForStaff, formatSlotCompact } from '../../services/ordersService.js';
import {
  getCachedStationOpenStatus,
  getStationOpenStatus,
  saveStationOpenStatus,
} from '../../services/productsService.js';
import {
  getDailyReports,
  getOrderActivityByHour,
  getTodayReportSummary,
} from '../../services/reportsService.js';
import { getAllTimeSlotsForAdmin } from '../../services/slotsService.js';
import {
  getStaffAndRidersForAdmin,
  setRiderAvailability,
} from '../../services/usersService.js';

function getDaysAgoDateStr(todayStr, days) {
  const d = new Date(todayStr + 'T00:00:00');
  d.setDate(d.getDate() - Math.max(0, Number(days) - 1));
  return d.toISOString().slice(0, 10);
}

function buildSmoothSvgOverlay(values, maxVal) {
  const n = values.length;
  if (!n) return '';
  const width = 1000;
  const height = 160;
  const step = width / n;

  const points = values.map((v, idx) => {
    const x = Math.round(step * idx + step / 2);
    const ratio = maxVal > 0 ? Math.min(1, Math.max(0, v / maxVal)) : 0;
    const y = Math.round(height - ratio * (height - 22) - 6);
    return { x, y, v };
  });

  if (points.length === 1) {
    return '';
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = Math.round((p0.x + p1.x) / 2);
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }

  const areaD = `${d} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  return `
    <svg class="modern-chart-svg-overlay" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="aquaDashAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563eb" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#2563eb" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#aquaDashAreaGrad)" />
      <path d="${d}" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-opacity="0.55" stroke-linecap="round" />
    </svg>
  `;
}

function renderModernHourlyChart(hourlyRows, { selectedDays, selectedHour, today }) {
  const values = hourlyRows.map((r) => Number(r.orders || 0));
  const totalPeriodOrders = values.reduce((a, b) => a + b, 0);
  const rawMax = Math.max(...values, 0);
  const maxVal = Math.max(rawMax, 6);
  const peakVal = rawMax;
  const peakIdx = peakVal > 0 ? values.indexOf(peakVal) : -1;

  const topGrid = maxVal;
  const midHighGrid = Math.round((maxVal * 2) / 3);
  const midLowGrid = Math.round(maxVal / 3);

  const periodRightNote =
    selectedDays === 1
      ? `Today (${formatDateShort(today)}) · 7 AM – 6 PM`
      : selectedDays === 7
        ? `7-day cumulative hourly volume (${formatDateShort(getDaysAgoDateStr(today, 7))} – ${formatDateShort(today)})`
        : `30-day monthly hourly pattern (${formatDateShort(getDaysAgoDateStr(today, 30))} – ${formatDateShort(today)})`;

  const periodTotalLabel =
    selectedDays === 1
      ? "Today's volume"
      : selectedDays === 7
        ? '7-day volume'
        : 'Monthly (30d) volume';

  const avgText =
    selectedDays === 1
      ? `${(totalPeriodOrders / 12).toFixed(1)} orders / hr`
      : `${(totalPeriodOrders / selectedDays).toFixed(1)} orders / day`;

  const peakRow = peakIdx >= 0 ? hourlyRows[peakIdx] : null;
  const peakSummary = peakRow
    ? `${peakRow.fullLabel} (${peakRow.orders})`
    : 'No peak yet';

  const activeBarRow =
    selectedHour !== null
      ? hourlyRows.find((r) => r.hour === selectedHour) || null
      : peakRow;

  const selectedCallout = activeBarRow
    ? `${activeBarRow.fullLabel}: ${activeBarRow.orders} order${activeBarRow.orders === 1 ? '' : 's'} (${selectedDays === 1 ? 'today' : selectedDays === 7 ? 'in 7 days' : 'this month'})`
    : 'Tap any bar to inspect hour';

  const barsHtml = hourlyRows
    .map((row, idx) => {
      const count = Number(row.orders || 0);
      const isPeak = idx === peakIdx && count > 0;
      const isSelected = selectedHour !== null && row.hour === selectedHour;
      const pct = maxVal > 0 ? Math.max(count > 0 ? 12 : 4, Math.round((count / maxVal) * 100)) : 4;
      return `
        <div
          class="modern-bar-col${isPeak ? ' is-peak' : ''}${isSelected ? ' is-selected' : ''}"
          data-hour-bar="${row.hour}"
          title="${escapeHtml(row.fullLabel)}: ${count} order${count === 1 ? '' : 's'} (Click to inspect)"
        >
          <div class="modern-bar-track">
            <span class="modern-bar-val">${count}</span>
            <div class="modern-bar-fill" style="height: ${pct}%"></div>
          </div>
          <span class="modern-bar-label">${escapeHtml(row.label)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="modern-chart-wrap">
      <div class="modern-chart-legend">
        <div class="modern-chart-legend-items">
          <span class="modern-chart-legend-item"><span class="legend-swatch"></span>Orders</span>
          <span class="modern-chart-legend-item"><span class="legend-swatch is-peak"></span>Peak hour</span>
          <span class="modern-chart-legend-item"><span class="legend-line"></span>Trend</span>
        </div>
        <span>${escapeHtml(periodRightNote)}</span>
      </div>

      <div class="modern-chart-scroll">
        <div class="modern-chart-stage">
          <div class="modern-chart-grid">
            <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${topGrid}</span></div>
            <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${midHighGrid}</span></div>
            <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${midLowGrid}</span></div>
            <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">0</span></div>
          </div>
          ${buildSmoothSvgOverlay(values, maxVal)}
          <div class="modern-chart-bars" style="--bar-count: ${hourlyRows.length}">
            ${barsHtml}
          </div>
        </div>
      </div>

      <div class="chart-insight-strip">
        <div class="chart-insight-metrics">
          <span class="chart-insight-item">${escapeHtml(periodTotalLabel)}: <strong>${totalPeriodOrders} order${totalPeriodOrders === 1 ? '' : 's'}</strong></span>
          <span class="chart-insight-item">Peak window: <strong>${escapeHtml(peakSummary)}</strong></span>
          <span class="chart-insight-item">Average: <strong>${escapeHtml(avgText)}</strong></span>
        </div>
        <span class="chart-insight-selected">${escapeHtml(selectedCallout)}</span>
      </div>
    </div>
  `;
}

export async function mount(profile) {
  const today = getTodayManila();

  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  let stationOpen = getCachedStationOpenStatus();
  let selectedDays = 1;
  let selectedHour = null;
  let allOrders = [];
  let todayReport = null;
  let dailyReports = [];
  let hourlyRows = [];
  let slots = [];
  let accounts = [];

  if (titleEl) titleEl.textContent = getGreeting(profile.full_name || 'Admin');
  if (subEl) subEl.textContent = `Station overview · ${formatDateHeading(today)}`;

  function renderTopbarRight() {
    if (!rightEl) return;
    rightEl.innerHTML = `
      <div
        class="admin-station-control ${stationOpen ? 'is-open' : 'is-closed'}"
        id="station-open-control"
        title="Click to toggle station open or closed"
      >
        <span class="admin-station-pill" id="station-open-label">
          ${stationOpen ? 'Station open' : 'Station closed'}
        </span>
        <button
          type="button"
          class="admin-switch${stationOpen ? ' is-on' : ''}"
          id="station-open-switch"
          role="switch"
          aria-checked="${stationOpen ? 'true' : 'false'}"
          aria-label="Toggle station open or closed"
        ></button>
      </div>
      <a class="btn btn-primary" href="reports.html">Open reports</a>
    `;

    const ctrl = rightEl.querySelector('#station-open-control');
    ctrl?.addEventListener('click', async () => {
      stationOpen = !stationOpen;
      renderTopbarRight();
      try {
        await saveStationOpenStatus(stationOpen);
        showToast(
          stationOpen
            ? 'Station is now open and accepting refill orders.'
            : 'Station is now marked as closed.',
          stationOpen ? 'success' : 'info'
        );
      } catch (err) {
        showToast(err.message || 'Could not update station status.', 'error');
      }
    });
  }

  renderTopbarRight();

  async function loadData() {
    try {
      const [ordersRes, todayRepRes, dailyRepRes, hourlyRes, slotsRes, accountsRes, openRes] =
        await Promise.all([
          getAllOrdersForStaff({ limit: 300 }),
          getTodayReportSummary(),
          getDailyReports({ limit: 7 }),
          getOrderActivityByHour({ days: selectedDays }),
          getAllTimeSlotsForAdmin(today),
          getStaffAndRidersForAdmin(),
          getStationOpenStatus(),
        ]);

      allOrders = ordersRes;
      todayReport = todayRepRes;
      dailyReports = dailyRepRes;
      hourlyRows = hourlyRes;
      slots = slotsRes;
      accounts = accountsRes;
      if (typeof openRes === 'boolean' && openRes !== stationOpen) {
        stationOpen = openRes;
        renderTopbarRight();
      }
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load admin dashboard.', 'error');
    }
  }

  async function reloadHourly(days) {
    selectedDays = days;
    selectedHour = null;
    try {
      hourlyRows = await getOrderActivityByHour({ days: selectedDays });
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load hourly activity.', 'error');
    }
  }

  function renderView() {
    const todayOrders = allOrders.filter(
      (o) => o.delivery_date === today && o.status !== 'cancelled'
    );
    const completedToday = todayOrders.filter((o) =>
      ['delivered', 'completed'].includes(o.status)
    );
    const recordedSalesToday = Number(todayReport?.recorded_sales || 0);

    const yesterdayReport = (dailyReports || []).find((r) => r.report_date !== today);
    const yesterdayOrdersCount = Number(yesterdayReport?.orders || 0);
    const ordersDiff = todayOrders.length - yesterdayOrdersCount;
    const ordersTrendText =
      yesterdayReport && yesterdayOrdersCount > 0
        ? `${ordersDiff >= 0 ? '+' : ''}${ordersDiff} vs yesterday`
        : `${todayOrders.length} scheduled today`;

    const completionRate =
      todayOrders.length > 0
        ? `${Math.round((completedToday.length / todayOrders.length) * 100)}% completion`
        : 'No deliveries yet';

    const yesterdaySales = Number(yesterdayReport?.recorded_sales || 0);
    const salesPct =
      yesterdaySales > 0
        ? Math.round(((recordedSalesToday - yesterdaySales) / yesterdaySales) * 100)
        : null;
    const salesTrendText =
      salesPct !== null
        ? `${salesPct >= 0 ? '+' : ''}${salesPct}% vs yesterday`
        : 'Paid COD orders';

    const riders = (accounts || []).filter((u) => u.role === 'rider' && u.is_active);
    const availableRiders = riders.filter((r) => r.is_available);

    // Dynamic chart title & subtitle based on Today / 7 days / Month filter
    const totalPeriodOrders = hourlyRows.reduce((s, r) => s + Number(r.orders || 0), 0);
    const peakRow = hourlyRows.reduce(
      (best, cur) => (Number(cur.orders || 0) > Number(best?.orders || 0) ? cur : best),
      hourlyRows[0] || { fullLabel: '3:00 PM', label: '3PM', orders: 0 }
    );
    const peakHourLabel = (peakRow?.label || '3PM').replace(/(AM|PM)/, ' $1');
    const peakCount = Number(peakRow?.orders || 0);

    let chartTitle = 'Order activity by hour · Today';
    let chartSubtitle = '';
    if (selectedDays === 1) {
      chartTitle = 'Order activity by hour · Today';
      chartSubtitle =
        peakCount > 0
          ? `Today's hourly breakdown (${formatDateShort(today)}) · ${totalPeriodOrders} total order${totalPeriodOrders === 1 ? '' : 's'} · Peak at ${peakHourLabel} (${peakCount})`
          : `Today's hourly breakdown (${formatDateShort(today)}) · No orders placed between 7 AM and 6 PM yet`;
    } else if (selectedDays === 7) {
      const start7 = formatDateShort(getDaysAgoDateStr(today, 7));
      chartTitle = 'Order activity by hour · Last 7 days';
      chartSubtitle =
        peakCount > 0
          ? `7-day overall activity (${start7} – ${formatDateShort(today)}) · ${totalPeriodOrders} orders across 7 days · Busiest hour: ${peakHourLabel} (${peakCount})`
          : `7-day overall activity (${start7} – ${formatDateShort(today)}) · 0 orders recorded in the last 7 days`;
    } else {
      const start30 = formatDateShort(getDaysAgoDateStr(today, 30));
      chartTitle = 'Order activity by hour · Monthly (30 days)';
      chartSubtitle =
        peakCount > 0
          ? `Monthly overall hourly chart (${start30} – ${formatDateShort(today)}) · ${totalPeriodOrders} orders this month · Overall peak hour: ${peakHourLabel} (${peakCount})`
          : `Monthly overall hourly chart (${start30} – ${formatDateShort(today)}) · 0 orders recorded in the past 30 days`;
    }

    const pipelinePool =
      todayOrders.length > 0
        ? todayOrders
        : allOrders.filter((o) => o.status !== 'cancelled');
    const totalPipeline = Math.max(pipelinePool.length, 1);

    const countSubmitted = pipelinePool.filter((o) => o.status === 'submitted').length;
    const countConfirmed = pipelinePool.filter((o) => o.status === 'confirmed').length;
    const countRefilling = pipelinePool.filter((o) => o.status === 'refilling').length;
    const countReady = pipelinePool.filter((o) => o.status === 'ready').length;
    const countOut = pipelinePool.filter((o) =>
      ['rider_assigned', 'out_for_delivery'].includes(o.status)
    ).length;
    const countCompleted = pipelinePool.filter((o) =>
      ['delivered', 'completed'].includes(o.status)
    ).length;

    const pipelineRows = [
      { label: 'Submitted', filterKey: 'submitted', count: countSubmitted, tone: 'is-amber' },
      { label: 'Confirmed', filterKey: 'refilling', count: countConfirmed, tone: '' },
      { label: 'Refilling', filterKey: 'refilling', count: countRefilling, tone: '' },
      { label: 'Ready', filterKey: 'refilling', count: countReady, tone: '' },
      { label: 'Out for delivery', filterKey: 'out_for_delivery', count: countOut, tone: 'is-sky' },
      { label: 'Completed', filterKey: 'completed', count: countCompleted, tone: 'is-green' },
    ];

    const avatarTones = [''];
    const ridersHtml =
      riders.length === 0
        ? `
          <div style="padding: 8px 0;">
            <p class="text-muted" style="margin-bottom: 10px;">No rider accounts configured yet.</p>
            <a class="btn btn-outline-blue btn-sm" href="users.html?action=add&role=rider">+ Add rider account</a>
          </div>
        `
        : riders
            .map((rider, idx) => {
              const activeCount = allOrders.filter(
                (o) =>
                  o.rider_id === rider.id &&
                  ['rider_assigned', 'out_for_delivery'].includes(o.status)
              ).length;
              const subText = !rider.is_available
                ? 'Off shift · click badge to set available'
                : `${activeCount} active deliver${activeCount === 1 ? 'y' : 'ies'}`;
              const pillHtml = rider.is_available
                ? `<button type="button" class="pill pill-success pill-btn-toggle" data-toggle-rider="${escapeHtml(rider.id)}" title="Click to mark off shift">Available</button>`
                : `<button type="button" class="pill pill-neutral pill-btn-toggle" data-toggle-rider="${escapeHtml(rider.id)}" title="Click to mark available">Unavailable</button>`;

              return `
                <div class="dash-mini-row">
                  <div class="dash-rider-left">
                    <span class="dash-avatar ${avatarTones[idx % avatarTones.length]}">${escapeHtml(getInitials(rider.full_name))}</span>
                    <div>
                      <p class="dash-rider-name">${escapeHtml(rider.full_name)}</p>
                      <p class="dash-rider-sub">${escapeHtml(subText)}</p>
                    </div>
                  </div>
                  ${pillHtml}
                </div>
              `;
            })
            .join('');

    const activeSlots = (slots || []).filter((s) => s.is_active).slice(0, 5);
    const slotsHtml =
      activeSlots.length === 0
        ? `
          <div style="padding: 8px 0;">
            <p class="text-muted" style="margin-bottom: 10px;">No active delivery slots.</p>
            <a class="btn btn-outline-blue btn-sm" href="time-slots.html">Configure time slots</a>
          </div>
        `
        : activeSlots
            .map((s) => {
              const used = Number(s.orders_count || 0);
              const cap = Math.max(1, Number(s.max_orders || 10));
              const pct = Math.min(100, Math.round((used / cap) * 100));
              const isFull = used >= cap || s.is_closed_today;
              const shortLabel = formatSlotCompact(s);
              return `
                <a class="dash-slot-item" href="time-slots.html" style="text-decoration: none;">
                  <div class="dash-slot-top">
                    <span class="dash-slot-label">${escapeHtml(shortLabel)}</span>
                    <span class="dash-slot-ratio${isFull ? ' is-full' : ''}">${used}/${cap}${isFull ? ' · Full' : ''}</span>
                  </div>
                  <div class="pipeline-track">
                    <div class="pipeline-fill${isFull ? ' is-amber' : ''}" style="width: ${pct}%"></div>
                  </div>
                </a>
              `;
            })
            .join('');

    const pendingOrders = allOrders.filter(
      (o) => o.status === 'delivered' && o.payment_status === 'unpaid'
    );
    const pendingHtml =
      pendingOrders.length === 0
        ? `<p class="text-muted" style="padding: 8px 0;">All delivered orders have been confirmed as paid.</p>`
        : pendingOrders
            .slice(0, 4)
            .map(
              (o) => `
              <a class="dash-mini-row" href="all-orders.html?search=${encodeURIComponent(o.order_number)}" style="text-decoration: none;">
                <div>
                  <p class="dash-rider-name">#${escapeHtml(o.order_number)} · ${escapeHtml(o.customer?.full_name || 'Customer')}</p>
                  <p class="dash-rider-sub">Delivered · Cash on delivery · ${escapeHtml(formatPeso(o.total))}</p>
                </div>
                <span class="pill pill-warning">Pending</span>
              </a>
            `
            )
            .join('');

    content.innerHTML = `
      <div class="stack-lg">
        <div class="grid-4">
          <a class="admin-stat-card is-interactive" href="all-orders.html">
            <span class="stat-label">Orders today <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${todayOrders.length}</div>
            <span class="stat-trend is-up">${escapeHtml(ordersTrendText)}</span>
          </a>
          <a class="admin-stat-card is-interactive" href="all-orders.html?filter=completed">
            <span class="stat-label">Completed deliveries <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${completedToday.length}</div>
            <span class="stat-trend is-up">${escapeHtml(completionRate)}</span>
          </a>
          <a class="admin-stat-card is-interactive" href="reports.html">
            <span class="stat-label">Recorded sales <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${escapeHtml(formatPeso(recordedSalesToday))}</div>
            <span class="stat-trend is-up">${escapeHtml(salesTrendText)}</span>
          </a>
          <a class="admin-stat-card is-interactive" href="users.html?role=rider">
            <span class="stat-label">Available riders <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${availableRiders.length} <span style="font-size: 16px; font-weight: 500; color: var(--text-muted);">of ${riders.length}</span></div>
            <span class="stat-sub">${riders.length - availableRiders.length} off shift</span>
          </a>
        </div>

        <div class="grid-split">
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">${escapeHtml(chartTitle)}</h2>
                <p class="card-subtitle">${escapeHtml(chartSubtitle)}</p>
              </div>
              <div class="admin-seg-group" role="tablist">
                <button type="button" class="admin-seg-btn${selectedDays === 1 ? ' is-active' : ''}" data-days="1">Today</button>
                <button type="button" class="admin-seg-btn${selectedDays === 7 ? ' is-active' : ''}" data-days="7">7 days</button>
                <button type="button" class="admin-seg-btn${selectedDays === 30 ? ' is-active' : ''}" data-days="30">Month</button>
              </div>
            </div>
            ${renderModernHourlyChart(hourlyRows, { selectedDays, selectedHour, today })}
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Order pipeline</h2>
              <a class="pill pill-info" href="all-orders.html" style="text-decoration: none;">${pipelinePool.length} orders</a>
            </div>
            <div class="pipeline-list">
              ${pipelineRows
                .map((row) => {
                  const pct = Math.min(100, Math.round((row.count / totalPipeline) * 100));
                  return `
                    <a class="pipeline-row" href="all-orders.html?filter=${encodeURIComponent(row.filterKey)}" style="text-decoration: none;">
                      <div class="pipeline-head">
                        <span class="pipeline-label">${escapeHtml(row.label)}</span>
                        <span class="pipeline-count">${row.count}</span>
                      </div>
                      <div class="pipeline-track">
                        <div class="pipeline-fill ${row.tone}" style="width: ${pct}%"></div>
                      </div>
                    </a>
                  `;
                })
                .join('')}
            </div>
          </section>
        </div>

        <div class="grid-3">
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Riders today</h2>
              <a class="card-link" href="users.html?role=rider">Users</a>
            </div>
            <div class="dash-mini-list">
              ${ridersHtml}
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Orders per slot</h2>
              <a class="card-link" href="time-slots.html">Time slots</a>
            </div>
            <div class="dash-slot-list">
              ${slotsHtml}
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Pending payments</h2>
              <a class="card-link" href="reports.html">Reports</a>
            </div>
            <div class="dash-mini-list">
              ${pendingHtml}
            </div>
            <div class="dash-pending-note">
              Delivered orders count as sales once staff confirm payment.
            </div>
          </section>
        </div>
      </div>
    `;

    content.querySelectorAll('[data-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = Number(btn.getAttribute('data-days') || 1);
        if (d !== selectedDays) reloadHourly(d);
      });
    });

    content.querySelectorAll('[data-hour-bar]').forEach((bar) => {
      bar.addEventListener('click', () => {
        const h = Number(bar.getAttribute('data-hour-bar'));
        selectedHour = selectedHour === h ? null : h;
        renderView();
      });
    });

    content.querySelectorAll('[data-toggle-rider]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-rider');
        const rider = accounts.find((u) => u.id === id);
        if (!rider) return;
        const nextAvail = !rider.is_available;
        rider.is_available = nextAvail;
        renderView();
        try {
          await setRiderAvailability(rider.id, nextAvail);
          showToast(
            `${rider.full_name} is now ${nextAvail ? 'Available' : 'Unavailable'}.`,
            'success'
          );
        } catch (err) {
          rider.is_available = !nextAvail;
          renderView();
          showToast(err.message || 'Could not update rider shift status.', 'error');
        }
      });
    });
  }

  await loadData();
  const unsubscribe = subscribeAdminWorkspace(() => {
    loadData();
  });
  return () => unsubscribe();
}

bootAdminPage('dashboard', mount);
