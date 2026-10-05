-- CreateTable
CREATE TABLE "BusinessTarget" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "salesTarget" DECIMAL(12,2) NOT NULL,
    "grossMarginTargetPct" DECIMAL(5,2) NOT NULL,
    "avgTicketTarget" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTarget_year_month_key" ON "BusinessTarget"("year", "month");
