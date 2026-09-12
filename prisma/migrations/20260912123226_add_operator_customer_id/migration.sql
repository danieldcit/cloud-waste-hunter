-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "operatorCustomerId" TEXT;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_operatorCustomerId_fkey" FOREIGN KEY ("operatorCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
