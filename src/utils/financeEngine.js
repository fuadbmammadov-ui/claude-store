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

function byGroupTotals(rowGroups) {
  const byGroup = {};
  rowGroups.forEach((rows) => {
    rows.forEach((r) => {
      byGroup[r.group] = (byGroup[r.group] || 0) + r.amount;
    });
  });
  return byGroup;
}

// The one shared entry point every report (günlük/həftəlik/aylıq) and the panel call —
// everything downstream (cards, group table, break-even, commitments table) is derived
// here so the numbers can never drift apart between pages.
function computeReport({ from, to, saleItems, expenses, commitments, categoryMap }) {
  const revenue = saleItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const marja = saleItems.reduce(
    (s, it) => s + (Number(it.lineTotal) - Number(it.purchasePrice) * Number(it.quantity)),
    0
  );

  const fixedRows = fixedCostForRange(commitments, from, to);
  const legacyRows = legacyFixedFallback(expenses, categoryMap, from, to);
  const dailyRows = dailyExpenseForRange(expenses, categoryMap, from, to);
  const fixedAssetRows = fixedAssetPurchasesForRange(expenses, categoryMap, from, to);

  const sabitXerc = fixedRows.reduce((s, r) => s + r.amount, 0) + legacyRows.reduce((s, r) => s + r.amount, 0);
  const gundelikXerc = dailyRows.reduce((s, r) => s + r.amount, 0);
  const fixedAssetTotal = fixedAssetRows.reduce((s, r) => s + r.amount, 0);
  const net = marja - sabitXerc - gundelikXerc;

  const breakEvenSales = marja > 0 ? (sabitXerc + gundelikXerc) / (marja / revenue) : null;
  const reservePct = revenue > 0 && breakEvenSales != null ? (revenue - breakEvenSales) / revenue : null;
  const netColor = net < 0 ? 'red' : (reservePct != null && reservePct > 0.20 ? 'green' : 'yellow');

  const byGroup = byGroupTotals([fixedRows, legacyRows, dailyRows]);

  const commitmentRows = commitments
    .filter((c) => c.periodStart < to && c.periodEnd > from)
    .map((c) => {
      const linked = expenses.filter((e) => e.commitmentId === c.id);
      return { commitment: c, ...commitmentStatus(c, linked) };
    });

  return {
    revenue, marja, sabitXerc, gundelikXerc, net,
    breakEvenSales, reservePct, netColor,
    byGroup, commitmentRows, fixedAssetTotal,
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
  computeReport,
};
