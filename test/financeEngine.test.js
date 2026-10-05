const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fixedCostForRange,
  legacyFixedFallback,
  dailyExpenseForRange,
  commitmentStatus,
  dailyRate,
  computeReport,
  previousPeriodRange,
  pctDelta,
} = require('../src/utils/financeEngine');

function d(y, m, day) {
  return new Date(Date.UTC(y, m - 1, day));
}

function approx(actual, expected, tol = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`
  );
}

test('October rent: 500 azn / 31 days = 16.13/day, 7 days = 112.90', () => {
  const commitment = {
    id: 1, group: 'İcarə', amount: 500,
    periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1),
  };
  approx(dailyRate(commitment), 16.13, 0.005);

  const from = d(2026, 10, 1);
  const to = d(2026, 10, 8); // 7 days: Oct 1-7
  const rows = fixedCostForRange([commitment], from, to);
  assert.equal(rows.length, 1);
  approx(rows[0].amount, 112.90, 0.01);
});

test('week crossing two months splits between both commitments daily rates', () => {
  const octCommitment = {
    id: 1, group: 'İcarə', amount: 500,
    periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1),
  };
  const novCommitment = {
    id: 2, group: 'İcarə', amount: 600,
    periodStart: d(2026, 11, 1), periodEnd: d(2026, 12, 1),
  };
  // Thu Oct 29 .. Wed Nov 4 inclusive (7 days): 3 days in Oct, 4 days in Nov.
  const from = d(2026, 10, 29);
  const to = d(2026, 11, 5);
  const rows = fixedCostForRange([octCommitment, novCommitment], from, to);
  assert.equal(rows.length, 2);
  const octRow = rows.find((r) => r.commitmentId === 1);
  const novRow = rows.find((r) => r.commitmentId === 2);
  approx(octRow.amount, 3 * (500 / 31));
  approx(novRow.amount, 4 * (600 / 30));
  approx(octRow.amount + novRow.amount, 3 * (500 / 31) + 4 * (600 / 30));
});

test('3-month template: single commitment spread over real day-count of 3 months', () => {
  // 2026 is not a leap year: Jan 31 + Feb 28 + Mar 31 = 90 days.
  const commitment = {
    id: 3, group: 'Maaş', amount: 120,
    periodStart: d(2026, 1, 1), periodEnd: d(2026, 4, 1),
  };
  approx(dailyRate(commitment), 120 / 90, 0.0001);

  const from = d(2026, 2, 8);
  const to = d(2026, 2, 15); // 7 days fully inside February
  const rows = fixedCostForRange([commitment], from, to);
  approx(rows[0].amount, 7 * (120 / 90));
});

test('partial payment leaves "qismən" status with correct qalıq', () => {
  const commitment = { id: 4, amount: 300 };
  const result = commitmentStatus(commitment, [{ amount: 150 }]);
  assert.equal(result.status, 'qismən');
  approx(result.odenib, 150);
  approx(result.qalıq, 150);
});

test('deleting the only payment reverts status to "ödənməyib"', () => {
  const commitment = { id: 4, amount: 300 };
  const beforeDelete = commitmentStatus(commitment, [{ amount: 150 }]);
  assert.equal(beforeDelete.status, 'qismən');

  const afterDelete = commitmentStatus(commitment, []);
  assert.equal(afterDelete.status, 'ödənməyib');
  approx(afterDelete.qalıq, 300);
});

test('full and over payment both report "ödənib"', () => {
  const commitment = { id: 4, amount: 300 };
  const exact = commitmentStatus(commitment, [{ amount: 300 }]);
  assert.equal(exact.status, 'ödənib');
  approx(exact.qalıq, 0);

  const over = commitmentStatus(commitment, [{ amount: 350 }]);
  assert.equal(over.status, 'ödənib');
  approx(over.qalıq, -50);
});

test('a payment linked to a commitment is never double-counted as a daily or legacy expense', () => {
  const categoryMap = {
    'İcarə': { group: 'İcarə', type: 'sabit' },
    'Elektrik': { group: 'Kommunal', type: 'gundelik' },
  };
  const from = d(2026, 10, 1);
  const to = d(2026, 10, 8);

  const linkedRentPayment = {
    id: 10, category: 'İcarə', amount: 500, commitmentId: 1,
    createdAt: d(2026, 10, 3), periodMonths: 1,
  };
  const unlinkedElectricity = {
    id: 11, category: 'Elektrik', amount: 40, commitmentId: null,
    createdAt: d(2026, 10, 3), periodMonths: 1,
  };

  const dailyRows = dailyExpenseForRange([linkedRentPayment, unlinkedElectricity], categoryMap, from, to);
  assert.equal(dailyRows.length, 1);
  assert.equal(dailyRows[0].expenseId, 11);

  const legacyRows = legacyFixedFallback([linkedRentPayment, unlinkedElectricity], categoryMap, from, to);
  assert.equal(legacyRows.length, 0, 'linked commitment payment must not fall back to legacy amortization');
});

test('legacy (pre-commitment) sabit expense prorates across the months it covers', () => {
  const categoryMap = { 'İcarə': { group: 'İcarə', type: 'sabit' } };
  const legacyExpense = {
    id: 20, category: 'İcarə', amount: 300, commitmentId: null,
    createdAt: d(2026, 1, 15), periodMonths: 3, // covers Jan, Feb, Mar fully — 100/month
  };

  const from = d(2026, 1, 1);
  const to = d(2026, 1, 11); // first 10 days of January (31-day month)
  const rows = legacyFixedFallback([legacyExpense], categoryMap, from, to);
  assert.equal(rows.length, 1);
  approx(rows[0].amount, (100 / 31) * 10);
});

// ---------------------------------------------------------------------------
// computeReport() proration (the "charged a full week's fixed cost on day 1" bug fix)
// ---------------------------------------------------------------------------

test('computeReport: Monday of a week only accrues one elapsed day of fixed cost', () => {
  const commitments = [{ id: 1, group: 'İcarə', amount: 500, periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1) }];
  const saleItems = [{ saleId: 1, lineTotal: 104, purchasePrice: 50, quantity: 1 }];
  const report = computeReport({
    from: d(2026, 10, 5), to: d(2026, 10, 12), today: d(2026, 10, 5),
    saleItems, expenses: [], commitments, categoryMap: {},
  });
  assert.equal(report.elapsedDays, 1);
  assert.equal(report.totalDays, 7);
  approx(report.sabitXerc, 500 / 31); // one day's share, not the whole week's
  approx(report.net, 54 - 500 / 31); // marja(104-50) minus that one day's fixed cost
  assert.ok(report.net > 0, 'a single elapsed day must not be charged the full week\'s fixed cost');
});

test('computeReport: mid-month caps elapsed days partway through, full-period total stays whole', () => {
  const commitments = [{ id: 1, group: 'İcarə', amount: 500, periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1) }];
  const report = computeReport({
    from: d(2026, 10, 1), to: d(2026, 11, 1), today: d(2026, 10, 15),
    saleItems: [], expenses: [], commitments, categoryMap: {},
  });
  assert.equal(report.elapsedDays, 15);
  assert.equal(report.totalDays, 31);
  approx(report.sabitXerc, (500 / 31) * 15); // to-date: only 15 days accrued
  approx(report.sabitXercFull, 500); // full-period: the whole deterministic commitment
});

test('computeReport: a fully closed past month matches the old (non-prorated) full-period formula', () => {
  const commitments = [{ id: 1, group: 'İcarə', amount: 500, periodStart: d(2026, 9, 1), periodEnd: d(2026, 10, 1) }];
  const saleItems = [{ saleId: 1, lineTotal: 2000, purchasePrice: 1000, quantity: 1 }];
  const from = d(2026, 9, 1);
  const to = d(2026, 10, 1);
  // "today" is long after the period closed — exactly what every report does once a month is over.
  const report = computeReport({ from, to, today: d(2026, 11, 20), saleItems, expenses: [], commitments, categoryMap: {} });

  assert.equal(report.elapsedDays, report.totalDays);
  approx(report.sabitXerc, report.sabitXercFull);
  approx(report.gundelikXerc, report.gundelikXercProjectedFull);

  // Old formula: (sabitXerc + gündəlikXərc) / (marja / revenue) — must still hold exactly.
  const oldBreakEven = (report.sabitXerc + report.gundelikXerc) / (report.marja / report.revenue);
  approx(report.breakEvenFull, oldBreakEven);
});

test('computeReport: a range crossing two months only accrues fixed cost up to the elapsed cutoff', () => {
  const octCommitment = { id: 1, group: 'İcarə', amount: 500, periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1) };
  const novCommitment = { id: 2, group: 'İcarə', amount: 600, periodStart: d(2026, 11, 1), periodEnd: d(2026, 12, 1) };
  // Week of Oct 29 - Nov 5, viewed on Nov 3 (3 days into October, 3 days into November so far).
  const report = computeReport({
    from: d(2026, 10, 29), to: d(2026, 11, 5), today: d(2026, 11, 3),
    saleItems: [], expenses: [], commitments: [octCommitment, novCommitment], categoryMap: {},
  });
  assert.equal(report.elapsedDays, 6); // Oct 29,30,31 + Nov 1,2,3
  approx(report.sabitXerc, 3 * (500 / 31) + 3 * (600 / 30));
  // Full-period (all 7 days) stays available separately for the breakeven projection.
  approx(report.sabitXercFull, 3 * (500 / 31) + 4 * (600 / 30));
});

test('computeReport: zero sales produces safe nulls instead of NaN/Infinity', () => {
  const commitments = [{ id: 1, group: 'İcarə', amount: 500, periodStart: d(2026, 10, 1), periodEnd: d(2026, 11, 1) }];
  const report = computeReport({
    from: d(2026, 10, 1), to: d(2026, 11, 1), today: d(2026, 10, 10),
    saleItems: [], expenses: [], commitments, categoryMap: {},
  });
  assert.equal(report.revenue, 0);
  assert.equal(report.gmPct, 0);
  assert.equal(report.breakEvenFull, null, 'no margin % means no breakeven point can be projected');
  assert.equal(report.pace, null);
  assert.equal(report.receiptCount, 0);
  assert.equal(report.avgReceipt, 0);
  assert.ok(Number.isFinite(report.net), 'net must stay a finite number even with zero sales');
  assert.ok(['red', 'yellow', 'green'].includes(report.netColor));
});

// ---------------------------------------------------------------------------
// Previous-period comparison window
// ---------------------------------------------------------------------------

test('previousPeriodRange: weekly/daily shift back by the period\'s own day-count', () => {
  const from = d(2026, 10, 5); // a Monday
  const to = d(2026, 10, 12);
  const { prevFrom, prevElapsedEnd } = previousPeriodRange(from, to, 3, false);
  assert.deepEqual(prevFrom, d(2026, 9, 28)); // exactly 7 days back
  assert.deepEqual(prevElapsedEnd, d(2026, 10, 1)); // same 3 elapsed days applied
});

test('previousPeriodRange: monthly shifts by a calendar month, capped to that month\'s length', () => {
  // Viewing Oct 1-5 (5 elapsed days) should compare to Sep 1-5, not "31 days before Oct 1".
  const { prevFrom, prevElapsedEnd } = previousPeriodRange(d(2026, 10, 1), d(2026, 11, 1), 5, true);
  assert.deepEqual(prevFrom, d(2026, 9, 1));
  assert.deepEqual(prevElapsedEnd, d(2026, 9, 6)); // Sep 1 + 5 days = "Sep 1-5"

  // Edge case: Oct 31 elapsed days can't fit inside a 30-day September — must clamp, not overflow into October.
  const edge = previousPeriodRange(d(2026, 10, 1), d(2026, 11, 1), 31, true);
  assert.deepEqual(edge.prevElapsedEnd, d(2026, 10, 1)); // clamped to Sep's own 30-day end
});

test('pctDelta: handles a zero previous value without dividing by zero', () => {
  assert.equal(pctDelta(0, 0), 0);
  assert.equal(pctDelta(50, 0), null);
  approx(pctDelta(120, 100), 0.20);
  approx(pctDelta(80, 100), -0.20);
});
