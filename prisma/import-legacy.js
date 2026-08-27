const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');
const { generateUniqueBarcode } = require('../src/utils/barcode');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

function toUnit(rawUnit) {
  const u = (rawUnit || '').trim().toLowerCase();
  if (u === 'kq' || u === 'kg') return 'KG';
  return 'PIECE';
}

function toActive(rawActive) {
  const a = (rawActive || '').trim().toLowerCase();
  if (a === 'deaktiv') return false;
  return true;
}

async function main() {
  const existingReceipts = await prisma.stockReceipt.count();
  if (existingReceipts > 0) {
    console.log('Köhnə mağaza məlumatları artıq import edilib, keçirilir.');
    return;
  }

  const dataPath = path.join(__dirname, 'legacy-data.json');
  if (!fs.existsSync(dataPath)) {
    console.log('legacy-data.json tapılmadı, import atlanıldı.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) {
    console.log('Admin istifadəçi tapılmadı, import atlanıldı.');
    return;
  }

  const receiptsSorted = [...data.receipts].filter((r) => r.product).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const salesSorted = [...data.sales].filter((s) => s.product).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // --- backfill maps: last known price per product name, in chronological order ---
  const lastPurchasePriceByName = {};
  receiptsSorted.forEach((r) => {
    const p = Number(r.unitPrice);
    if (p > 0) lastPurchasePriceByName[r.product] = p;
  });
  const lastSalePriceByName = {};
  salesSorted.forEach((s) => {
    const p = Number(s.unitPrice);
    if (p > 0) lastSalePriceByName[s.product] = p;
  });

  const nameToId = {};
  const warnings = [];
  let created = 0;

  for (const p of data.products) {
    if (!p.name) continue;

    const unit = toUnit(p.unit);
    let purchasePrice = Number(p.purchasePrice);
    if (!purchasePrice || Number.isNaN(purchasePrice)) {
      purchasePrice = lastPurchasePriceByName[p.name] || 0;
    }
    let salePrice = Number(p.salePrice);
    if (!salePrice || Number.isNaN(salePrice)) {
      salePrice = lastSalePriceByName[p.name] || purchasePrice;
      if (salePrice === purchasePrice) {
        warnings.push(`${p.name}: satış qiyməti tapılmadı, alış qiymətinə (${purchasePrice} AZN) bərabər qoyuldu — mütləq yoxlayın.`);
      }
    }
    const minStock = p.minStock ? round3(p.minStock) : null;

    const barcode = await generateUniqueBarcode();

    const product = await prisma.product.create({
      data: {
        name: p.name,
        barcode,
        unit,
        purchasePrice: round2(purchasePrice),
        salePrice: round2(salePrice),
        quantity: 0,
        minStock,
        active: toActive(p.active),
      },
    });
    nameToId[p.name] = product.id;
    created++;
  }
  console.log(`${created} mal yaradıldı (BirDad_Mini_ERP.xlsx-dən).`);

  // Cari stoku (Anbar səhifəsindəki kimi) sadə cəm şəklində hesablamaq üçün — ardıcıllıqla
  // artırıb-azaltmaq eyni günə aid sətirlərin sırası bəlli olmadığından yanlış nəticə verə bilər.
  const receivedTotal = {};
  const soldTotal = {};
  const lastPurchasePriceApplied = {};

  // --- replay historical stock receipts (mal qəbulları) ---
  let receiptCount = 0;
  for (let i = 0; i < receiptsSorted.length; i++) {
    const r = receiptsSorted[i];
    const productId = nameToId[r.product];
    if (!productId) {
      warnings.push(`Alış sətri "${r.product}" (${r.po}) üçün uyğun mal tapılmadı, keçirildi.`);
      continue;
    }
    const qty = round3(r.qty);
    if (!qty || qty <= 0) continue;
    const unitPrice = round2(r.unitPrice) || 0;
    const createdAt = new Date(`${r.date}T09:${String(i % 60).padStart(2, '0')}:00Z`);

    await prisma.stockReceipt.create({
      data: {
        productId,
        quantity: qty,
        purchasePrice: unitPrice,
        supplierName: r.supplier || null,
        receivedById: admin.id,
        createdAt,
      },
    });

    receivedTotal[r.product] = (receivedTotal[r.product] || 0) + qty;
    lastPurchasePriceApplied[r.product] = unitPrice;
    receiptCount++;
  }
  console.log(`${receiptCount} mal qəbulu qeydə alındı.`);

  // --- replay historical sales (satışlar) ---
  let saleCount = 0;
  for (let i = 0; i < salesSorted.length; i++) {
    const s = salesSorted[i];
    const productId = nameToId[s.product];
    if (!productId) {
      warnings.push(`Satış sətri "${s.product}" (${s.saleNo}) üçün uyğun mal tapılmadı, keçirildi.`);
      continue;
    }
    const qty = round3(s.qty);
    if (!qty || qty <= 0) continue;

    const unit = toUnit(s.unit);
    const unitPrice = round2(s.unitPrice) || 0;
    const lineTotal = round2(s.total) || round2(qty * unitPrice);
    const costTotal = round2(s.cost);
    const purchasePriceSnapshot = round2(costTotal / qty);
    const createdAt = new Date(`${s.date}T10:${String(i % 60).padStart(2, '0')}:00Z`);

    await prisma.sale.create({
      data: {
        cashierId: admin.id,
        paymentType: 'CASH',
        totalAmount: lineTotal,
        paidAmount: lineTotal,
        status: 'PAID',
        createdAt,
        items: {
          create: [
            {
              productId,
              productName: s.product,
              unit,
              quantity: qty,
              unitPrice,
              purchasePrice: purchasePriceSnapshot,
              lineTotal,
            },
          ],
        },
      },
    });

    soldTotal[s.product] = (soldTotal[s.product] || 0) + qty;
    saleCount++;
  }
  console.log(`${saleCount} tarixi satış qeydə alındı.`);

  // --- final stock reconciliation: bir dəfəlik cəm əsaslı yeniləmə ---
  for (const [name, productId] of Object.entries(nameToId)) {
    const finalQty = round3((receivedTotal[name] || 0) - (soldTotal[name] || 0));
    const updateData = { quantity: Math.max(0, finalQty) };
    if (lastPurchasePriceApplied[name]) updateData.purchasePrice = lastPurchasePriceApplied[name];
    await prisma.product.update({ where: { id: productId }, data: updateData });
    if (finalQty < 0) {
      warnings.push(`"${name}": tarixi sənədlərə görə satılan miqdar alınandan çoxdur (${-finalQty} çatışmır), stok 0-da saxlanıldı.`);
    }
  }

  // --- opening cash session matching the spreadsheet's starting balance ---
  // Yalnız heç bir kassa sessiyası (test daxil olmaqla) yoxdursa yaradılır ki, istifadəçinin
  // özünün açdığı/bağladığı sessiya ilə toqquşma yaranmasın.
  const existingSessions = await prisma.cashSession.count();
  if (existingSessions === 0) {
    await prisma.cashSession.create({
      data: {
        openedById: admin.id,
        openingAmount: 442,
        openedAt: new Date('2026-08-01T08:00:00Z'),
        note: 'BirDad_Mini_ERP.xlsx-dən idxal edilmiş başlanğıc kassa balansı',
      },
    });
    console.log('Başlanğıc kassa sessiyası (442 AZN) açıldı.');
  } else {
    console.log('Artıq mövcud kassa sessiyası var, yeni başlanğıc sessiyası yaradılmadı.');
  }

  if (warnings.length) {
    console.log('\n--- DİQQƏT tələb edən qeydlər ---');
    warnings.forEach((w) => console.log('- ' + w));
  }
}

main()
  .catch((e) => {
    console.error('import-legacy.js xətası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
