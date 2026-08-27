const prisma = require('../config/db');

function randomDigits(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Daxili, unikal ədədi barkod (Code128 kimi çap üçün yararlıdır).
async function generateUniqueBarcode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = '2' + Date.now().toString().slice(-9) + randomDigits(3);
    const exists = await prisma.product.findUnique({ where: { barcode: candidate } });
    if (!exists) return candidate;
  }
  throw new Error('Unikal barkod yaradıla bilmədi, yenidən cəhd edin.');
}

module.exports = { generateUniqueBarcode };
