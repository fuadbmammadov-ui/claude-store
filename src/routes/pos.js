const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pos/index');
});

router.get('/lookup', asyncHandler(async (req, res) => {
  const barcode = (req.query.barcode || '').trim();
  if (!barcode) return res.status(400).json({ error: 'Barkod boşdur' });

  const product = await prisma.product.findUnique({ where: { barcode } });
  if (!product || !product.active) return res.status(404).json({ error: 'Mal tapılmadı' });
  if (Number(product.quantity) <= 0) {
    return res.status(409).json({ error: `${product.name} anbarda yoxdur` });
  }

  res.json(product);
}));

router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const products = await prisma.product.findMany({
    where: { active: true, name: { contains: q, mode: 'insensitive' } },
    take: 10,
  });
  res.json(products);
}));

router.get('/customers-search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const customers = await prisma.customer.findMany({
    where: {
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }],
    },
    take: 10,
  });
  res.json(customers);
}));

router.post('/checkout', async (req, res) => {
  try {
    const { items, paymentType, customerId, customerName, customerPhone } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Səbət boşdur' });
    }
    if (!['CASH', 'CARD', 'DEBT'].includes(paymentType)) {
      return res.status(400).json({ error: 'Ödəniş növü yanlışdır' });
    }
    if (paymentType === 'DEBT' && !customerId && !(customerName && customerName.trim())) {
      return res.status(400).json({ error: 'Borca yazmaq üçün müştəri seçin və ya əlavə edin' });
    }

    const result = await prisma.$transaction(async (tx) => {
      let resolvedCustomerId = customerId ? Number(customerId) : null;
      if (!resolvedCustomerId && paymentType === 'DEBT') {
        const customer = await tx.customer.create({
          data: { name: customerName.trim(), phone: (customerPhone || '').trim() || null },
        });
        resolvedCustomerId = customer.id;
      }

      let totalAmount = 0;
      const saleItemsData = [];

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: Number(item.productId) } });
        if (!product || !product.active) throw new Error('Mal tapılmadı');

        const requestedQty = Number(item.quantity);
        if (!requestedQty || requestedQty <= 0) throw new Error(`${product.name}: miqdar yanlışdır`);
        if (Number(product.quantity) < requestedQty) {
          throw new Error(`${product.name}: anbarda kifayət qədər yoxdur (qalıq: ${product.quantity})`);
        }

        const lineTotal = requestedQty * Number(product.salePrice);
        totalAmount += lineTotal;

        saleItemsData.push({
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          quantity: requestedQty,
          unitPrice: product.salePrice,
          purchasePrice: product.purchasePrice,
          lineTotal,
        });

        await tx.product.update({
          where: { id: product.id },
          data: { quantity: { decrement: requestedQty } },
        });
      }

      const paidAmount = paymentType === 'DEBT' ? 0 : totalAmount;
      const status = paymentType === 'DEBT' ? 'DEBT' : 'PAID';

      const sale = await tx.sale.create({
        data: {
          customerId: resolvedCustomerId,
          cashierId: req.session.user.id,
          paymentType,
          totalAmount,
          paidAmount,
          status,
          items: { create: saleItemsData },
        },
        include: { items: true, customer: true },
      });

      return sale;
    });

    res.json({ success: true, saleId: result.id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Satış zamanı xəta baş verdi' });
  }
});

router.get('/receipt/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true, customer: true, cashier: true },
  });
  if (!sale) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Satış tapılmadı.' });
  res.render('pos/receipt', { sale });
}));

module.exports = router;
