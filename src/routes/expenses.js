const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const CATEGORIES = [
  'İcarə', 'İşçi maaşı', 'Elektrik', 'Su', 'İnternet', 'Reklam', 'Vergi',
  'DSMF', 'Nəqliyyat', 'Təmir', 'Avadanlıq', 'Qablaşdırma', 'Digər',
];

router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(async (req, res) => {
  const monthParam = req.query.month; // format YYYY-MM
  const now = new Date();
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const expenses = await prisma.expense.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: { createdBy: true },
    orderBy: { createdAt: 'desc' },
  });

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = {};
  expenses.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  });

  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  res.render('expenses/index', { expenses, total, byCategory, categories: CATEGORIES, monthValue });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { category, name, amount, method, note } = req.body;
  await prisma.expense.create({
    data: {
      category: category || 'Digər',
      name: name.trim(),
      amount: amount || 0,
      method: ['CASH', 'CARD', 'TRANSFER'].includes(method) ? method : 'CASH',
      note: (note || '').trim() || null,
      createdById: req.session.user.id,
    },
  });
  res.redirect('/expenses');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.expense.delete({ where: { id } });
  res.redirect('/expenses');
}));

module.exports = router;
