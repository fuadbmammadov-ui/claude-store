const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (existing) {
    console.log('admin istifadecisi artiq movcuddur, seed atlanildi.');
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      fullName: 'Baş Admin',
      role: 'ADMIN',
    },
  });

  console.log('Ilkin admin istifadecisi yaradildi -> username: admin, sifre: admin123');
  console.log('DIQQET: ilk girisden sonra sifreni mutleq deyisin.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
