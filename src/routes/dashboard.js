const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get('/', asyncHandler(async (req, res) => {
  const from = startOfToday();

  const [cashSales, cardSales, debtSales, saleItemsToday, openSession, lowStock] = await Promise.all([
    prisma.sale.aggregate({ _sum: { paidAmount: true }, _count: true, where: { paymentType: 'CASH', createdAt: { gte: from } } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, _count: true, where: { paymentType: 'CARD', createdAt: { gte: from } } }),
    prisma.sale.aggregate({ _sum: { totalAmount: true }, _count: true, where: { paymentType: 'DEBT', createdAt: { gte: from } } }),
    prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from } } } }),
    prisma.cashSession.findFirst({ where: { closedAt: null } }),
    prisma.product.findMany({
      where: { active: true, minStock: { not: null } },
    }),
  ]);

  const profitToday = saleItemsToday.reduce(
    (sum, it) => sum + (Number(it.unitPrice) - Number(it.purchasePrice)) * Number(it.quantity),
    0
  );

  const lowStockList = lowStock.filter((p) => Number(p.quantity) <= Number(p.minStock));

  res.render('dashboard', {
    cashTotal: Number(cashSales._sum.paidAmount || 0),
    cashCount: cashSales._count,
    cardTotal: Number(cardSales._sum.paidAmount || 0),
    cardCount: cardSales._count,
    debtTotal: Number(debtSales._sum.totalAmount || 0),
    debtCount: debtSales._count,
    profitToday,
    openSession,
    lowStockList,
  });
}));

module.exports = router;
