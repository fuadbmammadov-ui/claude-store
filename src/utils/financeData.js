const { computeReport, monthIndex, monthStartFromIndex, commitmentStatus, AZ_MONTH_NAMES } = require('./financeEngine');

const LEGACY_LOOKBACK_MONTHS = 60;

// Idempotent: creates the Commitment for (template, targetMonth) if it doesn't exist yet.
// Multi-month templates anchor their block to the template's own startDate month, so
// re-running this for month 2 or 3 of a 3-month block resolves to the same periodStart
// and the unique(templateId, periodStart) index keeps it a no-op.
async function ensureCommitmentsForMonth(prisma, year, month) {
  const targetIdx = monthIndex(year, month);

  const templates = await prisma.fixedExpenseTemplate.findMany({ where: { active: true } });

  for (const template of templates) {
    const startIdx = monthIndex(template.startDate.getUTCFullYear(), template.startDate.getUTCMonth() + 1);
    if (targetIdx < startIdx) continue;

    const periodMonths = Math.max(1, template.periodMonths || 1);
    const blockOffset = Math.floor((targetIdx - startIdx) / periodMonths);
    const blockStartIdx = startIdx + blockOffset * periodMonths;
    const periodStart = monthStartFromIndex(blockStartIdx);
    const periodEnd = monthStartFromIndex(blockStartIdx + periodMonths);

    // eslint-disable-next-line no-await-in-loop
    const existing = await prisma.commitment.findUnique({
      where: { templateId_periodStart: { templateId: template.id, periodStart } },
    });
    if (existing) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await prisma.commitment.create({
        data: {
          templateId: template.id,
          name: template.name,
          group: template.group,
          amount: template.amount,
          periodMonths,
          periodStart,
          periodEnd,
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err; // created concurrently by another request — fine
    }
  }
}

// Ensures commitments exist for every calendar month touched by [from, to).
async function ensureCommitmentsForRange(prisma, from, to) {
  const lastDay = new Date(to.getTime() - 1);
  const startIdx = monthIndex(from.getUTCFullYear(), from.getUTCMonth() + 1);
  const endIdx = monthIndex(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1);
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const d = monthStartFromIndex(idx);
    // eslint-disable-next-line no-await-in-loop
    await ensureCommitmentsForMonth(prisma, d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
}

async function getCategoryMap(prisma) {
  const rows = await prisma.expenseCategory.findMany();
  const map = {};
  rows.forEach((r) => { map[r.name] = { group: r.group, type: r.type }; });
  return map;
}

// The one function every report page (günlük/həftəlik/aylıq) and the panel call. Fetches
// exactly what computeReport() needs for [from, to) and hands off to the pure engine.
async function buildReport(prisma, from, to) {
  await ensureCommitmentsForRange(prisma, from, to);

  const lookbackFrom = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - LEGACY_LOOKBACK_MONTHS, 1));

  const [saleItems, unlinkedExpenses, commitments, categoryMap] = await Promise.all([
    prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: from, lt: to }, voided: false } } }),
    prisma.expense.findMany({ where: { commitmentId: null, createdAt: { gte: lookbackFrom, lt: to } } }),
    prisma.commitment.findMany({ where: { periodStart: { lt: to }, periodEnd: { gt: from } } }),
    getCategoryMap(prisma),
  ]);

  const commitmentIds = commitments.map((c) => c.id);
  const linkedPayments = commitmentIds.length
    ? await prisma.expense.findMany({ where: { commitmentId: { in: commitmentIds } } })
    : [];

  const expenses = [...unlinkedExpenses, ...linkedPayments];

  return computeReport({ from, to, saleItems, expenses, commitments, categoryMap });
}

// Recent commitments (± a few months around now) with their live hesablanıb/ödənib/qalıq/
// status, newest first — used to populate "Öhdəliyə bağla" pickers ("Əli maaş – Oktyabr
// (qalıq 290 ₼)") on the expense form and the old-expense linking screen.
async function recentCommitmentsWithStatus(prisma, monthsBack = 6) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));

  const commitments = await prisma.commitment.findMany({
    where: { periodStart: { gte: from } },
    orderBy: { periodStart: 'desc' },
  });
  const ids = commitments.map((c) => c.id);
  const payments = ids.length
    ? await prisma.expense.findMany({ where: { commitmentId: { in: ids } } })
    : [];

  return commitments.map((c) => {
    const status = commitmentStatus(c, payments.filter((p) => p.commitmentId === c.id));
    const monthLabel = `${AZ_MONTH_NAMES[c.periodStart.getUTCMonth()]} ${c.periodStart.getUTCFullYear()}`;
    return { commitment: c, monthLabel, ...status };
  });
}

// Real cash movement for [from, to) — separate, read-only query, deliberately independent
// of the accrual-based Sabit/Gündəlik split above and of cashSessions.js's own math.
async function cashFlowForRange(prisma, from, to) {
  const [cashSales, cashDebtPayments, cashExpenses, cashSupplierPayments] = await Promise.all([
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'CASH', createdAt: { gte: from, lt: to }, voided: false } }),
    prisma.debtPayment.aggregate({ _sum: { amount: true }, where: { method: 'CASH', paidAt: { gte: from, lt: to } } }),
    prisma.expense.aggregate({ _sum: { amount: true }, where: { method: 'CASH', createdAt: { gte: from, lt: to } } }),
    prisma.supplierPayment.aggregate({ _sum: { amount: true }, where: { method: 'CASH', paidAt: { gte: from, lt: to } } }),
  ]);

  const cashIn = Number(cashSales._sum.paidAmount || 0) + Number(cashDebtPayments._sum.amount || 0);
  const cashOutExpenses = Number(cashExpenses._sum.amount || 0);
  const cashOutSupplier = Number(cashSupplierPayments._sum.amount || 0);

  return { cashIn, cashOutExpenses, cashOutSupplier, net: cashIn - cashOutExpenses - cashOutSupplier };
}

async function debtSalesForRange(prisma, from, to) {
  const agg = await prisma.sale.aggregate({
    _sum: { totalAmount: true },
    where: { paymentType: 'DEBT', createdAt: { gte: from, lt: to }, voided: false },
  });
  return Number(agg._sum.totalAmount || 0);
}

module.exports = {
  ensureCommitmentsForMonth,
  ensureCommitmentsForRange,
  getCategoryMap,
  buildReport,
  recentCommitmentsWithStatus,
  cashFlowForRange,
  debtSalesForRange,
};
