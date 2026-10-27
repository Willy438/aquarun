// Admin Products: manage refill products, pricing, interactive photo cropper (pan/drag + zoom + fit/fill modes), active toggles, and delivery service charge.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  formatPeso,
  getPesoIconSvg,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  getAllProductsForAdmin,
  getServiceCharge,
  processProductPhotoFile,
  saveProduct,
  saveServiceCharge,
  toggleProductActive,
} from '../../services/productsService.js';

const CROP_WIDTH = 600;
const CROP_HEIGHT = 600;

function getGallonIconSvg() {
  return `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v3l-3 3.5V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9.5L14 6V3" />
      <path d="M7 13h10" />
      <path d="M7 17h10" />
    </svg>
  `;
}

function getCameraIconSvg() {
  return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  `;
}

export async function mount() {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  if (titleEl) titleEl.textContent = 'Products';
  if (subEl) subEl.textContent = 'Refill catalog and delivery service charge';

  if (rightEl) {
    rightEl.innerHTML = `<button type="button" class="btn btn-primary" id="btn-add-product">+ Add product</button>`;
    rightEl
      .querySelector('#btn-add-product')
      ?.addEventListener('click', () => openProductModal(null));
  }

  let products = [];
  let serviceCharge = 20;

  async function loadCatalog() {
    try {
      [products, serviceCharge] = await Promise.all([
        getAllProductsForAdmin(),
        getServiceCharge(),
      ]);
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load products.', 'error');
    }
  }

  function openProductModal(product, { focusField = 'name', isReadOnly = false } = {}) {
    const isEdit = Boolean(product?.id);
    let currentPhotoData = product?.photo_url || '';

    // Determine initial product category
    let currentType = 'refill';
    if (product) {
      if (product.is_returnable === false) {
        currentType = 'empty';
      } else {
        currentType = 'refill';
      }
    }

    const initSwap = Number(product?.price ?? 25);
    const initNew = Number(product?.new_container_price ?? (initSwap + 125));
    const initEmpty = Math.max(0, initNew - initSwap);

    // Interactive cropper state
    let sourceImg = null;
    let isCanvasTainted = false;
    let fitMode = 'fill'; // 'fill' (cover crop) | 'fit' (contain entire 1:1 image)
    let zoom = 1; // 0.5 to 3.0
    let panX = 0; // offset in canvas pixels
    let panY = 0;
    let hasUserAdjustedCrop = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-product" role="dialog" aria-modal="true" aria-labelledby="prod-modal-title" style="max-width: 580px;">
        <div class="modal-header">
          <div>
            <h3 class="modal-title" id="prod-modal-title">${isEdit ? 'Edit product' : 'Add product'}</h3>
            <p class="text-muted" style="font-size: 12px; margin-top: 2px;">Configure refill pricing, standalone empty containers, and catalog visibility</p>
          </div>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="prod-modal-form">
          <div class="modal-body stack" style="gap: 13px;">
            <!-- Product Category Tabs -->
            <div class="prod-type-tabs-wrap">
              <label class="label">Product Category</label>
              <div class="prod-type-tabs" id="prod-type-tabs" role="tablist">
                <button type="button" class="prod-type-tab${currentType === 'refill' ? ' is-active' : ''}" data-type="refill">
                  Water Refill (with Swap)
                </button>
                <button type="button" class="prod-type-tab${currentType === 'empty' ? ' is-active' : ''}" data-type="empty">
                  Empty Container Only
                </button>
              </div>
            </div>

            <!-- Product Name & Quick Presets -->
            <div class="field">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label class="label" for="prod-name" id="name-field-label">Product name</label>
                <div class="prod-preset-chips" id="name-preset-chips"></div>
              </div>
              <input class="input" id="prod-name" name="name" type="text" value="${escapeHtml(product?.name || '')}" placeholder="e.g. Round Gallon Refill" required />
            </div>

            <!-- REFILL PRICING: 3-WAY CONNECTED PRICING -->
            <div id="section-refill-pricing" ${currentType === 'refill' ? '' : 'hidden'}>
              <label class="label" style="margin-bottom: 6px;">Pricing breakdown for Water Refill</label>
              <div class="pricing-sync-grid">
                <div class="field">
                  <label class="label" for="prod-swap-price" style="font-size: 11.5px;">Swap refill price (₱)</label>
                  <input class="input" id="prod-swap-price" type="number" step="0.01" min="0" value="${initSwap}" />
                  <span class="field-hint" style="font-size: 10.5px; margin-top: 2px;">Water only (1:1 bottle swap)</span>
                </div>
                <div class="field">
                  <label class="label" for="prod-empty-price" style="font-size: 11.5px;">Empty container price (₱)</label>
                  <input class="input" id="prod-empty-price" type="number" step="0.01" min="0" value="${initEmpty}" />
                  <span class="field-hint" style="font-size: 10.5px; margin-top: 2px;">Dry container cost</span>
                </div>
                <div class="field">
                  <label class="label" for="prod-new-price" style="font-size: 11.5px;">New gallon + water price (₱)</label>
                  <input class="input" id="prod-new-price" type="number" step="0.01" min="0" value="${initNew}" />
                  <span class="field-hint" style="font-size: 10.5px; margin-top: 2px;">Auto: Swap + Bottle</span>
                </div>
              </div>
              <div class="pricing-preview-badge" id="refill-pricing-badge" style="margin-top: 8px;">
                <strong>Customer Rates:</strong> Swap Refill: ₱<span id="badge-swap-val">${initSwap}</span> · Empty Container: ₱<span id="badge-empty-val">${initEmpty}</span> · New Gallon + Water: ₱<span id="badge-new-val">${initNew}</span>
              </div>
            </div>

            <!-- SINGLE PRICING (EMPTY CONTAINER ONLY) -->
            <div id="section-single-pricing" ${currentType !== 'refill' ? '' : 'hidden'}>
              <div class="form-row">
                <div class="field">
                  <label class="label" for="prod-single-price" id="single-price-label">Selling price (₱)</label>
                  <input class="input" id="prod-single-price" type="number" step="0.01" min="0" value="${product?.price ?? 125}" />
                </div>
                <div class="field">
                  <label class="label" for="prod-unit-single" id="single-unit-label">Unit label</label>
                  <input class="input" id="prod-unit-single" type="text" value="${escapeHtml(product?.unit || 'container')}" />
                </div>
              </div>
              <div class="notice" id="single-type-notice" style="margin-top: 6px; font-size: 12px; line-height: 1.5; padding: 10px 12px; background: var(--brand-soft, #ebf2ff); border: 1px solid #bfdbfe; color: var(--ink-navy, #0f172a);">
                <strong style="color: var(--blue-app, #1d5bd6);">Sold Outright:</strong> Clean dry container delivered without water. Customers receive <strong>+1 empty bottle balance</strong> upon delivery.
              </div>
            </div>

            <!-- Unit & Visibility for Refill -->
            <div class="form-row" id="row-refill-meta" ${currentType === 'refill' ? '' : 'hidden'}>
              <div class="field">
                <label class="label" for="prod-unit-refill">Unit label</label>
                <input class="input" id="prod-unit-refill" type="text" value="${escapeHtml(product?.unit || 'gallon')}" />
              </div>
              <div class="field">
                <label class="label" for="prod-active-refill">Visibility in catalog</label>
                <select class="select" id="prod-active-refill">
                  <option value="true" ${product?.is_active !== false ? 'selected' : ''}>Active (shown to customers)</option>
                  <option value="false" ${product?.is_active === false ? 'selected' : ''}>Hidden from catalog</option>
                </select>
              </div>
            </div>

            <!-- Visibility for Single item -->
            <div class="field" id="row-single-meta" ${currentType !== 'refill' ? '' : 'hidden'}>
              <label class="label" for="prod-active-single">Visibility in catalog</label>
              <select class="select" id="prod-active-single">
                <option value="true" ${product?.is_active !== false ? 'selected' : ''}>Active (shown to customers)</option>
                <option value="false" ${product?.is_active === false ? 'selected' : ''}>Hidden from catalog</option>
              </select>
            </div>

            <div class="field prod-photo-uploader">
              <label class="label">Product photo</label>
              <input type="file" id="prod-photo-file" accept="image/*" hidden />

              <div class="prod-photo-preview-box${currentPhotoData ? ' has-image' : ''}" id="prod-photo-dropzone">
                <canvas class="prod-crop-canvas" id="prod-crop-canvas" width="${CROP_WIDTH}" height="${CROP_HEIGHT}" hidden></canvas>
                <div class="prod-photo-placeholder" id="prod-photo-placeholder">
                  ${getGallonIconSvg()}
                  <span>Click or drop a photo to upload</span>
                  <small>PNG, JPG, or WEBP · Drag &amp; zoom to crop after uploading</small>
                </div>
              </div>
              <p class="prod-crop-hint" id="prod-crop-badge" hidden>
                Drag photo to reposition · Scroll to zoom
              </p>

              <div class="prod-crop-controls" id="prod-crop-controls" hidden>
                <div class="prod-zoom-row">
                  <span class="prod-zoom-label">Zoom</span>
                  <input type="range" class="prod-zoom-slider" id="prod-zoom-slider" min="50" max="300" step="2" value="100" />
                  <span class="prod-zoom-val" id="prod-zoom-val">100%</span>
                </div>
                <div class="prod-crop-actions">
                  <div class="prod-fit-group" role="group" aria-label="Fit mode">
                    <button type="button" class="prod-fit-btn is-active" data-fit-mode="fill">Fill &amp; crop</button>
                    <button type="button" class="prod-fit-btn" data-fit-mode="fit">Fit whole 1:1</button>
                  </div>
                  <button type="button" class="prod-fit-btn" id="btn-reset-crop">Reset position</button>
                </div>
              </div>

              <div class="prod-photo-toolbar">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-upload-file">
                  ${getCameraIconSvg()} Upload photo from device
                </button>
                <button type="button" class="btn btn-light btn-sm" id="btn-clear-photo" ${currentPhotoData ? '' : 'hidden'}>
                  Remove photo
                </button>
              </div>

              <div class="prod-photo-presets">
                <span class="field-hint" style="margin-right:2px;">Quick photo presets:</span>
                <button type="button" class="prod-preset-chip" data-preset-photo="../assets/images/round-gallon-refill.png">Round Gallon</button>
                <button type="button" class="prod-preset-chip" data-preset-photo="../assets/images/slim-gallon-refill.png">Slim Gallon</button>
                <button type="button" class="prod-preset-chip" data-preset-photo="../assets/images/bottle-delivery.png">Bottle Delivery</button>
              </div>

              <div class="field" style="margin-top: 2px;">
                <label class="label" for="prod-photo">Or paste image URL (optional)</label>
                <input
                  class="input"
                  id="prod-photo"
                  name="photoUrl"
                  type="text"
                  value="${escapeHtml(currentPhotoData.startsWith('data:') ? '' : currentPhotoData)}"
                  placeholder="https://example.com/gallon.png"
                />
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-save-prod">${isEdit ? 'Save changes' : 'Add product'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const fileInput = backdrop.querySelector('#prod-photo-file');
    const dropzone = backdrop.querySelector('#prod-photo-dropzone');
    const canvas = backdrop.querySelector('#prod-crop-canvas');
    const ctx = canvas.getContext('2d');
    const badgeEl = backdrop.querySelector('#prod-crop-badge');
    const placeholderEl = backdrop.querySelector('#prod-photo-placeholder');
    const cropControlsEl = backdrop.querySelector('#prod-crop-controls');
    const zoomSlider = backdrop.querySelector('#prod-zoom-slider');
    const zoomValEl = backdrop.querySelector('#prod-zoom-val');
    const resetCropBtn = backdrop.querySelector('#btn-reset-crop');
    const clearBtn = backdrop.querySelector('#btn-clear-photo');
    const uploadBtn = backdrop.querySelector('#btn-upload-file');
    const urlInput = backdrop.querySelector('#prod-photo');

    function getBaseScale() {
      if (!sourceImg) return 1;
      const iw = sourceImg.naturalWidth || sourceImg.width || 1;
      const ih = sourceImg.naturalHeight || sourceImg.height || 1;
      return fitMode === 'fit'
        ? Math.min(CROP_WIDTH / iw, CROP_HEIGHT / ih)
        : Math.max(CROP_WIDTH / iw, CROP_HEIGHT / ih);
    }

    function clampPan() {
      if (!sourceImg) return;
      const iw = sourceImg.naturalWidth || sourceImg.width || 1;
      const ih = sourceImg.naturalHeight || sourceImg.height || 1;
      const scale = getBaseScale() * zoom;
      const drawW = iw * scale;
      const drawH = ih * scale;

      const limitX = Math.max((drawW - CROP_WIDTH) / 2, CROP_WIDTH * 0.35);
      const limitY = Math.max((drawH - CROP_HEIGHT) / 2, CROP_HEIGHT * 0.35);

      if (fitMode === 'fill' && drawW >= CROP_WIDTH) {
        const strictX = (drawW - CROP_WIDTH) / 2;
        panX = Math.max(-strictX, Math.min(strictX, panX));
      } else {
        panX = Math.max(-limitX, Math.min(limitX, panX));
      }

      if (fitMode === 'fill' && drawH >= CROP_HEIGHT) {
        const strictY = (drawH - CROP_HEIGHT) / 2;
        panY = Math.max(-strictY, Math.min(strictY, panY));
      } else {
        panY = Math.max(-limitY, Math.min(limitY, panY));
      }
    }

    function renderCropCanvas() {
      if (!sourceImg) return;
      clampPan();

      ctx.clearRect(0, 0, CROP_WIDTH, CROP_HEIGHT);

      // Soft AquaRun background fill (visible when fitMode === 'fit' or zoomed out)
      const grad = ctx.createLinearGradient(0, 0, 0, CROP_HEIGHT);
      grad.addColorStop(0, '#e6f0fd');
      grad.addColorStop(1, '#dbeafe');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CROP_WIDTH, CROP_HEIGHT);

      const iw = sourceImg.naturalWidth || sourceImg.width || 1;
      const ih = sourceImg.naturalHeight || sourceImg.height || 1;
      const scale = getBaseScale() * zoom;
      const drawW = iw * scale;
      const drawH = ih * scale;
      const dx = (CROP_WIDTH - drawW) / 2 + panX;
      const dy = (CROP_HEIGHT - drawH) / 2 + panY;

      ctx.drawImage(sourceImg, dx, dy, drawW, drawH);
    }

    function setFitModeUI(newMode) {
      fitMode = newMode;
      backdrop.querySelectorAll('[data-fit-mode]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-fit-mode') === fitMode);
      });
    }

    function loadImageIntoCropper(src, { markAdjusted = false } = {}) {
      const cleanSrc = String(src || '').trim();
      currentPhotoData = cleanSrc;

      if (!cleanSrc) {
        sourceImg = null;
        dropzone.classList.remove('has-image');
        canvas.hidden = true;
        badgeEl.hidden = true;
        cropControlsEl.hidden = true;
        clearBtn.hidden = true;
        placeholderEl.hidden = false;
        return;
      }

      const img = new Image();
      if (!cleanSrc.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        sourceImg = img;
        isCanvasTainted = false;
        zoom = 1;
        panX = 0;
        panY = 0;
        hasUserAdjustedCrop = markAdjusted;
        zoomSlider.value = '100';
        zoomValEl.textContent = '100%';
        setFitModeUI('fill');

        dropzone.classList.add('has-image');
        placeholderEl.hidden = true;
        canvas.hidden = false;
        badgeEl.hidden = false;
        cropControlsEl.hidden = false;
        clearBtn.hidden = false;
        renderCropCanvas();
      };
      img.onerror = () => {
        // Retry without crossOrigin if external host blocks CORS canvas
        if (img.crossOrigin) {
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            sourceImg = fallbackImg;
            isCanvasTainted = true;
            zoom = 1;
            panX = 0;
            panY = 0;
            dropzone.classList.add('has-image');
            placeholderEl.hidden = true;
            canvas.hidden = false;
            badgeEl.hidden = false;
            cropControlsEl.hidden = false;
            clearBtn.hidden = false;
            renderCropCanvas();
          };
          fallbackImg.onerror = () => {
            sourceImg = null;
            dropzone.classList.remove('has-image');
            canvas.hidden = true;
            badgeEl.hidden = true;
            cropControlsEl.hidden = true;
            placeholderEl.hidden = false;
          };
          fallbackImg.src = cleanSrc;
          return;
        }
        sourceImg = null;
        dropzone.classList.remove('has-image');
        canvas.hidden = true;
        badgeEl.hidden = true;
        cropControlsEl.hidden = true;
        placeholderEl.hidden = false;
      };
      img.src = cleanSrc;
    }

    loadImageIntoCropper(currentPhotoData, { markAdjusted: false });

    // Interactive Drag / Pan on the preview box
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startPanX = 0;
    let startPanY = 0;

    dropzone.addEventListener('pointerdown', (e) => {
      if (!sourceImg) {
        fileInput?.click();
        return;
      }
      e.preventDefault();
      isDragging = true;
      hasUserAdjustedCrop = true;
      dropzone.classList.add('is-dragging');
      dropzone.setPointerCapture?.(e.pointerId);
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startPanX = panX;
      startPanY = panY;
    });

    dropzone.addEventListener('pointermove', (e) => {
      if (!isDragging || !sourceImg) return;
      const rect = dropzone.getBoundingClientRect();
      const ratioX = CROP_WIDTH / Math.max(rect.width, 1);
      const ratioY = CROP_HEIGHT / Math.max(rect.height, 1);
      panX = startPanX + (e.clientX - dragStartX) * ratioX;
      panY = startPanY + (e.clientY - dragStartY) * ratioY;
      renderCropCanvas();
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      dropzone.classList.remove('is-dragging');
      if (e?.pointerId !== undefined) {
        try {
          dropzone.releasePointerCapture?.(e.pointerId);
        } catch {}
      }
    };

    dropzone.addEventListener('pointerup', stopDrag);
    dropzone.addEventListener('pointercancel', stopDrag);

    // Mouse wheel zoom directly over the image preview
    dropzone.addEventListener(
      'wheel',
      (e) => {
        if (!sourceImg) return;
        e.preventDefault();
        hasUserAdjustedCrop = true;
        const delta = e.deltaY < 0 ? 8 : -8;
        const nextPct = Math.max(50, Math.min(300, Number(zoomSlider.value) + delta));
        zoomSlider.value = String(nextPct);
        zoom = nextPct / 100;
        zoomValEl.textContent = `${nextPct}%`;
        renderCropCanvas();
      },
      { passive: false }
    );

    zoomSlider?.addEventListener('input', () => {
      if (!sourceImg) return;
      hasUserAdjustedCrop = true;
      const pct = Number(zoomSlider.value) || 100;
      zoom = pct / 100;
      zoomValEl.textContent = `${pct}%`;
      renderCropCanvas();
    });

    backdrop.querySelectorAll('[data-fit-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-fit-mode') || 'fill';
        hasUserAdjustedCrop = true;
        setFitModeUI(mode);
        panX = 0;
        panY = 0;
        zoom = 1;
        zoomSlider.value = '100';
        zoomValEl.textContent = '100%';
        renderCropCanvas();
      });
    });

    resetCropBtn?.addEventListener('click', () => {
      hasUserAdjustedCrop = true;
      panX = 0;
      panY = 0;
      zoom = 1;
      zoomSlider.value = '100';
      zoomValEl.textContent = '100%';
      renderCropCanvas();
    });

    async function handleFileSelected(file) {
      if (!file) return;
      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Loading photo...';
        const dataUrl = await processProductPhotoFile(file);
        urlInput.value = '';
        loadImageIntoCropper(dataUrl, { markAdjusted: true });
      } catch (err) {
        showToast(err.message || 'Could not process image file.', 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = `${getCameraIconSvg()} Upload photo from device`;
      }
    }

    uploadBtn?.addEventListener('click', () => fileInput?.click());

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--brand)';
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.style.borderColor = '';
    });
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '';
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelected(file);
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleFileSelected(file);
      fileInput.value = '';
    });

    clearBtn?.addEventListener('click', () => {
      urlInput.value = '';
      loadImageIntoCropper('', { markAdjusted: false });
    });

    backdrop.querySelectorAll('[data-preset-photo]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const presetUrl = chip.getAttribute('data-preset-photo') || '';
        urlInput.value = presetUrl;
        loadImageIntoCropper(presetUrl, { markAdjusted: false });
      });
    });

    urlInput?.addEventListener('change', () => {
      const typed = urlInput.value.trim();
      loadImageIntoCropper(typed, { markAdjusted: false });
    });

    if (focusField === 'price') {
      backdrop.querySelector('#prod-price')?.focus();
      backdrop.querySelector('#prod-price')?.select();
    } else if (focusField === 'photo') {
      dropzone?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      backdrop.querySelector('#prod-name')?.focus();
    }

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    function exportFinalPhotoString(fd) {
      if (sourceImg && !isCanvasTainted && (hasUserAdjustedCrop || currentPhotoData.startsWith('data:'))) {
        try {
          renderCropCanvas();
          let cropped = canvas.toDataURL('image/webp', 0.88);
          if (!cropped || !cropped.startsWith('data:image/webp')) {
            cropped = canvas.toDataURL('image/jpeg', 0.88);
          }
          return cropped;
        } catch {
          return currentPhotoData || null;
        }
      }
      return currentPhotoData || String(fd.get('photoUrl') || '').trim() || null;
    }

    const nameInput = backdrop.querySelector('#prod-name');
    const nameLabel = backdrop.querySelector('#name-field-label');
    const nameChipsEl = backdrop.querySelector('#name-preset-chips');
    const sectionRefill = backdrop.querySelector('#section-refill-pricing');
    const sectionSingle = backdrop.querySelector('#section-single-pricing');
    const rowRefillMeta = backdrop.querySelector('#row-refill-meta');
    const rowSingleMeta = backdrop.querySelector('#row-single-meta');
    const singlePriceLabel = backdrop.querySelector('#single-price-label');
    const singleTypeNotice = backdrop.querySelector('#single-type-notice');
    const singlePriceInput = backdrop.querySelector('#prod-single-price');
    const singleUnitInput = backdrop.querySelector('#prod-unit-single');

    const swapPriceInput = backdrop.querySelector('#prod-swap-price');
    const emptyPriceInput = backdrop.querySelector('#prod-empty-price');
    const newContainerPriceInput = backdrop.querySelector('#prod-new-price');
    const badgeSwap = backdrop.querySelector('#badge-swap-val');
    const badgeEmpty = backdrop.querySelector('#badge-empty-val');
    const badgeNew = backdrop.querySelector('#badge-new-val');

    function syncRefillBadge() {
      const s = Math.max(0, Number(swapPriceInput?.value || 0));
      const e = Math.max(0, Number(emptyPriceInput?.value || 0));
      const n = Math.max(s, Number(newContainerPriceInput?.value || s + e));
      if (badgeSwap) badgeSwap.textContent = String(s);
      if (badgeEmpty) badgeEmpty.textContent = String(e);
      if (badgeNew) badgeNew.textContent = String(n);
    }

    swapPriceInput?.addEventListener('input', () => {
      const s = Math.max(0, Number(swapPriceInput.value || 0));
      const e = Math.max(0, Number(emptyPriceInput.value || 125));
      newContainerPriceInput.value = String(s + e);
      syncRefillBadge();
    });

    emptyPriceInput?.addEventListener('input', () => {
      const s = Math.max(0, Number(swapPriceInput.value || 0));
      const e = Math.max(0, Number(emptyPriceInput.value || 0));
      newContainerPriceInput.value = String(s + e);
      syncRefillBadge();
    });

    newContainerPriceInput?.addEventListener('input', () => {
      const s = Math.max(0, Number(swapPriceInput.value || 0));
      const n = Math.max(s, Number(newContainerPriceInput.value || 0));
      emptyPriceInput.value = String(Math.max(0, n - s));
      syncRefillBadge();
    });

    function applyCategoryUI(isUserSwitch = false) {
      backdrop.querySelectorAll('#prod-type-tabs .prod-type-tab').forEach((tab) => {
        tab.classList.toggle('is-active', tab.dataset.type === currentType);
      });

      if (currentType === 'refill') {
        sectionRefill.hidden = false;
        sectionSingle.hidden = true;
        rowRefillMeta.hidden = false;
        rowSingleMeta.hidden = true;
        nameLabel.textContent = 'Water refill product name';
        nameInput.placeholder = 'e.g. Purified Water Refill (Round Gallon)';

        nameChipsEl.innerHTML = `
          <button type="button" class="prod-preset-chip" data-set-name="Purified Water Refill (Round Gallon)">+ Round Refill</button>
          <button type="button" class="prod-preset-chip" data-set-name="Mineral Water Refill (Slim Gallon)">+ Slim Refill</button>
          <button type="button" class="prod-preset-chip" data-set-name="Alkaline Water Refill (Round Gallon)">+ Alkaline Refill</button>
        `;

        if (isUserSwitch && !isEdit) {
          if (!nameInput.value || /empty|pump|tap|carrier/i.test(nameInput.value)) {
            nameInput.value = 'Purified Water Refill (Round Gallon)';
          }
        }
        syncRefillBadge();
      } else {
        // empty container only
        sectionRefill.hidden = true;
        sectionSingle.hidden = false;
        rowRefillMeta.hidden = true;
        rowSingleMeta.hidden = false;
        nameLabel.textContent = 'Empty container product name';
        nameInput.placeholder = 'e.g. Empty 5-Gallon Container (Round)';
        singlePriceLabel.textContent = 'Empty container selling price (₱)';
        singleTypeNotice.innerHTML = `
          <strong>Sold Outright:</strong> Clean dry container delivered without water. Customers receive <strong>+1 empty bottle balance</strong> upon delivery.
        `;

        nameChipsEl.innerHTML = `
          <button type="button" class="prod-preset-chip" data-set-name="Empty 5-Gallon Container (Round)">+ Empty Round (₱125)</button>
          <button type="button" class="prod-preset-chip" data-set-name="Empty 5-Gallon Container (Slim)">+ Empty Slim (₱125)</button>
        `;

        if (isUserSwitch && !isEdit) {
          nameInput.value = 'Empty 5-Gallon Container (Round)';
          if (singlePriceInput) singlePriceInput.value = '125';
          if (singleUnitInput) singleUnitInput.value = 'container';
        }
      }

      nameChipsEl.querySelectorAll('[data-set-name]').forEach((chip) => {
        chip.addEventListener('click', () => {
          nameInput.value = chip.dataset.setName;
          nameInput.focus();
        });
      });
    }

    backdrop.querySelector('#prod-type-tabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.prod-type-tab');
      if (!tab) return;
      currentType = tab.dataset.type === 'empty' ? 'empty' : 'refill';
      applyCategoryUI(true);
    });

    applyCategoryUI(false);

    if (isReadOnly) {
      backdrop.querySelectorAll('input, select, textarea').forEach((el) => {
        el.disabled = true;
        el.readOnly = true;
      });
      backdrop.querySelectorAll('.prod-type-tab, .prod-preset-chip, .prod-fit-btn, #btn-upload-file, #btn-clear-photo, #btn-reset-crop, .prod-photo-presets').forEach((el) => {
        el.style.display = 'none';
      });
      const cropControls = backdrop.querySelector('.prod-crop-controls');
      if (cropControls) cropControls.style.display = 'none';
      const urlField = backdrop.querySelector('#prod-photo')?.closest('.field');
      if (urlField) urlField.style.display = 'none';
    }

    const form = backdrop.querySelector('#prod-modal-form');
    const submitBtn = backdrop.querySelector('#btn-save-prod');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const finalPhoto = exportFinalPhotoString(fd);
      const nameVal = String(nameInput?.value || fd.get('name') || '').trim();

      let priceVal = 0;
      let newPriceVal = 0;
      let unitVal = 'gallon';
      let isActiveVal = true;
      let isReturnableVal = true;

      if (currentType === 'refill') {
        priceVal = Number(swapPriceInput?.value || 25);
        newPriceVal = Number(newContainerPriceInput?.value || priceVal + 125);
        unitVal =
          String(backdrop.querySelector('#prod-unit-refill')?.value || 'gallon').trim() ||
          'gallon';
        isActiveVal = backdrop.querySelector('#prod-active-refill')?.value === 'true';
        isReturnableVal = true;
      } else {
        // empty container
        priceVal = Number(singlePriceInput?.value || 125);
        newPriceVal = priceVal;
        unitVal =
          String(singleUnitInput?.value || 'container').trim() || 'container';
        isActiveVal = backdrop.querySelector('#prod-active-single')?.value === 'true';
        isReturnableVal = false;
      }

      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveProduct({
          id: product?.id || null,
          name: nameVal,
          price: priceVal,
          newContainerPrice: newPriceVal,
          unit: unitVal,
          photoUrl: finalPhoto,
          isActive: isActiveVal,
          isReturnable: isReturnableVal,
        });
        showToast(
          isEdit ? 'Product updated.' : `${nameVal} added to catalog.`,
          'success'
        );
        close();
        await loadCatalog();
      } catch (err) {
        showToast(err.message || 'Could not save product.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function openQuickPriceModal(product) {
    const isReturnable = product.is_returnable !== false;
    const currentSwapPrice = Number(product.price || 0);
    const currentNewPrice = Number(
      product.new_container_price ?? (isReturnable ? currentSwapPrice + 125 : currentSwapPrice)
    );
    const currentEmptyPrice = Math.max(25, currentNewPrice - currentSwapPrice);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width: 440px;">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Edit prices · ${escapeHtml(product.name)}</h3>
            <p class="modal-subtitle" style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Directly manipulate refill, new gallon, and container prices
            </p>
          </div>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="quick-price-form">
          <div class="modal-body stack">
            <div class="field">
              <label class="label" for="qp-swap-price">
                ${isReturnable ? 'Swap refill price — water only (₱)' : 'Product price (₱)'}
              </label>
              <input class="input" id="qp-swap-price" name="price" type="number" step="0.5" min="0" value="${currentSwapPrice}" required />
              <p class="field-hint">${isReturnable ? 'Charged when customer returns an empty bottle (1-to-1 swap).' : 'Outright purchase price.'}</p>
            </div>

            ${
              isReturnable
                ? `
              <div class="field">
                <label class="label" for="qp-new-price">New gallon + water price (₱)</label>
                <input class="input" id="qp-new-price" name="newPrice" type="number" step="0.5" min="0" value="${currentNewPrice}" required />
                <p class="field-hint">Charged when customer needs a new bottle (water + container).</p>
              </div>

              <div class="field">
                <label class="label" for="qp-empty-price">Empty container value (₱)</label>
                <input class="input" id="qp-empty-price" name="emptyPrice" type="number" step="0.5" min="0" value="${currentEmptyPrice}" />
                <p class="field-hint">Net value of container only (New Gallon − Refill).</p>
              </div>

              <div class="notice" style="font-size: 12px; line-height: 1.5; padding: 10px 12px; background: #f0f7ff; border-left: 3px solid var(--blue-app, #1d5bd6);">
                <strong>Live Pricing Summary:</strong>
                <br>• Swap Refill: <strong>₱<span id="qp-live-swap">${currentSwapPrice}</span></strong> (customer has empty bottle)
                <br>• New Gallon + Water: <strong>₱<span id="qp-live-new">${currentNewPrice}</span></strong> (filled new bottle)
                <br>• Empty Container: <strong>₱<span id="qp-live-empty">${currentEmptyPrice}</span></strong>
              </div>
            `
                : ''
            }
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-save-qp">Save prices</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const swapInput = backdrop.querySelector('#qp-swap-price');
    const newInput = backdrop.querySelector('#qp-new-price');
    const emptyInput = backdrop.querySelector('#qp-empty-price');
    const liveSwap = backdrop.querySelector('#qp-live-swap');
    const liveNew = backdrop.querySelector('#qp-live-new');
    const liveEmpty = backdrop.querySelector('#qp-live-empty');

    function syncLiveHints() {
      const s = Math.max(0, Number(swapInput?.value || 0));
      const n = Math.max(s, Number(newInput?.value || 0));
      const e = Math.max(0, n - s);
      if (liveSwap) liveSwap.textContent = String(s);
      if (liveNew) liveNew.textContent = String(n);
      if (liveEmpty) liveEmpty.textContent = String(e);
    }

    swapInput?.addEventListener('input', () => {
      if (isReturnable && emptyInput && newInput) {
        const s = Math.max(0, Number(swapInput.value || 0));
        const e = Math.max(0, Number(emptyInput.value || 125));
        newInput.value = String(s + e);
      }
      syncLiveHints();
    });

    emptyInput?.addEventListener('input', () => {
      if (isReturnable && swapInput && newInput) {
        const s = Math.max(0, Number(swapInput.value || 0));
        const e = Math.max(0, Number(emptyInput.value || 0));
        newInput.value = String(s + e);
      }
      syncLiveHints();
    });

    newInput?.addEventListener('input', () => {
      if (isReturnable && swapInput && emptyInput) {
        const s = Math.max(0, Number(swapInput.value || 0));
        const n = Math.max(s, Number(newInput.value || 0));
        emptyInput.value = String(Math.max(0, n - s));
      }
      syncLiveHints();
    });

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const form = backdrop.querySelector('#quick-price-form');
    const saveBtn = backdrop.querySelector('#btn-save-qp');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newSwap = Number(swapInput.value);
      const newGallon = isReturnable ? Number(newInput.value) : newSwap;
      setBusy(saveBtn, true, 'Updating prices...');
      try {
        await saveProduct({
          id: product.id,
          name: product.name,
          price: newSwap,
          newContainerPrice: newGallon,
          unit: product.unit,
          photoUrl: product.photo_url,
          isActive: product.is_active,
          isReturnable: product.is_returnable,
        });
        showToast(`Prices updated for ${product.name}!`, 'success');
        close();
        await loadCatalog();
      } catch (err) {
        showToast(err.message || 'Could not update prices.', 'error');
        setBusy(saveBtn, false);
      }
    });

    swapInput?.focus();
    swapInput?.select();
  }

  let searchQuery = '';
  let activeFilter = 'all';
  let currentPage = 1;
  const pageSize = 10;

  function renderView() {
    // 1. Filter products based on search and category tabs
    const q = searchQuery.trim().toLowerCase();
    let filtered = products.slice();

    if (q) {
      filtered = filtered.filter((p) => {
        const name = (p.name || '').toLowerCase();
        const unit = (p.unit || '').toLowerCase();
        const cat = p.is_returnable !== false ? 'refill returnable swap' : 'empty container sold outright';
        return name.includes(q) || unit.includes(q) || cat.includes(q);
      });
    }

    if (activeFilter === 'refill') {
      filtered = filtered.filter((p) => p.is_returnable !== false);
    } else if (activeFilter === 'outright') {
      filtered = filtered.filter((p) => p.is_returnable === false);
    } else if (activeFilter === 'active') {
      filtered = filtered.filter((p) => p.is_active !== false);
    } else if (activeFilter === 'hidden') {
      filtered = filtered.filter((p) => p.is_active === false);
    }

    // Counts for filter pills
    const allCount = products.length;
    const refillCount = products.filter((p) => p.is_returnable !== false).length;
    const outrightCount = products.filter((p) => p.is_returnable === false).length;
    const activeCount = products.filter((p) => p.is_active !== false).length;
    const hiddenCount = products.filter((p) => p.is_active === false).length;

    // Pagination calculations
    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * pageSize;
    const pagedProducts = filtered.slice(startIndex, startIndex + pageSize);

    // Build Table Body Rows
    const rowsHtml =
      totalFiltered === 0
        ? `
          <tr>
            <td colspan="5">
              <div class="prod-table-empty">
                <h3>No products found</h3>
                <p>${searchQuery ? 'Try clearing your search or choosing a different filter tab.' : 'No products have been added yet.'}</p>
                ${searchQuery ? '<button type="button" class="btn btn-secondary btn-sm" id="btn-clear-prod-search" style="margin-top: 8px;">Clear search</button>' : ''}
              </div>
            </td>
          </tr>
        `
        : pagedProducts
            .map((prod) => {
              const isActive = Boolean(prod.is_active);
              const isReturnable = prod.is_returnable !== false;
              const statusPill = isActive
                ? `<span class="pill pill-success">Active</span>`
                : `<span class="pill pill-neutral">Hidden</span>`;
              const returnablePill = isReturnable
                ? `<span class="pill pill-info">Returnable Refill</span>`
                : `<span class="pill pill-neutral">Sold Outright</span>`;
              const newGallonPrice = Number(
                prod.new_container_price ?? (isReturnable ? Number(prod.price || 25) + 125 : prod.price)
              );
              const emptyContainerPrice = Math.max(25, newGallonPrice - Number(prod.price || 0));
              const subtitle = isReturnable
                ? 'Standard 5-gallon refill'
                : 'Sold outright · No container return';
              const hasPhoto = Boolean(prod.photo_url);

              const thumbInner = hasPhoto
                ? `<img class="prod-table-thumb-img" src="${escapeHtml(prod.photo_url)}" alt="${escapeHtml(prod.name)}" />`
                : `<div class="prod-table-thumb-fallback">${getGallonIconSvg()}</div>`;

              return `
                <tr class="${isActive ? '' : 'is-hidden-row'}">
                  <!-- Product: 1:1 Photo & Title -->
                  <td>
                    <div class="prod-table-product-cell">
                      <div class="prod-table-thumb-wrap" data-edit-photo="${escapeHtml(prod.id)}" title="Click to view or crop photo">
                        ${thumbInner}
                        <span class="prod-table-thumb-hover">${getCameraIconSvg()}</span>
                      </div>
                      <div class="prod-table-info">
                        <span class="prod-table-name">${escapeHtml(prod.name)}</span>
                        <span class="prod-table-sub">${escapeHtml(subtitle)}</span>
                      </div>
                    </div>
                  </td>

                  <!-- Category -->
                  <td>
                    ${returnablePill}
                  </td>

                  <!-- Pricing Details -->
                  <td>
                    <div class="prod-table-pricing">
                      <div class="prod-price-chip">
                        <span class="chip-label">${isReturnable ? 'Swap refill:' : 'Price:'}</span>
                        <strong class="chip-val">${escapeHtml(formatPeso(prod.price))}</strong>
                      </div>
                      ${
                        isReturnable
                          ? `
                        <div class="prod-price-chip">
                          <span class="chip-label">New gallon:</span>
                          <strong class="chip-val">${escapeHtml(formatPeso(newGallonPrice))}</strong>
                        </div>
                        <div class="prod-price-chip">
                          <span class="chip-label">Container:</span>
                          <strong class="chip-val">${escapeHtml(formatPeso(emptyContainerPrice))}</strong>
                        </div>
                      `
                          : `
                        <div class="prod-price-chip">
                          <span class="chip-label">Unit:</span>
                          <strong class="chip-val">per ${escapeHtml(prod.unit || 'piece')}</strong>
                        </div>
                      `
                      }
                    </div>
                  </td>

                  <!-- Visibility Toggle -->
                  <td style="text-align: center;">
                    <div class="prod-table-vis-cell">
                      <button
                        type="button"
                        class="admin-switch${isActive ? ' is-on' : ''}"
                        data-toggle-prod="${escapeHtml(prod.id)}"
                        aria-label="Toggle product visibility"
                        title="${isActive ? 'Hide from customer catalog' : 'Show in customer catalog'}"
                      ></button>
                      ${statusPill}
                    </div>
                  </td>

                  <!-- Actions -->
                  <td style="text-align: right;">
                    <div class="prod-table-actions">
                      <button type="button" class="btn btn-primary btn-sm" data-edit-prod="${escapeHtml(prod.id)}">Edit</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-view-prod="${escapeHtml(prod.id)}">View</button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('');

    content.innerHTML = `
      <div class="stack-lg">
        <!-- Delivery service charge (with Thin Peso Icon) -->
        <section class="card delivery-charge-top-card">
          <div class="delivery-charge-top-inner">
            <div class="delivery-charge-top-left">
              <span class="delivery-charge-top-icon">
                ${getPesoIconSvg({ size: 20, strokeWidth: 1.4 })}
              </span>
              <div>
                <h2 class="card-title" style="font-size: 15px; margin: 0 0 2px 0;">Delivery service charge</h2>
                <p class="card-subtitle" style="font-size: 12px; margin: 0; color: #64748b;">Flat fee added to every delivery order</p>
              </div>
            </div>
            <form class="service-charge-inline-form" id="service-charge-form">
              <label class="label" for="service-charge-input" style="font-size: 13px; font-weight: 700; margin: 0; white-space: nowrap;">Charge per order:</label>
              <div class="charge-input-wrap">
                <span class="charge-input-prefix">
                  ${getPesoIconSvg({ size: 14, strokeWidth: 1.4 })}
                </span>
                <input
                  class="input charge-input-field"
                  id="service-charge-input"
                  type="number"
                  min="0"
                  step="1"
                  value="${Number(serviceCharge || 0).toFixed(0)}"
                  required
                />
              </div>
              <button type="submit" class="btn btn-primary btn-sm" id="btn-save-charge" style="min-height: 40px; padding: 0 18px;">Save</button>
            </form>
          </div>
        </section>

        <!-- Search & Filter Toolbar -->
        <div class="prod-table-toolbar">
          <div class="prod-search-field">
            <span class="prod-search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              type="search"
              class="input prod-search-input"
              id="prod-search-input"
              placeholder="Search products by name or type..."
              value="${escapeHtml(searchQuery)}"
            />
          </div>

          <div class="prod-filter-tabs" id="prod-filter-tabs">
            <button type="button" class="prod-filter-tab ${activeFilter === 'all' ? 'is-active' : ''}" data-filter="all">
              All <span class="tab-count">${allCount}</span>
            </button>
            <button type="button" class="prod-filter-tab ${activeFilter === 'refill' ? 'is-active' : ''}" data-filter="refill">
              Refills <span class="tab-count">${refillCount}</span>
            </button>
            <button type="button" class="prod-filter-tab ${activeFilter === 'outright' ? 'is-active' : ''}" data-filter="outright">
              Sold outright <span class="tab-count">${outrightCount}</span>
            </button>
            <button type="button" class="prod-filter-tab ${activeFilter === 'active' ? 'is-active' : ''}" data-filter="active">
              Active <span class="tab-count">${activeCount}</span>
            </button>
            <button type="button" class="prod-filter-tab ${activeFilter === 'hidden' ? 'is-active' : ''}" data-filter="hidden">
              Hidden <span class="tab-count">${hiddenCount}</span>
            </button>
          </div>
        </div>

        <!-- Professional Data Table -->
        <div class="card prod-table-card">
          <div class="prod-table-responsive">
            <table class="prod-table">
              <thead>
                <tr>
                  <th style="width: 280px;">Product</th>
                  <th style="width: 150px;">Category</th>
                  <th>Pricing details</th>
                  <th style="width: 140px; text-align: center;">Visibility</th>
                  <th style="width: 220px; text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>

          <!-- Pagination Footer -->
          ${
            totalFiltered > 0
              ? `
            <div class="prod-table-pagination">
              <span class="pagination-info">
                Showing <strong>${startIndex + 1}–${Math.min(startIndex + pageSize, totalFiltered)}</strong> of <strong>${totalFiltered}</strong> products
              </span>
              <div class="pagination-controls">
                <button type="button" class="btn btn-light btn-sm" id="prod-prev-page" ${currentPage <= 1 ? 'disabled' : ''}>
                  ← Previous
                </button>
                <span class="pagination-page-label">Page ${currentPage} of ${totalPages}</span>
                <button type="button" class="btn btn-light btn-sm" id="prod-next-page" ${currentPage >= totalPages ? 'disabled' : ''}>
                  Next →
                </button>
              </div>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;

    // Bind Search Input
    const searchInput = content.querySelector('#prod-search-input');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentPage = 1;
      renderView();
      // Keep search focused
      const updatedInput = content.querySelector('#prod-search-input');
      if (updatedInput) {
        updatedInput.focus();
        updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
      }
    });

    content.querySelector('#btn-clear-prod-search')?.addEventListener('click', () => {
      searchQuery = '';
      currentPage = 1;
      renderView();
    });

    // Bind Filter Tabs
    content.querySelectorAll('[data-filter]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeFilter = tab.getAttribute('data-filter') || 'all';
        currentPage = 1;
        renderView();
      });
    });

    // Bind Pagination
    content.querySelector('#prod-prev-page')?.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderView();
      }
    });

    content.querySelector('#prod-next-page')?.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderView();
      }
    });

    // Fallback to gallon icon if a custom photo URL fails to load
    content.querySelectorAll('.prod-table-thumb-img').forEach((img) => {
      img.addEventListener('error', () => {
        const holder = img.closest('.prod-table-thumb-wrap');
        if (!holder) return;
        img.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'prod-table-thumb-fallback',
            innerHTML: getGallonIconSvg(),
          })
        );
      });
    });

    // Toggle Product Visibility
    content.querySelectorAll('[data-toggle-prod]').forEach((sw) => {
      sw.addEventListener('click', async () => {
        const id = sw.getAttribute('data-toggle-prod');
        const prod = products.find((p) => p.id === id);
        if (!prod) return;

        if (prod.is_active) {
          const confirmed = await confirmModal({
            title: `Disable ${prod.name}?`,
            message: `This product will be hidden immediately and customers will not be able to order it.`,
            confirmText: 'Disable product',
            cancelText: 'Keep active',
            danger: true,
          });
          if (!confirmed) return;
        }

        sw.disabled = true;
        try {
          await toggleProductActive(prod.id, !prod.is_active);
          showToast(
            `${prod.name} is now ${!prod.is_active ? 'active' : 'hidden'}.`,
            'success'
          );
          await loadCatalog();
        } catch (err) {
          showToast(err.message || 'Could not update product status.', 'error');
          sw.disabled = false;
        }
      });
    });

    // Edit Product Modal (All fields including Photo)
    content.querySelectorAll('[data-edit-prod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-prod');
        const prod = products.find((p) => String(p.id) === String(id));
        if (prod) openProductModal(prod, { isReadOnly: false, focusField: 'name' });
      });
    });

    // View Product Modal (Read-Only)
    content.querySelectorAll('[data-view-prod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-view-prod');
        const prod = products.find((p) => String(p.id) === String(id));
        if (prod) openProductModal(prod, { isReadOnly: true });
      });
    });

    // Photo Thumbnail Click (Edit Modal focused on photo)
    content.querySelectorAll('[data-edit-photo]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-edit-photo');
        const prod = products.find((p) => String(p.id) === String(id));
        if (prod) openProductModal(prod, { isReadOnly: false, focusField: 'photo' });
      });
    });

    // Delivery Service Charge Form
    const chargeForm = content.querySelector('#service-charge-form');
    const chargeInput = content.querySelector('#service-charge-input');
    const saveChargeBtn = content.querySelector('#btn-save-charge');

    chargeForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = String(chargeInput?.value || '').replace(/[^0-9.]/g, '');
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        showToast('Enter a valid delivery service charge.', 'error');
        return;
      }
      setBusy(saveChargeBtn, true, 'Saving...');
      try {
        serviceCharge = await saveServiceCharge(amount);
        showToast(`Delivery service charge updated to ${formatPeso(serviceCharge)}.`, 'success');
        renderView();
      } catch (err) {
        showToast(err.message || 'Could not update service charge.', 'error');
        setBusy(saveChargeBtn, false);
      }
    });
  }

  await loadCatalog();
  const unsubscribe = subscribeAdminWorkspace(() => {
    loadCatalog();
  });
  return () => unsubscribe();
}

bootAdminPage('products', mount);
