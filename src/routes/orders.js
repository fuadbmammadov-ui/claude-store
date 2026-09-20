const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireRole('ADMIN'));

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function findOrCreateSupplier(tx, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = await tx.supplier.findUnique({ where: { name: trimmed } });
  if (existing) return existing.id;
  const created = await tx.supplier.create({ data: { name: trimmed } });
  return created.id;
}

function parseItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => ({
      productId: Number(it.productId),
      quantity: Number(it.quantity),
      purchasePrice: Number(it.purchasePrice),
    }))
    .filter((it) => it.productId && it.quantity > 0 && it.purchasePrice >= 0);
}

async function replaceOrderItems(tx, orderId, items, products) {
  await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: orderId } });
  for (const item of items) {
    const product = products.get(item.productId);
    if (!product) continue;
    await tx.purchaseOrderItem.create({
      data: {
        purchaseOrderId: orderId,
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: item.quantity,
        purchasePrice: round2(item.purchasePrice),
      },
    });
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const status = ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(req.query.status) ? req.query.status : '';
  const orders = await prisma.purchaseOrder.findMany({
    where: status ? { status } : {},
    include: { supplier: true, createdBy: true, items: true },
    orderBy: { createdAt: 'desc' },
  });
  const withTotals = orders.map((o) => ({
    ...o,
    itemCount: o.items.length,
    total: o.items.reduce((s, it) => s + Number(it.quantity) * Number(it.purchasePrice), 0),
  }));
  res.render('orders/index', { orders: withTotals, status });
}));

router.get('/new', asyncHandler(async (req, res) => {
  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
  ]);
  res.render('orders/form', {
    order: null,
    items: [],
    suppliers,
    products: products.map((p) => ({
      id: p.id, name: p.name, category: p.category || 'Digər', unit: p.unit, purchasePrice: Number(p.purchasePrice),
    })),
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { supplierName, note } = req.body;
  const items = parseItems(req.body.items);

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const orderId = await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    const order = await tx.purchaseOrder.create({
      data: {
        supplierId,
        supplierName: (supplierName || '').trim() || null,
        note: (note || '').trim() || null,
        createdById: req.session.user.id,
      },
    });
    await replaceOrderItems(tx, order.id, items, productMap);
    return order.id;
  });

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ id: orderId });
  }
  res.redirect(`/orders/${orderId}`);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: true,
      confirmedBy: true,
      items: { include: { product: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!order) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Sifariş tapılmadı.' });

  if (order.status !== 'DRAFT') {
    return res.render('orders/show', { order });
  }

  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
  ]);

  res.render('orders/form', {
    order,
    items: order.items.map((it) => ({
      productId: it.productId,
      name: it.productName,
      category: (it.product && it.product.category) || 'Digər',
      unit: it.unit,
      quantity: Number(it.quantity),
      purchasePrice: Number(it.purchasePrice),
    })),
    suppliers,
    products: products.map((p) => ({
      id: p.id, name: p.name, category: p.category || 'Digər', unit: p.unit, purchasePrice: Number(p.purchasePrice),
    })),
  });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı' });
  if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Bu sifariş artıq təsdiqlənib' });

  const { supplierName, note } = req.body;
  const items = parseItems(req.body.items);
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    await tx.purchaseOrder.update({
      where: { id },
      data: { supplierId, supplierName: (supplierName || '').trim() || null, note: (note || '').trim() || null },
    });
    await replaceOrderItems(tx, id, items, productMap);
  });

  res.json({ success: true });
}));

router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı' });
  if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Bu sifariş artıq təsdiqlənib' });

  const { supplierName, note } = req.body;
  const items = parseItems(req.body.items);
  if (!items.length) return res.status(400).json({ error: 'Siyahıda mal yoxdur' });

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    await tx.purchaseOrder.update({
      where: { id },
      data: { supplierId, supplierName: (supplierName || '').trim() || null, note: (note || '').trim() || null },
    });
    await replaceOrderItems(tx, id, items, productMap);

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) continue;
      const totalAmount = round2(item.quantity * item.purchasePrice);

      await tx.stockReceipt.create({
        data: {
          productId: product.id,
          quantity: item.quantity,
          purchasePrice: round2(item.purchasePrice),
          totalAmount,
          paidAmount: 0,
          status: 'DEBT',
          supplierId,
          supplierName: (supplierName || '').trim() || null,
          receivedById: req.session.user.id,
        },
      });

      await tx.product.update({
        where: { id: product.id },
        data: { quantity: { increment: item.quantity } },
      });
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedById: req.session.user.id, confirmedAt: new Date() },
    });
  });

  res.json({ success: true, redirect: `/orders/${id}` });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Sifariş tapılmadı.' });
  if (order.status !== 'DRAFT') {
    return res.status(400).render('error', { title: 'Xəta', message: 'Yalnız qaralama sifariş ləğv edilə bilər.' });
  }
  await prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  res.redirect('/orders');
}));

module.exports = router;
