import { bootCustomerPage } from '../../core/nav.js';
import { confirmModal, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
} from '../../services/addressesService.js';
import { formatAddressFull } from '../../services/ordersService.js';
import { calculateDistanceKm, getStationLocationSettings } from '../../services/settingsService.js';

const ICONS = {
  bookmark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  home: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1V9.5"/></svg>`,
  pin: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  alert: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  info: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  locate: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  expand: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
  collapse: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="10" y1="14" x2="3" y2="21"/></svg>`,
  store: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

function getAddressIcon(label = '') {
  return /^home$/i.test(label.trim()) ? ICONS.home : ICONS.pin;
}

async function ensureAddressesAssets() {
  if (!document.querySelector('link[href*="leaflet.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!document.querySelector('link[href*="addresses.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../css/pages/customer/addresses.css';
    document.head.appendChild(link);
  }
  if (typeof L === 'undefined') {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  }
}

export async function mount(me) {
  await ensureAddressesAssets().catch(() => {});
  const content = document.querySelector('#content');
  let addresses = [];
  let editingId = null;
  let isFormOpen = window.location.hash === '#add' || window.location.hash === '#new';
  let chosenLat = null;
  let chosenLng = null;
  let miniMap = null;
  let isMapExpanded = false;

  let stationSettings = {
    lat: 14.7565,
    lng: 121.0437,
    radiusKm: 3.5,
    address: 'University of Caloocan City, Caloocan',
  };

  try {
    const loaded = await getStationLocationSettings();
    if (loaded) stationSettings = loaded;
  } catch {}

  function cleanupMap() {
    if (miniMap) {
      try {
        miniMap.remove();
      } catch {}
      miniMap = null;
    }
  }

  function renderPage() {
    cleanupMap();
    const editingAddr = editingId ? addresses.find((a) => a.id === editingId) : null;
    if (editingAddr) {
      chosenLat = editingAddr?.latitude ? Number(editingAddr.latitude) : null;
      chosenLng = editingAddr?.longitude ? Number(editingAddr.longitude) : null;
    } else if (!isFormOpen) {
      chosenLat = null;
      chosenLng = null;
    }

    const listHtml = addresses.length
      ? `<div class="address-list">
          ${addresses
            .map((addr) => {
              const isSelected = editingId === addr.id;
              const hasCoords = addr.latitude && addr.longitude;
              const dist = hasCoords
                ? calculateDistanceKm(
                    stationSettings.lat,
                    stationSettings.lng,
                    Number(addr.latitude),
                    Number(addr.longitude)
                  )
                : null;
              const isWithinZone = dist !== null && dist <= stationSettings.radiusKm;

              let badgeHtml = '';
              if (dist !== null) {
                badgeHtml = isWithinZone
                  ? `<span class="address-distance-badge in-zone">${ICONS.check} ${dist} km · In zone</span>`
                  : `<span class="address-distance-badge out-zone">${ICONS.alert} ${dist} km · Outside zone</span>`;
              } else {
                badgeHtml = `<span class="address-distance-badge no-coords">${ICONS.pin} Needs pin</span>`;
              }

              return `
                <div class="address-card ${isSelected ? 'is-active-editing' : ''}">
                  <div class="address-card-top">
                    <div class="address-card-title-group">
                      <span class="address-card-icon">${getAddressIcon(addr.label)}</span>
                      <span class="address-label">${escapeHtml(addr.label)}</span>
                    </div>
                    ${addr.is_default ? `<span class="pill pill-green" style="font-size: 10.5px; padding: 2px 7px;">Default</span>` : ''}
                  </div>

                  <p class="address-line">${escapeHtml(formatAddressFull(addr))}</p>
                  ${
                    addr.landmark
                      ? `<p class="address-landmark">Landmark: ${escapeHtml(addr.landmark)}</p>`
                      : ''
                  }

                  <div>${badgeHtml}</div>

                  <div class="address-actions">
                    <button type="button" class="btn btn-outline-blue btn-sm" data-edit-id="${escapeHtml(addr.id)}">
                      ${isSelected ? 'Editing...' : 'Edit'}
                    </button>
                    ${
                      !addr.is_default
                        ? `<button type="button" class="btn btn-light btn-sm" data-default-id="${escapeHtml(addr.id)}">
                            Set default
                          </button>`
                        : ''
                    }
                    <button type="button" class="btn btn-outline-danger btn-sm" data-delete-id="${escapeHtml(addr.id)}">
                      Delete
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>`
      : `<div class="empty-state" style="padding: 24px 14px; text-align: center;">
          <div style="width: 44px; height: 44px; border-radius: 50%; background: var(--brand-soft, #ebf2ff); color: var(--blue-app, #1d5bd6); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;">
            ${ICONS.pin}
          </div>
          <p style="font-size: 13.5px; font-weight: 700; color: #1e293b; margin: 0;">No saved addresses yet</p>
          <p class="text-muted" style="font-size: 12px; margin: 4px 0 12px;">Add your house location to confirm delivery coverage.</p>
          <button type="button" class="btn btn-primary btn-sm" id="empty-add-addr-btn">
            ${ICONS.plus} <span>Add delivery address</span>
          </button>
        </div>`;

    // Right Column content: Form (when adding/editing) OR Welcome Card (when browsing)
    const shouldShowForm = isFormOpen || Boolean(editingAddr);

    let defaultLabel = '';
    if (editingAddr) {
      defaultLabel = editingAddr.label || '';
    } else {
      defaultLabel = addresses.some((a) => (a.label || '').trim().toLowerCase() === 'home') ? 'Work' : 'Home';
    }

    const rightColumnHtml = shouldShowForm
      ? `
        <div class="card addresses-main">
          <div class="card-header" style="padding-bottom: 12px;">
            <div class="card-title-group">
              <span class="card-icon">${editingAddr ? ICONS.pin : ICONS.plus}</span>
              <h2 class="card-title" style="font-size: 15px;">
                ${editingAddr ? `Edit: ${escapeHtml(editingAddr.label)}` : 'Add delivery address'}
              </h2>
            </div>
            <button type="button" class="btn btn-light btn-sm" id="close-form-btn" style="font-size: 12px; gap: 4px;">
              ${ICONS.x} <span>Close</span>
            </button>
          </div>

          <form class="form-stack" id="address-form" novalidate>
            <!-- Label and Landmark in 2 columns -->
            <div class="field-row">
              <div class="field">
                <label class="field-label" for="addr-label">Address label <span style="color:#ef4444;">*</span></label>
                <div class="addr-label-presets">
                  <button type="button" class="addr-preset-btn ${defaultLabel === 'Home' ? 'active' : ''}" data-preset="Home">Home</button>
                  <button type="button" class="addr-preset-btn ${defaultLabel === 'Work' ? 'active' : ''}" data-preset="Work">Work</button>
                  <button type="button" class="addr-preset-btn ${defaultLabel === 'Apartment' ? 'active' : ''}" data-preset="Apartment">Apartment</button>
                  <button type="button" class="addr-preset-btn ${defaultLabel === 'Parents' ? 'active' : ''}" data-preset="Parents">Parents</button>
                  <button type="button" class="addr-preset-btn ${!['Home', 'Work', 'Apartment', 'Parents'].includes(defaultLabel) ? 'active' : ''}" data-preset="Other">Other</button>
                </div>
                <input class="input" id="addr-label" name="label" type="text" placeholder="e.g. Home, Work, Apartment" value="${escapeHtml(defaultLabel)}" required>
                <div class="field-error-msg" id="addr-label-error"></div>
              </div>
              <div class="field">
                <label class="field-label" for="addr-landmark">Landmark (optional)</label>
                <input class="input" id="addr-landmark" name="landmark" type="text" placeholder="Nearby landmark, gate, corner" value="${escapeHtml(editingAddr?.landmark || '')}">
              </div>
            </div>

            <!-- Street Address -->
            <div class="field">
              <label class="field-label" for="addr-street">Street address / House number <span style="color:#ef4444;">*</span></label>
              <input class="input" id="addr-street" name="street" type="text" placeholder="House/Unit #, Street, Subdivision" value="${escapeHtml(editingAddr?.street || '')}" required>
              <div class="field-error-msg" id="addr-street-error"></div>
            </div>

            <!-- Barangay & City in 2 columns -->
            <div class="field-row">
              <div class="field">
                <label class="field-label" for="addr-barangay">Barangay <span style="color:#ef4444;">*</span></label>
                <input class="input" id="addr-barangay" name="barangay" type="text" placeholder="Barangay" value="${escapeHtml(editingAddr?.barangay && editingAddr.barangay !== 'N/A' ? editingAddr.barangay : 'Barangay 171')}" required>
                <div class="field-error-msg" id="addr-barangay-error"></div>
              </div>
              <div class="field">
                <label class="field-label" for="addr-city">City <span style="color:#ef4444;">*</span></label>
                <input class="input" id="addr-city" name="city" type="text" placeholder="Caloocan" value="${escapeHtml(editingAddr?.city || 'Caloocan')}" required>
                <div class="field-error-msg" id="addr-city-error"></div>
              </div>
            </div>

            <!-- Balanced Map Box -->
            <div class="addr-map-box" id="addr-map-box">
              <div class="addr-map-box-header">
                <div class="addr-map-box-title">
                  ${ICONS.pin}
                  <span>Pinpoint house on map</span>
                </div>
                <div class="addr-map-actions-group">
                  <button type="button" class="btn btn-light" id="locate-me-btn" title="Use GPS location">
                    ${ICONS.locate} <span>Locate me</span>
                  </button>
                  <button type="button" class="btn btn-light" id="expand-map-btn" title="Toggle fullscreen view">
                    ${ICONS.expand} <span id="expand-btn-text">Fullscreen</span>
                  </button>
                </div>
              </div>

              <!-- Quick Search on Map -->
              <div class="addr-map-search-row">
                <input type="text" id="map-search-input" placeholder="Search street, subdivision, or barangay...">
                <button type="button" class="btn btn-primary" id="map-search-btn">
                  Find
                </button>
              </div>

              <!-- Leaflet Map Container -->
              <div class="addr-map-wrap">
                <div id="addr-pin-map"></div>
              </div>

              <!-- Zone Status Banner -->
              <div class="zone-status-box is-idle" id="zone-status-box">
                ${ICONS.info}
                <div>
                  Tap on the map or drag the pin to your house. Station delivery zone is <strong>${stationSettings.radiusKm} km</strong>.
                </div>
              </div>
            </div>

            <label class="check" style="margin-top: 2px;">
              <input type="checkbox" id="addr-default" name="isDefault" ${editingAddr?.is_default || addresses.length === 0 ? 'checked' : ''}>
              <span style="font-size: 13px;">Set as default delivery address</span>
            </label>

            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button type="button" class="btn btn-light" id="cancel-form-btn" style="flex: 1; padding: 10px;">
                Cancel
              </button>
              <button type="submit" class="btn btn-primary" id="save-address-btn" style="flex: 2; padding: 10px;">
                ${editingAddr ? 'Update address' : 'Save address'}
              </button>
            </div>
          </form>
        </div>
      `
      : `
        <div class="card addresses-main addresses-placeholder-card">
          <div class="addr-welcome-header">
            <div class="addr-welcome-badge">
              ${ICONS.pin}
              <span>Caloocan Station Delivery Hub</span>
            </div>
            <h2 class="addr-welcome-title">Need water delivered?</h2>
            <p class="addr-welcome-desc">
              Add a delivery address to pinpoint your house on our interactive map and verify delivery coverage from our station.
            </p>
          </div>

          <div class="addr-feature-grid">
            <div class="addr-feature-item">
              <div class="addr-feature-icon">${ICONS.pin}</div>
              <div class="addr-feature-text">
                <strong>Pinpoint House on Map</strong>
                <span>Drop a precise pin right at your doorstep for fast, accurate rider delivery.</span>
              </div>
            </div>
            <div class="addr-feature-item">
              <div class="addr-feature-icon">${ICONS.check}</div>
              <div class="addr-feature-text">
                <strong>Instant Zone Verification</strong>
                <span>Real-time coverage scan confirms if you are within our ${stationSettings.radiusKm} km delivery radius.</span>
              </div>
            </div>
            <div class="addr-feature-item">
              <div class="addr-feature-icon">${ICONS.home}</div>
              <div class="addr-feature-text">
                <strong>Saved Addresses</strong>
                <span>Save Home, Office, or Apartment for seamless 1-click checkout.</span>
              </div>
            </div>
          </div>

          <div class="addr-welcome-cta">
            <button type="button" class="btn btn-primary btn-lg" id="trigger-add-addr-btn" style="padding: 10px 24px; font-weight: 700;">
              ${ICONS.plus} <span>Add delivery address</span>
            </button>
          </div>
        </div>
      `;

    content.innerHTML = `
      <div class="addresses-layout">
        <!-- Left Column: Saved Addresses & Station Info -->
        <div class="addresses-sidebar">
          <div class="card">
            <div class="card-header" style="padding-bottom: 12px;">
              <div class="addresses-header-actions">
                <div class="card-title-group">
                  <span class="card-icon">${ICONS.bookmark}</span>
                  <h2 class="card-title" style="font-size: 15px;">Saved addresses (${addresses.length})</h2>
                </div>
                <button type="button" class="btn btn-sm btn-primary" id="add-new-addr-btn" style="font-size: 12px; padding: 4px 10px;">
                  ${ICONS.plus} <span>Add address</span>
                </button>
              </div>
            </div>
            ${listHtml}
          </div>

          <!-- Station Delivery Zone Reference Card -->
          <div class="sidebar-coverage-card">
            <div class="sidebar-coverage-title">
              ${ICONS.store}
              <span>Station Delivery Info</span>
            </div>
            <div class="sidebar-coverage-row">
              <span>Hub:</span>
              <strong style="max-width: 170px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(stationSettings.address || 'Station')}">
                ${escapeHtml(stationSettings.address || 'Caloocan Station')}
              </strong>
            </div>
            <div class="sidebar-coverage-row">
              <span>Delivery Radius:</span>
              <strong>${stationSettings.radiusKm} km zone</strong>
            </div>
            <div class="sidebar-coverage-row">
              <span>Payment Mode:</span>
              <strong>Cash on Delivery (COD)</strong>
            </div>
          </div>
        </div>

        <!-- Right Column: Add / Edit Address Form & Map OR Guide Card -->
        ${rightColumnHtml}
      </div>
    `;

    // Initialize Map only when form container is in the DOM
    if (shouldShowForm) {
      setTimeout(() => {
        const mapEl = document.querySelector('#addr-pin-map');
        if (!mapEl || typeof L === 'undefined') return;

        const stLat = stationSettings.lat || 14.7565;
        const stLng = stationSettings.lng || 121.0437;
        const radiusKm = stationSettings.radiusKm || 3.5;

        const initialCenterLat = chosenLat || stLat;
        const initialCenterLng = chosenLng || stLng;

        miniMap = L.map('addr-pin-map', {
          zoomControl: true,
          scrollWheelZoom: true,
          closePopupOnClick: false,
        }).setView([initialCenterLat, initialCenterLng], chosenLat ? 16 : 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(miniMap);

        // Station Hub Marker with compact bubble (interactive: false so clicks pass through to map)
        const stationIcon = L.divIcon({
          className: 'station-hub-leaflet-icon',
          html: `<div class="station-hub-bubble" title="AquaRun Water Station">
            <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
            <span>Station</span>
          </div>`,
          iconSize: [64, 24],
          iconAnchor: [32, 24],
        });

        const stationMarker = L.marker([stLat, stLng], {
          icon: stationIcon,
          zIndexOffset: 50,
          interactive: false,
        }).addTo(miniMap);

        // Station Delivery Radius Circle (interactive: false so clicks pass through anywhere!)
        const deliveryCircle = L.circle([stLat, stLng], {
          radius: radiusKm * 1000,
          color: '#1d5bd6',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          weight: 2,
          dashArray: '5, 5',
          interactive: false,
        }).addTo(miniMap);

        let customerMarker = null;

        function updateZoneUI(lat, lng, showToastNotice = false) {
          const statusBox = document.querySelector('#zone-status-box');
          if (!statusBox) return;

          const dist = calculateDistanceKm(stLat, stLng, lat, lng);
          if (dist === null) return;

          const isOk = dist <= radiusKm;
          statusBox.className = `zone-status-box ${isOk ? 'is-inside' : 'is-outside'}`;

          if (isOk) {
            statusBox.innerHTML = `
              ${ICONS.check}
              <div>
                <strong>Inside delivery zone (${dist} km from station)</strong>
                <span class="zone-subtext">Delivery is available to this address.</span>
              </div>
            `;
            if (showToastNotice) {
              showToast(`Inside delivery zone (${dist} km from station). Delivery available!`, 'success');
            }
          } else {
            statusBox.innerHTML = `
              ${ICONS.alert}
              <div>
                <strong>Outside delivery radius (${dist} km from station)</strong>
                <span class="zone-subtext">Our station delivers up to ${radiusKm} km. Delivery is NOT available to this location.</span>
              </div>
            `;
            if (showToastNotice) {
              showToast(`Outside delivery zone (${dist} km away · station max is ${radiusKm} km).`, 'warning');
            }
          }

          // Use non-blocking tooltip so clicks are NEVER swallowed by Leaflet popups!
          if (customerMarker) {
            try {
              customerMarker.unbindPopup();
              customerMarker.unbindTooltip();
              customerMarker.bindTooltip(
                isOk ? `Within zone (${dist} km)` : `Outside zone (${dist} km)`,
                {
                  permanent: true,
                  direction: 'top',
                  offset: [0, -14],
                  className: `map-zone-tip ${isOk ? 'is-inside' : 'is-outside'}`,
                  interactive: false,
                }
              );
            } catch {}
          }

          // Update save button state
          const saveBtn = document.querySelector('#save-address-btn');
          if (saveBtn) {
            if (isOk) {
              saveBtn.classList.remove('btn-outside-zone');
              saveBtn.disabled = false;
              saveBtn.innerHTML = editingAddr ? 'Update address' : 'Save address';
            } else {
              saveBtn.classList.add('btn-outside-zone');
              saveBtn.disabled = true;
              saveBtn.innerHTML = `Outside delivery zone (${dist} km · Max ${radiusKm} km)`;
            }
          }
        }

        async function onLocationSelected(lat, lng, shouldReverseGeocode = true) {
          chosenLat = Number(Number(lat).toFixed(6));
          chosenLng = Number(Number(lng).toFixed(6));

          if (!customerMarker) {
            customerMarker = L.marker([chosenLat, chosenLng], {
              draggable: true,
              zIndexOffset: 100,
            }).addTo(miniMap);
            customerMarker.on('click', (e) => {
              if (e && e.originalEvent) e.originalEvent.stopPropagation();
              onLocationSelected(chosenLat, chosenLng, true);
            });
            customerMarker.on('dragend', () => {
              const pos = customerMarker.getLatLng();
              onLocationSelected(pos.lat, pos.lng, true);
            });
          } else {
            customerMarker.setLatLng([chosenLat, chosenLng]);
          }

          updateZoneUI(chosenLat, chosenLng, true);

          if (shouldReverseGeocode) {
            try {
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${chosenLat}&lon=${chosenLng}`
              );
              const data = await resp.json();
              if (data && data.address) {
                const streetInput = document.querySelector('#addr-street');
                const brgyInput = document.querySelector('#addr-barangay');
                const cityInput = document.querySelector('#addr-city');
                const labelInput = document.querySelector('#addr-label');

                if (labelInput && !labelInput.value.trim()) {
                  labelInput.value = 'Home';
                  clearInputError(labelInput);
                }

                if (streetInput && !streetInput.value.trim()) {
                  const roadName =
                    data.address.road ||
                    data.address.pedestrian ||
                    data.address.neighbourhood ||
                    data.address.suburb ||
                    (data.display_name ? data.display_name.split(',')[0].trim() : '');
                  if (roadName) {
                    streetInput.value = roadName;
                    clearInputError(streetInput);
                  }
                }
                if (brgyInput && !brgyInput.value.trim()) {
                  const brgy =
                    data.address.suburb ||
                    data.address.quarter ||
                    data.address.neighbourhood ||
                    data.address.village ||
                    '';
                  if (brgy) {
                    brgyInput.value = brgy;
                    clearInputError(brgyInput);
                  }
                }
                if (cityInput && !cityInput.value.trim()) {
                  cityInput.value = data.address.city || data.address.town || 'Caloocan';
                  clearInputError(cityInput);
                }
              }
            } catch {}
          }
        }

        if (chosenLat && chosenLng) {
          customerMarker = L.marker([chosenLat, chosenLng], {
            draggable: true,
            zIndexOffset: 100,
          }).addTo(miniMap);
          customerMarker.on('click', (e) => {
            if (e && e.originalEvent) e.originalEvent.stopPropagation();
            document.querySelector('#addr-map-box')?.classList.remove('is-invalid-box');
            onLocationSelected(chosenLat, chosenLng, true);
          });
          customerMarker.on('dragend', () => {
            const pos = customerMarker.getLatLng();
            document.querySelector('#addr-map-box')?.classList.remove('is-invalid-box');
            onLocationSelected(pos.lat, pos.lng, true);
          });
          updateZoneUI(chosenLat, chosenLng, false);
        } else {
          miniMap.fitBounds(deliveryCircle.getBounds(), { padding: [15, 15] });
        }

        setTimeout(() => {
          if (miniMap) miniMap.invalidateSize();
        }, 150);

        miniMap.on('click', (e) => {
          document.querySelector('#addr-map-box')?.classList.remove('is-invalid-box');
          onLocationSelected(e.latlng.lat, e.latlng.lng, true);
        });

        // Map Search Handler
        async function handleMapSearch() {
          const queryInput = document.querySelector('#map-search-input');
          const searchBtn = document.querySelector('#map-search-btn');
          const q = queryInput?.value.trim();
          if (!q) return;

          setBusy(searchBtn, true, 'Finding...');
          try {
            document.querySelector('#addr-map-box')?.classList.remove('is-invalid-box');
            const resp = await fetch(
              `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
                q + ', Philippines'
              )}&limit=1`
            );
            const results = await resp.json();
            if (results && results.length > 0) {
              const targetLat = parseFloat(results[0].lat);
              const targetLng = parseFloat(results[0].lon);
              miniMap.setView([targetLat, targetLng], 16);
              await onLocationSelected(targetLat, targetLng, false);
              showToast('Location pinned on map!', 'success');
            } else {
              showToast('Place not found. Try searching a specific street.', 'error');
            }
          } catch {
            showToast('Search failed. Please try again.', 'error');
          } finally {
            setBusy(searchBtn, false);
          }
        }

        document.querySelector('#map-search-btn')?.addEventListener('click', handleMapSearch);
        document.querySelector('#map-search-input')?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleMapSearch();
          }
        });

        // Locate Me (GPS) Handler
        document.querySelector('#locate-me-btn')?.addEventListener('click', () => {
          if (!navigator.geolocation) {
            showToast('Geolocation is not supported by your browser.', 'error');
            return;
          }
          const btn = document.querySelector('#locate-me-btn');
          setBusy(btn, true, 'Locating...');
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              setBusy(btn, false);
              const userLat = pos.coords.latitude;
              const userLng = pos.coords.longitude;
              miniMap.setView([userLat, userLng], 16);
              await onLocationSelected(userLat, userLng, true);
              showToast('Location pinned via GPS!', 'success');
            },
            () => {
              setBusy(btn, false);
              showToast('Could not retrieve GPS location.', 'error');
            },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });

        // Fullscreen / Expanded View Map Handler
        const mapBox = document.querySelector('#addr-map-box');
        const expandBtn = document.querySelector('#expand-map-btn');
        const expandText = document.querySelector('#expand-btn-text');

        function toggleMapExpand() {
          isMapExpanded = !isMapExpanded;
          if (isMapExpanded) {
            mapBox.classList.add('is-expanded');
            if (expandText) expandText.textContent = 'Close';
            expandBtn.innerHTML = `${ICONS.collapse} <span id="expand-btn-text">Close</span>`;
          } else {
            mapBox.classList.remove('is-expanded');
            if (expandText) expandText.textContent = 'Fullscreen';
            expandBtn.innerHTML = `${ICONS.expand} <span id="expand-btn-text">Fullscreen</span>`;
          }
          setTimeout(() => {
            if (miniMap) miniMap.invalidateSize();
          }, 150);
        }

        expandBtn?.addEventListener('click', toggleMapExpand);

        window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && isMapExpanded) {
            toggleMapExpand();
          }
        });
      }, 60);
    }

    // Attach Event Listeners
    function openAddAddress() {
      editingId = null;
      isFormOpen = true;
      renderPage();
      document.querySelector('#address-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.querySelector('#addr-label')?.focus();
    }

    function closeForm() {
      editingId = null;
      isFormOpen = false;
      renderPage();
    }

    content.querySelector('#add-new-addr-btn')?.addEventListener('click', openAddAddress);
    content.querySelector('#trigger-add-addr-btn')?.addEventListener('click', openAddAddress);
    content.querySelector('#empty-add-addr-btn')?.addEventListener('click', openAddAddress);

    content.querySelector('#close-form-btn')?.addEventListener('click', closeForm);
    content.querySelector('#cancel-form-btn')?.addEventListener('click', closeForm);

    content.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.editId;
        isFormOpen = true;
        renderPage();
        document.querySelector('#address-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.querySelector('#addr-label')?.focus();
      });
    });

    content.querySelectorAll('[data-default-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.defaultId;
        setBusy(btn, true, 'Updating...');
        try {
          await setDefaultCustomerAddress(me.id, id);
          showToast('Default delivery address updated.', 'success');
          await loadAddresses();
        } catch (err) {
          showToast(err.message || 'Could not set default address.', 'error');
          setBusy(btn, false);
        }
      });
    });

    content.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        const target = addresses.find((a) => a.id === id);
        const confirmed = await confirmModal({
          title: `Delete "${target?.label || 'Address'}"?`,
          message: 'Are you sure you want to remove this saved address?',
          confirmText: 'Delete address',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Deleting...');
        try {
          await deleteCustomerAddress(me.id, id);
          if (editingId === id) {
            editingId = null;
            isFormOpen = false;
          }
          showToast('Address removed.', 'success');
          await loadAddresses();
        } catch (err) {
          showToast(err.message || 'Could not delete address.', 'error');
          setBusy(btn, false);
        }
      });
    });

    // Quick Label Preset Buttons
    content.querySelectorAll('.addr-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        const labelInput = content.querySelector('#addr-label');
        if (!labelInput) return;
        content.querySelectorAll('.addr-preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (preset === 'Other') {
          labelInput.value = '';
          labelInput.focus();
        } else {
          labelInput.value = preset;
          clearInputError(labelInput);
        }
      });
    });

    // Helper functions for in-form field validation
    function markInputError(inputEl, msg) {
      if (!inputEl) return;
      inputEl.classList.add('is-invalid');
      const parent = inputEl.closest('.field');
      const errEl = parent?.querySelector('.field-error-msg');
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
    }

    function clearInputError(inputEl) {
      if (!inputEl) return;
      inputEl.classList.remove('is-invalid');
      const parent = inputEl.closest('.field');
      const errEl = parent?.querySelector('.field-error-msg');
      if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
      }
    }

    function clearAllFormErrors(form) {
      form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
      form.querySelectorAll('.field-error-msg').forEach((el) => {
        el.textContent = '';
        el.style.display = 'none';
      });
      document.querySelector('#addr-map-box')?.classList.remove('is-invalid-box');
    }

    // Clear error highlights as user types
    ['#addr-label', '#addr-street', '#addr-barangay', '#addr-city'].forEach((sel) => {
      const input = content.querySelector(sel);
      input?.addEventListener('input', () => {
        clearInputError(input);
        if (sel === '#addr-label') {
          const val = input.value.trim().toLowerCase();
          content.querySelectorAll('.addr-preset-btn').forEach((btn) => {
            const p = (btn.dataset.preset || '').toLowerCase();
            if (p === val) {
              btn.classList.add('active');
            } else if (p !== 'other') {
              btn.classList.remove('active');
            }
          });
        }
      });
    });

    // Form submission validation & saving
    content.querySelector('#address-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitBtn = form.querySelector('#save-address-btn');

      clearAllFormErrors(form);

      const labelVal = form.label?.value.trim() || '';
      const streetVal = form.street?.value.trim() || '';
      const brgyVal = form.barangay?.value.trim() || '';
      const cityVal = form.city?.value.trim() || 'Caloocan';

      // 1. Validate Label
      if (!labelVal) {
        markInputError(form.label, 'Please enter an address label (e.g. Home, Work).');
        showToast('Please enter an address label (e.g. Home, Work).', 'error');
        form.label?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.label?.focus();
        return;
      }

      // 2. Validate Street
      if (!streetVal) {
        markInputError(form.street, 'Please enter your street address or house number.');
        showToast('Please enter your street address or house number.', 'error');
        form.street?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.street?.focus();
        return;
      }

      // 3. Validate Barangay
      if (!brgyVal) {
        markInputError(form.barangay, 'Please enter your barangay.');
        showToast('Please enter your barangay.', 'error');
        form.barangay?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.barangay?.focus();
        return;
      }

      // 4. Validate that house is pinned on map
      if (chosenLat === null || chosenLng === null) {
        const mapBox = document.querySelector('#addr-map-box');
        if (mapBox) {
          mapBox.classList.add('is-invalid-box');
          mapBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast('Please pinpoint your house location on the map before saving.', 'error');
        return;
      }

      // 5. Validate that house is inside the station delivery zone
      const dist = calculateDistanceKm(
        stationSettings.lat,
        stationSettings.lng,
        chosenLat,
        chosenLng
      );
      if (dist !== null && dist > stationSettings.radiusKm) {
        showToast(
          `Cannot save address: Location is ${dist} km away, which is outside our ${stationSettings.radiusKm} km delivery radius. Please choose a location inside the highlighted delivery zone.`,
          'error'
        );
        return;
      }

      setBusy(submitBtn, true, 'Saving address...');
      try {
        await saveCustomerAddress(me.id, {
          id: editingId,
          label: labelVal,
          street: streetVal,
          barangay: brgyVal,
          city: cityVal,
          landmark: form.landmark?.value.trim() || '',
          latitude: chosenLat,
          longitude: chosenLng,
          isDefault: form.isDefault?.checked ?? false,
        });
        showToast(editingId ? 'Address updated.' : 'Address saved successfully.', 'success');
        editingId = null;
        isFormOpen = false;
        await loadAddresses();
      } catch (err) {
        showToast(err.message || 'Could not save address.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  async function loadAddresses() {
    try {
      addresses = await getCustomerAddresses(me.id);
      renderPage();
    } catch (err) {
      showToast(err.message || 'Could not load addresses.', 'error');
    }
  }

  await loadAddresses();
  return () => cleanupMap();
}

bootCustomerPage('addresses', mount);
