// Admin reports: daily & monthly sales summary, date/month filters, modernized recorded sales chart with interactive text, sales mix, and CSV/print export.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  formatPeso,
  getTodayManila,
  showToast,
} from '../../core/ui.js';
import { getDailyReports, getMonthlyReports } from '../../services/reportsService.js';

function formatMonthLabel(dateStr, { short = false } = {}) {
  if (!dateStr) return '—';
  const normalized = String(dateStr).length === 7 ? `${dateStr}-01` : String(dateStr).slice(0, 10);
  const d = new Date(normalized + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric',
  });
}

function formatDayChartLabel(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = d.getDate();
  return `${weekday} ${dayNum}`;
}

function buildSalesSvgOverlay(values, maxVal) {
  const n = values.length;
  if (n < 2) return '';
  const width = 1000;
  const height = 160;
  const step = width / n;

  const points = values.map((v, idx) => {
    const x = Math.round(step * idx + step / 2);
    const ratio = maxVal > 0 ? Math.min(1, Math.max(0, v / maxVal)) : 0;
    const y = Math.round(height - ratio * (height - 24) - 6);
    return { x, y };
  });

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
        <linearGradient id="aquaReportAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1d5bd6" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#1d5bd6" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#aquaReportAreaGrad)" />
      <path d="${d}" fill="none" stroke="#1d5bd6" stroke-width="2.4" stroke-opacity="0.6" stroke-linecap="round" />
    </svg>
  `;
}

export async function mount() {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  if (titleEl) titleEl.textContent = 'Reports';

  const today = getTodayManila();
  const currentYearMonth = today.slice(0, 7);

  let mode = 'daily'; // 'daily' | 'monthly'
  let chartWindow = '7d'; // '7d' | '14d' | '30d' | 'monthly'
  let selectedMonth = 'all'; // 'all' or 'YYYY-MM'
  let startDate = '';
  let endDate = '';
  let selectedBarIndex = null;

  let dailyRows = [];
  let monthlyRows = [];

  async function loadReports() {
    try {
      [dailyRows, monthlyRows] = await Promise.all([
        getDailyReports({ limit: 60 }),
        getMonthlyReports({ limit: 12 }),
      ]);
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load sales reports.', 'error');
    }
  }

  function getAvailableMonths() {
    const set = new Set([currentYearMonth]);
    for (const r of dailyRows) {
      if (r.report_date) set.add(String(r.report_date).slice(0, 7));
    }
    for (const r of monthlyRows) {
      if (r.report_month) set.add(String(r.report_month).slice(0, 7));
    }
    // Add previous 3 months so user always has month choices even on a fresh database
    const base = new Date(today + 'T00:00:00');
    for (let i = 1; i <= 3; i++) {
      const d = new Date(base);
      d.setMonth(d.getMonth() - i);
      set.add(d.toISOString().slice(0, 7));
    }
    return Array.from(set).sort().reverse();
  }

  function getFilteredRows() {
    if (mode === 'monthly' || chartWindow === 'monthly') {
      let rows = [...monthlyRows];
      if (selectedMonth !== 'all') {
        rows = rows.filter((r) => String(r.report_month || '').startsWith(selectedMonth));
      }
      return rows;
    }

    let rows = [...dailyRows];
    if (selectedMonth !== 'all') {
      rows = rows.filter((r) => String(r.report_date || '').startsWith(selectedMonth));
    }
    if (startDate) {
      rows = rows.filter((r) => String(r.report_date || '') >= startDate);
    }
    if (endDate) {
      rows = rows.filter((r) => String(r.report_date || '') <= endDate);
    }
    if (!startDate && !endDate && selectedMonth === 'all') {
      const limitCount = chartWindow === '7d' ? 7 : chartWindow === '14d' ? 14 : 30;
      rows = rows.slice(0, limitCount);
    }
    return rows;
  }

  function exportCsv(rows) {
    const isMonthlyView = mode === 'monthly' || chartWindow === 'monthly';
    const headers = [
      isMonthlyView ? 'Month' : 'Date',
      'Orders',
      'Refill Sales',
      'Service Charges',
      'Pending Payment',
      'Recorded Sales',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          isMonthlyView ? String(r.report_month || '').slice(0, 7) : r.report_date,
          Number(r.orders || 0),
          Number(r.refill_sales || 0).toFixed(2),
          Number(r.service_charges || 0).toFixed(2),
          Number(r.pending_payment || 0).toFixed(2),
          Number(r.recorded_sales || 0).toFixed(2),
        ].join(',')
      ),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aquarun-${isMonthlyView ? 'monthly' : 'daily'}-report.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Report exported as CSV.', 'success');
  }

  function renderView() {
    const isMonthlyView = mode === 'monthly' || chartWindow === 'monthly';
    const activeRows = getFilteredRows();
    const monthsList = getAvailableMonths();

    // Update topbar subtitle dynamically
    let rangeDescription = '';
    if (selectedMonth !== 'all') {
      rangeDescription = formatMonthLabel(selectedMonth);
    } else if (startDate || endDate) {
      rangeDescription = `${startDate ? formatDateShort(startDate) : 'Start'} – ${endDate ? formatDateShort(endDate) : 'Today'}`;
    } else if (isMonthlyView) {
      rangeDescription = 'Monthly overview (Last 12 months)';
    } else if (chartWindow === '7d') {
      rangeDescription = 'Last 7 days';
    } else if (chartWindow === '14d') {
      rangeDescription = 'Last 14 days';
    } else {
      rangeDescription = 'Last 30 days (Monthly window)';
    }

    if (subEl) {
      subEl.textContent = `${isMonthlyView ? 'Monthly' : 'Daily'} sales · ${rangeDescription}`;
    }

    if (rightEl) {
      rightEl.innerHTML = `
        <div class="admin-seg-group">
          <button type="button" class="admin-seg-btn${!isMonthlyView ? ' is-active' : ''}" id="btn-mode-daily">Daily</button>
          <button type="button" class="admin-seg-btn${isMonthlyView ? ' is-active' : ''}" id="btn-mode-monthly">Monthly</button>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-report-print">Print</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-report-export">Export CSV</button>
      `;

      rightEl.querySelector('#btn-mode-daily')?.addEventListener('click', () => {
        mode = 'daily';
        if (chartWindow === 'monthly') chartWindow = '7d';
        selectedBarIndex = null;
        renderView();
      });
      rightEl.querySelector('#btn-mode-monthly')?.addEventListener('click', () => {
        mode = 'monthly';
        chartWindow = 'monthly';
        selectedBarIndex = null;
        renderView();
      });
      rightEl.querySelector('#btn-report-print')?.addEventListener('click', () => {
        window.print();
      });
      rightEl.querySelector('#btn-report-export')?.addEventListener('click', () => {
        exportCsv(activeRows);
      });
    }

    const totalOrders = activeRows.reduce((s, r) => s + Number(r.orders || 0), 0);
    const totalRefill = activeRows.reduce((s, r) => s + Number(r.refill_sales || 0), 0);
    const totalService = activeRows.reduce((s, r) => s + Number(r.service_charges || 0), 0);
    const totalPending = activeRows.reduce((s, r) => s + Number(r.pending_payment || 0), 0);
    const totalRecorded = activeRows.reduce((s, r) => s + Number(r.recorded_sales || 0), 0);

    // Build chronological chart items (if database has 0 rows for the selected window, synthesize clean timeline placeholders so chart is always interactive)
    let chartRows = [...activeRows].slice(0, isMonthlyView ? 12 : 14).reverse();
    if (chartRows.length === 0) {
      if (isMonthlyView) {
        const monthsToBuild = selectedMonth !== 'all' ? [selectedMonth] : monthsList.slice(0, 6).reverse();
        chartRows = monthsToBuild.map((ym) => ({
          report_month: `${ym}-01`,
          orders: 0,
          refill_sales: 0,
          service_charges: 0,
          pending_payment: 0,
          recorded_sales: 0,
        }));
      } else {
        const countDays = chartWindow === '14d' ? 10 : 7;
        const baseD = new Date((endDate || today) + 'T00:00:00');
        chartRows = Array.from({ length: countDays }, (_, idx) => {
          const d = new Date(baseD);
          d.setDate(d.getDate() - (countDays - 1 - idx));
          return {
            report_date: d.toISOString().slice(0, 10),
            orders: 0,
            refill_sales: 0,
            service_charges: 0,
            pending_payment: 0,
            recorded_sales: 0,
          };
        });
      }
    }

    const chartValues = chartRows.map((r) => Number(r.recorded_sales || 0));
    const rawMax = Math.max(...chartValues, 0);
    const maxVal = Math.max(rawMax, 500);
    const peakIdx = rawMax > 0 ? chartValues.indexOf(rawMax) : -1;
    const bestRow = peakIdx >= 0 ? chartRows[peakIdx] : null;

    const bestLabelText = bestRow
      ? `${
          isMonthlyView
            ? formatMonthLabel(bestRow.report_month)
            : formatDateShort(bestRow.report_date)
        } (${formatPeso(bestRow.recorded_sales)})`
      : 'None yet';

    // Dynamic chart title and subtitle reflecting the active filter!
    let chartTitle = '';
    let chartSubtitle = '';
    if (isMonthlyView) {
      chartTitle =
        selectedMonth !== 'all'
          ? `Monthly sales overview · ${formatMonthLabel(selectedMonth)}`
          : 'Recorded sales by month · Overall monthly chart';
      chartSubtitle =
        totalRecorded > 0
          ? `Overall monthly sales (${rangeDescription}): ${formatPeso(totalRecorded)} across ${totalOrders} orders · Top month: ${bestLabelText}`
          : `Overall monthly chart (${rangeDescription}) · ₱0 recorded sales so far · Completed COD orders appear here`;
    } else if (selectedMonth !== 'all') {
      chartTitle = `Recorded sales by day · ${formatMonthLabel(selectedMonth)}`;
      chartSubtitle = `Daily breakdown for ${formatMonthLabel(selectedMonth)} · Month total: ${formatPeso(totalRecorded)} (${totalOrders} orders) · Best day: ${bestLabelText}`;
    } else if (startDate || endDate) {
      chartTitle = `Recorded sales · Custom date filter`;
      chartSubtitle = `Filtered date window (${rangeDescription}) · Total: ${formatPeso(totalRecorded)} (${totalOrders} orders) · Best day: ${bestLabelText}`;
    } else if (chartWindow === '30d') {
      chartTitle = `Recorded sales · Monthly (Last 30 days)`;
      chartSubtitle = `30-day monthly overview · Total recorded sales: ${formatPeso(totalRecorded)} across ${totalOrders} orders · Best day: ${bestLabelText}`;
    } else if (chartWindow === '14d') {
      chartTitle = `Recorded sales by day · Last 14 days`;
      chartSubtitle = `14-day sales window · Total recorded sales: ${formatPeso(totalRecorded)} across ${totalOrders} orders · Best day: ${bestLabelText}`;
    } else {
      chartTitle = `Recorded sales by day · Last 7 days`;
      chartSubtitle = `7-day sales overview · Total recorded sales: ${formatPeso(totalRecorded)} across ${totalOrders} orders · Best day: ${bestLabelText}`;
    }

    const avgPerUnit =
      chartRows.length > 0 ? formatPeso(Math.round(totalRecorded / chartRows.length)) : '₱0';

    const inspectedRow =
      selectedBarIndex !== null && chartRows[selectedBarIndex]
        ? chartRows[selectedBarIndex]
        : bestRow;
    const inspectedCallout = inspectedRow
      ? `${
          isMonthlyView
            ? formatMonthLabel(inspectedRow.report_month, { short: true })
            : formatDateShort(inspectedRow.report_date)
        }: ${formatPeso(inspectedRow.recorded_sales)} (${Number(inspectedRow.orders || 0)} orders · Pending ${formatPeso(inspectedRow.pending_payment)})`
      : 'Tap any bar to inspect sales breakdown';

    const barsHtml = chartRows
      .map((r, idx) => {
        const val = Number(r.recorded_sales || 0);
        const isPeak = idx === peakIdx && val > 0;
        const isSelected = selectedBarIndex === idx;
        const pct = maxVal > 0 ? Math.max(val > 0 ? 14 : 5, Math.round((val / maxVal) * 100)) : 5;
        const label = isMonthlyView
          ? formatMonthLabel(r.report_month, { short: true })
          : formatDayChartLabel(r.report_date);
        return `
          <div
            class="modern-bar-col${isPeak ? ' is-peak' : ''}${isSelected ? ' is-selected' : ''}"
            data-report-bar="${idx}"
            title="${escapeHtml(label)}: ${escapeHtml(formatPeso(val))} (${Number(r.orders || 0)} orders)"
          >
            <div class="modern-bar-track">
              <span class="modern-bar-val">${escapeHtml(formatPeso(val))}</span>
              <div class="modern-bar-fill" style="height: ${pct}%"></div>
            </div>
            <span class="modern-bar-label">${escapeHtml(label)}</span>
          </div>
        `;
      })
      .join('');

    const mixDenominator = Math.max(totalRecorded + totalPending, 1);
    const refillPct = Math.min(100, Math.round((totalRefill / Math.max(totalRecorded, 1)) * 100));
    const servicePct = Math.min(100, Math.round((totalService / Math.max(totalRecorded, 1)) * 100));
    const pendingPct = Math.min(100, Math.round((totalPending / mixDenominator) * 100));

    const tableRowsHtml =
      activeRows.length === 0
        ? `<tr><td colspan="6" class="text-muted" style="text-align:center; padding: 24px;">No sales rows match the selected ${escapeHtml(rangeDescription.toLowerCase())} filter yet.</td></tr>`
        : activeRows
            .map((r) => {
              const dateLabel = isMonthlyView
                ? formatMonthLabel(r.report_month)
                : formatDateShort(r.report_date);
              return `
                <tr>
                  <td style="font-weight: 600;">${escapeHtml(dateLabel)}</td>
                  <td>${Number(r.orders || 0)}</td>
                  <td>${escapeHtml(formatPeso(r.refill_sales))}</td>
                  <td>${escapeHtml(formatPeso(r.service_charges))}</td>
                  <td>${escapeHtml(formatPeso(r.pending_payment))}</td>
                  <td class="reports-table-total-cell">${escapeHtml(formatPeso(r.recorded_sales))}</td>
                </tr>
              `;
            })
            .join('');

    const hasCustomFilters = selectedMonth !== 'all' || Boolean(startDate) || Boolean(endDate);

    content.innerHTML = `
      <div class="stack-lg">
        <section class="card reports-filter-card">
          <div class="reports-filter-toolbar">
            <div class="reports-filter-group">
              <div class="reports-filter-field">
                <label for="report-month-select">Filter by month</label>
                <select class="select" id="report-month-select">
                  <option value="all" ${selectedMonth === 'all' ? 'selected' : ''}>All months</option>
                  ${monthsList
                    .map(
                      (ym) =>
                        `<option value="${escapeHtml(ym)}" ${selectedMonth === ym ? 'selected' : ''}>${escapeHtml(
                          formatMonthLabel(ym)
                        )}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <div class="reports-filter-field">
                <label for="report-start-date">From date</label>
                <input
                  type="date"
                  class="input"
                  id="report-start-date"
                  value="${escapeHtml(startDate)}"
                  ${isMonthlyView ? 'disabled' : ''}
                />
              </div>

              <div class="reports-filter-field">
                <label for="report-end-date">To date</label>
                <input
                  type="date"
                  class="input"
                  id="report-end-date"
                  value="${escapeHtml(endDate)}"
                  ${isMonthlyView ? 'disabled' : ''}
                />
              </div>

              ${
                hasCustomFilters
                  ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-reset-report-filters">Reset filters</button>`
                  : ''
              }
            </div>

            <div class="admin-seg-group" role="tablist" aria-label="Chart range">
              <button type="button" class="admin-seg-btn${!isMonthlyView && chartWindow === '7d' ? ' is-active' : ''}" data-chart-win="7d">7 days</button>
              <button type="button" class="admin-seg-btn${!isMonthlyView && chartWindow === '14d' ? ' is-active' : ''}" data-chart-win="14d">14 days</button>
              <button type="button" class="admin-seg-btn${!isMonthlyView && chartWindow === '30d' ? ' is-active' : ''}" data-chart-win="30d">Month (30d)</button>
              <button type="button" class="admin-seg-btn${isMonthlyView ? ' is-active' : ''}" data-chart-win="monthly">By Month</button>
            </div>
          </div>
        </section>

        <div class="grid-4">
          <div class="admin-stat-card">
            <span class="stat-label">Refill sales</span>
            <div class="stat-value">${escapeHtml(formatPeso(totalRefill))}</div>
            <span class="stat-sub">Water refills (${totalOrders} orders)</span>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Service charges</span>
            <div class="stat-value">${escapeHtml(formatPeso(totalService))}</div>
            <span class="stat-sub">Delivery service fees</span>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Pending payment</span>
            <div class="stat-value">${escapeHtml(formatPeso(totalPending))}</div>
            <span class="stat-sub">Delivered · awaiting confirmation</span>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Recorded sales</span>
            <div class="stat-value">${escapeHtml(formatPeso(totalRecorded))}</div>
            <span class="stat-trend is-up">${escapeHtml(rangeDescription)}</span>
          </div>
        </div>

        <div class="grid-split">
          <section class="card reports-bar-chart">
            <div class="card-header">
              <div>
                <h2 class="card-title">${escapeHtml(chartTitle)}</h2>
                <p class="card-subtitle">${escapeHtml(chartSubtitle)}</p>
              </div>
              <div class="admin-seg-group" role="tablist">
                <button type="button" class="admin-seg-btn${!isMonthlyView && chartWindow === '7d' ? ' is-active' : ''}" data-chart-win="7d">7 days</button>
                <button type="button" class="admin-seg-btn${!isMonthlyView && chartWindow === '30d' ? ' is-active' : ''}" data-chart-win="30d">30 days</button>
                <button type="button" class="admin-seg-btn${isMonthlyView ? ' is-active' : ''}" data-chart-win="monthly">Monthly</button>
              </div>
            </div>
            <div class="modern-chart-wrap">
              <div class="modern-chart-legend">
                <div class="modern-chart-legend-items">
                  <span class="modern-chart-legend-item"><span class="legend-swatch"></span>Recorded sales</span>
                  <span class="modern-chart-legend-item"><span class="legend-swatch is-peak"></span>Highest ${isMonthlyView ? 'month' : 'day'}</span>
                  <span class="modern-chart-legend-item"><span class="legend-line"></span>Trend</span>
                </div>
                <span>${escapeHtml(rangeDescription)} · Paid COD</span>
              </div>

              <div class="modern-chart-scroll">
                <div class="modern-chart-stage">
                  <div class="modern-chart-grid">
                    <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${escapeHtml(formatPeso(maxVal))}</span></div>
                    <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${escapeHtml(formatPeso(Math.round((maxVal * 2) / 3)))}</span></div>
                    <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">${escapeHtml(formatPeso(Math.round(maxVal / 3)))}</span></div>
                    <div class="modern-chart-grid-line"><span class="modern-chart-grid-label">₱0</span></div>
                  </div>
                  ${buildSalesSvgOverlay(chartValues, maxVal)}
                  <div class="modern-chart-bars" style="--bar-count: ${Math.max(chartRows.length, 1)}">
                    ${barsHtml}
                  </div>
                </div>
              </div>

              <div class="chart-insight-strip">
                <div class="chart-insight-metrics">
                  <span class="chart-insight-item">Overall total: <strong>${escapeHtml(formatPeso(totalRecorded))}</strong></span>
                  <span class="chart-insight-item">Best ${isMonthlyView ? 'month' : 'day'}: <strong>${escapeHtml(bestLabelText)}</strong></span>
                  <span class="chart-insight-item">Avg / ${isMonthlyView ? 'month' : 'day'}: <strong>${escapeHtml(avgPerUnit)}</strong></span>
                </div>
                <span class="chart-insight-selected">${escapeHtml(inspectedCallout)}</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Sales mix</h2>
              <span class="pill pill-info">${escapeHtml(rangeDescription)}</span>
            </div>
            <div class="sales-mix-list">
              <div class="pipeline-row">
                <div class="pipeline-head">
                  <span class="pipeline-label">Refill sales</span>
                  <span class="pipeline-count">${escapeHtml(formatPeso(totalRefill))}</span>
                </div>
                <div class="pipeline-track">
                  <div class="pipeline-fill" style="width: ${refillPct}%"></div>
                </div>
              </div>

              <div class="pipeline-row">
                <div class="pipeline-head">
                  <span class="pipeline-label">Service charges</span>
                  <span class="pipeline-count">${escapeHtml(formatPeso(totalService))}</span>
                </div>
                <div class="pipeline-track">
                  <div class="pipeline-fill is-sky" style="width: ${servicePct}%"></div>
                </div>
              </div>

              <div class="pipeline-row">
                <div class="pipeline-head">
                  <span class="pipeline-label">Pending payment</span>
                  <span class="pipeline-count">${escapeHtml(formatPeso(totalPending))}</span>
                </div>
                <div class="pipeline-track">
                  <div class="pipeline-fill is-amber" style="width: ${pendingPct}%"></div>
                </div>
              </div>
            </div>
            <div class="sales-mix-note">
              Pending payment is not counted in recorded sales.
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${isMonthlyView ? 'Monthly' : 'Daily'} breakdown</h2>
              <p class="card-subtitle">Showing ${activeRows.length} ${isMonthlyView ? 'month' : 'day'}${activeRows.length === 1 ? '' : 's'} for ${escapeHtml(rangeDescription)}</p>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>${isMonthlyView ? 'Month' : 'Date'}</th>
                  <th>Orders</th>
                  <th>Refill sales</th>
                  <th>Service charges</th>
                  <th>Pending payment</th>
                  <th>Recorded sales</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    // Bind filter controls
    content.querySelector('#report-month-select')?.addEventListener('change', (e) => {
      selectedMonth = e.target.value || 'all';
      selectedBarIndex = null;
      renderView();
    });

    content.querySelector('#report-start-date')?.addEventListener('change', (e) => {
      startDate = e.target.value || '';
      selectedBarIndex = null;
      renderView();
    });

    content.querySelector('#report-end-date')?.addEventListener('change', (e) => {
      endDate = e.target.value || '';
      selectedBarIndex = null;
      renderView();
    });

    content.querySelector('#btn-reset-report-filters')?.addEventListener('click', () => {
      selectedMonth = 'all';
      startDate = '';
      endDate = '';
      selectedBarIndex = null;
      renderView();
    });

    content.querySelectorAll('[data-chart-win]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const win = btn.getAttribute('data-chart-win') || '7d';
        chartWindow = win;
        mode = win === 'monthly' ? 'monthly' : 'daily';
        selectedBarIndex = null;
        renderView();
      });
    });

    content.querySelectorAll('[data-report-bar]').forEach((bar) => {
      bar.addEventListener('click', () => {
        const idx = Number(bar.getAttribute('data-report-bar'));
        selectedBarIndex = selectedBarIndex === idx ? null : idx;
        renderView();
      });
    });
  }

  await loadReports();
  const unsubscribe = subscribeAdminWorkspace(() => {
    loadReports();
  });
  return () => unsubscribe();
}

bootAdminPage('reports', mount);
