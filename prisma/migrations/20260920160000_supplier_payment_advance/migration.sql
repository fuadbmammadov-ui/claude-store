-- AlterTable
ALTER TABLE "SupplierPayment" ALTER COLUMN "stockReceiptId" DROP NOT NULL;
ALTER TABLE "SupplierPayment" ADD COLUMN "purchaseOrderId" INTEGER;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
