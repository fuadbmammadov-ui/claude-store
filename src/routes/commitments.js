const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { commitmentStatus, GROUPS, AZ_MONTH_NAMES } = require('../utils/financeEngine');
const { ensureCommitmentsForMonth } = require('../utils/financeData');

const router = express.Router();

router.use(requireRole('ADMIN'));

function monthParamRange(req) {
  const now = new Date();
  const [year, month] = req.query.month
    ? req.query.month.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const monthValue = `${year}-${String(month).padStart(2, '0')}`;
  return { year, month, monthStart, monthEnd, monthValue };
}

async function loadRows(monthStart, monthEnd) {
  const commitments = await prisma.commitment.findMany({
    where: { periodStart: { lt: monthEnd }, periodEnd: { gt: monthStart } },
    orderBy: [{ group: 'asc' }, { name: 'asc' }],
  });
  const ids = commitments.map((c) => c.id);
  const payments = ids.length
    ? await prisma.expense.findMany({ where: { commitmentId: { in: ids } } })
    : [];

  return commitments.map((c) => ({
    commitment: c,
    ...commitmentStatus(c, payments.filter((p) => p.commitmentId === c.id)),
  }));
}

router.get('/', asyncHandler(async (req, res) => {
  const { year, month, monthStart, monthEnd, monthValue } = monthParamRange(req);
  await ensureCommitmentsForMonth(prisma, year, month);

  const rows = await loadRows(monthStart, monthEnd);
  const totals = rows.reduce(
    (acc, r) => ({
      hesablanib: acc.hesablanib + r.hesablanib,
      odenib: acc.odenib + r.odenib,
      qalıq: acc.qalıq + r.qalıq,
    }),
    { hesablanib: 0, odenib: 0, qalıq: 0 }
  );

  res.render('commitments/index', {
    rows, totals, monthValue, year, month, groups: GROUPS,
    monthLabel: `${AZ_MONTH_NAMES[month - 1]} ${year}`,
  });
}));

router.post('/ensure', asyncHandler(async (req, res) => {
  const { year, month, monthValue } = monthParamRange(req);
  await ensureCommitmentsForMonth(prisma, year, month);
  res.redirect(`/commitments?month=${monthValue}`);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { amount, name, group } = req.body;
  await prisma.commitment.update({
    where: { id },
    data: {
      ...(amount ? { amount } : {}),
      ...(name ? { name: name.trim() } : {}),
      ...(group ? { group } : {}),
    },
  });
  res.redirect(req.get('Referer') || '/commitments');
}));

module.exports = router;
