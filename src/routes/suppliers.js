const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const suppliers = await prisma.supplier.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
      : {},
    include: { stockReceipts: { where: { status: 'DEBT' } } },
    orderBy: { name: 'asc' },
  });

  const withDebt = suppliers.map((s) => ({
    ...s,
    outstanding: s.stockReceipts.reduce((sum, r) => sum + (Number(r.totalAmount) - Number(r.paidAmount)), 0),
  }));

  res.render('suppliers/index', { suppliers: withDebt, q });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const suppliers = await prisma.supplier.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
    orderBy: { name: 'asc' },
    take: 20,
  });
  res.json(suppliers);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, note } = req.body;
  const supplier = await prisma.supplier.create({
    data: { name: name.trim(), phone: (phone || '').trim() || null, note: (note || '').trim() || null },
  });
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json(supplier);
  }
  res.redirect('/suppliers');
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      stockReceipts: { orderBy: { createdAt: 'desc' }, include: { product: true } },
      payments: { orderBy: { paidAt: 'desc' }, include: { paidBy: true } },
    },
  });
  if (!supplier) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Təchizatçı tapılmadı.' });

  const outstanding = supplier.stockReceipts
    .filter((r) => r.status === 'DEBT')
    .reduce((sum, r) => sum + (Number(r.totalAmount) - Number(r.paidAmount)), 0);

  res.render('suppliers/show', { supplier, outstanding });
}));

router.post('/:id/payments', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const supplierId = Number(req.params.id);
  const amount = Number(req.body.amount);
  const method = ['CARD', 'TRANSFER'].includes(req.body.method) ? req.body.method : 'CASH';

  if (!amount || amount <= 0) {
    return res.status(400).render('error', { title: 'Xəta', message: 'Ödəniş məbləği yanlışdır.' });
  }

  await prisma.$transaction(async (tx) => {
    const openReceipts = await tx.stockReceipt.findMany({
      where: { supplierId, status: 'DEBT' },
      orderBy: { createdAt: 'asc' },
    });

    const totalOwed = openReceipts.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount)), 0);
    let remaining = Math.min(amount, totalOwed);
    for (const receipt of openReceipts) {
      if (remaining <= 0) break;
      const owed = Number(receipt.totalAmount) - Number(receipt.paidAmount);
      if (owed <= 0) continue;
      const applied = Math.min(owed, remaining);
      remaining -= applied;

      const newPaid = Number(receipt.paidAmount) + applied;
      await tx.stockReceipt.update({
        where: { id: receipt.id },
        data: {
          paidAmount: newPaid,
          status: newPaid >= Number(receipt.totalAmount) ? 'PAID' : 'DEBT',
        },
      });

      await tx.supplierPayment.create({
        data: {
          stockReceiptId: receipt.id,
          supplierId,
          amount: applied,
          method,
          paidById: req.session.user.id,
        },
      });
    }
  });

  res.redirect(`/suppliers/${supplierId}`);
}));

module.exports = router;
