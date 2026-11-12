function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value, unit) {
  const n = Number(value || 0);
  if (unit === 'KG') return n.toLocaleString('az-AZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return n.toLocaleString('az-AZ', { maximumFractionDigits: 3 });
}

// Report-table quantity formatting: piece-based items are always whole units ("27"),
// weight-based items show a trimmed comma-decimal with the unit suffix ("3,75 kq") instead
// of a fixed 3-decimal dot-format ("3.750") that reads as ambiguous/foreign in az-AZ.
function qtyReport(value, unit) {
  const n = Number(value || 0);
  if (unit === 'KG') {
    return `${n.toLocaleString('az-AZ', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} kq`;
  }
  return Math.round(n).toLocaleString('az-AZ');
}

const DELIVERY_SLOT_LABELS = {
  SLOT_9_13: '09:00 – 13:00',
  SLOT_13_18: '13:00 – 18:00',
  SLOT_18_22: '18:00 – 22:00',
};

function deliverySlotLabel(slot) {
  return DELIVERY_SLOT_LABELS[slot] || slot;
}

module.exports = { money, qty, qtyReport, deliverySlotLabel, DELIVERY_SLOT_LABELS };
