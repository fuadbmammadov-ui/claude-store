const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getMonthlyExpenseBreakdown } = require('../utils/expenseAmortization');
const { recentCommitmentsWithStatus } = require('../utils/financeData');
const { CATEGORY_TYPES, GROUPS } = require('../utils/financeEngine');

const router = express.Router();

const STATUS_EPSILON = 0.01;

// Xerc yazmaq (yeni xerc formu + yaratma) hem ADMIN, hem CASHIER ucun acidir -
// satici xerci qeyd ede bilmelidir. Amma xerc siyahisi/cemi/silme/redakte yalniz
// ADMIN-e gorunur, cunki bu maliyye veziyyetini gostərir.

async function getCategoryNames() {
  const rows = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  return rows.map((r) => r.name);
}

router.get('/new', asyncHandler(async (req, res) => {
  const [categories, openCommitmentsAll] = await Promise.all([
    getCategoryNames(),
    recentCommitmentsWithStatus(prisma),
  ]);
  const openCommitments = openCommitmentsAll.filter((r) => r.status !== 'ödənib');

  res.render('expenses/new', {
    categories,
    openCommitments,
    preselectedCommitmentId: req.query.commitmentId ? Number(req.query.commitmentId) : null,
    added: req.query.added === '1',
    warnOverpay: req.query.warn === 'overpay',
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { category, name, amount, method, note, date, periodMonths, commitmentId } = req.body;
  const createdAt = date ? new Date(`${date}T12:00:00Z`) : undefined;
  const period = Math.max(1, parseInt(periodMonths, 10) || 1);
  const linkedCommitmentId = commitmentId ? Number(commitmentId) : null;

  const expense = await prisma.expense.create({
    data: {
      category: category || 'Digər',
      name: name.trim(),
      amount: amount || 0,
      periodMonths: period,
      method: ['CASH', 'CARD', 'TRANSFER', 'EXTERNAL'].includes(method) ? method : 'CASH',
      note: (note || '').trim() || null,
      createdById: req.session.user.id,
      commitmentId: linkedCommitmentId,
      ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
    },
  });

  let overpay = false;
  if (linkedCommitmentId) {
    const commitment = await prisma.commitment.findUnique({ where: { id: linkedCommitmentId } });
    const payments = await prisma.expense.findMany({ where: { commitmentId: linkedCommitmentId } });
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    overpay = commitment && paid > Number(commitment.amount) + STATUS_EPSILON;
  }
  const warnSuffix = overpay ? '&warn=overpay' : '';

  if (req.session.user.role === 'ADMIN') return res.redirect(`/expenses?added=${expense.id}${warnSuffix}`);
  res.redirect(`/expenses/new?added=1${warnSuffix}`);
}));

router.get('/', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const monthParam = req.query.month; // format YYYY-MM
  const now = new Date();
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  const [{ rows: expenses, total, byCategory }, categoryRows, openCommitments] = await Promise.all([
    getMonthlyExpenseBreakdown(prisma, year, month),
    prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
    recentCommitmentsWithStatus(prisma),
  ]);

  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  res.render('expenses/index', {
    expenses, total, byCategory,
    categories: categoryRows.map((c) => c.name),
    categoryRows,
    categoryTypes: CATEGORY_TYPES,
    groups: GROUPS,
    openCommitments,
    monthValue,
    warnOverpay: req.query.warn === 'overpay',
  });
}));

router.patch('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { category, name, amount, note } = req.body;
  await prisma.expense.update({
    where: { id },
    data: {
      ...(category ? { category } : {}),
      ...(name ? { name: name.trim() } : {}),
      ...(amount ? { amount } : {}),
      note: note !== undefined ? ((note || '').trim() || null) : undefined,
    },
  });
  res.redirect(req.get('Referer') || '/expenses');
}));

router.patch('/:id/link-commitment', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const commitmentId = req.body.commitmentId ? Number(req.body.commitmentId) : null;
  await prisma.expense.update({ where: { id }, data: { commitmentId } });
  res.redirect(req.get('Referer') || '/expenses');
}));

router.patch('/categories/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { group, type } = req.body;
  await prisma.expenseCategory.update({
    where: { id },
    data: {
      ...(group ? { group } : {}),
      ...(['gundelik', 'sabit', 'esas_vesait'].includes(type) ? { type } : {}),
    },
  });
  res.redirect('/expenses');
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.expense.delete({ where: { id } });
  res.redirect('/expenses');
}));

module.exports = router;
