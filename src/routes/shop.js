const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getCart(req) {
  if (!req.session.cart) req.session.cart = {};
  return req.session.cart;
}

// Drops lines whose product no longer exists/is active, clamps quantity to current stock,
// and recomputes prices live from the DB — the session only ever stores { productId: quantity },
// never a price, so a cart can't be reused to "lock in" a stale price after an admin changes it.
async function resolveCart(cart) {
  const ids = Object.keys(cart).map(Number).filter((n) => Number.isInteger(n));
  if (!ids.length) return { lines: [], total: 0, changed: false };

  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  let changed = false;
  const lines = [];
  for (const id of ids) {
    const product = byId.get(id);
    if (!product || !product.active) {
      delete cart[id];
      changed = true;
      continue;
    }
    let quantity = Number(cart[id]) || 0;
    const maxQty = Number(product.quantity);
    if (quantity > maxQty) {
      quantity = maxQty;
      changed = true;
    }
    if (quantity <= 0) {
      delete cart[id];
      changed = true;
      continue;
    }
    cart[id] = quantity;
    const lineTotal = round2(quantity * Number(product.salePrice));
    lines.push({ product, quantity, lineTotal });
  }

  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  return { lines, total, changed };
}

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(category ? { category } : {}),
      ...(q
        ? { name: { contains: q, mode: 'insensitive' } }
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

  const cart = getCart(req);
  const cartCount = Object.keys(cart).length;

  res.render('shop/index', { products, q, category, categories, cartCount });
}));

router.get('/product/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id, active: true } });
  if (!product) return res.status(404).render('shop/not-found', { message: 'Məhsul tapılmadı.' });
  const cart = getCart(req);
  res.render('shop/product', { product, cartCount: Object.keys(cart).length });
}));

router.post('/cart/add', asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId);
  const addQty = Number(req.body.quantity) || 1;
  const product = await prisma.product.findFirst({ where: { id: productId, active: true } });
  if (product) {
    const cart = getCart(req);
    const current = Number(cart[productId]) || 0;
    const next = Math.min(current + addQty, Number(product.quantity));
    if (next > 0) cart[productId] = next;
  }
  res.redirect(req.body.returnTo || '/shop');
}));

router.get('/cart', asyncHandler(async (req, res) => {
  const cart = getCart(req);
  const { lines, total } = await resolveCart(cart);
  res.render('shop/cart', { lines, total, cartCount: lines.length });
}));

router.post('/cart/update', asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Number(req.body.quantity) || 0;
  const cart = getCart(req);
  if (quantity <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = quantity;
  }
  res.redirect('/shop/cart');
}));

router.post('/cart/remove', asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId);
  const cart = getCart(req);
  delete cart[productId];
  res.redirect('/shop/cart');
}));

router.get('/checkout', asyncHandler(async (req, res) => {
  const cart = getCart(req);
  const { lines, total } = await resolveCart(cart);
  if (!lines.length) return res.redirect('/shop/cart');
  res.render('shop/checkout', { lines, total, error: null, form: {} });
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const cart = getCart(req);
  const { lines, total } = await resolveCart(cart);
  if (!lines.length) return res.redirect('/shop/cart');

  const customerName = (req.body.customerName || '').trim();
  const customerPhone = (req.body.customerPhone || '').trim();
  const customerAddress = (req.body.customerAddress || '').trim();
  const note = (req.body.note || '').trim();

  if (!customerName || !customerPhone) {
    return res.render('shop/checkout', {
      lines, total,
      error: 'Ad və telefon nömrəsi mütləqdir.',
      form: { customerName, customerPhone, customerAddress, note },
    });
  }

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.webOrder.create({
      data: {
        customerName,
        customerPhone,
        customerAddress: customerAddress || null,
        note: note || null,
        totalAmount: total,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            productName: l.product.name,
            unit: l.product.unit,
            unitPrice: l.product.salePrice,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });
    return created;
  });

  req.session.cart = {};
  req.session.lastWebOrderId = order.id;
  res.redirect(`/shop/order/${order.id}`);
}));

router.get('/order/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (req.session.lastWebOrderId !== id) {
    return res.status(404).render('shop/not-found', { message: 'Bu sifarişə giriş icazəniz yoxdur.' });
  }
  const order = await prisma.webOrder.findUnique({ where: { id }, include: { items: true } });
  if (!order) return res.status(404).render('shop/not-found', { message: 'Sifariş tapılmadı.' });
  res.render('shop/confirmation', { order });
}));

module.exports = router;
