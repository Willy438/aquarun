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

function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return fetch(url, {
    ...options,
    signal: controller ? controller.signal : undefined,
  }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

// Multi-provider Reverse Geocoding API: Coordinates -> Address Fields
// Combines Photon (Komoot OSM) + BigDataCloud Client API + Nominatim (with user-agent)
async function fetchAddressFromCoords(lat, lon) {
  let street = '';
  let barangay = '';
  let city = 'Caloocan';
  let full = '';

  // 1. High-speed Photon reverse geocoder (unmetered, no CORS or cellular hotspot rate-limit)
  try {
    const pUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`;
    const pResp = await fetchWithTimeout(pUrl, {}, 3500);
    if (pResp.ok) {
      const pData = await pResp.json();
      const feat = pData.features?.[0];
      if (feat && feat.properties) {
        const p = feat.properties;

        const houseNum = p.housenumber ? `${p.housenumber} ` : '';
        if (p.street) {
          street = `${houseNum}${p.street}`.trim();
        } else if (p.name && /(street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|boulevard|blvd|highway|hwy|subdivision|subd|village|compound)/i.test(p.name)) {
          street = `${houseNum}${p.name}`.trim();
        } else if (p.name && !/barangay|brgy|caloocan|metro manila|philippines/i.test(p.name)) {
          street = `${houseNum}${p.name}`.trim();
        }

        const brgyCandidates = [p.locality, p.district, p.name, p.suburb];
        for (const c of brgyCandidates) {
          if (c && /barangay|\bbrgy\b/i.test(c)) {
            barangay = c.trim();
            break;
          }
        }
        if (!barangay && p.locality && (!street || !street.toLowerCase().includes(p.locality.toLowerCase()))) {
          barangay = p.locality.trim();
        }

        if (p.city) {
          city = p.city.trim();
        }

        full = [p.name, p.street, p.locality, p.district, p.city].filter(Boolean).join(', ');
      }
    }
  } catch (err) {
    console.warn('Photon reverse error:', err.message);
  }

  // 2. BigDataCloud reverse geocoding (fast, client-focused, unmetered, accurate administrative levels)
  if (!street || !barangay) {
    try {
      const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
      const bResp = await fetchWithTimeout(bdcUrl, {}, 3500);
      if (bResp.ok) {
        const bData = await bResp.json();
        const admins = bData.localityInfo?.administrative || [];

        if (!barangay) {
          for (const a of admins) {
            if (/barangay|\bbrgy\b/i.test(a.name || '')) {
              barangay = a.name.trim();
              break;
            }
          }
          if (!barangay) {
            const area = admins.find((a) => /camarin|bagong silang|deparo|tala|bagumbong|amparo|zone/i.test(a.name || ''));
            if (area) barangay = area.name.trim();
          }
        }

        if ((!city || city === 'Caloocan') && bData.locality) {
          const cleanLocality = bData.locality.replace(/^City of\s+/i, '').trim();
          if (cleanLocality) city = cleanLocality;
        }

        if (!full && bData.locality) {
          full = [bData.locality, barangay, city].filter(Boolean).join(', ');
        }
      }
    } catch (err) {
      console.warn('BDC reverse error:', err.message);
    }
  }

  // 3. Nominatim reverse fallback (with User-Agent and email to prevent 403 Forbidden)
  if (!street || !barangay) {
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&email=aquarun.ph@gmail.com`;
      const nResp = await fetchWithTimeout(
        nomUrl,
        {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'AquaRunApp/1.0 (aquarun.ph@gmail.com)',
          },
        },
        3500
      );
      if (nResp.ok) {
        const nData = await nResp.json();
        const a = nData.address || {};
        if (!street) {
          const houseNumber = a.house_number ? `${a.house_number} ` : '';
          const road = a.road || a.pedestrian || a.street || a.residential || a.suburb || '';
          if (road) street = `${houseNumber}${road}`.trim();
          else if (nData.display_name) street = nData.display_name.split(',')[0].trim();
        }
        if (!barangay) {
          const candidates = [a.village, a.quarter, a.suburb, a.neighbourhood, a.city_district];
          for (const c of candidates) {
            if (c && /barangay|\bbrgy\b/i.test(c)) {
              barangay = c.trim();
              break;
            }
          }
          if (!barangay) {
            const match = (nData.display_name || '').match(/Barangay\s+[0-9A-Za-z\s-]+/i) || (nData.display_name || '').match(/Brgy\.?\s+[0-9A-Za-z\s-]+/i);
            if (match) barangay = match[0].split(',')[0].trim();
            else barangay = a.village || a.suburb || a.neighbourhood || '';
          }
        }
        if (!city && (a.city || a.town || a.municipality)) {
          city = a.city || a.town || a.municipality;
        }
        if (!full && nData.display_name) {
          full = nData.display_name;
        }
      }
    } catch (err) {
      console.warn('Nominatim reverse error:', err.message);
    }
  }

  // Format barangay standard
  if (barangay && !/^Barangay\b|^Brgy\.?\b/i.test(barangay) && /^\d+$/.test(barangay.trim())) {
    barangay = `Barangay ${barangay.trim()}`;
  }

  return {
    street: street || '',
    barangay: barangay || 'Barangay 171',
    city: city || 'Caloocan',
    full: full || [street, barangay, city].filter(Boolean).join(', '),
  };
}

// Multi-provider Forward Geocoding API: Address text -> Coordinates
async function searchAddressCoordinates(street, barangay, city = 'Caloocan', stationLat = 14.7565, stationLng = 121.0437) {
  try {
    const queryParts = [];
    if (street) queryParts.push(street);
    if (barangay && barangay !== 'N/A') queryParts.push(barangay);
    if (city) queryParts.push(city);
    queryParts.push('Philippines');
    const query = queryParts.join(', ');

    // 1. Photon forward geocoder (biased near station hub)
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${stationLat}&lon=${stationLng}&limit=3`;
      const pResp = await fetchWithTimeout(photonUrl, {}, 3500);
      if (pResp.ok) {
        const pData = await pResp.json();
        const feat = pData.features?.[0];
        if (feat && feat.geometry && Array.isArray(feat.geometry.coordinates)) {
          const [lon, lat] = feat.geometry.coordinates;
          return {
            lat: parseFloat(lat),
            lng: parseFloat(lon),
            displayName: feat.properties?.name || query,
          };
        }
      }
    } catch {}

    // 2. Nominatim fallback with user-agent and email
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(query)}&limit=1&email=aquarun.ph@gmail.com`;
      const resp = await fetchWithTimeout(
        nomUrl,
        {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'AquaRunApp/1.0 (aquarun.ph@gmail.com)',
          },
        },
        3500
      );
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            displayName: data[0].display_name,
          };
        }
      }
    } catch {}

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
  let isDisposed = false;
  let addresses = [];
  let editingId = null;
  let isModalOpen = window.location.hash === '#add' || window.location.hash === '#new';
  let chosenLat = null;
  let chosenLng = null;
  let miniMap = null;
  let customerMarker = null;
  let autoPinTimeout = null;
  let activeTypeFilter = 'all';
  let searchKeyword = '';

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
    if (isDisposed || !content) return;
    cleanupMap();
    const editingAddr = editingId ? addresses.find((a) => a.id === editingId) : null;
    if (editingAddr) {
      chosenLat = editingAddr?.latitude ? Number(editingAddr.latitude) : null;
      chosenLng = editingAddr?.longitude ? Number(editingAddr.longitude) : null;
    } else if (!isModalOpen) {
      chosenLat = null;
      chosenLng = null;
    }

    // Calculate filter counts
    const homeCount = addresses.filter((a) => /home|house|residence/i.test(a.label || '')).length;
    const workCount = addresses.filter((a) => /work|office|branch|store|shop|warehouse/i.test(a.label || '')).length;
    const defaultCount = addresses.filter((a) => a.is_default).length;

    // Filter addresses based on category and search
    const filtered = addresses.filter((addr) => {
      if (activeTypeFilter === 'default' && !addr.is_default) return false;
      if (activeTypeFilter === 'home' && !/home|house|residence/i.test(addr.label || '')) return false;
      if (activeTypeFilter === 'work' && !/work|office|branch|store|shop|warehouse/i.test(addr.label || '')) return false;

      if (searchKeyword.trim()) {
        const q = searchKeyword.trim().toLowerCase();
        const text = `${addr.label || ''} ${addr.street || ''} ${addr.barangay || ''} ${addr.city || ''} ${addr.landmark || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    // Helper to generate status badge for an address
    function getAddressStatusBadge(addr) {
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

      if (dist !== null) {
        return isWithinZone
          ? `<span class="address-distance-badge in-zone">${ICONS.check} ${dist} km · In delivery zone</span>`
          : `<span class="address-distance-badge out-zone">${ICONS.alert} ${dist} km · Outside station zone</span>`;
      }
      return `<span class="address-distance-badge no-coords">${ICONS.pin} Map pin required</span>`;
    }

    let cardsHtml = '';
    if (addresses.length === 0) {
      cardsHtml = `
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
    } else {
      const toolbarHtml = `
        <div class="addr-toolbar">
          <div class="addr-search-field">
            <span class="addr-search-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="text" id="addr-search-input" class="input addr-search-box" placeholder="Search by label, street, barangay..." value="${escapeHtml(searchKeyword)}">
            ${searchKeyword ? `<button type="button" class="addr-search-clear" id="addr-search-clear" aria-label="Clear search">×</button>` : ''}
          </div>
          <div class="addr-filter-tabs" role="tablist">
            <button type="button" class="addr-filter-tab ${activeTypeFilter === 'all' ? 'is-active' : ''}" data-addr-filter="all">
              All <span class="addr-tab-num">${addresses.length}</span>
            </button>
            <button type="button" class="addr-filter-tab ${activeTypeFilter === 'home' ? 'is-active' : ''}" data-addr-filter="home">
              Home <span class="addr-tab-num">${homeCount}</span>
            </button>
            <button type="button" class="addr-filter-tab ${activeTypeFilter === 'work' ? 'is-active' : ''}" data-addr-filter="work">
              Work <span class="addr-tab-num">${workCount}</span>
            </button>
            <button type="button" class="addr-filter-tab ${activeTypeFilter === 'default' ? 'is-active' : ''}" data-addr-filter="default">
              Default <span class="addr-tab-num">${defaultCount}</span>
            </button>
          </div>
        </div>
      `;

      if (filtered.length === 0) {
        cardsHtml = `
          ${toolbarHtml}
          <div class="card" style="padding: 32px 18px; text-align: center; color: #64748b;">
            <p style="margin: 0 0 6px 0; font-weight: 700; color: #0f172a; font-size: 15px;">No addresses match your filter</p>
            <p style="margin: 0; font-size: 13px;">Try switching tabs or searching another keyword.</p>
          </div>
        `;
      } else {
        // 1. Desktop Table Setup (min-width: 1024px)
        const tableRowsHtml = filtered
          .map((addr) => {
            const badgeHtml = getAddressStatusBadge(addr);
            return `
              <tr class="${addr.is_default ? 'is-default-row' : ''}">
                <td>
                  <div class="addr-table-label-cell">
                    <span class="addr-card-icon">${getAddressIcon(addr.label)}</span>
                    <div>
                      <strong class="addr-table-label-name">${escapeHtml(addr.label || 'Address')}</strong>
                      ${addr.is_default ? `<span class="pill pill-green" style="font-size: 10.5px; padding: 1px 6px; margin-left: 6px;">Default</span>` : ''}
                    </div>
                  </div>
                </td>
                <td>
                  <div class="addr-table-street">${escapeHtml(addr.street || '–')}</div>
                  ${addr.landmark ? `<span class="addr-table-landmark">Landmark: ${escapeHtml(addr.landmark)}</span>` : ''}
                </td>
                <td>
                  <div class="addr-table-area">${escapeHtml(addr.barangay ? `${addr.barangay}, ` : '')}${escapeHtml(addr.city || 'Caloocan')}</div>
                </td>
                <td>
                  ${badgeHtml}
                </td>
                <td style="text-align: right;">
                  <div class="addr-table-actions">
                    ${!addr.is_default ? `<button type="button" class="btn btn-light btn-sm" data-default-id="${escapeHtml(addr.id)}" title="Set as default delivery address">Set default</button>` : ''}
                    <button type="button" class="btn btn-light btn-sm" data-edit-id="${escapeHtml(addr.id)}">${ICONS.edit} <span>Edit</span></button>
                    <button type="button" class="btn btn-outline-danger btn-sm" data-delete-id="${escapeHtml(addr.id)}" title="Delete address">${ICONS.trash}</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join('');

        const tableViewHtml = `
          <div class="card addr-table-card addr-table-view">
            <div class="table-wrap">
              <table class="addr-table">
                <thead>
                  <tr>
                    <th style="min-width: 170px;">Label / Type</th>
                    <th>Street Address</th>
                    <th>Barangay &amp; City</th>
                    <th style="min-width: 200px;">Delivery Coverage</th>
                    <th style="min-width: 220px; text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        `;

        // 2. Mobile Responsive Cards View (< 1024px)
        const mobileCardsHtml = `
          <div class="addr-mobile-view">
            ${filtered
              .map((addr) => {
                const badgeHtml = getAddressStatusBadge(addr);
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
                    ${addr.landmark ? `<p class="addr-card-landmark">Landmark: ${escapeHtml(addr.landmark)}</p>` : ''}

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
        `;

        cardsHtml = `
          ${toolbarHtml}
          ${tableViewHtml}
          ${mobileCardsHtml}
        `;
      }
    }

    // Modal Form (when isModalOpen is true)
    let defaultLabel = '';
    if (editingAddr) {
      defaultLabel = editingAddr.label || '';
    } else {
      defaultLabel = '';
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
                    <button type="button" class="addr-preset-btn ${editingAddr && !['Home', 'Work', 'Apartment', 'Parents'].includes(defaultLabel) ? 'active' : ''}" data-preset="Other">Other</button>
                  </div>
                  <input class="input" id="addr-label" name="label" type="text" placeholder="e.g. Home, Work, Apartment" value="${escapeHtml(editingAddr?.label || '')}" required>
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
                    <input class="input" id="addr-barangay" name="barangay" type="text" placeholder="Barangay" value="${escapeHtml(editingAddr?.barangay && editingAddr.barangay !== 'N/A' ? editingAddr.barangay : '')}" required>
                    <div class="field-error-msg" id="addr-barangay-error"></div>
                  </div>
                  <div class="field">
                    <label class="field-label" for="addr-city">City <span style="color:#ef4444;">*</span></label>
                    <input class="input" id="addr-city" name="city" type="text" placeholder="Caloocan" value="${escapeHtml(editingAddr?.city || '')}" required>
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

                  <!-- Quick Search Row with Autocomplete Suggestions -->
                  <div class="addr-map-search-row">
                    <div class="location-search-wrap">
                      <input type="text" id="map-search-input" placeholder="Search street, subdivision, or barangay..." autocomplete="off">
                      <div class="location-suggestions-dropdown" id="map-suggestions-dropdown" hidden></div>
                    </div>
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

        // Location Search with Real-time Autocomplete Suggestions API
        const searchInput = document.querySelector('#map-search-input');
        const suggestionsBox = document.querySelector('#map-suggestions-dropdown');
        let searchDebounceTimer = null;

        function hideSuggestions() {
          if (suggestionsBox) {
            suggestionsBox.hidden = true;
            suggestionsBox.innerHTML = '';
          }
        }

        async function fetchSuggestions(query) {
          if (!query || query.length < 2) {
            hideSuggestions();
            return;
          }
          if (suggestionsBox) {
            suggestionsBox.hidden = false;
            suggestionsBox.innerHTML = '<div class="suggestion-loading">Searching locations near station...</div>';
          }

          try {
            const sLat = stationSettings.lat || 14.7565;
            const sLng = stationSettings.lng || 121.0437;
            let items = [];

            // 1. High-speed Photon API (unmetered, location-biased to station, unblocked on mobile hotspot)
            try {
              const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${sLat}&lon=${sLng}&limit=8`;
              const pResp = await fetchWithTimeout(photonUrl, {}, 3500);
              if (pResp.ok) {
                const pData = await pResp.json();
                const features = pData.features || [];
                items = features.map((f, idx) => {
                  const [lon, lat] = f.geometry.coordinates;
                  const p = f.properties || {};
                  const primary = p.name || p.street || query;
                  const secParts = [p.street && p.street !== primary ? p.street : '', p.locality || p.district, p.city].filter(Boolean);
                  const secondary = secParts.join(', ') || p.country || 'Philippines';
                  const d = calculateDistanceKm(sLat, sLng, lat, lon);
                  return {
                    idx,
                    lat,
                    lon,
                    primary,
                    secondary,
                    distanceKm: Number.isFinite(d) ? d : 99999,
                  };
                });
              }
            } catch {}

            // 2. Nominatim fallback if Photon is unavailable
            if (items.length === 0) {
              try {
                const left = (sLng - 0.25).toFixed(4);
                const top = (sLat + 0.20).toFixed(4);
                const right = (sLng + 0.25).toFixed(4);
                const bottom = (sLat - 0.20).toFixed(4);
                const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&viewbox=${left},${top},${right},${bottom}&bounded=0&q=${encodeURIComponent(query)}&limit=6&email=aquarun.ph@gmail.com`;
                const nResp = await fetchWithTimeout(nomUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'AquaRunApp/1.0 (aquarun.ph@gmail.com)' } }, 3500);
                if (nResp.ok) {
                  const nData = await nResp.json();
                  if (Array.isArray(nData)) {
                    items = nData.map((item, idx) => {
                      const lat = parseFloat(item.lat);
                      const lon = parseFloat(item.lon);
                      const parts = (item.display_name || '').split(',');
                      const primary = parts[0]?.trim() || 'Location';
                      const secondary = parts.slice(1, 4).join(',').trim();
                      const d = calculateDistanceKm(sLat, sLng, lat, lon);
                      return {
                        idx,
                        lat,
                        lon,
                        primary,
                        secondary,
                        distanceKm: Number.isFinite(d) ? d : 99999,
                      };
                    });
                  }
                }
              } catch {}
            }

            if (!items || items.length === 0) {
              if (suggestionsBox) {
                suggestionsBox.innerHTML = '<div class="suggestion-empty">No matching places found. Try typing a street or barangay.</div>';
              }
              return;
            }

            items.sort((a, b) => a.distanceKm - b.distanceKm);

            if (suggestionsBox) {
              suggestionsBox.innerHTML = items
                .slice(0, 6)
                .map((item, idx) => {
                  const distLabel = item.distanceKm < 9999 ? `${item.distanceKm.toFixed(1)} km` : '';
                  return `
                    <div class="suggestion-item" data-idx="${idx}" data-lat="${item.lat}" data-lon="${item.lon}">
                      <span class="suggestion-icon">
                        ${ICONS.pin}
                      </span>
                      <div class="suggestion-text" style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                          <span class="suggestion-primary">${escapeHtml(item.primary)}</span>
                          ${distLabel ? `<span class="suggestion-distance-tag" style="font-size:11px; font-weight:700; color:#1d5bd6; background:#ebf2ff; padding:1px 6px; border-radius:999px; white-space:nowrap; flex-shrink:0;">${distLabel}</span>` : ''}
                        </div>
                        <span class="suggestion-secondary">${escapeHtml(item.secondary)}</span>
                      </div>
                    </div>
                  `;
                })
                .join('');

              suggestionsBox.querySelectorAll('.suggestion-item').forEach((itemEl) => {
                itemEl.addEventListener('click', async () => {
                  const lat = parseFloat(itemEl.dataset.lat);
                  const lon = parseFloat(itemEl.dataset.lon);
                  const primaryText = itemEl.querySelector('.suggestion-primary')?.textContent || '';
                  if (searchInput) searchInput.value = primaryText;
                  hideSuggestions();

                  miniMap.setView([lat, lon], 16);
                  await onLocationSelected(lat, lon, true);
                  showToast(`Pinned: ${primaryText}`, 'success');
                });
              });
            }
          } catch {
            if (suggestionsBox) {
              suggestionsBox.innerHTML = '<div class="suggestion-empty">Could not load suggestions. You can still press Search or click the map directly.</div>';
            }
          }
        }

        searchInput?.addEventListener('input', (e) => {
          clearTimeout(searchDebounceTimer);
          const q = e.target.value.trim();
          if (q.length < 3) {
            hideSuggestions();
            return;
          }
          searchDebounceTimer = setTimeout(() => {
            fetchSuggestions(q);
          }, 280);
        });

        // Close suggestions when clicking outside
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.location-search-wrap')) {
            hideSuggestions();
          }
        });

        async function runMapSearch() {
          const query = searchInput?.value.trim();
          if (!query) return;
          hideSuggestions();
          const searchBtn = document.querySelector('#map-search-btn');
          setBusy(searchBtn, true, 'Searching...');

          try {
            const sLat = stationSettings.lat || 14.7565;
            const sLng = stationSettings.lng || 121.0437;
            let results = [];

            // 1. Photon search (resilient against mobile hotspot restrictions)
            try {
              const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${sLat}&lon=${sLng}&limit=5`;
              const pResp = await fetchWithTimeout(photonUrl, {}, 3500);
              if (pResp.ok) {
                const pData = await pResp.json();
                const features = pData.features || [];
                results = features.map((f) => {
                  const [lon, lat] = f.geometry.coordinates;
                  const p = f.properties || {};
                  const d = calculateDistanceKm(sLat, sLng, lat, lon);
                  return {
                    lat,
                    lon,
                    display_name: [p.name, p.street, p.locality || p.district, p.city].filter(Boolean).join(', '),
                    distanceKm: Number.isFinite(d) ? d : 99999,
                  };
                });
              }
            } catch {}

            // 2. Nominatim search fallback
            if (results.length === 0) {
              try {
                const left = (sLng - 0.25).toFixed(4);
                const top = (sLat + 0.20).toFixed(4);
                const right = (sLng + 0.25).toFixed(4);
                const bottom = (sLat - 0.20).toFixed(4);
                const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&viewbox=${left},${top},${right},${bottom}&bounded=0&q=${encodeURIComponent(query)}&limit=5&email=aquarun.ph@gmail.com`;
                const nResp = await fetchWithTimeout(nomUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'AquaRunApp/1.0 (aquarun.ph@gmail.com)' } }, 3500);
                if (nResp.ok) {
                  const nData = await nResp.json();
                  if (Array.isArray(nData)) {
                    results = nData.map((item) => {
                      const lat = parseFloat(item.lat);
                      const lon = parseFloat(item.lon);
                      const d = calculateDistanceKm(sLat, sLng, lat, lon);
                      return {
                        lat,
                        lon,
                        display_name: item.display_name,
                        distanceKm: Number.isFinite(d) ? d : 99999,
                      };
                    });
                  }
                }
              } catch {}
            }

            if (results && results.length > 0) {
              results.sort((a, b) => a.distanceKm - b.distanceKm);
              const hit = results[0];
              miniMap.setView([hit.lat, hit.lon], 16);
              await onLocationSelected(hit.lat, hit.lon, true);
              const distText = hit.distanceKm < 9999 ? ` (${hit.distanceKm.toFixed(1)} km away)` : '';
              showToast(`Found: ${hit.display_name.split(',')[0]}${distText}`, 'success');
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
        searchInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runMapSearch();
          } else if (e.key === 'Escape') {
            hideSuggestions();
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
            const res = await searchAddressCoordinates(streetVal, brgyVal, cityVal, stationSettings.lat, stationSettings.lng);
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
      if (!addrId) {
        chosenLat = null;
        chosenLng = null;
      }
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
    // Address Toolbar Event Listeners
    content.querySelectorAll('[data-addr-filter]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeTypeFilter = tab.dataset.addrFilter || 'all';
        renderPage();
      });
    });

    const searchInput = content.querySelector('#addr-search-input');
    searchInput?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      renderPage();
      const nextInput = content.querySelector('#addr-search-input');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      }
    });

    content.querySelector('#addr-search-clear')?.addEventListener('click', () => {
      searchKeyword = '';
      renderPage();
    });

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
    if (isDisposed) return;
    try {
      addresses = await getCustomerAddresses(me.id);
      renderPage();
    } catch (err) {
      showToast(err.message || 'Could not load addresses.', 'error');
    }
  }

  loadAddresses();
  return () => {
    isDisposed = true;
    cleanupMap();
  };
}

bootCustomerPage('addresses', mount);
