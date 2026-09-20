const PRODUCTS = window.ORDER_PRODUCTS || [];
const ORDER_ID = window.ORDER_ID;

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
    return;
  }
  cart.push({
    productId: product.id,
    name: product.name,
    category: product.category,
    unit: product.unit,
    quantity: product.unit === 'KG' ? 0 : 1,
    purchasePrice: Number(product.purchasePrice),
  });
  renderCart();
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
}

function updatePrice(idx, value) {
  const p = parseFloat(value);
  cart[idx].purchasePrice = isNaN(p) || p < 0 ? 0 : p;
  renderCart();
}

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
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

function buildPayload() {
  return {
    supplierName: document.getElementById('ord-supplier').value.trim(),
    note: document.getElementById('ord-note').value.trim(),
    items: cart.filter((c) => c.quantity > 0).map((c) => ({
      productId: c.productId,
      quantity: c.quantity,
      purchasePrice: c.purchasePrice,
    })),
  };
}

async function saveDraft() {
  errorEl.textContent = '';
  const payload = buildPayload();
  try {
    if (ORDER_ID) {
      const resp = await fetch('/orders/' + ORDER_ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) { errorEl.textContent = data.error || 'Xəta baş verdi'; return; }
      window.location.reload();
    } else {
      const form = document.createElement('form');
      form.method = 'post';
      form.action = '/orders';
      const fields = { supplierName: payload.supplierName, note: payload.note };
      Object.entries(fields).forEach(([k, v]) => {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = k; input.value = v;
        form.appendChild(input);
      });
      payload.items.forEach((item, i) => {
        ['productId', 'quantity', 'purchasePrice'].forEach((key) => {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = `items[${i}][${key}]`; input.value = item[key];
          form.appendChild(input);
        });
      });
      document.body.appendChild(form);
      form.submit();
    }
  } catch (err) {
    errorEl.textContent = 'Şəbəkə xətası';
  }
}

async function confirmOrder() {
  errorEl.textContent = '';
  const payload = buildPayload();
  if (!payload.items.length) { errorEl.textContent = 'Siyahıda mal yoxdur'; return; }
  if (!confirm('Sifariş təsdiqlənsin? Mallar anbara əlavə olunacaq və təchizatçı adına borc yaranacaq.')) return;

  try {
    let orderId = ORDER_ID;
    if (!orderId) {
      const createResp = await fetch('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const createData = await createResp.json();
      if (!createResp.ok) { errorEl.textContent = createData.error || 'Xəta baş verdi'; return; }
      orderId = createData.id;
    }

    const resp = await fetch('/orders/' + orderId + '/confirm', {
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

document.getElementById('ord-save-btn').addEventListener('click', saveDraft);
document.getElementById('ord-confirm-btn').addEventListener('click', confirmOrder);

const cancelBtn = document.getElementById('ord-cancel-btn');
if (cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    if (!confirm('Sifariş ləğv edilsin?')) return;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/orders/' + ORDER_ID + '/cancel';
    document.body.appendChild(form);
    form.submit();
  });
}

renderProducts();
renderCart();
