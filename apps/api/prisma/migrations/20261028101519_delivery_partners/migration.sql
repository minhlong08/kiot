-- CreateTable
CREATE TABLE "DeliveryPartner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "feeMode" TEXT NOT NULL DEFAULT 'flat',
    "flatFee" INTEGER NOT NULL DEFAULT 0,
    "feePerKg" INTEGER NOT NULL DEFAULT 0,
    "debt" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CodReconciliation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "codTotal" INTEGER NOT NULL,
    "feeTotal" INTEGER NOT NULL,
    "fundId" INTEGER NOT NULL,
    "cashVoucherId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InvoiceDelivery" (
    "invoiceId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ward" TEXT NOT NULL DEFAULT '',
    "province" TEXT NOT NULL DEFAULT '',
    "partnerId" INTEGER,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "cod" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trackingCode" TEXT NOT NULL DEFAULT '',
    "feePayer" TEXT NOT NULL DEFAULT 'shop',
    "deliveredAt" DATETIME,
    "reconciledAt" DATETIME,
    "reconciliationId" INTEGER,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_InvoiceDelivery" ("address", "cod", "fee", "invoiceId", "note", "partnerId", "province", "receiverName", "receiverPhone", "status", "trackingCode", "updatedAt", "ward", "weight") SELECT "address", "cod", "fee", "invoiceId", "note", "partnerId", "province", "receiverName", "receiverPhone", "status", "trackingCode", "updatedAt", "ward", "weight" FROM "InvoiceDelivery";
DROP TABLE "InvoiceDelivery";
ALTER TABLE "new_InvoiceDelivery" RENAME TO "InvoiceDelivery";
CREATE INDEX "InvoiceDelivery_status_idx" ON "InvoiceDelivery"("status");
CREATE INDEX "InvoiceDelivery_partnerId_status_idx" ON "InvoiceDelivery"("partnerId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPartner_code_key" ON "DeliveryPartner"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CodReconciliation_code_key" ON "CodReconciliation"("code");

-- CreateIndex
CREATE INDEX "CodReconciliation_partnerId_createdAt_idx" ON "CodReconciliation"("partnerId", "createdAt");
