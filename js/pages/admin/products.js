// Admin Products: manage refill products, pricing, interactive photo cropper (pan/drag + zoom + fit/fill modes), active toggles, and delivery service charge.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatPeso,
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

const CROP_WIDTH = 760;
const CROP_HEIGHT = 360;

function getGallonIconSvg() {
  return `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v3l-3 3.5V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9.5L14 6V3" />
      <path d="M7 13h10" />
      <path d="M7 17h10" />
    </svg>
  `;
}

function getCameraIconSvg() {
  return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
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

  function openProductModal(product, { focusField = 'name' } = {}) {
    const isEdit = Boolean(product?.id);
    let currentPhotoData = product?.photo_url || '';

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
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="prod-modal-title">
        <div class="modal-header">
          <h3 class="modal-title" id="prod-modal-title">${isEdit ? 'Edit refill product' : 'Add refill product'}</h3>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="prod-modal-form">
          <div class="modal-body stack">
            <div class="field">
              <label class="label" for="prod-name">Product name</label>
              <input class="input" id="prod-name" name="name" type="text" value="${escapeHtml(product?.name || '')}" placeholder="e.g. Round Gallon Refill" required />
            </div>

            <div class="form-row">
              <div class="field">
                <label class="label" for="prod-price">Swap refill price — water only (₱)</label>
                <input class="input" id="prod-price" name="price" type="number" step="0.01" min="0" value="${escapeHtml(product?.price ?? 25)}" required />
              </div>
              <div class="field">
                <label class="label" for="prod-new-container-price">New gallon + water price (₱)</label>
                <input
                  class="input"
                  id="prod-new-container-price"
                  name="newContainerPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  value="${escapeHtml(product?.new_container_price ?? (Number(product?.price ?? 25) + 125))}"
                  ${product?.is_returnable === false ? 'disabled' : ''}
                  required
                />
              </div>
            </div>

            <div class="form-row">
              <div class="field">
                <label class="label" for="prod-unit">Unit label</label>
                <input class="input" id="prod-unit" name="unit" type="text" value="${escapeHtml(product?.unit || 'gallon')}" required />
              </div>
              <div class="field">
                <span class="field-hint">
                  <strong>How pricing works:</strong> Customers pay the <strong>Swap refill price</strong> up to the number of station gallons they currently hold. Ordering extra gallons (or a 1st order) charges the <strong>New gallon + water price</strong>.
                </span>
              </div>
            </div>

            <div class="field prod-photo-uploader">
              <label class="label">Product photo</label>
              <input type="file" id="prod-photo-file" accept="image/*" hidden />

              <div class="prod-photo-preview-box${currentPhotoData ? ' has-image' : ''}" id="prod-photo-dropzone">
                <canvas class="prod-crop-canvas" id="prod-crop-canvas" width="${CROP_WIDTH}" height="${CROP_HEIGHT}" hidden></canvas>
                <span class="prod-crop-badge" id="prod-crop-badge" hidden>Drag photo to reposition · Scroll to zoom</span>
                <div class="prod-photo-placeholder" id="prod-photo-placeholder">
                  ${getGallonIconSvg()}
                  <span>Click or drop a photo to upload</span>
                  <small>PNG, JPG, or WEBP · Drag &amp; zoom to crop after uploading</small>
                </div>
              </div>

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
                <span class="field-hint" style="margin-right:2px;">Quick presets:</span>
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

            <div class="field">
              <label class="label" for="prod-active">Visibility</label>
              <select class="select" id="prod-active" name="isActive">
                <option value="true" ${product?.is_active !== false ? 'selected' : ''}>Active (shown to customers)</option>
                <option value="false" ${product?.is_active === false ? 'selected' : ''}>Hidden from catalog</option>
              </select>
            </div>

            <div class="field">
              <label class="check" for="prod-returnable">
                <input
                  id="prod-returnable"
                  name="is_returnable"
                  type="checkbox"
                  ${product?.is_returnable !== false ? 'checked' : ''}
                />
                <span>Customer returns the empty container</span>
              </label>
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
      uploadBtn?.focus();
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

    const returnableCheckbox = backdrop.querySelector('#prod-returnable');
    const newContainerPriceInput = backdrop.querySelector('#prod-new-container-price');
    const swapPriceInput = backdrop.querySelector('#prod-price');
    returnableCheckbox?.addEventListener('change', () => {
      if (!newContainerPriceInput) return;
      const checked = returnableCheckbox.checked;
      newContainerPriceInput.disabled = !checked;
      if (!checked && swapPriceInput) {
        newContainerPriceInput.value = swapPriceInput.value;
      } else if (checked && Number(newContainerPriceInput.value) <= Number(swapPriceInput?.value || 0)) {
        newContainerPriceInput.value = String(Number(swapPriceInput?.value || 25) + 125);
      }
    });

    const form = backdrop.querySelector('#prod-modal-form');
    const submitBtn = backdrop.querySelector('#btn-save-prod');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const finalPhoto = exportFinalPhotoString(fd);
      const isReturnableVal = Boolean(form.querySelector('#prod-returnable')?.checked);
      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveProduct({
          id: product?.id || null,
          name: fd.get('name'),
          price: fd.get('price'),
          newContainerPrice: isReturnableVal
            ? fd.get('newContainerPrice') ?? newContainerPriceInput?.value
            : fd.get('price'),
          unit: fd.get('unit'),
          photoUrl: finalPhoto,
          isActive: fd.get('isActive') === 'true',
          isReturnable: isReturnableVal,
        });
        showToast(isEdit ? 'Product updated.' : 'Product added.', 'success');
        close();
        await loadCatalog();
      } catch (err) {
        showToast(err.message || 'Could not save product.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function renderView() {
    const cardsHtml =
      products.length === 0
        ? `<div class="card"><p class="text-muted">No products added yet. Click "+ Add product" to create one.</p></div>`
        : products
            .map((prod) => {
              const isActive = Boolean(prod.is_active);
              const isReturnable = prod.is_returnable !== false;
              const statusPill = isActive
                ? `<span class="pill pill-success">Active</span>`
                : `<span class="pill pill-neutral">Hidden</span>`;
              const returnablePill = isReturnable
                ? `<span class="pill pill-info">Returnable</span>`
                : `<span class="pill pill-neutral">Sold outright</span>`;
              const newGallonPrice = Number(
                prod.new_container_price ?? (isReturnable ? Number(prod.price || 25) + 125 : prod.price)
              );
              const subtitle = isReturnable
                ? `Swap refill · New gallon + water: ${formatPeso(newGallonPrice)}`
                : 'Sold outright · No empty container return';
              const hasPhoto = Boolean(prod.photo_url);

              const artInner = hasPhoto
                ? `<img class="admin-product-art-img" src="${escapeHtml(prod.photo_url)}" alt="${escapeHtml(prod.name)}" />`
                : `
                  <div class="admin-product-art-circle">
                    ${getGallonIconSvg()}
                  </div>
                `;

              return `
                <article class="admin-product-card${isActive ? '' : ' is-hidden-prod'}">
                  <div class="admin-product-art${hasPhoto ? ' has-photo' : ''}" data-edit-photo="${escapeHtml(prod.id)}" title="Click to upload, crop, or change product photo">
                    ${artInner}
                    <span class="admin-product-art-overlay">
                      ${getCameraIconSvg()} ${hasPhoto ? 'Adjust / Change photo' : 'Upload photo'}
                    </span>
                  </div>
                  <div class="admin-product-body">
                    <div class="admin-product-top">
                      <div>
                        <h3 class="admin-product-title">${escapeHtml(prod.name)}</h3>
                        <p class="admin-product-sub">${escapeHtml(subtitle)}</p>
                      </div>
                      <div class="admin-action-btns">
                        ${returnablePill}
                        ${statusPill}
                      </div>
                    </div>

                    <div class="admin-product-price-row">
                      <div class="admin-product-price">
                        ${escapeHtml(formatPeso(prod.price))}<span>/ ${escapeHtml(prod.unit || 'gallon')}</span>
                      </div>
                      <button
                        type="button"
                        class="admin-switch${isActive ? ' is-on' : ''}"
                        data-toggle-prod="${escapeHtml(prod.id)}"
                        aria-label="Toggle product visibility"
                        title="${isActive ? 'Hide from customer catalog' : 'Show in customer catalog'}"
                      ></button>
                    </div>

                    <div class="admin-product-actions">
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-prod="${escapeHtml(prod.id)}">Edit product</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-photo="${escapeHtml(prod.id)}">${hasPhoto ? 'Adjust photo' : 'Upload photo'}</button>
                    </div>
                  </div>
                </article>
              `;
            })
            .join('');

    content.innerHTML = `
      <div class="stack-lg">
        <div class="grid-3">
          ${cardsHtml}
        </div>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Delivery service charge</h2>
              <p class="card-subtitle">Flat fee added to every delivery order</p>
            </div>
          </div>
          <form class="service-charge-row" id="service-charge-form">
            <div class="field">
              <label class="label" for="service-charge-input">Standard charge per order</label>
              <input
                class="input"
                id="service-charge-input"
                type="text"
                value="₱${Number(serviceCharge || 0).toFixed(0)}"
                required
              />
            </div>
            <button type="submit" class="btn btn-primary" id="btn-save-charge">Save</button>
          </form>
        </section>
      </div>
    `;

    // Fallback to gallon icon if a custom photo URL fails to load
    content.querySelectorAll('.admin-product-art-img').forEach((img) => {
      img.addEventListener('error', () => {
        const holder = img.closest('.admin-product-art');
        if (!holder) return;
        holder.classList.remove('has-photo');
        img.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'admin-product-art-circle',
            innerHTML: getGallonIconSvg(),
          })
        );
      });
    });

    content.querySelectorAll('[data-toggle-prod]').forEach((sw) => {
      sw.addEventListener('click', async () => {
        const id = sw.getAttribute('data-toggle-prod');
        const prod = products.find((p) => p.id === id);
        if (!prod) return;
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

    content.querySelectorAll('[data-edit-prod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-prod');
        const prod = products.find((p) => p.id === id);
        if (prod) openProductModal(prod, { focusField: 'name' });
      });
    });

    content.querySelectorAll('[data-edit-photo]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-edit-photo');
        const prod = products.find((p) => p.id === id);
        if (prod) openProductModal(prod, { focusField: 'photo' });
      });
    });

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
