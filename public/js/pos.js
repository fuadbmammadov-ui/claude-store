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
    const lineTotal = item.quantity * item.unitPrice;
    total += lineTotal;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.name}</td>
      <td style="width: 110px;">
        <input type="number" step="${item.unit === 'KG' ? '0.001' : '1'}" min="0" value="${item.quantity}"
          class="form-control form-control-sm" onchange="updateQty(${idx}, this.value)">
        <small class="text-muted">${item.unit === 'KG' ? 'kq' : 'ədəd'}</small>
      </td>
      <td>${money(item.unitPrice)}</td>
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

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
}

barcodeInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const code = barcodeInput.value.trim();
  barcodeInput.value = '';
  scanError.textContent = '';
  if (!code) return;
  try {
    const resp = await fetch('/pos/lookup?barcode=' + encodeURIComponent(code));
    const data = await resp.json();
    if (!resp.ok) {
      scanError.textContent = data.error || 'Xəta';
      return;
    }
    addToCart(data);
  } catch (err) {
    scanError.textContent = 'Şəbəkə xətası';
  }
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

  const total = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  document.getElementById('pay-modal-total').textContent = money(total);

  const titles = { CASH: 'Nağd ödəniş', CARD: 'Kartla ödəniş', DEBT: 'Borca yazılır' };
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
  const items = cart.filter((c) => c.quantity > 0).map((c) => ({ productId: c.productId, quantity: c.quantity }));
  const payload = { items, paymentType: currentPaymentType };

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
    renderCart();
    window.open('/pos/receipt/' + data.saleId, '_blank');
    barcodeInput.focus();
  } catch (err) {
    document.getElementById('pay-error').textContent = 'Şəbəkə xətası';
  }
}
