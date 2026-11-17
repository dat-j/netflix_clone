-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "overriddenFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "overriddenFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
