const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/', (req, res) => res.redirect('/reports/daily'));

router.get('/daily', asyncHandler(async (req, res) => {
  const dateParam = req.query.date;
  const day = dateParam ? new Date(dateParam) : new Date();
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(day);
  to.setHours(23, 59, 59, 999);

  const sales = await prisma.sale.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: { items: true, cashier: true, customer: true },
    orderBy: { createdAt: 'asc' },
  });

  const totals = { cash: 0, card: 0, debt: 0, revenue: 0, cost: 0, profit: 0 };
  sales.forEach((s) => {
    totals.revenue += Number(s.totalAmount);
    if (s.paymentType === 'CASH') totals.cash += Number(s.paidAmount);
    if (s.paymentType === 'CARD') totals.card += Number(s.paidAmount);
    if (s.paymentType === 'DEBT') totals.debt += Number(s.totalAmount);
    s.items.forEach((it) => {
      totals.cost += Number(it.purchasePrice) * Number(it.quantity);
      totals.profit += (Number(it.unitPrice) - Number(it.purchasePrice)) * Number(it.quantity);
    });
  });

  const receiptsToday = await prisma.stockReceipt.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: { product: true, receivedBy: true },
  });
  const totalPurchases = receiptsToday.reduce((s, r) => s + Number(r.quantity) * Number(r.purchasePrice), 0);

  res.render('reports/daily', {
    day: from.toISOString().slice(0, 10),
    sales,
    totals,
    receiptsToday,
    totalPurchases,
  });
}));

module.exports = router;
