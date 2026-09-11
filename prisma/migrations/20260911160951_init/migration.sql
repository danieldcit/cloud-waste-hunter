-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WasteRuleType" AS ENUM ('ORPHANED_DISK', 'UNASSOCIATED_PUBLIC_IP', 'OLD_SNAPSHOT', 'IDLE_VPN_GATEWAY');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'DISMISSED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "entraTenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "entraObjectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "azureSubscriptionId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "ScanStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rawProperties" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteFinding" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ruleType" "WasteRuleType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "estimatedMonthlyCost" DOUBLE PRECISION NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "WasteFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_entraTenantId_key" ON "Customer"("entraTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_entraObjectId_key" ON "User"("entraObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_azureSubscriptionId_key" ON "Subscription"("azureSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "WasteFinding_subscriptionId_resourceId_ruleType_key" ON "WasteFinding"("subscriptionId", "resourceId", "ruleType");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteFinding" ADD CONSTRAINT "WasteFinding_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
