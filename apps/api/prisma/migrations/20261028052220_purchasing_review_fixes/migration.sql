-- AlterTable
ALTER TABLE "PurchaseReceipt" ADD COLUMN "effectiveAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "expectedAt" DATETIME,
    "note" TEXT NOT NULL DEFAULT '',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "closedManually" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_PurchaseOrder" ("branchId", "code", "confirmedAt", "createdAt", "createdById", "discount", "expectedAt", "id", "note", "status", "subtotal", "supplierId", "total") SELECT "branchId", "code", "confirmedAt", "createdAt", "createdById", "discount", "expectedAt", "id", "note", "status", "subtotal", "supplierId", "total" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
