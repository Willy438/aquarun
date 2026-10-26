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
  pin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  store: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>`,
  save: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  locate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  refresh: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
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
        <div class="settings-grid">
          <!-- Left Column: Station Location & Delivery Zone -->
          <div class="card">
            <div class="settings-card-header">
              <div class="settings-card-title-group">
                <h2 class="settings-card-title">
                  ${ICONS.pin}
                  <span>Station Hub &amp; Delivery Zone</span>
                </h2>
                <p class="settings-card-sub">
                  Pinpoint your station reference point to calculate customer delivery distances and coverage.
                </p>
              </div>
            </div>

            <!-- Search Row Placed Cleanly Above Map with Location Suggestions -->
            <div class="map-search-row">
              <div class="location-search-wrap">
                <input
                  type="text"
                  id="station-search-input"
                  placeholder="Search landmark, university, street or barangay..."
                  autocomplete="off"
                />
                <div class="location-suggestions-dropdown" id="station-suggestions-dropdown" hidden></div>
              </div>
              <button type="button" class="btn btn-primary" id="station-search-btn">
                Search
              </button>
              <button type="button" class="btn btn-light" id="station-locate-btn" title="Pin via current GPS location">
                ${ICONS.locate} <span>Locate</span>
              </button>
            </div>

            <!-- Map Frame -->
            <div class="settings-map-frame">
              <div id="settings-map"></div>
            </div>

            <!-- Coordinates & Reset Bar -->
            <div class="map-meta-bar">
              <span class="map-coords-badge" id="val-coords">
                ${ICONS.pin} Lat: ${currentLat.toFixed(5)}, Lng: ${currentLng.toFixed(5)}
              </span>
              <button type="button" class="btn btn-light btn-sm" id="recenter-btn" style="font-size: 11.5px; padding: 4px 10px;">
                ${ICONS.refresh} <span>Reset to saved pin</span>
              </button>
            </div>

            <div class="form-stack" style="margin-top: 16px;">
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
                <label class="field-label">Delivery coverage radius</label>
                <div class="radius-slider-box">
                  <input
                    type="range"
                    class="radius-slider"
                    id="radius-slider"
                    min="0.5"
                    max="10.0"
                    step="0.5"
                    value="${currentRadiusKm}"
                  />
                  <span class="radius-pill" id="radius-val-text">${currentRadiusKm} km</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Store Operations & Delivery Fee -->
          <div class="card">
            <div class="settings-card-header">
              <div class="settings-card-title-group">
                <h2 class="settings-card-title">
                  ${ICONS.store}
                  <span>Store Operations &amp; Rates</span>
                </h2>
                <p class="settings-card-sub">
                  Control order acceptance status and flat delivery fees.
                </p>
              </div>
            </div>

            <!-- Store Status Toggle -->
            <div class="store-status-row">
              <div class="store-status-text">
                <div class="store-status-title">
                  <span>Store Status:</span>
                  <span class="pill ${currentOpen ? 'pill-green' : 'pill-neutral'}" id="summary-store-pill" style="font-size: 11px; padding: 2px 8px;">
                    ${currentOpen ? 'Open' : 'Closed'}
                  </span>
                </div>
                <p class="store-status-sub" id="station-open-desc">
                  ${currentOpen ? 'Accepting customer refill orders' : 'Closed — new orders blocked'}
                </p>
              </div>
              <label class="switch-label">
                <input type="checkbox" id="station-open-toggle" ${currentOpen ? 'checked' : ''}>
                <span class="switch-track"></span>
              </label>
            </div>

            <!-- Delivery Service Fee -->
            <div class="field">
              <label class="field-label" for="service-charge-input">Delivery service charge (₱)</label>
              <input
                class="input"
                id="service-charge-input"
                type="number"
                min="0"
                step="1"
                value="${currentCharge}"
                style="font-size: 15px; font-weight: 700;"
              />
              <p class="text-muted" style="margin: 4px 0 0; font-size: 12px;">
                Flat delivery fee applied per order within your delivery radius.
              </p>
            </div>

            <!-- Live Station Profile Summary Card -->
            <div class="station-summary-box">
              <div class="station-summary-title">
                <span>Active Station Specs</span>
                <span class="pill ${hasUnsavedChanges ? 'pill-amber' : 'pill-green'}" id="hub-status-pill" style="font-size: 10.5px; padding: 2px 7px;">
                  ${hasUnsavedChanges ? 'Unsaved' : 'Saved'}
                </span>
              </div>
              <div class="station-summary-item">
                <span class="station-summary-label">Reference Hub:</span>
                <span class="station-summary-val" id="summary-hub-name">${escapeHtml(currentAddress)}</span>
              </div>
              <div class="station-summary-item">
                <span class="station-summary-label">Max Coverage:</span>
                <span class="station-summary-val" id="summary-radius-val">${currentRadiusKm} km</span>
              </div>
              <div class="station-summary-item">
                <span class="station-summary-label">Delivery Fee:</span>
                <span class="station-summary-val" id="summary-charge-val">${formatPeso(currentCharge)}</span>
              </div>
              <div class="station-summary-item">
                <span class="station-summary-label">GPS Coords:</span>
                <span class="station-summary-val" id="summary-coords-val" style="font-family: monospace; font-size: 11.5px;">
                  ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}
                </span>
              </div>
            </div>

            <!-- Single, Unified Save Button -->
            <button
              type="button"
              class="btn btn-primary btn-block btn-lg"
              id="save-settings-btn"
              style="font-weight: 700; gap: 8px;"
            >
              ${ICONS.save} <span>Save station settings</span>
            </button>
          </div>
        </div>
      `;
    }

    renderView();

    if (topbarRight) {
      topbarRight.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" id="save-settings-topbar-btn">
          ${ICONS.save} <span>Save settings</span>
        </button>
      `;
    }

    function setUnsavedState(isUnsaved) {
      hasUnsavedChanges = isUnsaved;
      const pill = document.querySelector('#hub-status-pill');
      if (pill) {
        pill.className = `pill ${isUnsaved ? 'pill-amber' : 'pill-green'}`;
        pill.textContent = isUnsaved ? 'Unsaved' : 'Saved';
      }
    }

    function updateLiveLabels() {
      const coordsEl = document.querySelector('#val-coords');
      const summaryHubName = document.querySelector('#summary-hub-name');
      const summaryRadiusVal = document.querySelector('#summary-radius-val');
      const summaryCoordsVal = document.querySelector('#summary-coords-val');
      const summaryChargeVal = document.querySelector('#summary-charge-val');

      if (coordsEl) coordsEl.innerHTML = `${ICONS.pin} Lat: ${currentLat.toFixed(5)}, Lng: ${currentLng.toFixed(5)}`;
      if (summaryHubName) summaryHubName.textContent = currentAddress;
      if (summaryRadiusVal) summaryRadiusVal.textContent = `${currentRadiusKm} km`;
      if (summaryCoordsVal) summaryCoordsVal.textContent = `${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`;
      if (summaryChargeVal) summaryChargeVal.textContent = formatPeso(currentCharge);
    }

    // Initialize Map
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
        color: '#1d5bd6',
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

      // Nominatim search with Real-time Location Suggestions API
      const stationInput = document.querySelector('#station-search-input');
      const stationSuggestionsBox = document.querySelector('#station-suggestions-dropdown');
      let stationDebounceTimer = null;

      function hideStationSuggestions() {
        if (stationSuggestionsBox) {
          stationSuggestionsBox.hidden = true;
          stationSuggestionsBox.innerHTML = '';
        }
      }

      async function fetchStationSuggestions(query) {
        if (!query || query.length < 3) {
          hideStationSuggestions();
          return;
        }
        if (stationSuggestionsBox) {
          stationSuggestionsBox.hidden = false;
          stationSuggestionsBox.innerHTML = '<div class="suggestion-loading">Searching locations...</div>';
        }

        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
          const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!resp.ok) throw new Error('API failed');
          const data = await resp.json();

          if (!data || data.length === 0) {
            if (stationSuggestionsBox) {
              stationSuggestionsBox.innerHTML = '<div class="suggestion-empty">No matching places found. Try another landmark or street.</div>';
            }
            return;
          }

          if (stationSuggestionsBox) {
            stationSuggestionsBox.innerHTML = data
              .map((item) => {
                const parts = (item.display_name || '').split(',');
                const primary = parts[0]?.trim() || 'Location';
                const secondary = parts.slice(1, 4).join(',').trim();
                return `
                  <div class="suggestion-item" data-lat="${item.lat}" data-lon="${item.lon}">
                    <span class="suggestion-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                    </span>
                    <div class="suggestion-text">
                      <span class="suggestion-primary">${escapeHtml(primary)}</span>
                      <span class="suggestion-secondary">${escapeHtml(secondary)}</span>
                    </div>
                  </div>
                `;
              })
              .join('');

            stationSuggestionsBox.querySelectorAll('.suggestion-item').forEach((itemEl) => {
              itemEl.addEventListener('click', () => {
                const lat = parseFloat(itemEl.dataset.lat);
                const lon = parseFloat(itemEl.dataset.lon);
                const primaryText = itemEl.querySelector('.suggestion-primary')?.textContent || '';
                if (stationInput) stationInput.value = primaryText;
                hideStationSuggestions();

                mapInstance.flyTo([lat, lon], 16);
                onLocationChanged(lat, lon, primaryText);
                showToast(`Station pinned: ${primaryText}`, 'success');
              });
            });
          }
        } catch {
          if (stationSuggestionsBox) {
            stationSuggestionsBox.innerHTML = '<div class="suggestion-empty">Could not load suggestions. You can still click Search or click the map directly.</div>';
          }
        }
      }

      stationInput?.addEventListener('input', (e) => {
        clearTimeout(stationDebounceTimer);
        const q = e.target.value.trim();
        if (q.length < 3) {
          hideStationSuggestions();
          return;
        }
        stationDebounceTimer = setTimeout(() => {
          fetchStationSuggestions(q);
        }, 280);
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.location-search-wrap')) {
          hideStationSuggestions();
        }
      });

      async function doSearch() {
        const q = stationInput?.value.trim();
        if (!q) return;
        hideStationSuggestions();
        const searchBtn = document.querySelector('#station-search-btn');
        if (searchBtn) setBusy(searchBtn, true, 'Searching...');

        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`
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
            showToast('No locations found. You can click directly on the map to place the pin.', 'warning');
          }
        } catch {
          showToast('Search service busy. You can click on the map directly.', 'error');
        } finally {
          if (searchBtn) setBusy(searchBtn, false);
        }
      }

      document.querySelector('#station-search-btn')?.addEventListener('click', doSearch);
      stationInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSearch();
        } else if (e.key === 'Escape') {
          hideStationSuggestions();
        }
      });

      // Locate GPS button
      document.querySelector('#station-locate-btn')?.addEventListener('click', () => {
        if (!navigator.geolocation) {
          showToast('Geolocation is not supported by your browser.', 'error');
          return;
        }
        const btn = document.querySelector('#station-locate-btn');
        setBusy(btn, true, 'Locating...');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setBusy(btn, false);
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            mapInstance.flyTo([userLat, userLng], 16);
            onLocationChanged(userLat, userLng);
            showToast('Pinned to current GPS position!', 'success');
          },
          () => {
            setBusy(btn, false);
            showToast('Could not retrieve GPS coordinates.', 'error');
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
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
      if (toggleDesc) {
        toggleDesc.textContent = currentOpen
          ? 'Accepting customer refill orders'
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

        showToast(`Settings saved! Station address: ${addressVal}`, 'success');
      } catch (err) {
        showToast(err.message || 'Could not save settings.', 'error');
      } finally {
        if (triggerBtn) setBusy(triggerBtn, false);
      }
    }

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
