function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value, unit) {
  const n = Number(value || 0);
  if (unit === 'KG') return n.toLocaleString('az-AZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return n.toLocaleString('az-AZ', { maximumFractionDigits: 3 });
}

module.exports = { money, qty };
