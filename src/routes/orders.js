const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireRole('ADMIN'));

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cartTotal(items) {
  return items.reduce((s, it) => s + Number(it.quantity) * Number(it.purchasePrice), 0);
}

// Advance payments on a DRAFT order are real cash-out events, recorded the moment the amount
// is written — not deferred until confirm — because the money genuinely leaves the register
// that day. paidAmount is a single running total (no per-tranche history), so we keep exactly
// one ledger row per order (purchaseOrderId set, stockReceiptId null) synced on every draft
// save: created once it goes above 0, amount/paidAt updated when it changes, deleted when it
// goes back to 0. At confirm time this single row is reallocated across the newly created
// receipts (see reallocateAdvanceToReceipts) instead of a fresh cash-out being recorded, since
// the money already left the till on the day this row says it did.
async function syncDraftAdvance(tx, orderId, supplierId, actorId, cartTotalAmount, requestedAmount) {
  const existing = await tx.supplierPayment.findFirst({ where: { purchaseOrderId: orderId, stockReceiptId: null } });

  if (!supplierId) {
    // No supplier resolved yet — nothing to attach the cash-out to. Keep the typed number for
    // display but drop any stale ledger row (e.g. supplier field was cleared).
    if (existing) await tx.supplierPayment.delete({ where: { id: existing.id } });
    return { paidAmount: Math.max(0, round2(requestedAmount)), paidAt: null };
  }

  const clamped = Math.min(Math.max(0, round2(requestedAmount)), Math.max(0, round2(cartTotalAmount)));

  if (clamped <= 0) {
    if (existing) await tx.supplierPayment.delete({ where: { id: existing.id } });
    return { paidAmount: 0, paidAt: null };
  }

  if (existing) {
    if (round2(existing.amount) === clamped && existing.supplierId === supplierId) {
      return { paidAmount: clamped, paidAt: existing.paidAt };
    }
    const updated = await tx.supplierPayment.update({
      where: { id: existing.id },
      data: { amount: clamped, supplierId, paidAt: new Date(), paidById: actorId },
    });
    return { paidAmount: clamped, paidAt: updated.paidAt };
  }

  const created = await tx.supplierPayment.create({
    data: { purchaseOrderId: orderId, supplierId, amount: clamped, method: 'CASH', paidById: actorId, paidAt: new Date() },
  });
  return { paidAmount: clamped, paidAt: created.paidAt };
}

// Moves the order's advance ledger row (if any) onto the receipts just created by
// materializeItemsAsReceipts, oldest item first. This is a reallocation, not a new cash-out:
// the money already left the register on advance.paidAt (the day it was actually written into
// the draft), so that date/actor is reused instead of stamping `now()`.
async function reallocateAdvanceToReceipts(tx, orderId, supplierId) {
  const advance = await tx.supplierPayment.findFirst({ where: { purchaseOrderId: orderId, stockReceiptId: null } });
  if (!advance) return;

  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId }, orderBy: { id: 'asc' } });

  let remaining = round2(advance.amount);
  for (const item of items) {
    if (remaining <= 0) break;
    if (!item.stockReceiptId) continue;
    const totalAmount = round2(Number(item.quantity) * Number(item.purchasePrice));
    const applied = Math.min(totalAmount, remaining);
    if (applied <= 0) continue;
    remaining = round2(remaining - applied);

    await tx.stockReceipt.update({
      where: { id: item.stockReceiptId },
      data: { paidAmount: applied, status: applied >= totalAmount ? 'PAID' : 'DEBT' },
    });
    await tx.supplierPayment.create({
      data: {
        stockReceiptId: item.stockReceiptId,
        supplierId,
        amount: applied,
        method: 'CASH',
        paidById: advance.paidById,
        paidAt: advance.paidAt,
      },
    });
  }

  await tx.supplierPayment.delete({ where: { id: advance.id } });
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

// DRAFT orders have no stock/debt side effects yet, so saving is a cheap full replace.
async function replaceDraftItems(tx, orderId, items, products) {
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

// First-time confirm: every current item gets a fresh StockReceipt (debt) + stock increment.
// Any advance already paid on the draft is applied separately afterwards, by
// reallocateAdvanceToReceipts — this function only creates the receipts.
async function materializeItemsAsReceipts(tx, orderId, items, products, supplierId, supplierName, actorId) {
  await replaceDraftItems(tx, orderId, items, products);
  const createdItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId } });

  for (const item of createdItems) {
    const totalAmount = round2(Number(item.quantity) * Number(item.purchasePrice));
    const receipt = await tx.stockReceipt.create({
      data: {
        productId: item.productId,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
        totalAmount,
        paidAmount: 0,
        status: 'DEBT',
        supplierId,
        supplierName: (supplierName || '').trim() || null,
        receivedById: actorId,
      },
    });
    await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { stockReceiptId: receipt.id } });
    await tx.product.update({ where: { id: item.productId }, data: { quantity: { increment: item.quantity } } });
  }
}

// Editing an already-confirmed order: diff against the linked receipts and apply only the delta
// to stock/debt, so kassa-adjacent totals stay correct instead of double-counting.
async function syncConfirmedItems(tx, orderId, items, products, supplierId, supplierName, actorId) {
  const existing = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: orderId },
    include: { stockReceipt: true },
  });

  const alreadyPaid = existing.find((it) => it.stockReceipt && Number(it.stockReceipt.paidAmount) > 0);
  if (alreadyPaid) {
    const err = new Error(
      `"${alreadyPaid.productName}" üzrə artıq təchizatçıya ödəniş edilib — dəyişiklik üçün əvvəlcə həmin ödənişi geri götürün.`
    );
    err.status = 400;
    throw err;
  }

  const existingByProduct = new Map(existing.map((it) => [it.productId, it]));
  const incomingByProduct = new Map(items.map((it) => [it.productId, it]));

  // Removed items: delete the receipt (clears debt), reverse stock, drop the order line.
  for (const old of existing) {
    if (incomingByProduct.has(old.productId)) continue;
    if (old.stockReceiptId) {
      await tx.stockReceipt.delete({ where: { id: old.stockReceiptId } });
    }
    await tx.product.update({ where: { id: old.productId }, data: { quantity: { decrement: old.quantity } } });
    await tx.purchaseOrderItem.delete({ where: { id: old.id } });
  }

  for (const [productId, incoming] of incomingByProduct) {
    const product = products.get(productId);
    if (!product) continue;
    const old = existingByProduct.get(productId);

    if (!old) {
      // New line added to an already-confirmed order.
      const totalAmount = round2(incoming.quantity * incoming.purchasePrice);
      const receipt = await tx.stockReceipt.create({
        data: {
          productId,
          quantity: incoming.quantity,
          purchasePrice: round2(incoming.purchasePrice),
          totalAmount,
          paidAmount: 0,
          status: 'DEBT',
          supplierId,
          supplierName: (supplierName || '').trim() || null,
          receivedById: actorId,
        },
      });
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: orderId,
          productId,
          productName: product.name,
          unit: product.unit,
          quantity: incoming.quantity,
          purchasePrice: round2(incoming.purchasePrice),
          stockReceiptId: receipt.id,
        },
      });
      await tx.product.update({ where: { id: productId }, data: { quantity: { increment: incoming.quantity } } });
      continue;
    }

    const delta = incoming.quantity - Number(old.quantity);
    const totalAmount = round2(incoming.quantity * incoming.purchasePrice);

    // Always re-sync the linked receipt (qty/price/supplier), even when only the supplier
    // changed, so StockReceipt.supplierId never drifts from PurchaseOrder.supplierId.
    if (old.stockReceiptId) {
      await tx.stockReceipt.update({
        where: { id: old.stockReceiptId },
        data: {
          quantity: incoming.quantity,
          purchasePrice: round2(incoming.purchasePrice),
          totalAmount,
          supplierId,
          supplierName: (supplierName || '').trim() || null,
        },
      });
    }
    await tx.purchaseOrderItem.update({
      where: { id: old.id },
      data: { quantity: incoming.quantity, purchasePrice: round2(incoming.purchasePrice) },
    });
    if (delta !== 0) {
      await tx.product.update({ where: { id: productId }, data: { quantity: { increment: delta } } });
    }
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
    paidAmount: 0,
  });
}));

// Autosave endpoint for a brand-new draft: called the moment the first item is added,
// so the draft lives on the server (not just in the browser) from the very start.
router.post('/', asyncHandler(async (req, res) => {
  const { supplierName, note } = req.body;
  const requestedPaidAmount = Math.max(0, round2(req.body.paidAmount));
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
        paidAmount: 0,
        createdById: req.session.user.id,
      },
    });
    await replaceDraftItems(tx, order.id, items, productMap);
    const { paidAmount, paidAt } = await syncDraftAdvance(tx, order.id, supplierId, req.session.user.id, cartTotal(items), requestedPaidAmount);
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { paidAmount, paidAt } });
    return order.id;
  });

  res.json({ id: orderId });
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

  if (order.status === 'CANCELLED') {
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
    paidAmount: Number(order.paidAmount),
  });
}));

// Autosave endpoint for an existing order. DRAFT: cheap full replace, no side effects.
// CONFIRMED: diff-based, adjusts stock/debt by the delta only.
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı' });
  if (order.status === 'CANCELLED') return res.status(400).json({ error: 'Bu sifariş ləğv edilib' });

  const { supplierName, note } = req.body;
  const items = parseItems(req.body.items);
  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  try {
    await prisma.$transaction(async (tx) => {
      const supplierId = await findOrCreateSupplier(tx, supplierName);
      const orderData = { supplierId, supplierName: (supplierName || '').trim() || null, note: (note || '').trim() || null };
      // Once confirmed, "already paid" is applied for good — further payments go through
      // the supplier payments page, not this form, so paidAmount is only writable pre-confirm.
      if (order.status === 'DRAFT' && req.body.paidAmount !== undefined) {
        const synced = await syncDraftAdvance(tx, id, supplierId, req.session.user.id, cartTotal(items), req.body.paidAmount);
        orderData.paidAmount = synced.paidAmount;
        orderData.paidAt = synced.paidAt;
      }
      await tx.purchaseOrder.update({ where: { id }, data: orderData });

      if (order.status === 'DRAFT') {
        await replaceDraftItems(tx, id, items, productMap);
      } else {
        await syncConfirmedItems(tx, id, items, productMap, supplierId, supplierName, req.session.user.id);
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Xəta baş verdi' });
  }

  res.json({ success: true });
}));

router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı' });
  if (order.status !== 'DRAFT') return res.status(400).json({ error: 'Bu sifariş artıq təsdiqlənib' });

  const { supplierName, note } = req.body;
  const requestedPaidAmount = Math.max(0, round2(req.body.paidAmount));
  const items = parseItems(req.body.items);
  if (!items.length) return res.status(400).json({ error: 'Siyahıda mal yoxdur' });

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    const supplierId = await findOrCreateSupplier(tx, supplierName);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId,
        supplierName: (supplierName || '').trim() || null,
        note: (note || '').trim() || null,
      },
    });

    const { paidAmount, paidAt } = await syncDraftAdvance(tx, id, supplierId, req.session.user.id, cartTotal(items), requestedPaidAmount);
    await tx.purchaseOrder.update({ where: { id }, data: { paidAmount, paidAt } });

    await materializeItemsAsReceipts(tx, id, items, productMap, supplierId, supplierName, req.session.user.id);
    await reallocateAdvanceToReceipts(tx, id, supplierId);

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedById: req.session.user.id, confirmedAt: new Date() },
    });
  });

  res.json({ success: true, redirect: `/orders/${id}` });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { stockReceipt: true } } },
  });
  if (!order) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Sifariş tapılmadı.' });
  if (order.status === 'CANCELLED') {
    return res.status(400).render('error', { title: 'Xəta', message: 'Bu sifariş artıq ləğv edilib.' });
  }

  const alreadyPaid = order.items.find((it) => it.stockReceipt && Number(it.stockReceipt.paidAmount) > 0);
  if (alreadyPaid) {
    return res.status(400).render('error', {
      title: 'Xəta',
      message: `"${alreadyPaid.productName}" üzrə artıq təchizatçıya ödəniş edilib — ləğv etmək üçün əvvəlcə həmin ödənişi geri götürün.`,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (item.stockReceiptId) {
        await tx.stockReceipt.delete({ where: { id: item.stockReceiptId } });
        await tx.product.update({ where: { id: item.productId }, data: { quantity: { decrement: item.quantity } } });
      }
    }
    // A still-DRAFT order can already have a real cash-out recorded (advance paid before
    // confirm, see syncDraftAdvance) — cancelling means the order never happens, so that
    // money is credited back to the register by removing the ledger row.
    if (order.status === 'DRAFT') {
      await tx.supplierPayment.deleteMany({ where: { purchaseOrderId: id, stockReceiptId: null } });
    }
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  });

  res.redirect('/orders');
}));

module.exports = router;
