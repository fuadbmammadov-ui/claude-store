-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'TRANSFER';

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PAID', 'DEBT');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentType" NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Product
ALTER TABLE "Product" ADD COLUMN "category" TEXT;
ALTER TABLE "Product" ADD COLUMN "subCategory" TEXT;
ALTER TABLE "Product" ADD COLUMN "defaultSupplierId" INTEGER;

-- AlterTable: StockReceipt (nullable first, backfill, then enforce NOT NULL)
ALTER TABLE "StockReceipt" ADD COLUMN "totalAmount" DECIMAL(12,2);
ALTER TABLE "StockReceipt" ADD COLUMN "paidAmount" DECIMAL(12,2);
UPDATE "StockReceipt" SET "totalAmount" = "quantity" * "purchasePrice" WHERE "totalAmount" IS NULL;
UPDATE "StockReceipt" SET "paidAmount" = "totalAmount" WHERE "paidAmount" IS NULL;
ALTER TABLE "StockReceipt" ALTER COLUMN "totalAmount" SET NOT NULL;
ALTER TABLE "StockReceipt" ALTER COLUMN "paidAmount" SET NOT NULL;
ALTER TABLE "StockReceipt" ADD COLUMN "status" "ReceiptStatus" NOT NULL DEFAULT 'PAID';
ALTER TABLE "StockReceipt" ADD COLUMN "supplierId" INTEGER;

-- AlterTable: SaleItem
ALTER TABLE "SaleItem" ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: Sale
ALTER TABLE "Sale" ADD COLUMN "note" TEXT;

-- CreateTable: SupplierPayment
CREATE TABLE "SupplierPayment" (
    "id" SERIAL NOT NULL,
    "stockReceiptId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentType" NOT NULL,
    "paidById" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_stockReceiptId_fkey" FOREIGN KEY ("stockReceiptId") REFERENCES "StockReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
