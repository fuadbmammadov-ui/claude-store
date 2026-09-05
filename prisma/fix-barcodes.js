const prisma = require('../src/config/db');
const { isValidEan13, ean13CheckDigit } = require('../src/utils/barcode');

// Movcud 13 reqemli eded barkodlarin (avtomatik yaradilmish ve ya elle
// yazilmish) sonuncu reqemini duzgun EAN-13 nezaret reqemi ile evez edir.
// 13 reqemli olmayan (elyfba/basqa uzunluq) barkodlara toxunmur - onlar
// artiq CODE128 kimi cap olunur ve real mehsul barkodu ola biler.
async function main() {
  const products = await prisma.product.findMany({ select: { id: true, name: true, barcode: true } });

  let fixed = 0;
  let alreadyValid = 0;
  let skippedFormat = 0;
  let skippedCollision = 0;

  for (const p of products) {
    if (!/^\d{13}$/.test(p.barcode)) {
      skippedFormat++;
      continue;
    }
    if (isValidEan13(p.barcode)) {
      alreadyValid++;
      continue;
    }

    const base = p.barcode.slice(0, 12);
    const corrected = base + ean13CheckDigit(base);

    const collision = await prisma.product.findUnique({ where: { barcode: corrected } });
    if (collision) {
      skippedCollision++;
      console.log(`ATLANDI (toqqusma): #${p.id} ${p.name} - ${p.barcode} -> ${corrected} artiq #${collision.id}-de istifade olunur.`);
      continue;
    }

    await prisma.product.update({ where: { id: p.id }, data: { barcode: corrected } });
    console.log(`DUZELDILDI: #${p.id} ${p.name} - ${p.barcode} -> ${corrected}`);
    fixed++;
  }

  console.log(`\nCemi: ${products.length} mehsul. Duzeldildi: ${fixed}, artiq keçerli: ${alreadyValid}, format uygun deyil (toxunulmadi): ${skippedFormat}, toqqusma sebebi ile atlandi: ${skippedCollision}.`);
  if (fixed > 0) {
    console.log('DIQQET: duzeldilen mehsullarin barkod etiketleri yeniden cap olunmalidir.');
  }
}

main()
  .catch((e) => {
    console.error('fix-barcodes.js xetasi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
