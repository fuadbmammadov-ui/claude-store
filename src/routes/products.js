const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { generateUniqueBarcode } = require('../utils/barcode');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const products = await prisma.product.findMany({
    where: {
      active: true,
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
  res.render('products/index', { products, q });
}));

router.get('/new', (req, res) => {
  res.render('products/form', { product: null });
});

router.post('/', asyncHandler(async (req, res) => {
  const { name, unit, purchasePrice, salePrice, quantity, minStock } = req.body;
  let { barcode } = req.body;

  if (!barcode || !barcode.trim()) {
    barcode = await generateUniqueBarcode();
  }

  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      barcode: barcode.trim(),
      unit: unit === 'KG' ? 'KG' : 'PIECE',
      purchasePrice: purchasePrice || 0,
      salePrice: salePrice || 0,
      quantity: quantity || 0,
      minStock: minStock ? minStock : null,
    },
  });

  if (Number(quantity) > 0) {
    await prisma.stockReceipt.create({
      data: {
        productId: product.id,
        quantity: quantity,
        purchasePrice: purchasePrice || 0,
        receivedById: req.session.user.id,
        supplierName: req.body.supplierName || null,
      },
    });
  }

  res.redirect(`/products/${product.id}/label`);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      stockReceipts: { orderBy: { createdAt: 'desc' }, take: 20, include: { receivedBy: true } },
    },
  });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/show', { product });
}));

router.get('/:id/edit', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/form', { product });
}));

router.put('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { name, barcode, unit, purchasePrice, salePrice, minStock } = req.body;
  await prisma.product.update({
    where: { id },
    data: {
      name: name.trim(),
      barcode: barcode.trim(),
      unit: unit === 'KG' ? 'KG' : 'PIECE',
      purchasePrice: purchasePrice || 0,
      salePrice: salePrice || 0,
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
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/receive', { product });
}));

router.post('/:id/receive', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { quantity, purchasePrice, salePrice, supplierName } = req.body;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });

  await prisma.$transaction([
    prisma.stockReceipt.create({
      data: {
        productId: id,
        quantity,
        purchasePrice,
        supplierName: supplierName || null,
        receivedById: req.session.user.id,
      },
    }),
    prisma.product.update({
      where: { id },
      data: {
        quantity: { increment: Number(quantity) },
        purchasePrice: purchasePrice,
        ...(salePrice ? { salePrice } : {}),
      },
    }),
  ]);

  res.redirect(`/products/${id}`);
}));

router.get('/:id/label', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Mal tapılmadı.' });
  res.render('products/label', { product });
}));

module.exports = router;
