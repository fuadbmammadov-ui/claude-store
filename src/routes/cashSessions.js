const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function computeTotals(session) {
  const from = session.openedAt;
  const to = session.closedAt || new Date();

  const [cashSales, cardSales, debtSales, cashDebtPayments, cardDebtPayments] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { paidAmount: true },
      where: { paymentType: 'CASH', createdAt: { gte: from, lte: to } },
    }),
    prisma.sale.aggregate({
      _sum: { paidAmount: true },
      where: { paymentType: 'CARD', createdAt: { gte: from, lte: to } },
    }),
    prisma.sale.aggregate({
      _sum: { totalAmount: true },
      where: { paymentType: 'DEBT', createdAt: { gte: from, lte: to } },
    }),
    prisma.debtPayment.aggregate({
      _sum: { amount: true },
      where: { method: 'CASH', paidAt: { gte: from, lte: to } },
    }),
    prisma.debtPayment.aggregate({
      _sum: { amount: true },
      where: { method: 'CARD', paidAt: { gte: from, lte: to } },
    }),
  ]);

  const cash = Number(cashSales._sum.paidAmount || 0) + Number(cashDebtPayments._sum.amount || 0);
  const card = Number(cardSales._sum.paidAmount || 0) + Number(cardDebtPayments._sum.amount || 0);
  const debt = Number(debtSales._sum.totalAmount || 0);
  const expectedCash = Number(session.openingAmount) + cash;

  return { cash, card, debt, expectedCash };
}

router.get('/', asyncHandler(async (req, res) => {
  const openSession = await prisma.cashSession.findFirst({
    where: { closedAt: null },
    include: { openedBy: true },
    orderBy: { openedAt: 'desc' },
  });

  const history = await prisma.cashSession.findMany({
    where: { closedAt: { not: null } },
    include: { openedBy: true },
    orderBy: { openedAt: 'desc' },
    take: 15,
  });

  let totals = null;
  if (openSession) {
    totals = await computeTotals(openSession);
  }

  const historyWithTotals = [];
  for (const s of history) {
    historyWithTotals.push({ session: s, totals: await computeTotals(s) });
  }

  res.render('cash-sessions/index', { openSession, totals, historyWithTotals });
}));

router.post('/open', asyncHandler(async (req, res) => {
  const existing = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (existing) return res.redirect('/cash-sessions');

  await prisma.cashSession.create({
    data: {
      openedById: req.session.user.id,
      openingAmount: req.body.openingAmount || 0,
      note: req.body.note || null,
    },
  });
  res.redirect('/cash-sessions');
}));

router.post('/:id/close', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.cashSession.update({
    where: { id },
    data: {
      closedAt: new Date(),
      closingAmountActual: req.body.closingAmountActual || 0,
      note: req.body.note || null,
    },
  });
  res.redirect('/cash-sessions');
}));

module.exports = router;
