-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "commitmentId" INTEGER;

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedExpenseTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodMonths" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FixedExpenseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_templateId_periodStart_key" ON "Commitment"("templateId", "periodStart");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FixedExpenseTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: metadata (qrup/növ) for the expense categories that already existed in the app's
-- hardcoded list, so existing Expense rows get classified without any data migration.
INSERT INTO "ExpenseCategory" ("name", "group", "type", "updatedAt") VALUES
    ('İcarə', 'İcarə', 'sabit', CURRENT_TIMESTAMP),
    ('İşçi maaşı', 'Maaş', 'sabit', CURRENT_TIMESTAMP),
    ('Elektrik', 'Kommunal', 'gundelik', CURRENT_TIMESTAMP),
    ('Su', 'Kommunal', 'gundelik', CURRENT_TIMESTAMP),
    ('İnternet', 'Kommunal', 'gundelik', CURRENT_TIMESTAMP),
    ('Reklam', 'Digər', 'gundelik', CURRENT_TIMESTAMP),
    ('Vergi', 'Dövlət/Vergi', 'gundelik', CURRENT_TIMESTAMP),
    ('DSMF', 'Dövlət/Vergi', 'gundelik', CURRENT_TIMESTAMP),
    ('Nəqliyyat', 'Nəqliyyat', 'gundelik', CURRENT_TIMESTAMP),
    ('Təmir', 'Digər', 'gundelik', CURRENT_TIMESTAMP),
    ('Avadanlıq', 'Əsas vəsait', 'esas_vesait', CURRENT_TIMESTAMP),
    ('Qablaşdırma', 'Qablaşdırma', 'gundelik', CURRENT_TIMESTAMP),
    ('Digər', 'Digər', 'gundelik', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Seed: starter fixed-expense templates. startDate anchors to the first of the month this
-- migration is actually applied in, so "Ayı aç" has something to generate from immediately.
INSERT INTO "FixedExpenseTemplate" ("name", "group", "amount", "periodMonths", "startDate", "updatedAt") VALUES
    ('Arenda', 'İcarə', 500, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Arenda vergisi', 'Dövlət/Vergi', 14, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Fərid maaş', 'Maaş', 600, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Əli maaş', 'Maaş', 300, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Mühasib', 'Maaş', 40, 3, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Kredit', 'Kredit', 300, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Su', 'Kommunal', 40, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP),
    ('Polis', 'Dövlət/Vergi', 30, 1, date_trunc('month', CURRENT_DATE), CURRENT_TIMESTAMP);
