const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username: (username || '').trim() } });

  if (!user || !user.active) {
    return res.render('login', { error: 'İstifadəçi adı və ya şifrə yanlışdır.' });
  }

  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) {
    return res.render('login', { error: 'İstifadəçi adı və ya şifrə yanlışdır.' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  };
  res.redirect('/');
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
