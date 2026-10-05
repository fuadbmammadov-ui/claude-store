-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('RETAIL', 'WHOLESALE', 'COST');

-- AlterTable: add nullable first so existing rows don't violate NOT NULL, backfill, then lock it down.
ALTER TABLE "Product" ADD COLUMN "wholesalePrice" DECIMAL(12,2);
UPDATE "Product" SET "wholesalePrice" = ROUND("purchasePrice" * 1.15, 2);
ALTER TABLE "Product" ALTER COLUMN "wholesalePrice" SET NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "priceMode" "PriceMode" NOT NULL DEFAULT 'RETAIL';
