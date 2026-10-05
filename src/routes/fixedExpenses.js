const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { GROUPS } = require('../utils/financeEngine');

const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(async (req, res) => {
  const templates = await prisma.fixedExpenseTemplate.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  res.render('fixed-expenses/index', { templates, groups: GROUPS });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, group, amount, periodMonths, startDate } = req.body;
  await prisma.fixedExpenseTemplate.create({
    data: {
      name: (name || '').trim(),
      group: group || 'Digər',
      amount: amount || 0,
      periodMonths: Math.max(1, parseInt(periodMonths, 10) || 1),
      startDate: startDate ? new Date(`${startDate}T00:00:00Z`) : new Date(),
    },
  });
  res.redirect('/fixed-expenses');
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { name, group, amount, periodMonths, startDate } = req.body;
  await prisma.fixedExpenseTemplate.update({
    where: { id },
    data: {
      name: (name || '').trim(),
      group: group || 'Digər',
      amount: amount || 0,
      periodMonths: Math.max(1, parseInt(periodMonths, 10) || 1),
      ...(startDate ? { startDate: new Date(`${startDate}T00:00:00Z`) } : {}),
    },
  });
  res.redirect('/fixed-expenses');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.fixedExpenseTemplate.update({ where: { id }, data: { active: false } });
  res.redirect('/fixed-expenses');
}));

router.post('/:id/activate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.fixedExpenseTemplate.update({ where: { id }, data: { active: true } });
  res.redirect('/fixed-expenses');
}));

module.exports = router;
