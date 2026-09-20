-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "stockReceiptId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_stockReceiptId_key" ON "PurchaseOrderItem"("stockReceiptId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_stockReceiptId_fkey" FOREIGN KEY ("stockReceiptId") REFERENCES "StockReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
