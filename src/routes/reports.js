const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getMonthlyExpenseBreakdown } = require('../utils/expenseAmortization');

const router = express.Router();

router.use(requireRole('ADMIN'));

function paymentLabel(type) {
  return type === 'CASH' ? 'Nağd' : type === 'CARD' ? 'Kart' : type === 'TRANSFER' ? 'Köçürmə' : 'Borc';
}

function monthRange(req) {
  const now = new Date();
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, from, to, daysInMonth };
}

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

  const totals = { cash: 0, card: 0, transfer: 0, debt: 0, revenue: 0, cost: 0, profit: 0 };
  sales.forEach((s) => {
    totals.revenue += Number(s.totalAmount);
    if (s.paymentType === 'CASH') totals.cash += Number(s.paidAmount);
    if (s.paymentType === 'CARD') totals.card += Number(s.paidAmount);
    if (s.paymentType === 'TRANSFER') totals.transfer += Number(s.paidAmount);
    if (s.paymentType === 'DEBT') totals.debt += Number(s.totalAmount);
    s.items.forEach((it) => {
      totals.cost += Number(it.purchasePrice) * Number(it.quantity);
      totals.profit += Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity);
    });
  });

  const receiptsToday = await prisma.stockReceipt.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: { product: true, receivedBy: true, supplier: true },
  });
  const totalPurchases = receiptsToday.reduce((s, r) => s + Number(r.quantity) * Number(r.purchasePrice), 0);

  const expensesToday = await prisma.expense.findMany({ where: { createdAt: { gte: from, lte: to } } });
  const totalExpensesToday = expensesToday.reduce((s, e) => s + Number(e.amount), 0);

  res.render('reports/daily', {
    day: from.toISOString().slice(0, 10),
    sales,
    totals,
    receiptsToday,
    totalPurchases,
    expensesToday,
    totalExpensesToday,
    paymentLabel,
  });
}));

router.get('/monthly', asyncHandler(async (req, res) => {
  const { year, month, from, to, daysInMonth } = monthRange(req);

  const [saleItems, sales, { total: expenseTotal }, supplierDebtRows, activeProducts] = await Promise.all([
    prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from, lt: to } } } }),
    prisma.sale.findMany({ where: { createdAt: { gte: from, lt: to } } }),
    getMonthlyExpenseBreakdown(prisma, year, month),
    prisma.stockReceipt.findMany({ where: { status: 'DEBT' }, select: { totalAmount: true, paidAmount: true } }),
    prisma.product.findMany({ where: { active: true }, select: { quantity: true, purchasePrice: true } }),
  ]);

  const revenue = saleItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const cogs = saleItems.reduce((s, it) => s + Number(it.purchasePrice) * Number(it.quantity), 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netProfit = grossProfit - expenseTotal;
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const cashSales = sales.filter((s) => s.paymentType === 'CASH').reduce((s, x) => s + Number(x.paidAmount), 0);
  const cardSales = sales.filter((s) => s.paymentType === 'CARD').reduce((s, x) => s + Number(x.paidAmount), 0);
  const transferSales = sales.filter((s) => s.paymentType === 'TRANSFER').reduce((s, x) => s + Number(x.paidAmount), 0);
  const debtSales = sales.filter((s) => s.paymentType === 'DEBT').reduce((s, x) => s + Number(x.totalAmount), 0);

  const supplierDebtTotal = supplierDebtRows.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount)), 0);
  const inventoryValue = activeProducts.reduce((s, p) => s + Number(p.quantity) * Number(p.purchasePrice), 0);

  const cashFlowEstimate = netProfit;

  const fixedCosts = expenseTotal;
  const breakEvenSales = grossMarginPct > 0 ? fixedCosts / (grossMarginPct / 100) : 0;
  const dailyTarget = breakEvenSales / daysInMonth;
  const salesCount = sales.length;
  const avgDailySale = revenue / daysInMonth;
  const avgTransactionValue = salesCount > 0 ? revenue / salesCount : 0;
  const inventoryTurnover = inventoryValue > 0 ? cogs / inventoryValue : 0;
  const status = netProfit >= 0 ? 'MƏNFƏƏTLİ ✓' : 'ZƏRƏRLƏ İŞLƏYİR ✗';

  res.render('reports/monthly', {
    year, month,
    revenue, cogs, grossProfit, grossMarginPct, expenseTotal, netProfit, netMarginPct,
    cashSales, cardSales, transferSales, debtSales,
    supplierDebtTotal, inventoryValue, cashFlowEstimate,
    fixedCosts, breakEvenSales, dailyTarget, avgDailySale, avgTransactionValue,
    inventoryTurnover, salesCount, status,
  });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const { year, month, from, to } = monthRange(req);

  const saleItems = await prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from, lt: to } } } });

  const byProduct = {};
  saleItems.forEach((it) => {
    const key = it.productName;
    if (!byProduct[key]) byProduct[key] = { name: key, qty: 0, revenue: 0, cost: 0, profit: 0 };
    const cost = Number(it.purchasePrice) * Number(it.quantity);
    byProduct[key].qty += Number(it.quantity);
    byProduct[key].revenue += Number(it.lineTotal);
    byProduct[key].cost += cost;
    byProduct[key].profit += Number(it.lineTotal) - cost;
  });
  const rows = Object.values(byProduct)
    .map((p) => ({ ...p, marginPct: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  res.render('reports/products', { year, month, rows });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  const { year, month, from, to } = monthRange(req);

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: from, lt: to } } },
    include: { product: { select: { category: true } } },
  });

  const byCategory = {};
  saleItems.forEach((it) => {
    const key = (it.product && it.product.category) || 'Kateqoriyasız';
    byCategory[key] = (byCategory[key] || 0) + Number(it.lineTotal);
  });
  const rows = Object.entries(byCategory)
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((s, r) => s + r.revenue, 0);

  res.render('reports/categories', { year, month, rows, total });
}));

router.get('/critical-stock', asyncHandler(async (req, res) => {
  const products = await prisma.product.findMany({
    where: { active: true, minStock: { not: null } },
    orderBy: { name: 'asc' },
  });
  const critical = products.filter((p) => Number(p.quantity) <= Number(p.minStock));
  res.render('reports/critical-stock', { critical });
}));

module.exports = router;
