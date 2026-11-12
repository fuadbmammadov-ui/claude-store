const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED'];

router.get('/', asyncHandler(async (req, res) => {
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : '';
  const orders = await prisma.webOrder.findMany({
    where: status ? { status } : {},
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.render('web-orders/index', { orders, status });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.webOrder.findUnique({ where: { id }, include: { items: true } });
  if (!order) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Sifariş tapılmadı.' });
  res.render('web-orders/show', { order });
}));

router.post('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).render('error', { title: 'Yanlış status', message: 'Yanlış status dəyəri.' });
  }
  await prisma.webOrder.update({ where: { id }, data: { status } });
  res.redirect(`/admin/web-orders/${id}`);
}));

module.exports = router;
