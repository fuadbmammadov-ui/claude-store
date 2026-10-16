// Anbar sayımı (audit) üçün təmiz hesablama funksiyaları — DB-dən asılı deyil, test olunur.

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

// Daxil edilən say mətnini rəqəmə çevirir: "2,5" və "2.5" eyni qəbul olunur.
// Boş mətn → null (sayılmayıb). Mənfi və ya rəqəm olmayan dəyər → undefined (səhv).
function parseCountedQty(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  return round3(Number(s));
}

// Ədədlə satılan mal üçün say tam olmalıdır.
function isValidForUnit(value, unit) {
  if (value === null) return true;
  if (unit === 'PIECE') return Number.isInteger(value);
  return true;
}

// Fərq = real − sistem (sayıldığı an). Müsbət → artıq, mənfi → əskik.
function itemDelta(item) {
  if (item.countedQty === null || item.countedQty === undefined) return null;
  return round3(Number(item.countedQty) - Number(item.systemQty));
}

// Tətbiq zamanı yeni qalıq: indiki qalıq + fərq. Beləliklə sayımdan SONRA edilən
// satışlar/qəbullar itmir. Nəticə mənfi ola bilməz.
function newQuantityOnApply(currentQty, item) {
  const d = itemDelta(item);
  if (d === null) return round3(currentQty);
  return Math.max(0, round3(Number(currentQty) + d));
}

function summarize(items) {
  const s = {
    total: items.length,
    counted: 0,
    matched: 0,
    shortageCount: 0,
    surplusCount: 0,
    shortageValue: 0,
    surplusValue: 0,
  };
  for (const it of items) {
    const d = itemDelta(it);
    if (d === null) continue;
    s.counted += 1;
    const value = Math.round(d * Number(it.purchasePrice || 0) * 100) / 100;
    if (d === 0) s.matched += 1;
    else if (d < 0) { s.shortageCount += 1; s.shortageValue += -value; }
    else { s.surplusCount += 1; s.surplusValue += value; }
  }
  s.shortageValue = Math.round(s.shortageValue * 100) / 100;
  s.surplusValue = Math.round(s.surplusValue * 100) / 100;
  s.netValue = Math.round((s.surplusValue - s.shortageValue) * 100) / 100;
  s.uncounted = s.total - s.counted;
  return s;
}

module.exports = { parseCountedQty, isValidForUnit, itemDelta, newQuantityOnApply, summarize, round3 };
