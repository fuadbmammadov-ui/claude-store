const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getMonthlyExpenseBreakdown } = require('../utils/expenseAmortization');
const { buildReport, cashFlowForRange, debtSalesForRange } = require('../utils/financeData');

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

function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function isoWeekRange(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const from = new Date(simple);
  from.setUTCDate(simple.getUTCDate() - dow + 1);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + 7);
  return { from, to };
}

function parseIsoWeekParam(w) {
  const m = /^(\d{4})-W(\d{2})$/.exec(w || '');
  if (!m) return null;
  return { year: Number(m[1]), week: Number(m[2]) };
}

function mondayOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - dow + 1);
  return d;
}

function toIsoWeekParam(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday decides the ISO week-year
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// Unifies month- and week-based report filtering behind one query param set.
function periodRange(req) {
  const period = req.query.period === 'week' ? 'week' : 'month';
  if (period === 'week') {
    const now = new Date();
    const parsed = parseIsoWeekParam(req.query.w) || { year: now.getFullYear(), week: getIsoWeek(now) };
    const { from, to } = isoWeekRange(parsed.year, parsed.week);
    const wValue = `${parsed.year}-W${String(parsed.week).padStart(2, '0')}`;
    return { period, year: parsed.year, week: parsed.week, wValue, from, to };
  }
  const { year, month, from, to, daysInMonth } = monthRange(req);
  return { period, year, month, from, to, daysInMonth };
}

router.get('/', (req, res) => res.redirect('/reports/daily'));

router.get('/daily', asyncHandler(async (req, res) => {
  const fromParam = req.query.from || req.query.date;
  const toParam = req.query.to || req.query.date;
  const fromDay = fromParam ? new Date(fromParam) : new Date();
  const toDay = toParam ? new Date(toParam) : fromDay;
  const from = new Date(fromDay);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDay);
  to.setHours(23, 59, 59, 999);

  const sales = await prisma.sale.findMany({
    where: { createdAt: { gte: from, lte: to }, voided: false },
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

  // [from, to] above is inclusive end-of-day (23:59:59.999); the shared engine wants a
  // half-open [from, to) range, so give it the start of the next day as the exclusive end.
  const reportTo = new Date(to.getTime() + 1);
  const [report, cashFlow, debtSales] = await Promise.all([
    buildReport(prisma, from, reportTo),
    cashFlowForRange(prisma, from, reportTo),
    debtSalesForRange(prisma, from, reportTo),
  ]);

  res.render('reports/daily', {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    sales,
    totals,
    receiptsToday,
    totalPurchases,
    report,
    cashFlow,
    debtSales,
    paymentLabel,
  });
}));

router.get('/monthly', asyncHandler(async (req, res) => {
  const { year, month, from, to, daysInMonth } = monthRange(req);

  const [saleItems, sales, supplierDebtRows, activeProducts, report, cashFlow, periodDebtSales] = await Promise.all([
    prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from, lt: to }, voided: false } } }),
    prisma.sale.findMany({ where: { createdAt: { gte: from, lt: to }, voided: false } }),
    prisma.stockReceipt.findMany({ where: { status: 'DEBT' }, select: { totalAmount: true, paidAmount: true } }),
    prisma.product.findMany({ where: { active: true }, select: { quantity: true, purchasePrice: true } }),
    buildReport(prisma, from, to),
    cashFlowForRange(prisma, from, to),
    debtSalesForRange(prisma, from, to),
  ]);

  const revenue = saleItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const cogs = saleItems.reduce((s, it) => s + Number(it.purchasePrice) * Number(it.quantity), 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  const cashSales = sales.filter((s) => s.paymentType === 'CASH').reduce((s, x) => s + Number(x.paidAmount), 0);
  const cardSales = sales.filter((s) => s.paymentType === 'CARD').reduce((s, x) => s + Number(x.paidAmount), 0);
  const transferSales = sales.filter((s) => s.paymentType === 'TRANSFER').reduce((s, x) => s + Number(x.paidAmount), 0);

  const supplierDebtTotal = supplierDebtRows.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount)), 0);
  const inventoryValue = activeProducts.reduce((s, p) => s + Number(p.quantity) * Number(p.purchasePrice), 0);

  const salesCount = sales.length;
  const avgDailySale = revenue / daysInMonth;
  const avgTransactionValue = salesCount > 0 ? revenue / salesCount : 0;
  const inventoryTurnover = inventoryValue > 0 ? cogs / inventoryValue : 0;

  res.render('reports/monthly', {
    year, month,
    revenue, cogs, grossProfit, grossMarginPct,
    cashSales, cardSales, transferSales, debtSales: periodDebtSales,
    supplierDebtTotal, inventoryValue,
    avgDailySale, avgTransactionValue, inventoryTurnover, salesCount,
    report, cashFlow,
  });
}));

router.get('/weekly', asyncHandler(async (req, res) => {
  const now = new Date();
  let from;
  let to;
  let wValue;
  const customRange = Boolean(req.query.from || req.query.to);

  if (customRange) {
    const fromDay = req.query.from ? new Date(req.query.from) : now;
    const toDay = req.query.to ? new Date(req.query.to) : fromDay;
    from = new Date(Date.UTC(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate()));
    to = new Date(Date.UTC(toDay.getFullYear(), toDay.getMonth(), toDay.getDate()));
    to.setUTCDate(to.getUTCDate() + 1); // make the "to" day inclusive
    wValue = toIsoWeekParam(from);
  } else {
    const parsed = parseIsoWeekParam(req.query.w);
    from = parsed ? mondayOfWeek(new Date(Date.UTC(parsed.year, 0, 1 + (parsed.week - 1) * 7))) : mondayOfWeek(now);
    to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 7);
    wValue = toIsoWeekParam(from);
  }

  const prevWeekFrom = new Date(from);
  prevWeekFrom.setUTCDate(from.getUTCDate() - 7);
  const nextWeekFrom = new Date(from);
  nextWeekFrom.setUTCDate(from.getUTCDate() + 7);

  const [report, cashFlow, debtSales] = await Promise.all([
    buildReport(prisma, from, to),
    cashFlowForRange(prisma, from, to),
    debtSalesForRange(prisma, from, to),
  ]);

  // Son 8 həftənin Satış/Xərc/Net qrafiki — həmişə bu günə əsasən, baxılan həftədən asılı olmayaraq.
  const WEEKS = 8;
  const currentMonday = mondayOfWeek(now);
  const chartLabels = [];
  const chartRevenue = [];
  const chartExpense = [];
  const chartNet = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const wkFrom = new Date(currentMonday);
    wkFrom.setUTCDate(currentMonday.getUTCDate() - i * 7);
    const wkTo = new Date(wkFrom);
    wkTo.setUTCDate(wkFrom.getUTCDate() + 7);
    // eslint-disable-next-line no-await-in-loop
    const wkReport = await buildReport(prisma, wkFrom, wkTo);
    chartLabels.push(`${String(wkFrom.getUTCDate()).padStart(2, '0')}.${String(wkFrom.getUTCMonth() + 1).padStart(2, '0')}`);
    chartRevenue.push(wkReport.revenue);
    chartExpense.push(wkReport.sabitXerc + wkReport.gundelikXerc);
    chartNet.push(wkReport.net);
  }

  res.render('reports/weekly', {
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    wValue,
    customRange,
    prevW: toIsoWeekParam(prevWeekFrom),
    nextW: toIsoWeekParam(nextWeekFrom),
    report, cashFlow, debtSales,
    chartLabels, chartRevenue, chartExpense, chartNet,
  });
}));

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.get('/trends', asyncHandler(async (req, res) => {
  const now = new Date();

  // Gündəlik gedişat - son 30 gün
  const DAYS = 30;
  const dayFrom = new Date(now);
  dayFrom.setHours(0, 0, 0, 0);
  dayFrom.setDate(dayFrom.getDate() - (DAYS - 1));

  const dailySales = await prisma.sale.findMany({
    where: { createdAt: { gte: dayFrom }, voided: false },
    select: { totalAmount: true, createdAt: true },
  });

  const dayBuckets = new Map();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(dayFrom);
    d.setDate(d.getDate() + i);
    dayBuckets.set(localDateKey(d), 0);
  }
  dailySales.forEach((s) => {
    const key = localDateKey(s.createdAt);
    if (dayBuckets.has(key)) dayBuckets.set(key, dayBuckets.get(key) + Number(s.totalAmount));
  });
  const dailyLabels = [...dayBuckets.keys()].map((k) => k.slice(5).split('-').reverse().join('.'));
  const dailyValues = [...dayBuckets.values()];

  // Gündəlik net gəlir gedişatı - son 30 gün (satış qazancı - həmin ayın gündəlik xərc payı)
  const dailyItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: dayFrom }, voided: false } },
    select: { lineTotal: true, purchasePrice: true, quantity: true, sale: { select: { createdAt: true } } },
  });

  const dayNetBuckets = new Map();
  for (const key of dayBuckets.keys()) dayNetBuckets.set(key, 0);
  dailyItems.forEach((it) => {
    const key = localDateKey(it.sale.createdAt);
    if (!dayNetBuckets.has(key)) return;
    const grossProfit = Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity);
    dayNetBuckets.set(key, dayNetBuckets.get(key) + grossProfit);
  });

  const expenseCache = new Map();
  for (const key of dayNetBuckets.keys()) {
    const [y, m] = key.split('-').map(Number);
    const cacheKey = `${y}-${m}`;
    if (!expenseCache.has(cacheKey)) {
      // eslint-disable-next-line no-await-in-loop
      const { total } = await getMonthlyExpenseBreakdown(prisma, y, m);
      const daysInThatMonth = new Date(y, m, 0).getDate();
      expenseCache.set(cacheKey, total / daysInThatMonth);
    }
    dayNetBuckets.set(key, dayNetBuckets.get(key) - expenseCache.get(cacheKey));
  }
  const dailyNetValues = [...dayNetBuckets.values()];

  // Aylıq gedişat - son 12 ay
  const MONTHS = 12;
  const monthNames = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
  const monthFrom = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1));
  const monthlySales = await prisma.sale.findMany({
    where: { createdAt: { gte: monthFrom }, voided: false },
    select: { totalAmount: true, createdAt: true },
  });

  const monthBuckets = new Map();
  for (let i = 0; i < MONTHS; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (MONTHS - 1) + i, 1));
    monthBuckets.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, 0);
  }
  monthlySales.forEach((s) => {
    const key = `${s.createdAt.getUTCFullYear()}-${s.createdAt.getUTCMonth()}`;
    if (monthBuckets.has(key)) monthBuckets.set(key, monthBuckets.get(key) + Number(s.totalAmount));
  });
  const monthlyLabels = [...monthBuckets.keys()].map((k) => {
    const [y, m] = k.split('-').map(Number);
    return `${monthNames[m]} ${y}`;
  });
  const monthlyValues = [...monthBuckets.values()];

  // Run rate - cari ayın gedişatına əsasən proyeksiya
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const monthToDateAgg = await prisma.sale.aggregate({
    _sum: { totalAmount: true },
    where: { createdAt: { gte: monthStart }, voided: false },
  });
  const monthToDateRevenue = Number(monthToDateAgg._sum.totalAmount || 0);
  const dailyRunRate = daysElapsed > 0 ? monthToDateRevenue / daysElapsed : 0;
  const projectedMonthRevenue = dailyRunRate * daysInMonth;
  const annualRunRate = projectedMonthRevenue * 12;

  // Gəlir / xərc / mənfəət gedişatı - son 6 ay
  const FIN_MONTHS = 6;
  const financeTrend = [];
  for (let i = FIN_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const mFrom = new Date(Date.UTC(y, m - 1, 1));
    const mTo = new Date(Date.UTC(y, m, 1));
    // eslint-disable-next-line no-await-in-loop
    const items = await prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: mFrom, lt: mTo }, voided: false } } });
    const rev = items.reduce((s, it) => s + Number(it.lineTotal), 0);
    const cost = items.reduce((s, it) => s + Number(it.purchasePrice) * Number(it.quantity), 0);
    // eslint-disable-next-line no-await-in-loop
    const { total: exp } = await getMonthlyExpenseBreakdown(prisma, y, m);
    financeTrend.push({
      label: `${monthNames[m - 1]} ${y}`,
      revenue: rev,
      expenses: exp,
      netProfit: rev - cost - exp,
    });
  }

  // Ödəniş növü üzrə paylanma - cari ay
  const [cashAgg, cardAgg, transferAgg, debtAgg] = await Promise.all([
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'CASH', createdAt: { gte: monthStart }, voided: false } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'CARD', createdAt: { gte: monthStart }, voided: false } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'TRANSFER', createdAt: { gte: monthStart }, voided: false } }),
    prisma.sale.aggregate({ _sum: { totalAmount: true }, where: { paymentType: 'DEBT', createdAt: { gte: monthStart }, voided: false } }),
  ]);
  const paymentBreakdown = [
    { label: 'Nağd', value: Number(cashAgg._sum.paidAmount || 0) },
    { label: 'Kart', value: Number(cardAgg._sum.paidAmount || 0) },
    { label: 'Köçürmə', value: Number(transferAgg._sum.paidAmount || 0) },
    { label: 'Borc', value: Number(debtAgg._sum.totalAmount || 0) },
  ];

  // Ən çox satılan mallar (məbləğ üzrə) - cari ay, top 5
  const monthItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: monthStart }, voided: false } },
  });
  const byProduct = {};
  monthItems.forEach((it) => {
    const key = it.productName;
    byProduct[key] = (byProduct[key] || 0) + Number(it.lineTotal);
  });
  const topProducts = Object.entries(byProduct)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.render('reports/trends', {
    dailyLabels, dailyValues, dailyNetValues,
    monthlyLabels, monthlyValues,
    monthToDateRevenue, daysElapsed, daysInMonth,
    dailyRunRate, projectedMonthRevenue, annualRunRate,
    financeTrend, paymentBreakdown, topProducts,
  });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const { period, year, month, week, wValue, from, to } = periodRange(req);

  const saleItems = await prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from, lt: to }, voided: false } } });

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

  res.render('reports/products', { period, year, month, week, wValue, rows });
}));

router.get('/categories', asyncHandler(async (req, res) => {
  const { period, year, month, week, wValue, from, to } = periodRange(req);

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: from, lt: to }, voided: false } },
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

  res.render('reports/categories', { period, year, month, week, wValue, rows, total });
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
