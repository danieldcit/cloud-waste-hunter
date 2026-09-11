-- AlterEnum
ALTER TYPE "WasteRuleType" ADD VALUE 'IDLE_VM';

-- CreateTable
CREATE TABLE "CostSnapshot" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monthToDateSpend" DOUBLE PRECISION NOT NULL,
    "projectedSpend" DOUBLE PRECISION NOT NULL,
    "dailyTrend" JSONB NOT NULL,

    CONSTRAINT "CostSnapshot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CostSnapshot" ADD CONSTRAINT "CostSnapshot_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
