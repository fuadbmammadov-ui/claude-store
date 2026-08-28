let cart = [];
let selectedCustomerId = null;
let currentPaymentType = null;

const barcodeInput = document.getElementById('barcode-input');
const nameSearch = document.getElementById('name-search');
const searchResults = document.getElementById('search-results');
const cartBody = document.getElementById('cart-body');
const cartTotalEl = document.getElementById('cart-total');
const scanError = document.getElementById('scan-error');

function money(n) {
  return Number(n || 0).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addToCart(product) {
  const existing = cart.find((c) => c.productId === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      unitPrice: Number(product.salePrice),
      discount: 0,
      quantity: product.unit === 'KG' ? 0 : 1,
      maxQuantity: Number(product.quantity),
    });
  }
  renderCart();
}

function renderCart() {
  cartBody.innerHTML = '';
  let total = 0;
  cart.forEach((item, idx) => {
    const lineTotal = Math.max(0, item.quantity * item.unitPrice - (item.discount || 0));
    total += lineTotal;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.name}</td>
      <td style="width: 100px;">
        <input type="number" step="${item.unit === 'KG' ? '0.001' : '1'}" min="0" value="${item.quantity}"
          class="form-control form-control-sm" onchange="updateQty(${idx}, this.value)">
        <small class="text-muted">${item.unit === 'KG' ? 'kq' : 'ədəd'}</small>
      </td>
      <td style="width: 90px;">
        <input type="number" step="0.01" min="0" value="${item.unitPrice}"
          class="form-control form-control-sm" onchange="updatePrice(${idx}, this.value)">
      </td>
      <td style="width: 90px;">
        <input type="number" step="0.01" min="0" value="${item.discount || 0}"
          class="form-control form-control-sm" onchange="updateDiscount(${idx}, this.value)">
      </td>
      <td>${money(lineTotal)}</td>
      <td><button class="btn btn-sm btn-outline-danger" onclick="removeItem(${idx})">×</button></td>
    `;
    cartBody.appendChild(tr);
  });
  cartTotalEl.textContent = money(total);
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

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
}

async function lookupAndAddToCart(code) {
  scanError.textContent = '';
  if (!code) return;
  try {
    const resp = await fetch('/pos/lookup?barcode=' + encodeURIComponent(code));
    const data = await resp.json();
    if (!resp.ok) {
      scanError.textContent = data.error || 'Xəta';
      return false;
    }
    addToCart(data);
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
  lookupAndAddToCart(code);
});

let searchTimer;
nameSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = nameSearch.value.trim();
  if (!q) {
    searchResults.innerHTML = '';
    return;
  }
  searchTimer = setTimeout(async () => {
    const resp = await fetch('/pos/search?q=' + encodeURIComponent(q));
    const items = await resp.json();
    searchResults.innerHTML = '';
    items.forEach((p) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'list-group-item list-group-item-action';
      a.textContent = `${p.name} — ${money(p.salePrice)} ₼ (qalıq: ${p.quantity})`;
      a.onclick = (e) => {
        e.preventDefault();
        addToCart(p);
        nameSearch.value = '';
        searchResults.innerHTML = '';
      };
      searchResults.appendChild(a);
    });
  }, 250);
});

document.querySelectorAll('.quick-pick-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    addToCart({
      id: Number(btn.dataset.id),
      name: btn.dataset.name,
      unit: btn.dataset.unit,
      salePrice: Number(btn.dataset.price),
      quantity: Number(btn.dataset.qty),
    });
  });
});

function openPayModal(type) {
  if (cart.length === 0 || cart.every((c) => c.quantity <= 0)) {
    alert('Səbət boşdur');
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
    bootstrap.Modal.getInstance(document.getElementById('pay-modal')).hide();
    cart = [];
    document.getElementById('sale-note').value = '';
    renderCart();
    window.open('/pos/receipt/' + data.saleId, '_blank');
    barcodeInput.focus();
  } catch (err) {
    document.getElementById('pay-error').textContent = 'Şəbəkə xətası';
  }
}

// --- Kamera ilə barkod skan ---
const cameraScanBtn = document.getElementById('camera-scan-btn');
const scanModalEl = document.getElementById('scan-modal');
const scanVideo = document.getElementById('scan-video');
const scanModalStatus = document.getElementById('scan-modal-status');
const scanModalLast = document.getElementById('scan-modal-last');

let scanModal;
let scanStream = null;
let scanRafId = null;
let barcodeDetector = null;
let lastScannedCode = null;
let lastScannedAt = 0;

if (cameraScanBtn && scanModalEl) {
  scanModal = new bootstrap.Modal(scanModalEl);

  cameraScanBtn.addEventListener('click', startCameraScan);
  scanModalEl.addEventListener('hidden.bs.modal', stopCameraScan);
}

async function startCameraScan() {
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
        const ok = await lookupAndAddToCart(code);
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
