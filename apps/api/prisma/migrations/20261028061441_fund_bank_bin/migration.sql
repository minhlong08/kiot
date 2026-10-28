-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CashFund" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL DEFAULT '',
    "bankBin" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "accountName" TEXT NOT NULL DEFAULT '',
    "branchId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CashFund" ("accountName", "accountNumber", "bankName", "branchId", "createdAt", "id", "isActive", "name", "openingBalance", "type") SELECT "accountName", "accountNumber", "bankName", "branchId", "createdAt", "id", "isActive", "name", "openingBalance", "type" FROM "CashFund";
DROP TABLE "CashFund";
ALTER TABLE "new_CashFund" RENAME TO "CashFund";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
