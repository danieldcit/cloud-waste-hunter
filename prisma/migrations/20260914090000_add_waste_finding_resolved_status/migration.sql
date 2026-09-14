-- AlterEnum
ALTER TYPE "FindingStatus" ADD VALUE 'RESOLVED';

-- AlterTable
ALTER TABLE "WasteFinding" ADD COLUMN     "resolvedAt" TIMESTAMP(3);
