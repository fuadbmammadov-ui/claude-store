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
  const now = new Date();
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const monthFrom = new Date(Date.UTC(year, month - 1, 1));
  const monthTo = new Date(Date.UTC(year, month, 1));

  const [cashSales, cardSales, transferSales, debtSales, saleItemsToday, openSession, lowStock] = await Promise.all([
    prisma.sale.aggregate({ _sum: { paidAmount: true }, _count: true, where: { paymentType: 'CASH', createdAt: { gte: from } } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, _count: true, where: { paymentType: 'CARD', createdAt: { gte: from } } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, _count: true, where: { paymentType: 'TRANSFER', createdAt: { gte: from } } }),
    prisma.sale.aggregate({ _sum: { totalAmount: true }, _count: true, where: { paymentType: 'DEBT', createdAt: { gte: from } } }),
    prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from } } } }),
    prisma.cashSession.findFirst({ where: { closedAt: null } }),
    prisma.product.findMany({ where: { active: true, minStock: { not: null } } }),
  ]);

  const profitToday = saleItemsToday.reduce(
    (sum, it) => sum + (Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity)),
    0
  );

  const lowStockList = lowStock.filter((p) => Number(p.quantity) <= Number(p.minStock));

  // --- selected month KPIs ---
  const monthSaleItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: monthFrom, lt: monthTo } } },
  });
  const monthExpenses = await prisma.expense.aggregate({
    _sum: { amount: true },
    where: { createdAt: { gte: monthFrom, lt: monthTo } },
  });

  const monthRevenue = monthSaleItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const monthGrossProfit = monthSaleItems.reduce(
    (s, it) => s + (Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity)),
    0
  );
  const monthExpenseTotal = Number(monthExpenses._sum.amount || 0);
  const monthNetProfit = monthGrossProfit - monthExpenseTotal;

  const byProduct = {};
  monthSaleItems.forEach((it) => {
    const key = it.productName;
    if (!byProduct[key]) byProduct[key] = { name: key, qty: 0, revenue: 0, profit: 0 };
    byProduct[key].qty += Number(it.quantity);
    byProduct[key].revenue += Number(it.lineTotal);
    byProduct[key].profit += Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity);
  });
  const productList = Object.values(byProduct);
  const topSelling = [...productList].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topProfit = [...productList].sort((a, b) => b.profit - a.profit).slice(0, 5);

  const supplierDebtAgg = await prisma.stockReceipt.findMany({
    where: { status: 'DEBT' },
    select: { totalAmount: true, paidAmount: true },
  });
  const supplierDebtTotal = supplierDebtAgg.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount)), 0);

  res.render('dashboard', {
    cashTotal: Number(cashSales._sum.paidAmount || 0),
    cashCount: cashSales._count,
    cardTotal: Number(cardSales._sum.paidAmount || 0),
    cardCount: cardSales._count,
    transferTotal: Number(transferSales._sum.paidAmount || 0),
    transferCount: transferSales._count,
    debtTotal: Number(debtSales._sum.totalAmount || 0),
    debtCount: debtSales._count,
    profitToday,
    openSession,
    lowStockList,
    year,
    month,
    monthRevenue,
    monthGrossProfit,
    monthExpenseTotal,
    monthNetProfit,
    topSelling,
    topProfit,
    supplierDebtTotal,
  });
}));

module.exports = router;
