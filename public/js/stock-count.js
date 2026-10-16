(function () {
  const root = document.getElementById('stock-count');
  if (!root) return;
  const countId = root.dataset.countId;
  const editable = root.dataset.editable === '1';
  const statusEl = document.getElementById('sc-status');
  const rows = Array.from(document.querySelectorAll('#sc-table tbody tr'));

  // az-AZ formatı (1.234,5) — brauzerin lokal dəstəyindən asılı olmasın deyə əl ilə.
  function groupInt(str) { return str.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtNum(n, minFrac, maxFrac) {
    const neg = n < 0;
    let [i, f = ''] = Math.abs(n).toFixed(maxFrac).split('.');
    f = f.replace(/0+$/, '');
    while (f.length < minFrac) f += '0';
    return (neg ? '-' : '') + groupInt(i) + (f ? ',' + f : '');
  }
  function fmtQty(n, unit) {
    if (unit === 'KG') return fmtNum(n, 0, 3) + ' kq';
    return fmtNum(Math.round(n), 0, 0);
  }
  function fmtMoney(n) { return fmtNum(Number(n || 0), 2, 2); }
  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'ms-auto small align-self-center ' + (isError ? 'text-danger' : 'text-muted');
  }

  function paintRow(tr, item) {
    const unit = tr.dataset.unit;
    const d = item.delta;
    tr.classList.remove('table-danger', 'table-success');
    let state = 'uncounted';
    if (d !== null) {
      state = d < 0 ? 'shortage' : d > 0 ? 'surplus' : 'match';
      if (d < 0) tr.classList.add('table-danger');
      if (d > 0) tr.classList.add('table-success');
    }
    tr.dataset.state = state;
    tr.querySelector('[data-col="delta"]').textContent = d === null ? '' : (d > 0 ? '+' : '') + fmtQty(d, unit);
    tr.querySelector('[data-col="system"]').textContent = fmtQty(item.systemQty, unit) + (unit === 'KG' ? '' : ' əd.');
  }

  function paintSummary(s) {
    const set = (k, v) => { const el = document.querySelector('[data-sum="' + k + '"]'); if (el) el.textContent = v; };
    set('counted', s.counted);
    set('matched', s.matched);
    set('shortageCount', s.shortageCount);
    set('surplusCount', s.surplusCount);
    set('shortageValue', fmtMoney(s.shortageValue));
    set('surplusValue', fmtMoney(s.surplusValue));
  }

  async function save(tr, payload, input) {
    setStatus('Yadda saxlanılır…');
    input.classList.remove('is-invalid', 'is-valid');
    try {
      const res = await fetch('/stock-counts/' + countId + '/items/' + tr.dataset.itemId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Server cavabı oxunmadı.' }));
      if (!res.ok || !data.ok) {
        input.classList.add('is-invalid');
        setStatus(data.error || 'Xəta baş verdi.', true);
        return false;
      }
      input.dataset.saved = input.value;
      input.classList.add('is-valid');
      setTimeout(() => input.classList.remove('is-valid'), 1200);
      paintRow(tr, data.item);
      paintSummary(data.summary);
      setStatus('Yadda saxlanıldı');
      return true;
    } catch (e) {
      input.classList.add('is-invalid');
      setStatus('İnternet bağlantısı yoxdur — yenidən cəhd edin.', true);
      return false;
    }
  }

  function visibleQtyInputs() {
    return rows.filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.sc-qty')).filter(Boolean);
  }

  if (editable) {
    rows.forEach((tr) => {
      const qtyInput = tr.querySelector('.sc-qty');
      const noteInput = tr.querySelector('.sc-note');
      [qtyInput, noteInput].forEach((inp) => { if (inp) inp.dataset.saved = inp.value; });

      qtyInput.addEventListener('change', () => {
        if (qtyInput.value === qtyInput.dataset.saved) return;
        save(tr, { countedQty: qtyInput.value }, qtyInput);
      });
      qtyInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const list = visibleQtyInputs();
        const next = list[list.indexOf(qtyInput) + 1];
        // Fokus dəyişəndə "change" hadisəsi işə düşür və say yadda saxlanılır.
        if (next) { next.focus(); next.select(); } else { qtyInput.blur(); }
      });
      noteInput.addEventListener('change', () => {
        if (noteInput.value === noteInput.dataset.saved) return;
        save(tr, { note: noteInput.value }, noteInput);
      });
    });

    window.addEventListener('beforeunload', (e) => {
      const dirty = rows.some((tr) => Array.from(tr.querySelectorAll('input')).some((i) => i.value !== i.dataset.saved));
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    const applyForm = document.getElementById('sc-apply-form');
    if (applyForm) {
      applyForm.addEventListener('submit', (e) => {
        const counted = rows.filter((r) => r.dataset.state !== 'uncounted').length;
        const diff = rows.filter((r) => r.dataset.state === 'shortage' || r.dataset.state === 'surplus').length;
        if (!counted) { e.preventDefault(); alert('Hələ heç bir mal sayılmayıb.'); return; }
        if (!confirm(counted + ' mal sayılıb, ' + diff + ' malda fərq var.\nAnbar qalıqları düzəldilsin? (kassaya təsiri yoxdur)')) e.preventDefault();
      });
    }
  }

  // Filtrlər
  const search = document.getElementById('sc-search');
  const cat = document.getElementById('sc-category');
  const filter = document.getElementById('sc-filter');
  function applyFilters() {
    const q = (search.value || '').toLocaleLowerCase('az-AZ').trim();
    const c = cat.value;
    const f = filter.value;
    rows.forEach((tr) => {
      const st = tr.dataset.state;
      let ok = (!q || tr.dataset.name.includes(q)) && (!c || tr.dataset.category === c);
      if (ok && f === 'uncounted') ok = st === 'uncounted';
      if (ok && f === 'diff') ok = st === 'shortage' || st === 'surplus';
      if (ok && f === 'shortage') ok = st === 'shortage';
      if (ok && f === 'surplus') ok = st === 'surplus';
      tr.style.display = ok ? '' : 'none';
    });
  }
  [search, cat, filter].forEach((el) => el && el.addEventListener('input', applyFilters));
})();
