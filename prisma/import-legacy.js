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

async function ensureSuppliers(names) {
  const distinct = [...new Set(names.map((n) => (n || '').trim()).filter(Boolean))];
  const nameToId = {};
  for (const name of distinct) {
    const existing = await prisma.supplier.findUnique({ where: { name } });
    if (existing) {
      nameToId[name] = existing.id;
    } else {
      const created = await prisma.supplier.create({ data: { name } });
      nameToId[name] = created.id;
    }
  }
  return nameToId;
}

async function importExpenses(data, admin, warnings) {
  const existingExpenses = await prisma.expense.count();
  if (existingExpenses > 0 || !data.expenses || !data.expenses.length) return;

  const validMethods = ['CASH', 'CARD', 'TRANSFER'];
  const methodMap = { Nağd: 'CASH', Kart: 'CARD', Köçürmə: 'TRANSFER' };

  let count = 0;
  for (const e of data.expenses) {
    if (!e.name || !e.amount) continue;
    const method = methodMap[(e.method || '').trim()] || 'CASH';
    await prisma.expense.create({
      data: {
        category: e.category || 'Digər',
        name: e.name,
        amount: round2(e.amount),
        method: validMethods.includes(method) ? method : 'CASH',
        note: e.note || null,
        createdById: admin.id,
        createdAt: new Date(`${e.date}T12:00:00Z`),
      },
    });
    count++;
  }
  console.log(`${count} tarixi xərc qeydə alındı (Xərclər vərəqindən).`);
}

async function backfillProductCategories(data, warnings) {
  let updated = 0;
  for (const p of data.products) {
    if (!p.name) continue;
    const product = await prisma.product.findFirst({ where: { name: p.name } });
    if (!product || product.category) continue;

    const category = (p.category || '').trim() || null;
    const subCategory = (p.altCategory || '').trim() || null;
    if (!category && !subCategory) continue;

    await prisma.product.update({
      where: { id: product.id },
      data: { category, subCategory },
    });
    updated++;
  }
  if (updated) console.log(`${updated} mövcud malın kateqoriyası dolduruldu.`);
}

async function main() {
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

  const warnings = [];

  const supplierNames = [
    ...data.products.map((p) => p.supplier),
    ...data.receipts.map((r) => r.supplier),
  ];
  const supplierNameToId = await ensureSuppliers(supplierNames);

  const existingReceipts = await prisma.stockReceipt.count();

  if (existingReceipts > 0) {
    console.log('Köhnə mağaza məlumatları artıq import edilib — mal/satış/qəbul idxalı keçirilir, yalnız əlavə məlumatlar tamamlanır.');
    await backfillProductCategories(data, warnings);
    await importExpenses(data, admin, warnings);
    return;
  }

  const receiptsSorted = [...data.receipts].filter((r) => r.product).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const salesSorted = [...data.sales].filter((s) => s.product).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

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
    const defaultSupplierId = supplierNameToId[(p.supplier || '').trim()] || null;

    const barcode = await generateUniqueBarcode();

    const product = await prisma.product.create({
      data: {
        name: p.name,
        category: (p.category || '').trim() || null,
        subCategory: (p.altCategory || '').trim() || null,
        barcode,
        unit,
        purchasePrice: round2(purchasePrice),
        salePrice: round2(salePrice),
        quantity: 0,
        minStock,
        active: toActive(p.active),
        defaultSupplierId,
      },
    });
    nameToId[p.name] = product.id;
    created++;
  }
  console.log(`${created} mal yaradıldı (BirDad_Mini_ERP.xlsx-dən).`);

  const receivedTotal = {};
  const soldTotal = {};
  const lastPurchasePriceApplied = {};

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
    const totalAmount = round2(r.total) || round2(qty * unitPrice);
    const isPaid = (r.status || '').trim() === 'Ödənilib';
    const paidAmount = isPaid ? totalAmount : 0;
    const createdAt = new Date(`${r.date}T09:${String(i % 60).padStart(2, '0')}:00Z`);
    const supplierId = supplierNameToId[(r.supplier || '').trim()] || null;

    await prisma.stockReceipt.create({
      data: {
        productId,
        quantity: qty,
        purchasePrice: unitPrice,
        totalAmount,
        paidAmount,
        status: isPaid ? 'PAID' : 'DEBT',
        supplierId,
        supplierName: (r.supplier || '').trim() || null,
        receivedById: admin.id,
        createdAt,
      },
    });

    receivedTotal[r.product] = (receivedTotal[r.product] || 0) + qty;
    lastPurchasePriceApplied[r.product] = unitPrice;
    receiptCount++;
  }
  console.log(`${receiptCount} mal qəbulu qeydə alındı.`);

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
    const discount = round2(s.discount) || 0;
    const lineTotal = round2(s.total) || round2(qty * unitPrice - discount);
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
              discount,
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

  for (const [name, productId] of Object.entries(nameToId)) {
    const finalQty = round3((receivedTotal[name] || 0) - (soldTotal[name] || 0));
    const updateData = { quantity: Math.max(0, finalQty) };
    if (lastPurchasePriceApplied[name]) updateData.purchasePrice = lastPurchasePriceApplied[name];
    await prisma.product.update({ where: { id: productId }, data: updateData });
    if (finalQty < 0) {
      warnings.push(`"${name}": tarixi sənədlərə görə satılan miqdar alınandan çoxdur (${-finalQty} çatışmır), stok 0-da saxlanıldı.`);
    }
  }

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

  await importExpenses(data, admin, warnings);

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
