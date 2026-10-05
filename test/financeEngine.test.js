const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fixedCostForRange,
  legacyFixedFallback,
  dailyExpenseForRange,
  commitmentStatus,
  dailyRate,
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
