const DAIRY_ALERT_DAYS = 3;

// "Süd məhsulları" kateqoriyası hər yerdə eyni qaydada tanınsın deyə.
function isDairyCategory(category) {
  return (category || '').toLocaleLowerCase('az-AZ').includes('süd məhsul');
}

// Hər malın son mal qəbulu tarixindən (yoxdursa yaradılma tarixindən)
// neçə gün keçdiyini hesablayır.
async function getProductsWithStockAge(prisma, where = {}, orderBy = { name: 'asc' }) {
  const products = await prisma.product.findMany({ where: { active: true, ...where }, orderBy });
  if (!products.length) return [];

  const receiptDates = await prisma.stockReceipt.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((p) => p.id) } },
    _max: { createdAt: true },
  });
  const lastReceiptMap = new Map(receiptDates.map((r) => [r.productId, r._max.createdAt]));

  const now = Date.now();
  return products.map((p) => {
    const referenceDate = lastReceiptMap.get(p.id) || p.createdAt;
    const daysInStock = Math.floor((now - new Date(referenceDate).getTime()) / 86400000);
    const dairy = isDairyCategory(p.category);
    return { ...p, daysInStock, isDairy: dairy, stockAlert: dairy && daysInStock >= DAIRY_ALERT_DAYS };
  });
}

// Yalnız 3+ gündür stokda olan süd məhsullarını qaytarır (ən köhnə əvvəldə).
async function getDairyStockAlerts(prisma) {
  const products = await getProductsWithStockAge(prisma, { category: { not: null } });
  return products
    .filter((p) => p.stockAlert)
    .sort((a, b) => b.daysInStock - a.daysInStock);
}

module.exports = { DAIRY_ALERT_DAYS, isDairyCategory, getProductsWithStockAge, getDairyStockAlerts };
