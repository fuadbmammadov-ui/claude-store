const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.render('users/index', { users });
}));

router.get('/new', (req, res) => {
  res.render('users/form', { user: null, error: null });
});

router.post('/', asyncHandler(async (req, res) => {
  const { username, password, fullName, role } = req.body;
  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) {
    return res.render('users/form', { user: null, error: 'Bu istifadəçi adı artıq mövcuddur.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username: username.trim(),
      passwordHash,
      fullName: fullName.trim(),
      role: role === 'ADMIN' ? 'ADMIN' : 'CASHIER',
    },
  });
  res.redirect('/users');
}));

router.post('/:id/toggle-active', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).render('error', { title: 'Tapılmadı', message: 'İstifadəçi tapılmadı.' });
  await prisma.user.update({ where: { id }, data: { active: !user.active } });
  res.redirect('/users');
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  res.redirect('/users');
}));

module.exports = router;
