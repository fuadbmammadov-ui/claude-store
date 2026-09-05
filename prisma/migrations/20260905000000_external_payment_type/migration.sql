-- AlterEnum: PaymentType gains EXTERNAL, for supplier/expense payments made
-- from outside the cash register (does not affect cash session totals).
ALTER TYPE "PaymentType" ADD VALUE 'EXTERNAL';
