const DAY_MS = 24 * 60 * 60 * 1000;

const GROUPS = [
  'Maaş', 'İcarə', 'Kredit', 'Kommunal', 'Nəqliyyat',
  'Dövlət/Vergi', 'Qablaşdırma', 'Əsas vəsait', 'Digər',
];

const CATEGORY_TYPES = [
  { value: 'gundelik', label: 'Gündəlik' },
  { value: 'sabit', label: 'Sabit (öhdəlik)' },
  { value: 'esas_vesait', label: 'Əsas vəsait' },
];

const FIXED_ASSET_GROUP = 'Əsas vəsait';

const AZ_MONTH_NAMES = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
  'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
];

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// Day-count overlap between [aStart,aEnd) and [bStart,bEnd), both UTC-midnight exclusive-end ranges.
function overlapDays(aStart, aEnd, bStart, bEnd) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const days = daysBetween(start, end);
  return days > 0 ? days : 0;
}

function monthIndex(year, month1based) {
  return year * 12 + (month1based - 1);
}

function monthStartFromIndex(idx) {
  const year = Math.floor(idx / 12);
  const month1based = (idx % 12) + 1;
  return new Date(Date.UTC(year, month1based - 1, 1));
}

function dailyRate(commitment) {
  const days = daysBetween(commitment.periodStart, commitment.periodEnd);
  if (days <= 0) return 0;
  return Number(commitment.amount) / days;
}

function categoryInfo(categoryMap, categoryName) {
  return categoryMap[categoryName] || { group: 'Digər', type: 'gundelik' };
}

// Sabit xərc contributions from materialized commitments for [from,to), excluding
// the "Əsas vəsait" group (capex is never part of Net). One row per commitment touched.
function fixedCostForRange(commitments, from, to) {
  return commitments
    .filter((c) => c.group !== FIXED_ASSET_GROUP)
    .map((c) => {
      const overlap = overlapDays(c.periodStart, c.periodEnd, from, to);
      if (overlap <= 0) return null;
      return { commitmentId: c.id, group: c.group, amount: dailyRate(c) * overlap };
    })
    .filter(Boolean);
}

// Prorates a legacy (pre-commitment-system) multi-month expense's monthly share across
// the real day-count of each calendar month it covers, so weekly/daily ranges that cross
// a month boundary get a proportional slice instead of an all-or-nothing lump.
function prorateLegacyAmount(amount, createdAt, periodMonths, from, to) {
  const months = Math.max(1, periodMonths || 1);
  const monthlyAmount = Number(amount) / months;
  const startIdx = monthIndex(createdAt.getUTCFullYear(), createdAt.getUTCMonth() + 1);
  let total = 0;
  for (let i = 0; i < months; i++) {
    const monthStart = monthStartFromIndex(startIdx + i);
    const monthEnd = monthStartFromIndex(startIdx + i + 1);
    const overlap = overlapDays(monthStart, monthEnd, from, to);
    if (overlap <= 0) continue;
    const daysInMonth = daysBetween(monthStart, monthEnd);
    total += (monthlyAmount / daysInMonth) * overlap;
  }
  return total;
}

// Expenses of type "sabit" that were never linked to a Commitment (data written before
// this system existed, or not yet migrated by an admin) — kept on the old amortization
// behavior so historical months don't shift.
function legacyFixedFallback(expenses, categoryMap, from, to) {
  return expenses
    .filter((e) => !e.commitmentId && categoryInfo(categoryMap, e.category).type === 'sabit')
    .map((e) => {
      const amount = prorateLegacyAmount(e.amount, e.createdAt, e.periodMonths, from, to);
      if (amount <= 0) return null;
      return { expenseId: e.id, group: categoryInfo(categoryMap, e.category).group, amount };
    })
    .filter(Boolean);
}

function inRange(date, from, to) {
  return date >= from && date < to;
}

// "Gündəlik" expenses count in full on the day they were written, never amortized, and
// never double-counted against a commitment (commitmentId must be unset).
function dailyExpenseForRange(expenses, categoryMap, from, to) {
  return expenses
    .filter((e) => !e.commitmentId && categoryInfo(categoryMap, e.category).type === 'gundelik' && inRange(e.createdAt, from, to))
    .map((e) => ({ expenseId: e.id, group: categoryInfo(categoryMap, e.category).group, amount: Number(e.amount) }));
}

// Capex ("əsas vəsait") never enters Net — shown as its own line, full amount on its day.
function fixedAssetPurchasesForRange(expenses, categoryMap, from, to) {
  return expenses
    .filter((e) => categoryInfo(categoryMap, e.category).type === 'esas_vesait' && inRange(e.createdAt, from, to))
    .map((e) => ({ expenseId: e.id, group: categoryInfo(categoryMap, e.category).group, amount: Number(e.amount) }));
}

const STATUS_EPSILON = 0.01;

// Computed on the fly from whatever payments are currently linked — never a stored field,
// so add/edit/delete of a payment "updates" status for free (there's nothing to go stale).
function commitmentStatus(commitment, linkedPayments) {
  const hesablanib = Number(commitment.amount);
  const odenib = linkedPayments.reduce((s, p) => s + Number(p.amount), 0);
  const qalıq = hesablanib - odenib;
  let status;
  if (odenib <= STATUS_EPSILON) status = 'ödənməyib';
  else if (qalıq > STATUS_EPSILON) status = 'qismən';
  else status = 'ödənib';
  return { hesablanib, odenib, qalıq, status };
}

// Per-product revenue/cost/profit/margin for a set of SaleItem rows — shared by the
// Mal üzrə mənfəət report and the weekly/monthly "Diqqət tələb edir" low-margin list.
function productMarginRows(saleItems) {
  const byProduct = {};
  saleItems.forEach((it) => {
    const key = it.productName;
    if (!byProduct[key]) byProduct[key] = { name: key, unit: it.unit, qty: 0, revenue: 0, cost: 0, profit: 0 };
    const cost = Number(it.purchasePrice) * Number(it.quantity);
    byProduct[key].qty += Number(it.quantity);
    byProduct[key].revenue += Number(it.lineTotal);
    byProduct[key].cost += cost;
    byProduct[key].profit += Number(it.lineTotal) - cost;
  });
  return Object.values(byProduct).map((p) => ({ ...p, marginPct: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0 }));
}

function byGroupTotals(rowGroups) {
  const byGroup = {};
  rowGroups.forEach((rows) => {
    rows.forEach((r) => {
      byGroup[r.group] = (byGroup[r.group] || 0) + r.amount;
    });
  });
  return byGroup;
}

// Shared green/yellow/red banding for any "how am I doing vs a target" ratio-minus-one value.
function paceColor(delta) {
  if (delta == null) return null;
  return delta >= 0 ? 'green' : delta >= -0.10 ? 'yellow' : 'red';
}

// Compares this period's to-date actuals against a monthly BusinessTarget (resolved by the
// caller, possibly falling back to the previous month's values). Sales are prorated by
// elapsed days (a daily rate derived from the target's own month length); margin % and
// average-ticket are already rates, so they're compared directly, unprorated.
function targetProgress({ target, elapsedDays, revenue, gmPct, avgReceipt }) {
  if (!target) return null;

  const targetMonthIdx = monthIndex(target.year, target.month);
  const daysInTargetMonth = daysBetween(monthStartFromIndex(targetMonthIdx), monthStartFromIndex(targetMonthIdx + 1));
  const dailyTargetRate = daysInTargetMonth > 0 ? Number(target.salesTarget) / daysInTargetMonth : 0;
  const salesToDateTarget = dailyTargetRate * elapsedDays;
  const salesDelta = salesToDateTarget > 0 ? revenue / salesToDateTarget - 1 : null;

  const gmTargetPct = Number(target.grossMarginTargetPct);
  const gmDelta = gmTargetPct > 0 ? (gmPct * 100) / gmTargetPct - 1 : null;

  const avgTicketTarget = Number(target.avgTicketTarget);
  const avgDelta = avgTicketTarget > 0 ? avgReceipt / avgTicketTarget - 1 : null;

  return {
    dailyTargetRate,
    salesToDateTarget, salesDelta, salesColor: paceColor(salesDelta),
    gmTargetPct, gmDelta, gmColor: paceColor(gmDelta),
    avgTicketTarget, avgDelta, avgColor: paceColor(avgDelta),
    isDefault: Boolean(target.isDefault),
  };
}

// Previous-period window covering the SAME number of elapsed days, so "this Monday" compares
// to "last Monday" and "1-5 Oct" compares to "1-5 Sep" rather than an arbitrary day-count back.
// Monthly shifts by a calendar month (handles different month lengths); everything else
// (daily/custom-range/weekly) shifts by the period's own total day-count.
function previousPeriodRange(from, to, elapsedDays, isMonthly) {
  if (isMonthly) {
    const idx = monthIndex(from.getUTCFullYear(), from.getUTCMonth() + 1);
    const prevFrom = monthStartFromIndex(idx - 1);
    const prevMonthDays = daysBetween(prevFrom, from);
    const cappedElapsed = Math.min(elapsedDays, prevMonthDays);
    return { prevFrom, prevElapsedEnd: new Date(prevFrom.getTime() + cappedElapsed * DAY_MS) };
  }
  const totalDays = daysBetween(from, to);
  const prevFrom = new Date(from.getTime() - totalDays * DAY_MS);
  return { prevFrom, prevElapsedEnd: new Date(prevFrom.getTime() + elapsedDays * DAY_MS) };
}

function pctDelta(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sumAmount(rows) {
  return rows.reduce((s, r) => s + r.amount, 0);
}

// The one shared entry point every report (günlük/həftəlik/aylıq) and the panel call —
// everything downstream (cards, group table, break-even, commitments table) is derived
// here so the numbers can never drift apart between pages.
//
// `today` is the as-of reference date for "how much of this period has actually elapsed".
// Sales/marja are naturally already "to-date" (there are no future Sale rows). Fixed costs
// from commitments/legacy-amortization are deterministic for the WHOLE period (known in
// advance), so the full-period total is used for the breakeven projection; ad-hoc "gündəlik"
// expenses are not knowable in advance, so the full-period projection linearly extrapolates
// from the to-date rate. For a fully closed period (today >= to) elapsedDays == totalDays and
// every "to-date" figure collapses to the old full-period figure — i.e. historical reports
// are bit-for-bit unchanged.
function computeReport({ from, to, today, saleItems, expenses, commitments, categoryMap }) {
  const totalDays = Math.max(0, daysBetween(from, to));
  const todayDay = startOfUtcDay(today || new Date());
  let elapsedEnd = new Date(todayDay.getTime() + DAY_MS);
  if (elapsedEnd > to) elapsedEnd = to;
  if (elapsedEnd < from) elapsedEnd = from;
  const elapsedDays = Math.max(0, daysBetween(from, elapsedEnd));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const isClosed = elapsedDays >= totalDays;

  const revenue = saleItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const marja = saleItems.reduce(
    (s, it) => s + (Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity)),
    0
  );
  const grossProfit = marja;
  const gmPct = revenue > 0 ? grossProfit / revenue : 0;
  const receiptCount = new Set(saleItems.map((it) => it.saleId)).size;
  const avgReceipt = receiptCount > 0 ? revenue / receiptCount : 0;

  // --- to-date (actual, elapsed-days-only) accrual ---
  const fixedToDateRows = fixedCostForRange(commitments, from, elapsedEnd);
  const legacyToDateRows = legacyFixedFallback(expenses, categoryMap, from, elapsedEnd);
  const dailyToDateRows = dailyExpenseForRange(expenses, categoryMap, from, elapsedEnd);
  const fixedAssetRows = fixedAssetPurchasesForRange(expenses, categoryMap, from, elapsedEnd);

  const sabitXerc = sumAmount(fixedToDateRows) + sumAmount(legacyToDateRows);
  const gundelikXerc = sumAmount(dailyToDateRows);
  const fixedAssetTotal = sumAmount(fixedAssetRows);
  const net = marja - sabitXerc - gundelikXerc;

  const byGroup = byGroupTotals([fixedToDateRows, legacyToDateRows, dailyToDateRows]);

  // --- full-period figures, for breakeven/projection ---
  const fixedFullRows = fixedCostForRange(commitments, from, to);
  const legacyFullRows = legacyFixedFallback(expenses, categoryMap, from, to);
  const sabitXercFull = sumAmount(fixedFullRows) + sumAmount(legacyFullRows);
  const gundelikXercProjectedFull = elapsedDays > 0 ? (gundelikXerc / elapsedDays) * totalDays : gundelikXerc;

  const breakEvenFull = gmPct > 0 ? (sabitXercFull + gundelikXercProjectedFull) / gmPct : null;
  const breakEvenReached = breakEvenFull != null && revenue >= breakEvenFull;
  const remaining = breakEvenFull != null ? Math.max(0, breakEvenFull - revenue) : null;
  const dailyNeeded = remaining != null ? (remainingDays > 0 ? remaining / remainingDays : remaining) : null;

  const expectedSalesByNow = (breakEvenFull != null && totalDays > 0) ? (breakEvenFull * elapsedDays) / totalDays : null;
  const pace = (expectedSalesByNow != null && expectedSalesByNow > 0) ? (revenue / expectedSalesByNow) - 1 : null;
  const netColor = net < 0 ? 'red' : (paceColor(pace) || 'yellow');

  // --- full-period projection ("Proqnoz (dövr sonu)" card) ---
  const projSales = elapsedDays > 0 ? (revenue / elapsedDays) * totalDays : revenue;
  const projNet = projSales * gmPct - sabitXercFull - gundelikXercProjectedFull;

  const commitmentRows = commitments
    .filter((c) => c.periodStart < to && c.periodEnd > from)
    .map((c) => {
      const linked = expenses.filter((e) => e.commitmentId === c.id);
      return { commitment: c, ...commitmentStatus(c, linked) };
    });

  return {
    revenue, marja, grossProfit, gmPct, receiptCount, avgReceipt,
    sabitXerc, gundelikXerc, net, netColor,
    sabitXercFull, gundelikXercProjectedFull,
    byGroup, commitmentRows, fixedAssetTotal,
    totalDays, elapsedDays, remainingDays, isClosed,
    breakEvenFull, breakEvenReached, remaining, dailyNeeded, pace,
    projSales, projNet,
  };
}

module.exports = {
  GROUPS,
  CATEGORY_TYPES,
  FIXED_ASSET_GROUP,
  AZ_MONTH_NAMES,
  daysBetween,
  overlapDays,
  monthIndex,
  monthStartFromIndex,
  dailyRate,
  fixedCostForRange,
  legacyFixedFallback,
  dailyExpenseForRange,
  fixedAssetPurchasesForRange,
  commitmentStatus,
  productMarginRows,
  paceColor,
  targetProgress,
  previousPeriodRange,
  pctDelta,
  computeReport,
};
