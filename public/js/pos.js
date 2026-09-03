const PRODUCTS = window.POS_PRODUCTS || [];
const QUICK_IDS = window.POS_QUICK_IDS || [];

let cart = [];
let currentCategory = 'all';
let selectedCustomerId = null;
let currentPaymentType = null;
let lastSaleId = null;

const searchInput = document.getElementById('pos-search');
const barcodeInput = document.getElementById('pos-barcode');
const scanError = document.getElementById('pos-scan-error');
const categoriesBox = document.getElementById('pos-categories');
const grid = document.getElementById('pos-products-grid');
const currentCategoryEl = document.getElementById('pos-current-category');
const productsCountEl = document.getElementById('pos-products-count');
const cartItemsBox = document.getElementById('pos-cart-items');
const cartCountEl = document.getElementById('pos-cart-count');
const totalAmountEl = document.getElementById('pos-total-amount');

const CATEGORY_EMOJI = {
  'Bal və mürəbbə': '🍯',
  'Konserv': '🥫',
  'Süd': '🥛',
  'Süd məhsulları': '🧀',
  'Toyuq': '🍗',
  'Turşu və konserv': '🥒',
  'Un məhsulları': '🍞',
  'Un məmulatları': '🥮',
  'Yumurta': '🥚',
  'Şirniyyat': '🍬',
};

function categoryEmoji(cat) {
  return CATEGORY_EMOJI[cat] || '📦';
}

function money(n) {
  return Number(n || 0).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyLabel(unit) {
  return unit === 'KG' ? 'kq' : 'ədəd';
}

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

function findProductByBarcode(code) {
  return PRODUCTS.find((p) => p.barcode === code);
}

function showToast(msg) {
  const t = document.getElementById('pos-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- RENDER: favorites ----------
function renderFavorites() {
  const box = document.getElementById('pos-favorites');
  if (!box) return;
  const favs = QUICK_IDS.map((id) => findProduct(id)).filter(Boolean);
  box.innerHTML = favs.map((p) => {
    const out = p.quantity <= 0;
    return `
      <div class="pos-fav-card ${out ? 'disabled' : ''}" onclick="addToCart(${p.id})">
        <div class="emoji">${categoryEmoji(p.category)}</div>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="price">${money(p.salePrice)} ₼</div>
      </div>`;
  }).join('');
}

// ---------- RENDER: product grid ----------
function renderProducts() {
  const search = searchInput.value.trim().toLowerCase();
  let filtered = PRODUCTS;

  if (currentCategory !== 'all') {
    filtered = filtered.filter((p) => p.category === currentCategory);
  }
  if (search) {
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(search) || p.barcode.includes(search));
  }

  productsCountEl.textContent = filtered.length + ' məhsul';
  currentCategoryEl.textContent = currentCategory === 'all' ? 'Bütün məhsullar' : currentCategory;

  grid.innerHTML = filtered.map((p) => {
    const out = p.quantity <= 0;
    const low = !out && p.minStock !== null && p.quantity <= p.minStock;
    let badgeClass = '';
    let badgeText = `${qty(p.quantity, p.unit)} ${qtyLabel(p.unit)}`;
    if (out) { badgeClass = 'out'; badgeText = 'Bitib'; }
    else if (low) { badgeClass = 'low'; }

    return `
      <div class="pos-product-card ${out ? 'out-of-stock' : ''}" onclick="addToCart(${p.id})">
        <div class="pos-product-img">${categoryEmoji(p.category)}</div>
        <div class="pos-product-name">${escapeHtml(p.name)}</div>
        <div class="pos-product-footer">
          <span class="pos-product-price">${money(p.salePrice)} ₼</span>
          <span class="pos-stock-badge ${badgeClass}">${badgeText}</span>
        </div>
      </div>`;
  }).join('');
}

function qty(value, unit) {
  const n = Number(value || 0);
  if (unit === 'KG') return n.toLocaleString('az-AZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return n.toLocaleString('az-AZ', { maximumFractionDigits: 3 });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- CART ----------
function addToCart(id) {
  const product = findProduct(id);
  if (!product || product.quantity <= 0) return;

  const existing = cart.find((c) => c.productId === product.id);
  if (existing) {
    if (product.unit !== 'KG') {
      if (existing.quantity < product.maxQuantity) {
        existing.quantity += 1;
        showToast(`${product.name} +1`);
      } else {
        showToast('Stok kifayət etmir');
        return;
      }
    } else {
      showToast(`${product.name} artıq səbətdədir`);
    }
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      unit: product.unit,
      unitPrice: Number(product.salePrice),
      discount: 0,
      quantity: product.unit === 'KG' ? 0 : 1,
      maxQuantity: Number(product.quantity),
      editOpen: false,
    });
    showToast(`${product.name} əlavə olundu`);
  }
  renderCart();
}

function renderCart() {
  cartCountEl.textContent = cart.length;

  if (cart.length === 0) {
    cartItemsBox.innerHTML = `
      <div class="pos-empty-cart" id="pos-empty-cart">
        <div class="icon">🛒</div>
        <p>Səbət boşdur</p>
        <p style="font-size:12px">Məhsul seçərək satışa başlayın</p>
      </div>`;
    totalAmountEl.textContent = '0.00 ₼';
    return;
  }

  let total = 0;
  cartItemsBox.innerHTML = cart.map((item, idx) => {
    const lineTotal = Math.max(0, item.quantity * item.unitPrice - (item.discount || 0));
    total += lineTotal;

    const qtyControl = item.unit === 'KG'
      ? `<input type="number" step="0.001" min="0" class="pos-qty-kg-input" value="${item.quantity}" onchange="updateQty(${idx}, this.value)">`
      : `<div class="pos-qty-control">
          <button class="pos-qty-btn" onclick="changeQty(${idx}, -1)">−</button>
          <span class="pos-qty-value">${item.quantity}</span>
          <button class="pos-qty-btn" onclick="changeQty(${idx}, 1)">+</button>
        </div>`;

    return `
      <div class="pos-cart-item">
        <div class="pos-cart-item-row">
          <div class="pos-cart-item-img">${categoryEmoji(item.category)}</div>
          <div class="pos-cart-item-info">
            <div class="pos-cart-item-name">${escapeHtml(item.name)}</div>
            <div class="pos-cart-item-price">${money(item.unitPrice)} ₼ × ${qty(item.quantity, item.unit)} = ${money(lineTotal)} ₼</div>
          </div>
          ${qtyControl}
          <button class="pos-cart-edit-toggle" onclick="toggleEdit(${idx})" title="Qiymət/endirim">✎</button>
          <button class="pos-cart-remove" onclick="removeItem(${idx})">🗑</button>
        </div>
        <div class="pos-cart-edit-row ${item.editOpen ? 'show' : ''}" id="edit-row-${idx}">
          <div class="pos-cart-edit-field">
            <label>Qiymət (₼)</label>
            <input type="number" step="0.01" min="0" value="${item.unitPrice}" onchange="updatePrice(${idx}, this.value)">
          </div>
          <div class="pos-cart-edit-field">
            <label>Endirim (₼)</label>
            <input type="number" step="0.01" min="0" value="${item.discount || 0}" onchange="updateDiscount(${idx}, this.value)">
          </div>
        </div>
      </div>`;
  }).join('');

  totalAmountEl.textContent = money(total) + ' ₼';
}

function changeQty(idx, delta) {
  const item = cart[idx];
  const newQty = item.quantity + delta;
  if (newQty <= 0) { removeItem(idx); return; }
  if (newQty > item.maxQuantity) { showToast('Stok kifayət etmir'); return; }
  item.quantity = newQty;
  renderCart();
}

function updateQty(idx, value) {
  const q = parseFloat(value);
  cart[idx].quantity = isNaN(q) || q < 0 ? 0 : q;
  renderCart();
}

function updatePrice(idx, value) {
  const p = parseFloat(value);
  cart[idx].unitPrice = isNaN(p) || p < 0 ? 0 : p;
  renderCart();
}

function updateDiscount(idx, value) {
  const d = parseFloat(value);
  cart[idx].discount = isNaN(d) || d < 0 ? 0 : d;
  renderCart();
}

function toggleEdit(idx) {
  cart[idx].editOpen = !cart[idx].editOpen;
  renderCart();
}

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
}

// ---------- Category & search ----------
categoriesBox.addEventListener('click', (e) => {
  const btn = e.target.closest('.pos-cat-btn');
  if (!btn) return;
  categoriesBox.querySelectorAll('.pos-cat-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.cat;
  renderProducts();
});

searchInput.addEventListener('input', renderProducts);

// ---------- Barcode ----------
async function lookupAndAddByBarcode(code) {
  scanError.textContent = '';
  if (!code) return false;
  const local = findProductByBarcode(code);
  if (local) {
    if (local.quantity <= 0) { scanError.textContent = `${local.name} anbarda yoxdur`; return false; }
    addToCart(local.id);
    return true;
  }
  try {
    const resp = await fetch('/pos/lookup?barcode=' + encodeURIComponent(code));
    const data = await resp.json();
    if (!resp.ok) { scanError.textContent = data.error || 'Mal tapılmadı'; return false; }
    PRODUCTS.push({
      id: data.id, name: data.name, barcode: data.barcode, category: data.category || 'Digər',
      unit: data.unit, salePrice: Number(data.salePrice), quantity: Number(data.quantity),
      minStock: data.minStock !== null && data.minStock !== undefined ? Number(data.minStock) : null,
    });
    addToCart(data.id);
    return true;
  } catch (err) {
    scanError.textContent = 'Şəbəkə xətası';
    return false;
  }
}

barcodeInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const code = barcodeInput.value.trim();
  barcodeInput.value = '';
  lookupAndAddByBarcode(code);
});

// ---------- Payment modal ----------
function openPayModal(type) {
  if (cart.length === 0 || cart.every((c) => c.quantity <= 0)) {
    showToast('Səbət boşdur');
    return;
  }
  currentPaymentType = type;
  selectedCustomerId = null;
  document.getElementById('pay-error').textContent = '';
  document.getElementById('selected-customer').style.display = 'none';
  document.getElementById('new-customer-fields').style.display = 'block';
  document.getElementById('new-customer-name').value = '';
  document.getElementById('new-customer-phone').value = '';
  document.getElementById('customer-search').value = '';
  document.getElementById('customer-results').innerHTML = '';

  const total = cart.reduce((s, i) => s + Math.max(0, i.quantity * i.unitPrice - (i.discount || 0)), 0);
  document.getElementById('pay-modal-total').textContent = money(total);

  const titles = { CASH: 'Nağd ödəniş', CARD: 'Kartla ödəniş', TRANSFER: 'Köçürmə ilə ödəniş', DEBT: 'Borca yazılır' };
  document.getElementById('pay-modal-title').textContent = titles[type];
  document.getElementById('customer-section').style.display = type === 'DEBT' ? 'block' : 'none';

  const modal = new bootstrap.Modal(document.getElementById('pay-modal'));
  modal.show();
}

document.getElementById('pay-modal').addEventListener('hidden.bs.modal', () => {
  barcodeInput.focus();
});

document.getElementById('customer-search').addEventListener('input', function () {
  clearTimeout(this._t);
  const q = this.value.trim();
  const box = document.getElementById('customer-results');
  if (!q) { box.innerHTML = ''; return; }
  this._t = setTimeout(async () => {
    const resp = await fetch('/pos/customers-search?q=' + encodeURIComponent(q));
    const items = await resp.json();
    box.innerHTML = '';
    items.forEach((c) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'list-group-item list-group-item-action';
      a.textContent = c.name + (c.phone ? ' — ' + c.phone : '');
      a.onclick = (e) => {
        e.preventDefault();
        selectedCustomerId = c.id;
        document.getElementById('selected-customer').style.display = 'block';
        document.getElementById('selected-customer').textContent = 'Seçildi: ' + c.name;
        document.getElementById('new-customer-fields').style.display = 'none';
        box.innerHTML = '';
      };
      box.appendChild(a);
    });
  }, 250);
});

async function submitCheckout() {
  const items = cart.filter((c) => c.quantity > 0).map((c) => ({
    productId: c.productId,
    quantity: c.quantity,
    unitPrice: c.unitPrice,
    discount: c.discount || 0,
  }));
  const payload = { items, paymentType: currentPaymentType, note: document.getElementById('sale-note').value };

  if (currentPaymentType === 'DEBT') {
    if (selectedCustomerId) {
      payload.customerId = selectedCustomerId;
    } else {
      const name = document.getElementById('new-customer-name').value.trim();
      if (!name) {
        document.getElementById('pay-error').textContent = 'Müştəri seçin və ya adını daxil edin';
        return;
      }
      payload.customerName = name;
      payload.customerPhone = document.getElementById('new-customer-phone').value.trim();
    }
  }

  try {
    const resp = await fetch('/pos/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      document.getElementById('pay-error').textContent = data.error || 'Xəta baş verdi';
      return;
    }

    // Reflect sold quantities locally so the grid/stock badges stay accurate without a reload.
    items.forEach((it) => {
      const p = findProduct(it.productId);
      if (p) p.quantity = Math.max(0, p.quantity - it.quantity);
    });

    cart = [];
    document.getElementById('sale-note').value = '';
    renderCart();
    renderProducts();
    renderFavorites();

    lastSaleId = data.saleId;
    document.getElementById('success-receipt-no').textContent = '#' + data.saleId;

    const payModalEl = document.getElementById('pay-modal');
    payModalEl.addEventListener('hidden.bs.modal', function showSuccess() {
      payModalEl.removeEventListener('hidden.bs.modal', showSuccess);
      new bootstrap.Modal(document.getElementById('success-modal')).show();
    });
    bootstrap.Modal.getInstance(payModalEl).hide();
  } catch (err) {
    document.getElementById('pay-error').textContent = 'Şəbəkə xətası';
  }
}

document.getElementById('success-print-btn').addEventListener('click', () => {
  if (lastSaleId) window.open('/pos/receipt/' + lastSaleId, '_blank');
});

document.getElementById('success-modal').addEventListener('hidden.bs.modal', () => {
  barcodeInput.focus();
});

// ---------- Kamera ilə barkod skan ----------
const cameraScanBtn = document.getElementById('pos-camera-btn');
const scanModalEl = document.getElementById('scan-modal');
const scanVideo = document.getElementById('scan-video');
const scanModalStatus = document.getElementById('scan-modal-status');
const scanModalLast = document.getElementById('scan-modal-last');

let scanModal = null;
let scanStream = null;
let scanRafId = null;
let barcodeDetector = null;
let lastScannedCode = null;
let lastScannedAt = 0;

if (cameraScanBtn && scanModalEl) {
  cameraScanBtn.addEventListener('click', startCameraScan);
  scanModalEl.addEventListener('hidden.bs.modal', stopCameraScan);
}

async function startCameraScan() {
  if (!scanModal) {
    scanModal = new bootstrap.Modal(scanModalEl);
  }
  scanModalLast.style.display = 'none';
  scanModalLast.textContent = '';
  lastScannedCode = null;

  if (!('BarcodeDetector' in window)) {
    scanModalStatus.textContent = 'Bu brauzer kamera ilə skanı dəstəkləmir. Google Chrome (Android) istifadə edin.';
    scanModal.show();
    return;
  }

  try {
    barcodeDetector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
    });
  } catch (err) {
    scanModalStatus.textContent = 'Barkod oxuyucu başladıla bilmədi.';
    scanModal.show();
    return;
  }

  scanModalStatus.textContent = 'Kamera açılır...';
  scanModal.show();

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    scanVideo.srcObject = scanStream;
    await scanVideo.play();
    scanModalStatus.textContent = 'Barkodu kameraya tutun...';
    scanRafId = requestAnimationFrame(scanFrame);
  } catch (err) {
    scanModalStatus.textContent = 'Kameraya icazə verilmədi və ya kamera tapılmadı.';
  }
}

async function scanFrame() {
  if (!scanStream) return;
  try {
    const barcodes = await barcodeDetector.detect(scanVideo);
    if (barcodes.length) {
      const code = barcodes[0].rawValue;
      const now = Date.now();
      if (code !== lastScannedCode || now - lastScannedAt > 2000) {
        lastScannedCode = code;
        lastScannedAt = now;
        const ok = await lookupAndAddByBarcode(code);
        if (ok) {
          scanModalLast.style.display = 'block';
          scanModalLast.textContent = 'Əlavə edildi: ' + code;
        }
      }
    }
  } catch (err) {
    // frame ötürüldü, davam et
  }
  if (scanStream) {
    scanRafId = requestAnimationFrame(scanFrame);
  }
}

function stopCameraScan() {
  if (scanRafId) {
    cancelAnimationFrame(scanRafId);
    scanRafId = null;
  }
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  scanVideo.srcObject = null;
}

// ---------- INIT ----------
renderFavorites();
renderProducts();
renderCart();
