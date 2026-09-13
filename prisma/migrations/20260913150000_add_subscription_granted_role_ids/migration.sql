-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "grantedRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
