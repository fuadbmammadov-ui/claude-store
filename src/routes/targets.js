const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { AZ_MONTH_NAMES } = require('../utils/financeEngine');
const { resolveTarget } = require('../utils/financeData');

const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(async (req, res) => {
  const now = new Date();
  const [year, month] = req.query.month
    ? req.query.month.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  const [target, allTargets] = await Promise.all([
    resolveTarget(prisma, year, month),
    prisma.businessTarget.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' } ] }),
  ]);

  res.render('targets/index', {
    year, month,
    monthValue: `${year}-${String(month).padStart(2, '0')}`,
    monthLabel: `${AZ_MONTH_NAMES[month - 1]} ${year}`,
    target, allTargets, AZ_MONTH_NAMES,
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const salesTarget = Number(req.body.salesTarget) || 0;
  const grossMarginTargetPct = Number(req.body.grossMarginTargetPct) || 0;
  const avgTicketTarget = Number(req.body.avgTicketTarget) || 0;

  await prisma.businessTarget.upsert({
    where: { year_month: { year, month } },
    update: { salesTarget, grossMarginTargetPct, avgTicketTarget },
    create: { year, month, salesTarget, grossMarginTargetPct, avgTicketTarget },
  });

  res.redirect(`/targets?month=${year}-${String(month).padStart(2, '0')}`);
}));

module.exports = router;
