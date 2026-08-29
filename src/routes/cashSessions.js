const express = require('express');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendTelegramMessage } = require('../utils/telegram');
const { money, qty } = require('../utils/format');

const router = express.Router();

const TELEGRAM_CHUNK_LIMIT = 3500;

function closeNotificationText(session, totals, closedByName) {
  const time = new Date(session.closedAt).toLocaleString('az-AZ');
  const diff = Number(session.closingAmountActual) - totals.expectedCash;
  const diffLine = diff === 0
    ? 'Fərq: 0 ₼ (uyğundur)'
    : `Fərq: ${diff > 0 ? '+' : ''}${money(diff)} ₼`;
  const noteLine = session.note ? `\nQeyd: ${session.note}` : '';

  return (
    `🔒 Kassa bağlandı (${time})\n` +
    `Açan: ${session.openedBy.fullName}\n` +
    `Bağlayan: ${closedByName}\n\n` +
    `Açılış məbləği: ${money(session.openingAmount)} ₼\n` +
    `Nağd satış: ${money(totals.cash)} ₼\n` +
    `Kart: ${money(totals.card)} ₼\n` +
    `Köçürmə: ${money(totals.transfer)} ₼\n` +
    `Borc: ${money(totals.debt)} ₼\n` +
    `Təchizatçı ödənişi (nağd): ${money(totals.cashOutSupplier)} ₼\n` +
    `Xərc (nağd): ${money(totals.cashOutExpenses)} ₼\n\n` +
    `Olmalı nağd: ${money(totals.expectedCash)} ₼\n` +
    `Faktiki sayılan: ${money(session.closingAmountActual)} ₼\n` +
    `${diffLine}` +
    noteLine
  );
}

// "Süd məhsulları" kateqoriyası hesabatda hər zaman ən başda gəlsin deyə.
function isDairyCategory(category) {
  return (category || '').toLocaleLowerCase('az-AZ').includes('süd məhsul');
}

function unitLabel(unit) {
  return unit === 'KG' ? 'kq' : 'ədəd';
}

function chunkText(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && (current.length + line.length + 1) > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function stockReportTexts() {
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  const groups = new Map();
  for (const p of products) {
    const key = p.category || 'Digər';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const categoryNames = [...groups.keys()].sort((a, b) => {
    const aDairy = isDairyCategory(a);
    const bDairy = isDairyCategory(b);
    if (aDairy !== bDairy) return aDairy ? -1 : 1;
    if (a === 'Digər' || b === 'Digər') return a === b ? 0 : (a === 'Digər' ? 1 : -1);
    return a.localeCompare(b, 'az');
  });

  const lines = [`📦 Stok qalığı (${new Date().toLocaleString('az-AZ')})`];
  for (const cat of categoryNames) {
    lines.push(`\n<b>${cat}</b>`);
    for (const p of groups.get(cat)) {
      lines.push(`• ${p.name}: ${qty(p.quantity, p.unit)} ${unitLabel(p.unit)}`);
    }
  }

  return chunkText(lines.join('\n'), TELEGRAM_CHUNK_LIMIT);
}

async function computeTotals(session) {
  const from = session.openedAt;
  const to = session.closedAt || new Date();

  const [
    cashSales, cardSales, transferSales, debtSales,
    cashDebtPayments, cardDebtPayments,
    cashSupplierPayments,
    cashExpenses,
  ] = await Promise.all([
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'CASH', createdAt: { gte: from, lte: to } } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'CARD', createdAt: { gte: from, lte: to } } }),
    prisma.sale.aggregate({ _sum: { paidAmount: true }, where: { paymentType: 'TRANSFER', createdAt: { gte: from, lte: to } } }),
    prisma.sale.aggregate({ _sum: { totalAmount: true }, where: { paymentType: 'DEBT', createdAt: { gte: from, lte: to } } }),
    prisma.debtPayment.aggregate({ _sum: { amount: true }, where: { method: 'CASH', paidAt: { gte: from, lte: to } } }),
    prisma.debtPayment.aggregate({ _sum: { amount: true }, where: { method: 'CARD', paidAt: { gte: from, lte: to } } }),
    prisma.supplierPayment.aggregate({ _sum: { amount: true }, where: { method: 'CASH', paidAt: { gte: from, lte: to } } }),
    prisma.expense.aggregate({ _sum: { amount: true }, where: { method: 'CASH', createdAt: { gte: from, lte: to } } }),
  ]);

  const cash = Number(cashSales._sum.paidAmount || 0) + Number(cashDebtPayments._sum.amount || 0);
  const card = Number(cardSales._sum.paidAmount || 0) + Number(cardDebtPayments._sum.amount || 0);
  const transfer = Number(transferSales._sum.paidAmount || 0);
  const debt = Number(debtSales._sum.totalAmount || 0);
  const cashOutSupplier = Number(cashSupplierPayments._sum.amount || 0);
  const cashOutExpenses = Number(cashExpenses._sum.amount || 0);
  const expectedCash = Number(session.openingAmount) + cash - cashOutSupplier - cashOutExpenses;

  return { cash, card, transfer, debt, cashOutSupplier, cashOutExpenses, expectedCash };
}

router.get('/', asyncHandler(async (req, res) => {
  const openSession = await prisma.cashSession.findFirst({
    where: { closedAt: null },
    include: { openedBy: true },
    orderBy: { openedAt: 'desc' },
  });

  const history = await prisma.cashSession.findMany({
    where: { closedAt: { not: null } },
    include: { openedBy: true },
    orderBy: { openedAt: 'desc' },
    take: 15,
  });

  let totals = null;
  if (openSession) {
    totals = await computeTotals(openSession);
  }

  const historyWithTotals = [];
  for (const s of history) {
    historyWithTotals.push({ session: s, totals: await computeTotals(s) });
  }

  res.render('cash-sessions/index', { openSession, totals, historyWithTotals });
}));

router.post('/open', asyncHandler(async (req, res) => {
  const existing = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (existing) return res.redirect('/cash-sessions');

  await prisma.cashSession.create({
    data: {
      openedById: req.session.user.id,
      openingAmount: req.body.openingAmount || 0,
      note: req.body.note || null,
    },
  });
  res.redirect('/cash-sessions');
}));

router.post('/:id/close', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const session = await prisma.cashSession.update({
    where: { id },
    data: {
      closedAt: new Date(),
      closingAmountActual: req.body.closingAmountActual || 0,
      note: req.body.note || null,
    },
    include: { openedBy: true },
  });

  const totals = await computeTotals(session);
  sendTelegramMessage(closeNotificationText(session, totals, req.session.user.fullName));

  stockReportTexts()
    .then((chunks) => chunks.reduce(
      (chain, chunk) => chain.then(() => sendTelegramMessage(chunk)),
      Promise.resolve()
    ))
    .catch((err) => console.error('Stok hesabatı bildirişi göndərilmədi:', err.message));

  res.redirect('/cash-sessions');
}));

module.exports = router;
