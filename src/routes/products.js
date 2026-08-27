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

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
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
    orderBy: { name: 'asc' },
  });
  const categoryRows = await prisma.product.findMany({
    where: { active: true, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
  });
  const categories = categoryRows.map((c) => c.category).filter(Boolean).sort();
  res.render('products/index', { products, q, category, categories });
}));

router.get('/new', asyncHandler(async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  res.render('products/form', { product: null, suppliers });
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
  res.render('products/form', { product, suppliers });
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
