const MAX_LOOKBACK_MONTHS = 60;

function monthIndex(year, monthNumber1based) {
  return year * 12 + (monthNumber1based - 1);
}

// Splits multi-month expenses (e.g. a yearly ad payment) evenly across the
// months they cover, so a given month only shows its share instead of the
// full amount on the month it was paid.
async function getMonthlyExpenseBreakdown(prisma, year, month) {
  const targetIndex = monthIndex(year, month);
  const to = new Date(Date.UTC(year, month, 1));
  const lookbackFrom = new Date(Date.UTC(year, month - 1 - MAX_LOOKBACK_MONTHS, 1));

  const candidates = await prisma.expense.findMany({
    where: { createdAt: { gte: lookbackFrom, lt: to } },
    include: { createdBy: true },
    orderBy: { createdAt: 'desc' },
  });

  const rows = candidates
    .map((e) => {
      const periodMonths = e.periodMonths || 1;
      const startIndex = monthIndex(e.createdAt.getUTCFullYear(), e.createdAt.getUTCMonth() + 1);
      const endIndexExclusive = startIndex + periodMonths;
      return { e, periodMonths, startIndex, endIndexExclusive };
    })
    .filter(({ startIndex, endIndexExclusive }) => targetIndex >= startIndex && targetIndex < endIndexExclusive)
    .map(({ e, periodMonths }) => ({
      ...e,
      periodMonths,
      monthlyAmount: Number(e.amount) / periodMonths,
      isSplit: periodMonths > 1,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const total = rows.reduce((s, r) => s + r.monthlyAmount, 0);
  const byCategory = {};
  rows.forEach((r) => {
    byCategory[r.category] = (byCategory[r.category] || 0) + r.monthlyAmount;
  });

  return { rows, total, byCategory };
}

module.exports = { getMonthlyExpenseBreakdown };
