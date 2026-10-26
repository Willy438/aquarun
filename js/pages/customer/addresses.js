import { bootCustomerPage } from '../../core/nav.js';
import { confirmModal, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
} from '../../services/addressesService.js';
import { calculateDistanceKm, getStationLocationSettings } from '../../services/settingsService.js';

const ICONS = {
  bookmark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  home: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1V9.5"/></svg>`,
  briefcase: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  pin: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  alert: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  info: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  locate: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  store: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  x: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

function getAddressIcon(label = '') {
  const norm = (label || '').trim().toLowerCase();
  if (norm.includes('home') || norm.includes('house')) return ICONS.home;
  if (norm.includes('work') || norm.includes('office')) return ICONS.briefcase;
  return ICONS.pin;
}

// Reverse Geocoding API: Coordinates -> Address Fields
async function fetchAddressFromCoords(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.address) return null;

    const a = data.address;
    let street = '';
    const houseNumber = a.house_number || '';
    const road = a.road || a.pedestrian || a.street || '';
    if (houseNumber && road) {
      street = `${houseNumber} ${road}`;
    } else if (road) {
      street = road;
    } else if (a.residential || a.suburb || a.neighbourhood) {
      street = a.residential || a.suburb || a.neighbourhood;
    } else if (data.display_name) {
      street = data.display_name.split(',')[0].trim();
    }

    let barangay = '';
    const candidates = [a.village, a.quarter, a.suburb, a.neighbourhood, a.city_district];
    for (const c of candidates) {
      if (c && /barangay|\bbrgy\b/i.test(c)) {
        barangay = c;
        break;
      }
    }
    if (!barangay) {
      const match = data.display_name.match(/Barangay\s+[0-9A-Za-z\s-]+/i) || data.display_name.match(/Brgy\.?\s+[0-9A-Za-z\s-]+/i);
      if (match) {
        barangay = match[0].split(',')[0].trim();
      } else {
        barangay = a.village || a.suburb || a.neighbourhood || 'Barangay 171';
      }
    }

    const city = a.city || a.town || a.municipality || 'Caloocan';
    return { street, barangay, city, full: data.display_name };
  } catch {
    return null;
  }
}

// Forward Geocoding API: Address text -> Coordinates
async function searchAddressCoordinates(street, barangay, city = 'Caloocan') {
  try {
    const queryParts = [];
    if (street) queryParts.push(street);
    if (barangay) queryParts.push(barangay);
    if (city) queryParts.push(city);
    queryParts.push('Philippines');
    const query = queryParts.join(', ');

    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(query)}&limit=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
    return null;
  } catch {
    return null;
  }
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
  let isModalOpen = window.location.hash === '#add' || window.location.hash === '#new';
  let chosenLat = null;
  let chosenLng = null;
  let miniMap = null;
  let customerMarker = null;
  let autoPinTimeout = null;

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
      customerMarker = null;
    }
  }

  function renderPage() {
    cleanupMap();
    const editingAddr = editingId ? addresses.find((a) => a.id === editingId) : null;
    if (editingAddr) {
      chosenLat = editingAddr?.latitude ? Number(editingAddr.latitude) : null;
      chosenLng = editingAddr?.longitude ? Number(editingAddr.longitude) : null;
    } else if (!isModalOpen) {
      chosenLat = null;
      chosenLng = null;
    }

    // Generate Cards List
    const cardsHtml = addresses.length
      ? `
        <div class="addr-grid">
          ${addresses
            .map((addr) => {
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
                  ? `<span class="address-distance-badge in-zone">${ICONS.check} ${dist} km · In delivery zone</span>`
                  : `<span class="address-distance-badge out-zone">${ICONS.alert} ${dist} km · Outside station zone</span>`;
              } else {
                badgeHtml = `<span class="address-distance-badge no-coords">${ICONS.pin} Map pin required to order</span>`;
              }

              return `
                <div class="addr-card ${addr.is_default ? 'is-default' : ''}">
                  <div class="addr-card-top">
                    <div class="addr-card-label-badge">
                      <span class="addr-card-icon">${getAddressIcon(addr.label)}</span>
                      <span>${escapeHtml(addr.label || 'Address')}</span>
                    </div>
                    ${addr.is_default ? `<span class="pill pill-green" style="font-size: 11px; padding: 2px 8px;">Default</span>` : ''}
                  </div>

                  <h3 class="addr-card-street">${escapeHtml(addr.street || 'Address details')}</h3>
                  <p class="addr-card-area">
                    ${escapeHtml(addr.barangay ? `${addr.barangay}, ` : '')}${escapeHtml(addr.city || 'Caloocan')}
                  </p>
                  ${
                    addr.landmark
                      ? `<p class="addr-card-landmark">Landmark: ${escapeHtml(addr.landmark)}</p>`
                      : ''
                  }

                  <div class="addr-card-status">${badgeHtml}</div>

                  <div class="addr-card-actions">
                    <button type="button" class="btn btn-light btn-sm" data-edit-id="${escapeHtml(addr.id)}">
                      ${ICONS.edit} <span>Edit</span>
                    </button>
                    ${
                      !addr.is_default
                        ? `<button type="button" class="btn btn-light btn-sm" data-default-id="${escapeHtml(addr.id)}">
                            Set default
                          </button>`
                        : ''
                    }
                    <button type="button" class="btn btn-outline-danger btn-sm" data-delete-id="${escapeHtml(addr.id)}" title="Delete address" style="margin-left: auto;">
                      ${ICONS.trash} <span>Delete</span>
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      `
      : `
        <div class="addr-empty-card">
          <div class="addr-empty-icon">${ICONS.pin}</div>
          <h2 class="addr-empty-title">No saved addresses yet</h2>
          <p class="addr-empty-desc">
            Add your home or office address to check station delivery coverage and order water refills in one click.
          </p>
          <button type="button" class="btn btn-primary" id="empty-add-addr-btn">
            ${ICONS.plus} <span>Add delivery address</span>
          </button>
        </div>
      `;

    // Modal Form (when isModalOpen is true)
    let defaultLabel = '';
    if (editingAddr) {
      defaultLabel = editingAddr.label || '';
    } else {
      defaultLabel = addresses.some((a) => (a.label || '').trim().toLowerCase() === 'home') ? 'Work' : 'Home';
    }

    const modalHtml = isModalOpen
      ? `
        <div class="addr-modal-backdrop" id="addr-modal-backdrop">
          <div class="addr-modal-card" role="dialog" aria-modal="true" aria-labelledby="addr-modal-heading">
            <div class="addr-modal-header">
              <h2 class="addr-modal-title" id="addr-modal-heading">
                ${editingAddr ? `Edit: ${escapeHtml(editingAddr.label)}` : 'Add delivery address'}
              </h2>
              <button type="button" class="addr-modal-close" id="close-modal-btn" aria-label="Close dialog">
                ${ICONS.x}
              </button>
            </div>

            <div class="addr-modal-body">
              <form class="form-stack" id="address-form" novalidate>
                <!-- Quick Label Presets -->
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

                <!-- Street Address & Landmark -->
                <div class="addr-form-grid-2">
                  <div class="field">
                    <label class="field-label" for="addr-street">Street address / House # <span style="color:#ef4444;">*</span></label>
                    <input class="input" id="addr-street" name="street" type="text" placeholder="House/Unit #, Street, Subd." value="${escapeHtml(editingAddr?.street || '')}" required>
                    <div class="field-error-msg" id="addr-street-error"></div>
                  </div>
                  <div class="field">
                    <label class="field-label" for="addr-landmark">Landmark (optional)</label>
                    <input class="input" id="addr-landmark" name="landmark" type="text" placeholder="Corner, Gate, Store" value="${escapeHtml(editingAddr?.landmark || '')}">
                  </div>
                </div>

                <!-- Barangay & City -->
                <div class="addr-form-grid-2">
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

                <!-- Map Pinpoint Section -->
                <div class="addr-map-section" id="addr-map-section">
                  <div class="addr-map-header">
                    <div class="addr-map-title">
                      ${ICONS.pin}
                      <span>Pinpoint delivery spot on map</span>
                    </div>
                    <button type="button" class="btn btn-light btn-sm" id="locate-me-btn" title="Use current GPS location">
                      ${ICONS.locate} <span>My location</span>
                    </button>
                  </div>

                  <!-- Quick Search Row -->
                  <div class="addr-map-search-row">
                    <input type="text" id="map-search-input" placeholder="Search street, subdivision, or barangay...">
                    <button type="button" class="btn btn-primary" id="map-search-btn">
                      Search
                    </button>
                  </div>

                  <!-- Leaflet Map -->
                  <div class="addr-map-wrap">
                    <div id="addr-pin-map"></div>
                  </div>

                  <!-- Real-time Zone Feedback -->
                  <div class="zone-status-box is-idle" id="zone-status-box">
                    ${ICONS.info}
                    <div>
                      Click on map or drag pin to auto-fill address details. Station delivery zone is <strong>${stationSettings.radiusKm} km</strong>.
                    </div>
                  </div>
                </div>

                <!-- Default Checkbox -->
                <label class="check" style="margin: 6px 0 0;">
                  <input type="checkbox" id="addr-default" name="isDefault" ${editingAddr?.is_default || addresses.length === 0 ? 'checked' : ''}>
                  <span style="font-size: 13px; font-weight: 500; color: var(--ink-navy, #0f172a);">Set as default delivery address</span>
                </label>
              </form>
            </div>

            <div class="addr-modal-footer">
              <button type="button" class="btn btn-light" id="cancel-modal-btn">
                Cancel
              </button>
              <button type="submit" form="address-form" class="btn btn-primary" id="save-address-btn">
                ${editingAddr ? 'Update address' : 'Save address'}
              </button>
            </div>
          </div>
        </div>
      `
      : '';

    // Render Full Content View - Notice Station Bar is placed AT THE TOP!
    content.innerHTML = `
      <div class="addr-page-container">
        <!-- Top Action Header -->
        <div class="addr-page-header">
          <div class="addr-page-header-text">
            <h2 class="addr-page-header-title">
              <span>Saved delivery addresses</span>
              <span class="addr-count-pill">${addresses.length}</span>
            </h2>
            <p class="addr-page-header-sub">Manage your delivery locations and verify station delivery coverage.</p>
          </div>
          <button type="button" class="btn btn-primary" id="add-new-addr-btn">
            ${ICONS.plus} <span>Add delivery address</span>
          </button>
        </div>

        <!-- Station Coverage Reference Banner (AT THE TOP) -->
        <div class="addr-station-bar">
          <div class="addr-station-info-group">
            <span class="addr-station-icon">${ICONS.store}</span>
            <div>
              <strong style="color: var(--ink-navy, #0f172a); display: block;">${escapeHtml(stationSettings.address || 'AquaRun Station Hub')}</strong>
              <span style="font-size: 11.5px; color: var(--muted-blue, #64748b);">Official refill &amp; fulfillment center</span>
            </div>
          </div>
          <div class="addr-station-tags">
            <div class="addr-station-tag">
              <span>Delivery Radius:</span>
              <strong>${stationSettings.radiusKm} km zone</strong>
            </div>
            <div class="addr-station-tag">
              <span>Payment Mode:</span>
              <strong>Cash on Delivery (COD)</strong>
            </div>
          </div>
        </div>

        <!-- Addresses List Grid -->
        ${cardsHtml}

        <!-- Modal Dialog (if open) -->
        ${modalHtml}
      </div>
    `;

    // Initialize Map only when modal is open
    if (isModalOpen) {
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

        // Station Hub Marker
        const stationIcon = L.divIcon({
          className: 'station-hub-leaflet-icon',
          html: `<div class="station-hub-bubble" title="AquaRun Water Station">
            <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
            <span>Station</span>
          </div>`,
          iconSize: [64, 24],
          iconAnchor: [32, 24],
        });

        L.marker([stLat, stLng], {
          icon: stationIcon,
          zIndexOffset: 50,
          interactive: false,
        }).addTo(miniMap);

        // Station Delivery Radius Circle
        L.circle([stLat, stLng], {
          radius: radiusKm * 1000,
          color: '#1d5bd6',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          weight: 2,
          dashArray: '5, 5',
          interactive: false,
        }).addTo(miniMap);

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
              showToast(`Inside delivery zone (${dist} km from station).`, 'success');
            }
          } else {
            statusBox.innerHTML = `
              ${ICONS.alert}
              <div>
                <strong>Outside delivery radius (${dist} km from station)</strong>
                <span class="zone-subtext">Our station delivers up to ${radiusKm} km. Please select a spot inside the highlighted circle.</span>
              </div>
            `;
            if (showToastNotice) {
              showToast(`Outside delivery zone (${dist} km · Station max is ${radiusKm} km).`, 'warning');
            }
          }

          if (customerMarker) {
            try {
              customerMarker.unbindTooltip();
              customerMarker.bindTooltip(
                isOk ? `Inside zone (${dist} km)` : `Outside zone (${dist} km)`,
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

          const saveBtn = document.querySelector('#save-address-btn');
          if (saveBtn) {
            if (isOk) {
              saveBtn.classList.remove('btn-outside-zone');
              saveBtn.disabled = false;
              saveBtn.innerHTML = editingAddr ? 'Update address' : 'Save address';
            } else {
              saveBtn.classList.add('btn-outside-zone');
              saveBtn.disabled = true;
              saveBtn.innerHTML = `Outside zone (${dist} km · Max ${radiusKm} km)`;
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

          updateZoneUI(chosenLat, chosenLng, false);

          // Every time a location is selected or pinned, auto-fill address details via API!
          if (shouldReverseGeocode) {
            const statusBox = document.querySelector('#zone-status-box');
            if (statusBox) {
              const prevHtml = statusBox.innerHTML;
              statusBox.innerHTML = `${ICONS.info} <div><strong>Looking up street address...</strong></div>`;
            }

            const addrData = await fetchAddressFromCoords(chosenLat, chosenLng);
            if (addrData) {
              const streetInput = document.querySelector('#addr-street');
              const brgyInput = document.querySelector('#addr-barangay');
              const cityInput = document.querySelector('#addr-city');

              if (streetInput && addrData.street) {
                streetInput.value = addrData.street;
                clearInputError(streetInput);
              }
              if (brgyInput && addrData.barangay) {
                brgyInput.value = addrData.barangay;
                clearInputError(brgyInput);
              }
              if (cityInput && addrData.city) {
                cityInput.value = addrData.city;
                clearInputError(cityInput);
              }

              showToast(`Address detected: ${addrData.street || addrData.barangay}`, 'info');
            }
            updateZoneUI(chosenLat, chosenLng, false);
          }
        }

        // If editing existing address with coords, restore marker
        if (chosenLat && chosenLng) {
          onLocationSelected(chosenLat, chosenLng, false);
        }

        // Click map to drop/move pin
        miniMap.on('click', (e) => {
          onLocationSelected(e.latlng.lat, e.latlng.lng, true);
        });

        // Search location via Nominatim
        async function runMapSearch() {
          const query = document.querySelector('#map-search-input')?.value.trim();
          if (!query) return;
          const searchBtn = document.querySelector('#map-search-btn');
          setBusy(searchBtn, true, 'Searching...');

          try {
            const searchQuery = query.toLowerCase().includes('caloocan')
              ? query
              : `${query}, Caloocan, Philippines`;
            const resp = await fetch(
              `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
            );
            const results = await resp.json();
            if (results && results.length > 0) {
              const hit = results[0];
              const lat = parseFloat(hit.lat);
              const lng = parseFloat(hit.lon);
              miniMap.setView([lat, lng], 16);
              await onLocationSelected(lat, lng, true);
              showToast(`Found: ${hit.display_name.split(',')[0]}`, 'success');
            } else {
              showToast('Location not found. Try searching another street or barangay.', 'warning');
            }
          } catch {
            showToast('Search error. Please try again.', 'error');
          } finally {
            setBusy(searchBtn, false);
          }
        }

        document.querySelector('#map-search-btn')?.addEventListener('click', runMapSearch);
        document.querySelector('#map-search-input')?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runMapSearch();
          }
        });

        // Locate Me GPS: Pinpoint user doorstep and auto-fill address inputs
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
              showToast('Location pinned & address auto-filled via GPS!', 'success');
            },
            () => {
              setBusy(btn, false);
              showToast('Could not retrieve GPS location.', 'error');
            },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });

        // Forward Geocoding: Auto-pin on map when user types address details
        function triggerAutoPinFromInputs() {
          if (autoPinTimeout) clearTimeout(autoPinTimeout);
          autoPinTimeout = setTimeout(async () => {
            const streetVal = document.querySelector('#addr-street')?.value.trim();
            const brgyVal = document.querySelector('#addr-barangay')?.value.trim();
            const cityVal = document.querySelector('#addr-city')?.value.trim() || 'Caloocan';

            if (!streetVal && !brgyVal) return;
            const res = await searchAddressCoordinates(streetVal, brgyVal, cityVal);
            if (res) {
              miniMap.setView([res.lat, res.lng], 16);
              await onLocationSelected(res.lat, res.lng, false);
            }
          }, 850);
        }

        ['#addr-street', '#addr-barangay'].forEach((sel) => {
          const inputEl = document.querySelector(sel);
          inputEl?.addEventListener('input', triggerAutoPinFromInputs);
          inputEl?.addEventListener('blur', triggerAutoPinFromInputs);
        });

        // Trigger map invalidate size so tiles render smoothly
        setTimeout(() => {
          if (miniMap) miniMap.invalidateSize();
        }, 120);
      }, 50);
    }

    // Modal Control Functions
    function openModal(addrId = null) {
      editingId = addrId;
      isModalOpen = true;
      renderPage();
      setTimeout(() => {
        document.querySelector('#addr-label')?.focus();
      }, 60);
    }

    function closeModal() {
      editingId = null;
      isModalOpen = false;
      renderPage();
    }

    // Event Listeners: Open Modal
    content.querySelector('#add-new-addr-btn')?.addEventListener('click', () => openModal(null));
    content.querySelector('#empty-add-addr-btn')?.addEventListener('click', () => openModal(null));

    content.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.editId));
    });

    // Event Listeners: Close Modal
    content.querySelector('#close-modal-btn')?.addEventListener('click', closeModal);
    content.querySelector('#cancel-modal-btn')?.addEventListener('click', closeModal);

    content.querySelector('#addr-modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isModalOpen) closeModal();
    });

    // Set Default Address Action
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

    // Delete Address Action
    content.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        const target = addresses.find((a) => a.id === id);
        const confirmed = await confirmModal({
          title: `Delete "${target?.label || 'Address'}"?`,
          message: 'Are you sure you want to remove this delivery address?',
          confirmText: 'Delete address',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Deleting...');
        try {
          await deleteCustomerAddress(me.id, id);
          showToast('Address removed.', 'success');
          await loadAddresses();
        } catch (err) {
          showToast(err.message || 'Could not delete address.', 'error');
          setBusy(btn, false);
        }
      });
    });

    // Preset Label Buttons
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

    // Validation Helpers
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
      document.querySelector('#addr-map-section')?.classList.remove('is-invalid-box');
    }

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

    // Form Submit
    content.querySelector('#address-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitBtn = document.querySelector('#save-address-btn');

      clearAllFormErrors(form);

      const labelVal = form.label?.value.trim() || '';
      const streetVal = form.street?.value.trim() || '';
      const brgyVal = form.barangay?.value.trim() || '';
      const cityVal = form.city?.value.trim() || 'Caloocan';

      if (!labelVal) {
        markInputError(form.label, 'Please enter an address label (e.g. Home, Work).');
        showToast('Please enter an address label.', 'error');
        form.label?.focus();
        return;
      }

      if (!streetVal) {
        markInputError(form.street, 'Please enter your street address or house number.');
        showToast('Please enter your street address.', 'error');
        form.street?.focus();
        return;
      }

      if (!brgyVal) {
        markInputError(form.barangay, 'Please enter your barangay.');
        showToast('Please enter your barangay.', 'error');
        form.barangay?.focus();
        return;
      }

      if (chosenLat === null || chosenLng === null) {
        const mapSection = document.querySelector('#addr-map-section');
        if (mapSection) {
          mapSection.classList.add('is-invalid-box');
          mapSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast('Please pinpoint your house location on the map before saving.', 'error');
        return;
      }

      const dist = calculateDistanceKm(
        stationSettings.lat,
        stationSettings.lng,
        chosenLat,
        chosenLng
      );
      if (dist !== null && dist > stationSettings.radiusKm) {
        showToast(
          `Cannot save: Location is ${dist} km away, which is outside the ${stationSettings.radiusKm} km station delivery zone.`,
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
        isModalOpen = false;
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
