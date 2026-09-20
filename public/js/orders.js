const PRODUCTS = window.ORDER_PRODUCTS || [];
let ORDER_ID = window.ORDER_ID;
const ORDER_STATUS = window.ORDER_STATUS || 'DRAFT';

let cart = (window.ORDER_EXISTING_ITEMS || []).map((it) => ({
  productId: it.productId,
  name: it.name,
  category: it.category,
  unit: it.unit,
  quantity: it.quantity,
  purchasePrice: it.purchasePrice,
}));
let currentCategory = 'all';

const searchInput = document.getElementById('ord-search');
const categoriesBox = document.getElementById('ord-categories');
const grid = document.getElementById('ord-products-grid');
const currentCategoryEl = document.getElementById('ord-current-category');
const productsCountEl = document.getElementById('ord-products-count');
const cartItemsBox = document.getElementById('ord-cart-items');
const cartCountEl = document.getElementById('ord-cart-count');
const totalAmountEl = document.getElementById('ord-total-amount');
const errorEl = document.getElementById('ord-error');
const saveStatusEl = document.getElementById('ord-save-status');
const supplierInput = document.getElementById('ord-supplier');
const noteInput = document.getElementById('ord-note');
const paidAmountInput = document.getElementById('ord-paid-amount');

function money(n) {
  return Number(n || 0).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyLabel(unit) {
  return unit === 'KG' ? 'kq' : 'ədəd';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

function renderProducts() {
  const search = searchInput.value.trim().toLowerCase();
  let filtered = PRODUCTS;
  if (currentCategory !== 'all') filtered = filtered.filter((p) => p.category === currentCategory);
  if (search) filtered = filtered.filter((p) => p.name.toLowerCase().includes(search));

  productsCountEl.textContent = filtered.length + ' mal';
  currentCategoryEl.textContent = currentCategory === 'all' ? 'Bütün mallar' : currentCategory;

  grid.innerHTML = filtered.map((p) => `
    <div class="ord-product-card" onclick="addToCart(${p.id})">
      <div class="ord-product-name">${escapeHtml(p.name)}</div>
      <div class="ord-product-price">Son alış: ${money(p.purchasePrice)} ₼</div>
    </div>`).join('');
}

function addToCart(id) {
  const product = findProduct(id);
  if (!product) return;
  const existing = cart.find((c) => c.productId === product.id);
  if (existing) {
    if (product.unit !== 'KG') existing.quantity += 1;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      unit: product.unit,
      quantity: product.unit === 'KG' ? 0 : 1,
      purchasePrice: Number(product.purchasePrice),
    });
  }
  renderCart();
  scheduleAutosave();
}

function renderCart() {
  cartCountEl.textContent = cart.length + ' mal';

  if (cart.length === 0) {
    cartItemsBox.innerHTML = `
      <div class="ord-empty-cart" id="ord-empty-cart">
        <div style="font-size:38px; opacity:.4;">📦</div>
        <p class="mb-0">Sifariş siyahısı boşdur</p>
        <p class="small">Soldan mal seçərək əlavə edin</p>
      </div>`;
    totalAmountEl.textContent = '0.00 ₼';
    return;
  }

  let total = 0;
  cartItemsBox.innerHTML = cart.map((item, idx) => {
    const lineTotal = Math.max(0, item.quantity * item.purchasePrice);
    total += lineTotal;
    return `
      <div class="ord-cart-item">
        <div class="d-flex justify-content-between align-items-start">
          <div class="ord-cart-item-name">${escapeHtml(item.name)}</div>
          <button class="ord-cart-remove" onclick="removeItem(${idx})">🗑</button>
        </div>
        <div class="ord-cart-item-row">
          <div class="ord-cart-item-field">
            <label>Miqdar (${qtyLabel(item.unit)})</label>
            <input type="number" step="${item.unit === 'KG' ? '0.001' : '1'}" min="0" value="${item.quantity}" onchange="updateQty(${idx}, this.value)">
          </div>
          <div class="ord-cart-item-field">
            <label>Qiymət (₼)</label>
            <input type="number" step="0.01" min="0" value="${item.purchasePrice}" onchange="updatePrice(${idx}, this.value)">
          </div>
        </div>
        <div class="ord-cart-item-total">${money(lineTotal)} ₼</div>
      </div>`;
  }).join('');

  totalAmountEl.textContent = money(total) + ' ₼';
}

function updateQty(idx, value) {
  const q = parseFloat(value);
  cart[idx].quantity = isNaN(q) || q < 0 ? 0 : q;
  renderCart();
  scheduleAutosave();
}

function updatePrice(idx, value) {
  const p = parseFloat(value);
  cart[idx].purchasePrice = isNaN(p) || p < 0 ? 0 : p;
  renderCart();
  scheduleAutosave();
}

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
  scheduleAutosave();
}

categoriesBox.addEventListener('click', (e) => {
  const btn = e.target.closest('.ord-cat-btn');
  if (!btn) return;
  categoriesBox.querySelectorAll('.ord-cat-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.cat;
  renderProducts();
});

searchInput.addEventListener('input', renderProducts);
supplierInput.addEventListener('change', scheduleAutosave);
noteInput.addEventListener('change', scheduleAutosave);
if (paidAmountInput) paidAmountInput.addEventListener('change', scheduleAutosave);

function buildPayload() {
  const payload = {
    supplierName: supplierInput.value.trim(),
    note: noteInput.value.trim(),
    items: cart.filter((c) => c.quantity > 0).map((c) => ({
      productId: c.productId,
      quantity: c.quantity,
      purchasePrice: c.purchasePrice,
    })),
  };
  if (paidAmountInput) {
    const p = parseFloat(paidAmountInput.value);
    payload.paidAmount = isNaN(p) || p < 0 ? 0 : p;
  }
  return payload;
}

let autosaveTimer = null;

function scheduleAutosave() {
  errorEl.textContent = '';
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(persistDraft, 600);
}

// Saves the current basket to the server as-is. Never confirms — confirming
// only ever happens from the explicit "Təsdiqlə" button.
async function persistDraft() {
  const payload = buildPayload();

  if (!ORDER_ID && payload.items.length === 0) {
    return; // nothing to persist yet
  }

  saveStatusEl.textContent = 'Yadda saxlanılır...';
  try {
    if (!ORDER_ID) {
      const resp = await fetch('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) { errorEl.textContent = data.error || 'Xəta baş verdi'; saveStatusEl.textContent = ''; return; }
      ORDER_ID = data.id;
      window.history.replaceState(null, '', '/orders/' + ORDER_ID);
    } else {
      const resp = await fetch('/orders/' + ORDER_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) { errorEl.textContent = data.error || 'Xəta baş verdi'; saveStatusEl.textContent = ''; return; }
    }
    const now = new Date();
    saveStatusEl.textContent = 'Yadda saxlanıldı · ' + now.toLocaleTimeString('az-AZ');
  } catch (err) {
    saveStatusEl.textContent = '';
    errorEl.textContent = 'Şəbəkə xətası — dəyişiklik yadda saxlanmadı';
  }
}

async function confirmOrder() {
  errorEl.textContent = '';
  if (autosaveTimer) clearTimeout(autosaveTimer);

  const payload = buildPayload();
  if (!payload.items.length) { errorEl.textContent = 'Siyahıda mal yoxdur'; return; }
  if (!confirm('Sifariş təsdiqlənsin? Mallar anbara əlavə olunacaq və təchizatçı adına borc yaranacaq.')) return;

  await persistDraft();
  if (!ORDER_ID) { errorEl.textContent = 'Sifariş yadda saxlanmadı, yenidən cəhd edin'; return; }

  try {
    const resp = await fetch('/orders/' + ORDER_ID + '/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) { errorEl.textContent = data.error || 'Xəta baş verdi'; return; }
    window.location.href = data.redirect;
  } catch (err) {
    errorEl.textContent = 'Şəbəkə xətası';
  }
}

const confirmBtn = document.getElementById('ord-confirm-btn');
if (confirmBtn) confirmBtn.addEventListener('click', confirmOrder);

const cancelBtn = document.getElementById('ord-cancel-btn');
if (cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    const msg = ORDER_STATUS === 'CONFIRMED'
      ? 'Sifariş ləğv edilsin? Anbara əlavə olunan mallar geri götürüləcək və təchizatçı borcu silinəcək.'
      : 'Sifariş ləğv edilsin?';
    if (!confirm(msg)) return;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/orders/' + ORDER_ID + '/cancel';
    document.body.appendChild(form);
    form.submit();
  });
}

renderProducts();
renderCart();
