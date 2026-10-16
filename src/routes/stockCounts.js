const express = require('express');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const {
  parseCountedQty, isValidForUnit, itemDelta, summarize, round3,
} = require('../utils/stockCount');

const router = express.Router();

// Anbar sayımı yalnız Admin üçündür.
router.use(requireRole('ADMIN'));

const STATUS_LABELS = { DRAFT: 'Davam edir', APPLIED: 'Tətbiq edilib', CANCELLED: 'Ləğv edilib' };

async function loadCount(id) {
  return prisma.stockCount.findUnique({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      appliedBy: { select: { fullName: true } },
      items: {
        include: {
          product: { select: { quantity: true, active: true } },
          countedBy: { select: { fullName: true } },
        },
        orderBy: [{ category: 'asc' }, { productName: 'asc' }],
      },
    },
  });
}

router.get('/', asyncHandler(async (req, res) => {
  const counts = await prisma.stockCount.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { fullName: true } },
      appliedBy: { select: { fullName: true } },
      items: { select: { systemQty: true, countedQty: true, purchasePrice: true } },
    },
  });
  const rows = counts.map((c) => ({ count: c, summary: summarize(c.items) }));
  const openDraft = counts.find((c) => c.status === 'DRAFT');
  res.render('stock-counts/index', { title: 'Anbar sayımı', rows, openDraft, STATUS_LABELS });
}));

// Yeni sayım: bütün aktiv malların siyahısı və hazırkı qalığı götürülür.
router.post('/', asyncHandler(async (req, res) => {
  const existing = await prisma.stockCount.findFirst({ where: { status: 'DRAFT' } });
  if (existing) return res.redirect(`/stock-counts/${existing.id}`);

  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, category: true, unit: true, purchasePrice: true, quantity: true },
  });

  const count = await prisma.stockCount.create({
    data: {
      note: (req.body.note || '').trim() || null,
      createdById: req.session.user.id,
      items: {
        create: products.map((p) => ({
          productId: p.id,
          productName: p.name,
          category: p.category,
          unit: p.unit,
          purchasePrice: p.purchasePrice,
          systemQty: p.quantity,
        })),
      },
    },
  });
  res.redirect(`/stock-counts/${count.id}`);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const count = await loadCount(Number(req.params.id));
  if (!count) {
    return res.status(404).render('error', { title: 'Tapılmadı', message: 'Sayım tapılmadı.' });
  }
  const categories = [...new Set(count.items.map((i) => i.category || 'Kateqoriyasız'))];
  res.render('stock-counts/show', {
    title: `Anbar sayımı #${count.id}`,
    count,
    summary: summarize(count.items),
    categories,
    itemDelta,
    STATUS_LABELS,
    error: req.query.error || null,
  });
}));

// Bir sətrin real sayını/qeydini yadda saxlayır (səhifədən avtomatik çağırılır).
// Sistem qalığı elə bu an yenidən götürülür ki, fərq düzgün hesablansın.
router.post('/:id/items/:itemId', asyncHandler(async (req, res) => {
  const countId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const item = await prisma.stockCountItem.findFirst({
    where: { id: itemId, stockCountId: countId },
    include: { stockCount: { select: { status: true } }, product: { select: { quantity: true } } },
  });
  if (!item) return res.status(404).json({ ok: false, error: 'Sətir tapılmadı.' });
  if (item.stockCount.status !== 'DRAFT') {
    return res.status(409).json({ ok: false, error: 'Bu sayım artıq bağlanıb.' });
  }

  const data = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'countedQty')) {
    const value = parseCountedQty(req.body.countedQty);
    if (value === undefined) {
      return res.status(400).json({ ok: false, error: 'Say düzgün deyil (yalnız müsbət rəqəm).' });
    }
    if (!isValidForUnit(value, item.unit)) {
      return res.status(400).json({ ok: false, error: 'Ədədlə satılan mal üçün say tam olmalıdır.' });
    }
    if (value === null) {
      Object.assign(data, { countedQty: null, countedAt: null, countedById: null });
    } else {
      Object.assign(data, {
        countedQty: value,
        systemQty: item.product.quantity,
        countedAt: new Date(),
        countedById: req.session.user.id,
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'note')) {
    data.note = String(req.body.note || '').trim().slice(0, 500) || null;
  }

  const updated = await prisma.stockCountItem.update({ where: { id: item.id }, data });
  const all = await prisma.stockCountItem.findMany({
    where: { stockCountId: countId },
    select: { systemQty: true, countedQty: true, purchasePrice: true },
  });
  res.json({
    ok: true,
    item: {
      id: updated.id,
      systemQty: Number(updated.systemQty),
      countedQty: updated.countedQty === null ? null : Number(updated.countedQty),
      delta: itemDelta(updated),
      note: updated.note,
    },
    summary: summarize(all),
  });
}));

// Sayılmış sətirləri anbara tətbiq edir. Kassaya, xərclərə, təchizatçı borcuna
// heç bir təsiri yoxdur — yalnız Product.quantity dəyişir.
router.post('/:id/apply', asyncHandler(async (req, res) => {
  const countId = Number(req.params.id);
  const result = await prisma.$transaction(async (tx) => {
    // Eyni sayımın iki dəfə tətbiqinin qarşısını alır.
    const locked = await tx.stockCount.updateMany({
      where: { id: countId, status: 'DRAFT' },
      data: { status: 'APPLIED', appliedById: req.session.user.id, appliedAt: new Date() },
    });
    if (locked.count === 0) return { error: 'Bu sayım artıq tətbiq edilib və ya ləğv olunub.' };

    const items = await tx.stockCountItem.findMany({
      where: { stockCountId: countId, countedQty: { not: null } },
    });
    let changed = 0;
    for (const it of items) {
      const delta = itemDelta(it);
      if (delta === 0) {
        await tx.stockCountItem.update({ where: { id: it.id }, data: { appliedDelta: 0 } });
        continue;
      }
      // Atomik: qalıq = max(0, indiki qalıq + fərq). Arada edilən satışlar qorunur.
      const rows = await tx.$queryRaw`
        UPDATE "Product" AS p
        SET "quantity" = GREATEST(0, o."quantity" + ${delta}::numeric), "updatedAt" = NOW()
        FROM (SELECT "id", "quantity" FROM "Product" WHERE "id" = ${it.productId} FOR UPDATE) AS o
        WHERE p."id" = o."id"
        RETURNING o."quantity" AS "oldQty", p."quantity" AS "newQty"`;
      const applied = rows.length ? round3(Number(rows[0].newQty) - Number(rows[0].oldQty)) : 0;
      await tx.stockCountItem.update({ where: { id: it.id }, data: { appliedDelta: applied } });
      if (applied !== 0) changed += 1;
    }
    return { changed };
  });

  if (result.error) return res.redirect(`/stock-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  res.redirect(`/stock-counts/${countId}`);
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const countId = Number(req.params.id);
  await prisma.stockCount.updateMany({ where: { id: countId, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
  res.redirect('/stock-counts');
}));

module.exports = router;
