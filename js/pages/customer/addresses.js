import { bootCustomerPage } from '../../core/nav.js';
import { confirmModal, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  saveCustomerAddress,
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
    chosenLat = editingAddr?.latitude ? Number(editingAddr.latitude) : null;
    chosenLng = editingAddr?.longitude ? Number(editingAddr.longitude) : null;

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
                    <button type="button" class="btn btn-outline-danger btn-sm" data-delete-id="${escapeHtml(addr.id)}">
                      Delete
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>`
      : `<div class="empty-state" style="padding: 18px 12px;">
          <p style="font-size: 13px;">No saved addresses yet.</p>
          <p class="text-muted" style="font-size: 12px; margin-top: 2px;">Add your delivery address using the form.</p>
        </div>`;

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
                ${
                  editingAddr
                    ? `<button type="button" class="btn btn-sm btn-outline-blue" id="add-new-addr-btn" style="font-size: 11.5px; padding: 3px 8px;">+ Add new</button>`
                    : ''
                }
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

        <!-- Right Column: Add / Edit Address Form & Map -->
        <div class="card addresses-main">
          <div class="card-header" style="padding-bottom: 12px;">
            <div class="card-title-group">
              <span class="card-icon">${editingAddr ? ICONS.pin : ICONS.plus}</span>
              <h2 class="card-title" style="font-size: 15px;">
                ${editingAddr ? `Edit: ${escapeHtml(editingAddr.label)}` : 'Add delivery address'}
              </h2>
            </div>
            ${
              editingAddr
                ? `<button type="button" class="btn btn-link btn-sm" id="cancel-edit-btn" style="font-size: 12px;">Cancel</button>`
                : ''
            }
          </div>

          <form class="form-stack" id="address-form" novalidate>
            <!-- Label and Landmark in 2 columns -->
            <div class="field-row">
              <div class="field">
                <label class="field-label" for="addr-label">Address label</label>
                <input class="input" id="addr-label" name="label" type="text" placeholder="e.g. Home, Work, Apartment" value="${escapeHtml(editingAddr?.label || '')}" required>
              </div>
              <div class="field">
                <label class="field-label" for="addr-landmark">Landmark (optional)</label>
                <input class="input" id="addr-landmark" name="landmark" type="text" placeholder="Nearby landmark" value="${escapeHtml(editingAddr?.landmark || '')}">
              </div>
            </div>

            <!-- Street Address -->
            <div class="field">
              <label class="field-label" for="addr-street">Street address / House number</label>
              <input class="input" id="addr-street" name="street" type="text" placeholder="House/Unit #, Street, Subdivision" value="${escapeHtml(editingAddr?.street || '')}" required>
            </div>

            <!-- Barangay & City in 2 columns -->
            <div class="field-row">
              <div class="field">
                <label class="field-label" for="addr-barangay">Barangay</label>
                <input class="input" id="addr-barangay" name="barangay" type="text" placeholder="Barangay" value="${escapeHtml(editingAddr?.barangay && editingAddr.barangay !== 'N/A' ? editingAddr.barangay : '')}" required>
              </div>
              <div class="field">
                <label class="field-label" for="addr-city">City</label>
                <input class="input" id="addr-city" name="city" type="text" placeholder="Caloocan" value="${escapeHtml(editingAddr?.city || 'Caloocan')}" required>
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
                <div id="zone-status-text">
                  Tap on the map or drag the pin to your house. Station delivery zone is <strong>${stationSettings.radiusKm} km</strong>.
                </div>
              </div>
            </div>

            <label class="check" style="margin-top: 2px;">
              <input type="checkbox" id="addr-default" name="isDefault" ${editingAddr?.is_default || addresses.length === 0 ? 'checked' : ''}>
              <span style="font-size: 13px;">Set as default delivery address</span>
            </label>

            <button type="submit" class="btn btn-primary btn-block" id="save-address-btn" style="margin-top: 8px; padding: 10px;">
              ${editingAddr ? 'Update address' : 'Save address'}
            </button>
          </form>
        </div>
      </div>
    `;

    // Initialize Map with station hub, delivery radius circle, and draggable customer marker
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
      }).setView([initialCenterLat, initialCenterLng], chosenLat ? 16 : 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(miniMap);

      // Station Hub Marker with compact bubble
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
      }).addTo(miniMap);
      stationMarker.bindPopup(
        `<strong>AquaRun Station</strong><br>${escapeHtml(stationSettings.address || 'Station Hub')}<br><small>Radius: ${radiusKm} km</small>`
      );

      // Station Delivery Radius Circle
      const deliveryCircle = L.circle([stLat, stLng], {
        radius: radiusKm * 1000,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 2,
        dashArray: '5, 5',
      }).addTo(miniMap);

      let customerMarker = null;
      if (chosenLat && chosenLng) {
        customerMarker = L.marker([chosenLat, chosenLng], {
          draggable: true,
          zIndexOffset: 100,
        }).addTo(miniMap);
        customerMarker.bindPopup('<strong>Your House</strong><br>Drag to adjust').openPopup();
        updateZoneUI(chosenLat, chosenLng);
      } else {
        miniMap.fitBounds(deliveryCircle.getBounds(), { padding: [15, 15] });
      }

      setTimeout(() => {
        if (miniMap) miniMap.invalidateSize();
      }, 150);

      function updateZoneUI(lat, lng) {
        const statusBox = document.querySelector('#zone-status-box');
        const statusText = document.querySelector('#zone-status-text');
        if (!statusBox || !statusText) return;

        const dist = calculateDistanceKm(stLat, stLng, lat, lng);
        if (dist === null) return;

        const isOk = dist <= radiusKm;
        statusBox.className = `zone-status-box ${isOk ? 'is-inside' : 'is-outside'}`;
        if (isOk) {
          statusBox.innerHTML = `
            ${ICONS.check}
            <div>
              <strong>✓ Inside delivery zone (${dist} km from station)</strong> · Delivery available
            </div>
          `;
        } else {
          statusBox.innerHTML = `
            ${ICONS.alert}
            <div>
              <strong>⚠️ Outside delivery radius (${dist} km from station)</strong> · Station max is ${radiusKm} km
            </div>
          `;
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
          customerMarker.bindPopup('<strong>Your House</strong><br>Drag to adjust');
          customerMarker.on('dragend', () => {
            const pos = customerMarker.getLatLng();
            onLocationSelected(pos.lat, pos.lng, true);
          });
        } else {
          customerMarker.setLatLng([chosenLat, chosenLng]);
        }

        updateZoneUI(chosenLat, chosenLng);

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

              if (streetInput && !streetInput.value && data.address.road) {
                streetInput.value = data.address.road;
              }
              if (brgyInput && !brgyInput.value) {
                brgyInput.value =
                  data.address.suburb ||
                  data.address.quarter ||
                  data.address.neighbourhood ||
                  data.address.village ||
                  '';
              }
              if (cityInput && !cityInput.value) {
                cityInput.value = data.address.city || data.address.town || 'Caloocan';
              }
            }
          } catch {}
        }
      }

      miniMap.on('click', (e) => {
        onLocationSelected(e.latlng.lat, e.latlng.lng, true);
      });

      if (customerMarker) {
        customerMarker.on('dragend', () => {
          const pos = customerMarker.getLatLng();
          onLocationSelected(pos.lat, pos.lng, true);
        });
      }

      // Map Search Handler
      async function handleMapSearch() {
        const queryInput = document.querySelector('#map-search-input');
        const searchBtn = document.querySelector('#map-search-btn');
        const q = queryInput?.value.trim();
        if (!q) return;

        setBusy(searchBtn, true, 'Finding...');
        try {
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

    // Event listeners
    content.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.editId;
        renderPage();
        document.querySelector('#address-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.querySelector('#addr-label')?.focus();
      });
    });

    content.querySelector('#add-new-addr-btn')?.addEventListener('click', () => {
      editingId = null;
      renderPage();
      document.querySelector('#addr-label')?.focus();
    });

    content.querySelector('#cancel-edit-btn')?.addEventListener('click', () => {
      editingId = null;
      renderPage();
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
          if (editingId === id) editingId = null;
          showToast('Address removed.', 'success');
          await loadAddresses();
        } catch (err) {
          showToast(err.message || 'Could not delete address.', 'error');
          setBusy(btn, false);
        }
      });
    });

    content.querySelector('#address-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitBtn = form.querySelector('#save-address-btn');

      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveCustomerAddress(me.id, {
          id: editingId,
          label: form.label.value,
          street: form.street.value,
          barangay: form.barangay.value,
          city: form.city.value,
          landmark: form.landmark.value,
          latitude: chosenLat,
          longitude: chosenLng,
          isDefault: form.isDefault.checked,
        });
        showToast(editingId ? 'Address updated.' : 'Address saved.', 'success');
        editingId = null;
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
