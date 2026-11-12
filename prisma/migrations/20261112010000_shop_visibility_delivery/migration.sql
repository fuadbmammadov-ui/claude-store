-- AlterTable
ALTER TABLE "Product" ADD COLUMN "showInShop" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "DeliveryTimeSlot" AS ENUM ('SLOT_9_13', 'SLOT_13_18', 'SLOT_18_22');

-- AlterTable
-- DEFAULT values below are only a safety net for any pre-existing rows (the app always
-- supplies real deliveryDate/deliveryTimeSlot values going forward at checkout).
ALTER TABLE "WebOrder" ADD COLUMN "deliveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE "WebOrder" ADD COLUMN "deliveryTimeSlot" "DeliveryTimeSlot" NOT NULL DEFAULT 'SLOT_9_13';
