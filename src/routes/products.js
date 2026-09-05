const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { generateUniqueBarcode } = require('../utils/barcode');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function findOrCreateSupplier(tx, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = await tx.supplier.findUnique({ where: { name: trimmed } });
  if (existing) return existing.id;
  const created = await tx.supplier.create({ data: { name: trimmed } });
  return created.id;
}

async function getCategoryOptions() {
  const [categoryRows, subCategoryRows] = await Promise.all([
    prisma.product.findMany({ where: { active: true, category: { not: null } }, select: { category: true }, distinct: ['category'] }),
    prisma.product.findMany({ where: { active: true, subCategory: { not: null } }, select: { subCategory: true }, distinct: ['subCategory'] }),
  ]);
  return {
    categories: categoryRows.map((c) => c.category).filter(Boolean).sort(),
    subCategories: subCategoryRows.map((c) => c.subCategory).filter(Boolean).sort(),
  };
}

const STOCK_SORTS = {
  qty_asc: { quantity: 'asc' },
  qty_desc: { quantity: 'desc' },
};

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const sort = STOCK_SORTS[req.query.sort] ? req.query.sort : '';
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: STOCK_SORTS[sort] || { name: 'asc' },
  });
  const categoryRows = await prisma.product.findMany({
    where: { active: true, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
  });
  const categories = categoryRows.map((c) => c.category).filter(Boolean).sort();
  const bulkAdded = req.query.bulk ? Number(req.query.bulk) : null;
  res.render('products/index', { products, q, category, sort, categories, bulkAdded });
}));

router.get('/new', asyncHandler(async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  const { categories, subCategories } = await getCategoryOptions();
  res.render('products/form', { product: null, suppliers, categories, subCategories });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, category, subCategory, unit, purchasePrice, salePrice, quantity, minStock, supplierName, paidAmount } = req.body;
  let { barcode } = req.body;

  if (!barcode || !barcode.trim()) {
    barcode = await generateUniqueBarcode();
  }

  const productId = await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);

    const product = await tx.product.create({
      data: {
        name: name.trim(),
        category: (category || '').trim() || null,
        subCategory: (subCategory || '').trim() || null,
        barcode: barcode.trim(),
        unit: unit === 'KG' ? 'KG' : 'PIECE',
        purchasePrice: purchasePrice || 0,
        salePrice: salePrice || 0,
        quantity: quantity || 0,
        minStock: minStock ? minStock : null,
        defaultSupplierId: supplierId,
      },
    });

    if (Number(quantity) > 0) {
      const totalAmount = round2(Number(quantity) * Number(purchasePrice || 0));
      const paid = paidAmount === '' || paidAmount === undefined ? totalAmount : round2(Number(paidAmount));
      await tx.stockReceipt.create({
        data: {
          productId: product.id,
          quantity,
          purchasePrice: purchasePrice || 0,
          totalAmount,
          paidAmount: paid,
          status: paid >= totalAmount ? 'PAID' : 'DEBT',
          supplierId,
          supplierName: (supplierName || '').trim() || null,
          receivedById: req.session.user.id,
        },
      });
    }

    return product.id;
  });

  res.redirect(`/products/${productId}/label`);
}));

router.get('/bulk-new', asyncHandler(async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  res.render('products/bulk-new', { suppliers, error: null, rawText: '', supplierName: '' });
}));

router.post('/bulk', asyncHandler(async (req, res) => {
  const { supplierName, rows } = req.body;
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });

  const lines = (rows || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    return res.render('products/bulk-new', {
      suppliers, supplierName: supplierName || '', rawText: rows || '',
      error: 'Siyahı boşdur.',
    });
  }

  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim());
    const [name, quantity, purchasePrice, salePrice, category] = parts;
    if (!name || quantity === undefined || purchasePrice === undefined || salePrice === undefined) {
      return res.render('products/bulk-new', {
        suppliers, supplierName: supplierName || '', rawText: rows,
        error: `${i + 1}-ci sətir yanlış formatdadır: "${lines[i]}". Format: Ad, Miqdar, Alış qiyməti, Satış qiyməti[, Kateqoriya]`,
      });
    }
    const qtyNum = Number(quantity);
    const purchaseNum = Number(purchasePrice);
    const saleNum = Number(salePrice);
    if (!Number.isFinite(qtyNum) || qtyNum < 0 || !Number.isFinite(purchaseNum) || purchaseNum < 0 || !Number.isFinite(saleNum) || saleNum < 0) {
      return res.render('products/bulk-new', {
        suppliers, supplierName: supplierName || '', rawText: rows,
        error: `${i + 1}-ci sətirdə rəqəm yanlışdır: "${lines[i]}"`,
      });
    }
    parsed.push({ name, quantity: qtyNum, purchasePrice: purchaseNum, salePrice: saleNum, category: category || null });
  }

  for (const p of parsed) {
    p.barcode = await generateUniqueBarcode();
  }

  await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    for (const p of parsed) {
      const product = await tx.product.create({
        data: {
          name: p.name,
          category: p.category,
          barcode: p.barcode,
          unit: 'PIECE',
          purchasePrice: p.purchasePrice,
          salePrice: p.salePrice,
          quantity: p.quantity,
          defaultSupplierId: supplierId,
        },
      });

      if (p.quantity > 0) {
        const totalAmount = round2(p.quantity * p.purchasePrice);
        await tx.stockReceipt.create({
          data: {
            productId: product.id,
            quantity: p.quantity,
            purchasePrice: p.purchasePrice,
            totalAmount,
            paidAmount: totalAmount,
            status: 'PAID',
            supplierId,
            supplierName: (supplierName || '').trim() || null,
            receivedById: req.session.user.id,
          },
        });
      }
    }
  });

  res.redirect(`/products?bulk=${parsed.length}`);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      stockReceipts: { orderBy: { createdAt: 'desc' }, take: 20, include: { receivedBy: true, supplier: true } },
    },
  });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/show', { product });
}));

router.get('/:id/edit', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  const { categories, subCategories } = await getCategoryOptions();
  res.render('products/form', { product, suppliers, categories, subCategories });
}));

router.put('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { name, barcode, category, subCategory, unit, purchasePrice, salePrice, quantity, minStock } = req.body;
  await prisma.product.update({
    where: { id },
    data: {
      name: name.trim(),
      barcode: barcode.trim(),
      category: (category || '').trim() || null,
      subCategory: (subCategory || '').trim() || null,
      unit: unit === 'KG' ? 'KG' : 'PIECE',
      purchasePrice: purchasePrice || 0,
      salePrice: salePrice || 0,
      quantity: quantity === '' || quantity === undefined ? undefined : quantity,
      minStock: minStock ? minStock : null,
    },
  });
  res.redirect(`/products/${id}`);
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.product.update({ where: { id }, data: { active: false } });
  res.redirect('/products');
}));

router.get('/:id/receive', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id }, include: { defaultSupplier: true } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  res.render('products/receive', { product, suppliers });
}));

router.post('/:id/receive', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { quantity, purchasePrice, salePrice, supplierName, paidAmount } = req.body;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });

  await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    const totalAmount = round2(Number(quantity) * Number(purchasePrice));
    const paid = paidAmount === '' || paidAmount === undefined ? totalAmount : round2(Number(paidAmount));

    await tx.stockReceipt.create({
      data: {
        productId: id,
        quantity,
        purchasePrice,
        totalAmount,
        paidAmount: paid,
        status: paid >= totalAmount ? 'PAID' : 'DEBT',
        supplierId,
        supplierName: (supplierName || '').trim() || null,
        receivedById: req.session.user.id,
      },
    });
    await tx.product.update({
      where: { id },
      data: {
        quantity: { increment: Number(quantity) },
        purchasePrice: purchasePrice,
        ...(salePrice ? { salePrice } : {}),
        ...(supplierId ? { defaultSupplierId: supplierId } : {}),
      },
    });
  });

  res.redirect(`/products/${id}`);
}));

router.get('/:id/label', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/label', { product });
}));

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = router;
