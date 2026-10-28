-- CreateTable
CREATE TABLE "Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "branchId" INTEGER NOT NULL,
    "position" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "birthday" DATETIME,
    "idNumber" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "startDate" DATETIME,
    "salaryTemplateId" INTEGER,
    "commissionTableId" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkShift" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#0f766e',
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ScheduleEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "date" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "checkIn" DATETIME,
    "checkOut" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "late" INTEGER NOT NULL DEFAULT 0,
    "early" INTEGER NOT NULL DEFAULT 0,
    "overtime" INTEGER NOT NULL DEFAULT 0,
    "worked" INTEGER NOT NULL DEFAULT 0,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SalaryTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "overtimeRate" INTEGER NOT NULL DEFAULT 150,
    "allowances" TEXT NOT NULL DEFAULT '[]',
    "deductions" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "CommissionTable" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "rules" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Paysheet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "base" INTEGER NOT NULL DEFAULT 0,
    "overtime" INTEGER NOT NULL DEFAULT 0,
    "allowance" INTEGER NOT NULL DEFAULT 0,
    "deduction" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_branchId_idx" ON "Employee"("branchId");

-- CreateIndex
CREATE INDEX "ScheduleEntry_date_idx" ON "ScheduleEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEntry_employeeId_shiftId_date_key" ON "ScheduleEntry"("employeeId", "shiftId", "date");

-- CreateIndex
CREATE INDEX "Timesheet_date_idx" ON "Timesheet"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employeeId_shiftId_date_key" ON "Timesheet"("employeeId", "shiftId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_code_key" ON "PayrollPeriod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Paysheet_code_key" ON "Paysheet"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Paysheet_periodId_employeeId_key" ON "Paysheet"("periodId", "employeeId");
