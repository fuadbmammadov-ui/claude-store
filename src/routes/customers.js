const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const customers = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
      : {},
    include: { sales: { where: { status: 'DEBT', voided: false } } },
    orderBy: { name: 'asc' },
  });

  const withDebt = customers.map((c) => ({
    ...c,
    outstanding: c.sales.reduce((sum, s) => sum + (Number(s.totalAmount) - Number(s.paidAmount)), 0),
  }));

  res.render('customers/index', { customers: withDebt, q });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, note } = req.body;
  await prisma.customer.create({
    data: { name: name.trim(), phone: (phone || '').trim() || null, note: (note || '').trim() || null },
  });
  res.redirect('/customers');
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: { orderBy: { createdAt: 'desc' }, include: { items: true } },
      debtPayments: { orderBy: { paidAt: 'desc' }, include: { receivedBy: true } },
    },
  });
  if (!customer) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Müştəri tapılmadı.' });

  const outstanding = customer.sales
    .filter((s) => s.status === 'DEBT' && !s.voided)
    .reduce((sum, s) => sum + (Number(s.totalAmount) - Number(s.paidAmount)), 0);

  res.render('customers/show', { customer, outstanding });
}));

router.post('/:id/payments', asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const amount = Number(req.body.amount);
  const method = req.body.method === 'CARD' ? 'CARD' : 'CASH';

  if (!amount || amount <= 0) {
    return res.status(400).render('error', { title: 'Xəta', message: 'Ödəniş məbləği yanlışdır.' });
  }

  await prisma.$transaction(async (tx) => {
    const openSales = await tx.sale.findMany({
      where: { customerId, status: 'DEBT', voided: false },
      orderBy: { createdAt: 'asc' },
    });

    const totalOwed = openSales.reduce((s, sale) => s + (Number(sale.totalAmount) - Number(sale.paidAmount)), 0);
    let remaining = Math.min(amount, totalOwed);
    for (const sale of openSales) {
      if (remaining <= 0) break;
      const owed = Number(sale.totalAmount) - Number(sale.paidAmount);
      if (owed <= 0) continue;
      const applied = Math.min(owed, remaining);
      remaining -= applied;

      const newPaid = Number(sale.paidAmount) + applied;
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          paidAmount: newPaid,
          status: newPaid >= Number(sale.totalAmount) ? 'PAID' : 'DEBT',
        },
      });

      await tx.debtPayment.create({
        data: {
          saleId: sale.id,
          customerId,
          amount: applied,
          method,
          receivedById: req.session.user.id,
        },
      });
    }
  });

  res.redirect(`/customers/${customerId}`);
}));

module.exports = router;
