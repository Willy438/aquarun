import { bootAdminPage } from '../../core/nav.js';
import { confirmModal, escapeHtml, formatPeso, setBusy, showToast } from '../../core/ui.js';
import {
  getStationLocationSettings,
  saveStationLocationSettings,
} from '../../services/settingsService.js';
import {
  getServiceCharge,
  getStationOpenStatus,
  saveServiceCharge,
  saveStationOpenStatus,
} from '../../services/productsService.js';

let mapInstance = null;

const ICONS = {
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  compass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  store: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>`,
  save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; vertical-align: -3px; display: inline-block;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
};

async function ensureSettingsAssets() {
  if (!document.querySelector('link[href*="leaflet.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if (!document.querySelector('link[href*="settings.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../css/pages/admin/settings.css';
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

export async function mount() {
  const content = document.querySelector('#content');

  const topbarRight = document.querySelector('#topbar-right');

  // Clean up any existing map instance from previous mounts
  if (mapInstance) {
    try {
      mapInstance.remove();
    } catch {}
    mapInstance = null;
  }

  try {
    await ensureSettingsAssets();

    const [locationSettings, isStationOpen, serviceCharge] = await Promise.all([
      getStationLocationSettings(),
      getStationOpenStatus(),
      getServiceCharge(),
    ]);

    let savedLat = locationSettings.lat;
    let savedLng = locationSettings.lng;
    let savedAddress = locationSettings.address;
    let savedRadiusKm = locationSettings.radiusKm;

    let currentLat = savedLat;
    let currentLng = savedLng;
    let currentAddress = savedAddress;
    let currentRadiusKm = savedRadiusKm;
    let currentOpen = isStationOpen;
    let currentCharge = serviceCharge;
    let hasUnsavedChanges = false;

    function renderView() {
      content.innerHTML = `
        <!-- Prominent Active Station Location Banner -->
        <div class="active-hub-banner ${hasUnsavedChanges ? 'is-unsaved' : 'is-saved'}" id="hub-status-banner">
          <div class="active-hub-icon">
            ${hasUnsavedChanges ? ICONS.compass : ICONS.pin}
          </div>
          <div class="active-hub-body">
            <div class="active-hub-header">
              <span class="active-hub-caption">
                ${hasUnsavedChanges ? 'Location selected (Unsaved)' : 'Current saved station location'}
              </span>
              <span class="pill ${hasUnsavedChanges ? 'pill-amber' : 'pill-green'}" id="hub-status-pill">
                ${hasUnsavedChanges ? '● Unsaved changes · Click Save to apply' : '● Saved in database'}
              </span>
            </div>
            <div class="active-hub-address" id="hub-display-address">
              ${escapeHtml(currentAddress)}
            </div>
            <div class="active-hub-meta">
              <span id="hub-display-coords" style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.pin} ${currentLat.toFixed(5)}° N, ${currentLng.toFixed(5)}° E</span>
              <span>·</span>
              <span id="hub-display-radius">Coverage: ${currentRadiusKm} km radius</span>
            </div>
          </div>
        </div>

        <div class="settings-grid">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Set station hub reference</h2>
                <p class="card-subtitle text-muted" style="margin: 4px 0 0 0; font-size: 13px;">
                  Search an area or drag the pin. Distance and batch routes are calculated from this point.
                </p>
              </div>
            </div>

            <div class="map-container-wrap">
              <div class="map-search-bar">
                <input
                  type="text"
                  id="station-search-input"
                  placeholder="Search landmark, university, street or barangay..."
                />
                <button type="button" class="btn btn-sm btn-primary" id="station-search-btn">
                  Search
                </button>
              </div>
              <div id="settings-map"></div>
            </div>

            <div class="map-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span>Tip: Drag the pin or click any street to set the station point. The blue circle shows your delivery zone.</span>
            </div>

            <div class="coords-badge-row">
              <div class="coord-pills-group">
                <span class="coord-pill" id="val-lat">Lat: ${currentLat.toFixed(5)}</span>
                <span class="coord-pill" id="val-lng">Lng: ${currentLng.toFixed(5)}</span>
              </div>
              <button type="button" class="btn btn-light btn-sm" id="recenter-btn" style="font-size: 12px; padding: 4px 10px;">
                Reset to saved pin
              </button>
            </div>

            <div class="form-stack" style="margin-top: 18px;">
              <div class="field">
                <label class="field-label" for="station-address-input">Station address / Landmark name</label>
                <input
                  class="input"
                  id="station-address-input"
                  type="text"
                  value="${escapeHtml(currentAddress)}"
                  placeholder="e.g. University of Caloocan City / Station Hub"
                />
              </div>

              <div class="field">
                <label class="field-label">Max delivery radius</label>
                <div class="radius-slider-wrap">
                  <input
                    type="range"
                    class="radius-slider"
                    id="radius-slider"
                    min="0.5"
                    max="10.0"
                    step="0.5"
                    value="${currentRadiusKm}"
                  />
                  <span class="radius-value-pill" id="radius-val-text">${currentRadiusKm} km</span>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary btn-block btn-lg"
                id="save-settings-main-btn"
                style="margin-top: 20px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px;"
              >
                ${ICONS.save} Save station settings
              </button>
            </div>
          </div>

          <div class="stack">
            <!-- Active Hub Summary Card -->
            <div class="card">
              <div class="card-header">
                <div class="card-title-group">
                  <span class="card-icon">${ICONS.store}</span>
                  <h2 class="card-title">Station profile</h2>
                </div>
                <span class="pill ${currentOpen ? 'pill-green' : 'pill-neutral'}" id="summary-store-pill">
                  ${currentOpen ? 'Open' : 'Closed'}
                </span>
              </div>

              <div class="hub-summary-row">
                <span class="hub-summary-label">Reference hub</span>
                <span class="hub-summary-val" id="summary-hub-name" style="text-align: right; max-width: 180px;">
                  ${escapeHtml(currentAddress)}
                </span>
              </div>

              <div class="hub-summary-row">
                <span class="hub-summary-label">Service coverage</span>
                <span class="hub-summary-val" id="summary-radius-val">${currentRadiusKm} km</span>
              </div>

              <div class="hub-summary-row">
                <span class="hub-summary-label">Delivery fee</span>
                <span class="hub-summary-val" id="summary-charge-val">${formatPeso(currentCharge)}</span>
              </div>

              <div class="hub-summary-row">
                <span class="hub-summary-label">GPS coordinates</span>
                <span class="hub-summary-val" id="summary-coords-val" style="font-family: monospace; font-size: 11.5px;">
                  ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}
                </span>
              </div>
            </div>

            <!-- Controls Card -->
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Store controls</h2>
              </div>

              <div class="toggle-row-between">
                <div class="toggle-info">
                  <h4>Station status</h4>
                  <p id="station-open-desc">${currentOpen ? 'Accepting customer orders' : 'Closed — new orders blocked'}</p>
                </div>
                <label class="switch-label">
                  <input type="checkbox" id="station-open-toggle" ${currentOpen ? 'checked' : ''}>
                  <span class="switch-track"></span>
                </label>
              </div>

              <div class="form-stack" style="margin-top: 16px;">
                <div class="field">
                  <label class="field-label" for="service-charge-input">Delivery service charge (₱)</label>
                  <input
                    class="input"
                    id="service-charge-input"
                    type="number"
                    min="0"
                    step="1"
                    value="${currentCharge}"
                  />
                  <p class="field-hint" style="margin-top: 4px; font-size: 12px; color: #64748b;">
                    Flat delivery fee per order in your delivery zone.
                  </p>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-primary btn-block"
                id="save-settings-btn"
                style="margin-top: 22px;"
              >
                Save station settings
              </button>
            </div>
          </div>
        </div>
      `;
    }

    renderView();
    if (topbarRight) {
      topbarRight.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" id="save-settings-topbar-btn">
          Save settings
        </button>
      `;
    }

    function setUnsavedState(isUnsaved) {
      hasUnsavedChanges = isUnsaved;
      const banner = document.querySelector('#hub-status-banner');
      const pill = document.querySelector('#hub-status-pill');
      if (banner && pill) {
        banner.className = `active-hub-banner ${isUnsaved ? 'is-unsaved' : 'is-saved'}`;
        pill.className = `pill ${isUnsaved ? 'pill-amber' : 'pill-green'}`;
        pill.textContent = isUnsaved
          ? '● Unsaved changes · Click Save to apply'
          : '● Saved in database';
      }
    }

    function updateLiveLabels() {
      const displayAddr = document.querySelector('#hub-display-address');
      const displayCoords = document.querySelector('#hub-display-coords');
      const displayRadius = document.querySelector('#hub-display-radius');
      const latEl = document.querySelector('#val-lat');
      const lngEl = document.querySelector('#val-lng');
      const summaryHubName = document.querySelector('#summary-hub-name');
      const summaryRadiusVal = document.querySelector('#summary-radius-val');
      const summaryCoordsVal = document.querySelector('#summary-coords-val');
      const summaryChargeVal = document.querySelector('#summary-charge-val');

      if (displayAddr) displayAddr.textContent = currentAddress;
      if (displayCoords) displayCoords.innerHTML = `${ICONS.pin} ${currentLat.toFixed(5)}° N, ${currentLng.toFixed(5)}° E`;
      if (displayRadius) displayRadius.textContent = `Coverage: ${currentRadiusKm} km radius`;
      if (latEl) latEl.textContent = `Lat: ${currentLat.toFixed(5)}`;
      if (lngEl) lngEl.textContent = `Lng: ${currentLng.toFixed(5)}`;
      if (summaryHubName) summaryHubName.textContent = currentAddress;
      if (summaryRadiusVal) summaryRadiusVal.textContent = `${currentRadiusKm} km`;
      if (summaryCoordsVal) summaryCoordsVal.textContent = `${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`;
      if (summaryChargeVal) summaryChargeVal.textContent = formatPeso(currentCharge);
    }

    // Initialize Leaflet Map
    setTimeout(() => {
      const mapEl = document.querySelector('#settings-map');
      if (!mapEl || typeof L === 'undefined') return;

      mapInstance = L.map('settings-map').setView([currentLat, currentLng], 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(mapInstance);

      const marker = L.marker([currentLat, currentLng], { draggable: true }).addTo(mapInstance);

      const circle = L.circle([currentLat, currentLng], {
        radius: currentRadiusKm * 1000,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(mapInstance);

      setTimeout(() => {
        if (mapInstance) mapInstance.invalidateSize();
      }, 150);

      async function onLocationChanged(newLat, newLng, overrideName = null) {
        currentLat = Number(newLat);
        currentLng = Number(newLng);
        marker.setLatLng([currentLat, currentLng]);
        circle.setLatLng([currentLat, currentLng]);

        if (overrideName) {
          currentAddress = overrideName;
          const addrInput = document.querySelector('#station-address-input');
          if (addrInput) addrInput.value = overrideName;
        } else {
          // Reverse geocode to get institution/road/barangay name
          try {
            const resp = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${currentLat}&lon=${currentLng}`
            );
            const data = await resp.json();
            if (data && data.display_name) {
              const parts = data.display_name.split(',').map((s) => s.trim());
              const cleanName = parts.slice(0, 3).join(', ');
              currentAddress = cleanName;
              const addrInput = document.querySelector('#station-address-input');
              if (addrInput) addrInput.value = cleanName;
            }
          } catch {}
        }

        setUnsavedState(true);
        updateLiveLabels();
      }

      mapInstance.on('click', (e) => {
        onLocationChanged(e.latlng.lat, e.latlng.lng);
      });

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onLocationChanged(pos.lat, pos.lng);
      });

      // Recenter Button
      document.querySelector('#recenter-btn')?.addEventListener('click', () => {
        currentLat = savedLat;
        currentLng = savedLng;
        currentAddress = savedAddress;
        currentRadiusKm = savedRadiusKm;
        marker.setLatLng([currentLat, currentLng]);
        circle.setLatLng([currentLat, currentLng]);
        circle.setRadius(currentRadiusKm * 1000);
        mapInstance.flyTo([currentLat, currentLng], 15);

        const addrInput = document.querySelector('#station-address-input');
        if (addrInput) addrInput.value = savedAddress;
        const slider = document.querySelector('#radius-slider');
        if (slider) slider.value = savedRadiusKm;
        const valText = document.querySelector('#radius-val-text');
        if (valText) valText.textContent = `${savedRadiusKm} km`;

        setUnsavedState(false);
        updateLiveLabels();
      });

      // Radius Slider
      const radiusSlider = document.querySelector('#radius-slider');
      const radiusValText = document.querySelector('#radius-val-text');
      if (radiusSlider && radiusValText) {
        radiusSlider.addEventListener('input', (e) => {
          currentRadiusKm = Number(e.target.value);
          radiusValText.textContent = `${currentRadiusKm} km`;
          circle.setRadius(currentRadiusKm * 1000);
          setUnsavedState(true);
          updateLiveLabels();
        });
      }

      // Nominatim search
      async function doSearch() {
        const input = document.querySelector('#station-search-input');
        const q = input?.value.trim();
        if (!q) return;
        const searchBtn = document.querySelector('#station-search-btn');
        if (searchBtn) searchBtn.textContent = '...';

        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(q)}`
          );
          const results = await resp.json();
          if (results && results.length > 0) {
            const first = results[0];
            const lat = Number(first.lat);
            const lon = Number(first.lon);
            const parts = first.display_name.split(',').map((s) => s.trim());
            const resolvedName = parts.slice(0, 3).join(', ');

            mapInstance.flyTo([lat, lon], 16);
            onLocationChanged(lat, lon, resolvedName);
            showToast(`Found: ${resolvedName}`, 'success');
          } else {
            showToast('No locations found. You can click directly on the map to place the pin.', 'error');
          }
        } catch {
          showToast('Search service busy. You can click on the map directly.', 'error');
        } finally {
          if (searchBtn) searchBtn.textContent = 'Search';
        }
      }

      document.querySelector('#station-search-btn')?.addEventListener('click', doSearch);
      document.querySelector('#station-search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSearch();
        }
      });
    }, 50);

    // Station Address Text Input Manual Change
    document.querySelector('#station-address-input')?.addEventListener('input', (e) => {
      currentAddress = e.target.value.trim() || 'Station Hub';
      setUnsavedState(true);
      updateLiveLabels();
    });

    // Store controls: Station Open Toggle
    const toggleEl = document.querySelector('#station-open-toggle');
    const toggleDesc = document.querySelector('#station-open-desc');
    const summaryStorePill = document.querySelector('#summary-store-pill');

    toggleEl?.addEventListener('change', async (e) => {
      const willBeOpen = e.target.checked;
      if (!willBeOpen) {
        const confirmed = await confirmModal({
          title: 'Close Station for New Orders?',
          message: 'Marking the station as Closed will prevent all customers from placing new orders until you reopen it. Are you sure?',
          confirmText: 'Yes, close station',
          cancelText: 'Keep open',
          danger: true,
        });
        if (!confirmed) {
          toggleEl.checked = true;
          return;
        }
      }
      currentOpen = willBeOpen;
      const slider = toggleEl.nextElementSibling;
      if (slider) {
        slider.style.backgroundColor = currentOpen ? 'var(--blue-app, #2563eb)' : '#cbd5e1';
      }
      if (toggleDesc) {
        toggleDesc.textContent = currentOpen
          ? 'Accepting customer orders'
          : 'Closed — new orders blocked';
      }
      if (summaryStorePill) {
        summaryStorePill.className = `pill ${currentOpen ? 'pill-green' : 'pill-neutral'}`;
        summaryStorePill.textContent = currentOpen ? 'Open' : 'Closed';
      }
      setUnsavedState(true);
    });

    // Service Charge Input
    document.querySelector('#service-charge-input')?.addEventListener('input', (e) => {
      currentCharge = Math.max(0, Number(e.target.value || 0));
      setUnsavedState(true);
      updateLiveLabels();
    });

    async function handleSaveSettings(triggerBtn) {
      const addrInput = document.querySelector('#station-address-input');
      const addressVal = addrInput?.value.trim() || currentAddress || 'AquaRun Station Hub';

      const coordsChanged = Math.abs(currentLat - savedLat) > 0.0001 || Math.abs(currentLng - savedLng) > 0.0001;
      const radiusChanged = Math.abs(currentRadiusKm - savedRadiusKm) > 0.1;
      if (coordsChanged || radiusChanged) {
        const confirmed = await confirmModal({
          title: 'Update Station Delivery Zone?',
          message: `Station reference will be set to "${addressVal}" with a ${currentRadiusKm} km coverage radius. All distance calculations and batch routing will use this new point. Continue?`,
          confirmText: 'Save zone settings',
          cancelText: 'Cancel',
        });
        if (!confirmed) return;
      }

      if (triggerBtn) setBusy(triggerBtn, true, 'Saving...');
      try {
        await Promise.all([
          saveStationLocationSettings({
            lat: currentLat,
            lng: currentLng,
            address: addressVal,
            radiusKm: currentRadiusKm,
          }),
          saveStationOpenStatus(currentOpen),
          saveServiceCharge(currentCharge),
        ]);

        savedLat = currentLat;
        savedLng = currentLng;
        savedAddress = addressVal;
        savedRadiusKm = currentRadiusKm;
        currentAddress = addressVal;

        setUnsavedState(false);
        updateLiveLabels();

        showToast(`Saved! Current station address: ${addressVal}`, 'success');
      } catch (err) {
        showToast(err.message || 'Could not save settings.', 'error');
      } finally {
        if (triggerBtn) setBusy(triggerBtn, false);
      }
    }

    document.querySelector('#save-settings-main-btn')?.addEventListener('click', (e) => handleSaveSettings(e.currentTarget));
    document.querySelector('#save-settings-btn')?.addEventListener('click', (e) => handleSaveSettings(e.currentTarget));
    document.querySelector('#save-settings-topbar-btn')?.addEventListener('click', (e) => handleSaveSettings(e.currentTarget));
  } catch (err) {
    content.innerHTML = `<div class="card"><p class="text-danger">Could not load station settings: ${escapeHtml(err.message)}</p></div>`;
  }

  return () => {
    if (mapInstance) {
      try {
        mapInstance.remove();
      } catch {}
      mapInstance = null;
    }
  };
}

bootAdminPage('settings', mount);
