const prisma = require('../config/db');

function randomDigits(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// EAN-13 nəzarət rəqəmi: cüt indeksli (1-ci, 3-cü, ...) rəqəmlər x1,
// tək indeksli (2-ci, 4-cü, ...) rəqəmlər x3 ilə çarpılıb cəmlənir.
function ean13CheckDigit(digits12) {
  const sum = digits12
    .split('')
    .reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

function isValidEan13(barcode) {
  if (!/^\d{13}$/.test(barcode)) return false;
  return ean13CheckDigit(barcode.slice(0, 12)) === Number(barcode[12]);
}

// Daxili, unikal EAN-13 barkod. "2" prefiksi GS1 standartında mağaza-daxili
// istifadə üçün ayrılmış diapazondur (20-29), buna görə real məhsul
// barkodları ilə toqquşmur. Düzgün nəzarət rəqəmi sayəsində istənilən
// standart barkod oxuyucu (yalnız EAN-13/UPC dəstəkləyənlər daxil) tanıyır.
async function generateUniqueBarcode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = '2' + Date.now().toString().slice(-9) + randomDigits(2);
    const candidate = base + ean13CheckDigit(base);
    const exists = await prisma.product.findUnique({ where: { barcode: candidate } });
    if (!exists) return candidate;
  }
  throw new Error('Unikal barkod yaradıla bilmədi, yenidən cəhd edin.');
}

module.exports = { generateUniqueBarcode, isValidEan13, ean13CheckDigit };
