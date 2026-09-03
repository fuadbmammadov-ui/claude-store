const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { sendTelegramMessage } = require('../utils/telegram');
const { money, qty } = require('../utils/format');

const router = express.Router();

function paymentLabel(type) {
  return type === 'CASH' ? 'Nağd' : type === 'CARD' ? 'Kart' : type === 'TRANSFER' ? 'Köçürmə' : 'Borc';
}

function saleNotificationText(sale) {
  const time = new Date(sale.createdAt).toLocaleTimeString('az-AZ');
  const itemLines = sale.items
    .map((it) => `• ${it.productName} ${qty(it.quantity, it.unit)} x ${money(it.unitPrice)} ₼ = ${money(it.lineTotal)} ₼`)
    .join('\n');
  const customerLine = sale.customer ? `\nMüştəri: ${sale.customer.name}` : '';

  return (
    `🛒 Yeni satış #${sale.id} (${time})\n` +
    `Satıcı: ${sale.cashier.fullName}\n` +
    `Ödəniş: ${paymentLabel(sale.paymentType)}${customerLine}\n\n` +
    `${itemLines}\n\n` +
    `Cəmi: ${money(sale.totalAmount)} ₼`
  );
}

router.get('/', asyncHandler(async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const topItems = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { createdAt: { gte: since }, voided: false } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 12,
  });

  let quickProducts = [];
  if (topItems.length) {
    const ids = topItems.map((t) => t.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, active: true, quantity: { gt: 0 } },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    quickProducts = products.sort((a, b) => order.get(a.id) - order.get(b.id));
  }

  if (quickProducts.length < 6) {
    const fallback = await prisma.product.findMany({
      where: { active: true, quantity: { gt: 0 }, id: { notIn: quickProducts.map((p) => p.id) } },
      orderBy: { createdAt: 'desc' },
      take: 12 - quickProducts.length,
    });
    quickProducts = quickProducts.concat(fallback);
  }

  const allProducts = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  const categories = [...new Set(allProducts.map((p) => p.category || 'Digər'))].sort((a, b) => a.localeCompare(b, 'az'));

  const products = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    category: p.category || 'Digər',
    unit: p.unit,
    salePrice: Number(p.salePrice),
    quantity: Number(p.quantity),
    minStock: p.minStock !== null ? Number(p.minStock) : null,
  }));

  const quickIds = new Set(quickProducts.map((p) => p.id));

  res.render('pos/index', { products, categories, quickIds: [...quickIds] });
}));

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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

router.post('/checkout', async (req, res) => {
  try {
    const { items, paymentType, customerId, customerName, customerPhone, note } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Səbət boşdur' });
    }
    if (!['CASH', 'CARD', 'TRANSFER', 'DEBT'].includes(paymentType)) {
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

        const unitPrice = item.unitPrice !== undefined && item.unitPrice !== '' && Number(item.unitPrice) >= 0
          ? round2(item.unitPrice)
          : round2(product.salePrice);
        const discount = Math.max(0, round2(item.discount));
        const rawTotal = requestedQty * unitPrice;
        const lineTotal = Math.max(0, round2(rawTotal - discount));
        totalAmount += lineTotal;

        saleItemsData.push({
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          quantity: requestedQty,
          unitPrice,
          discount,
          purchasePrice: product.purchasePrice,
          lineTotal,
        });

        await tx.product.update({
          where: { id: product.id },
          data: { quantity: { decrement: requestedQty } },
        });
      }

      totalAmount = round2(totalAmount);
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
          note: (note || '').trim() || null,
          items: { create: saleItemsData },
        },
        include: { items: true, customer: true, cashier: true },
      });

      return sale;
    });

    sendTelegramMessage(saleNotificationText(result));

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

router.post('/:id/void', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true, debtPayments: true },
  });
  if (!sale) return res.status(404).render('error', { title: 'Tapılmadı', message: 'Satış tapılmadı.' });
  if (sale.voided) {
    return res.status(400).render('error', { title: 'Xəta', message: 'Bu satış artıq ləğv edilib.' });
  }
  if (sale.debtPayments.length > 0) {
    return res.status(400).render('error', {
      title: 'Xəta',
      message: 'Bu satışa görə artıq borc ödənişi qeydə alınıb, ona görə ləğv edilə bilmir.',
    });
  }

  const reason = (req.body.reason || '').trim() || null;

  await prisma.$transaction(async (tx) => {
    for (const item of sale.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { quantity: { increment: Number(item.quantity) } },
      });
    }
    await tx.sale.update({
      where: { id },
      data: {
        voided: true,
        voidedAt: new Date(),
        voidedById: req.session.user.id,
        voidReason: reason,
      },
    });
  });

  sendTelegramMessage(
    `↩️ Satış #${sale.id} ləğv edildi\n` +
    `Ləğv edən: ${req.session.user.fullName}\n` +
    `Məbləğ: ${money(sale.totalAmount)} ₼${reason ? `\nSəbəb: ${reason}` : ''}`
  );

  res.redirect(req.get('Referrer') || '/today-sales');
}));

module.exports = router;
