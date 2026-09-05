const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getMonthlyExpenseBreakdown } = require('../utils/expenseAmortization');

const router = express.Router();

const CATEGORIES = [
  'İcarə', 'İşçi maaşı', 'Elektrik', 'Su', 'İnternet', 'Reklam', 'Vergi',
  'DSMF', 'Nəqliyyat', 'Təmir', 'Avadanlıq', 'Qablaşdırma', 'Digər',
];

// Xerc yazmaq (yeni xerc formu + yaratma) hem ADMIN, hem CASHIER ucun acidir -
// satici xerci qeyd ede bilmelidir. Amma xerc siyahisi/cemi/silme yalniz ADMIN-e
// gorunur, cunki bu maliyye veziyyetini gostərir.

router.get('/new', (req, res) => {
  res.render('expenses/new', { categories: CATEGORIES, added: req.query.added === '1' });
});

router.post('/', asyncHandler(async (req, res) => {
  const { category, name, amount, method, note, date, periodMonths } = req.body;
  const createdAt = date ? new Date(`${date}T12:00:00Z`) : undefined;
  const period = Math.max(1, parseInt(periodMonths, 10) || 1);
  await prisma.expense.create({
    data: {
      category: category || 'Digər',
      name: name.trim(),
      amount: amount || 0,
      periodMonths: period,
      method: ['CASH', 'CARD', 'TRANSFER', 'EXTERNAL'].includes(method) ? method : 'CASH',
      note: (note || '').trim() || null,
      createdById: req.session.user.id,
      ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
    },
  });

  if (req.session.user.role === 'ADMIN') return res.redirect('/expenses');
  res.redirect('/expenses/new?added=1');
}));

router.get('/', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const monthParam = req.query.month; // format YYYY-MM
  const now = new Date();
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  const { rows: expenses, total, byCategory } = await getMonthlyExpenseBreakdown(prisma, year, month);

  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  res.render('expenses/index', { expenses, total, byCategory, categories: CATEGORIES, monthValue });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.expense.delete({ where: { id } });
  res.redirect('/expenses');
}));

module.exports = router;
