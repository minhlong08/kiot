# Milestone 9 — Dashboard & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Tổng quan dashboard and every report in requirements §8 — analytics (Kinh doanh, Hàng hóa, Khách hàng, Hiệu quả), end of day, sales (time/profit/discount/return/staff/branch), orders, products (sales, profit, xuất nhập tồn, stock value, write-offs), customers, suppliers, staff, channels and the simplified P&L — each with filters, chart + table, print and Excel export.

**Architecture:** One fact layer, many views. `services/reportFacts.ts` turns documents into flat rows once per request: **sale facts** (one per invoice line, revenue allocated so lines sum to the invoice total, COGS from the line's cost snapshot) and **return facts** (negative, by return date); reports are pure aggregations of facts in `packages/shared/src/reports.ts` (`groupFacts`, `periodCompare`, `bucketKey` for day/hour/weekday/month in VN time) so the UI and API share them and tests are cheap. Stock reports read `StockLedger`; money reports read `CashVoucher` and `PartnerLedger`. Charts are small in-house SVG components (`components/charts`: `BarChart`, `HBarChart`, `LineChart`) — no chart dependency. Every report page is `ReportPage` (filter sidebar, chart/table toggle, print, export) fed by a `{ columns, rows, totals, chart }` response, so adding a report is a route + a config.

**Tech Stack:** as before; xlsx export via `lib/excel`.

**Spec:** requirements §1, §8; design §8 (P&L uses `CashVoucher.affectsPnl`); decisions M7 (shop-paid delivery fees are an expense found in `PartnerLedger` docType `deliveryFee`).

## Global Constraints

- All earlier constraints. All bucketing in Vietnam time (UTC+7). "Doanh thu" = invoice totals of completed invoices (incl. points-paid part); "Trả hàng" = completed return totals by return date; "Doanh thu thuần" = Doanh thu − Trả hàng; "Giá vốn" = Σ line cost × qty (returns subtract their cost); "Lợi nhuận gộp" = thuần − giá vốn.
- Branch filter: users see their session branch; admins may pass `branchId=all`.
- P&L by month: revenue − returns − COGS − expenses + other income = profit, where expenses = completed **out** vouchers whose category `affectsPnl` (incl. "Chi lương") + shop-paid delivery fees (`deliveryFee` ledger rows, net of `deliveryFee_cancel`); other income = completed **in** vouchers with `affectsPnl` + invoice `otherIncome` + return fees.
- Dashboard "% so với cùng kỳ tháng trước" compares today (00:00→now) with the same day-of-month and time last month (clamped to the month's last day).
- Every report endpoint: `GET /api/reports/<name>?from&to&branchId&...` → `{ columns: { key, label, money? }[], rows, totals, chart?: { type: 'bar' | 'hbar' | 'line', labels, series: { name, values }[] } }`; `GET /api/reports/<name>/export` → xlsx with the same columns. Permission `reports.view` (`reports.export` for export); cost/profit columns only with `cost.view`.
- Failed logins are audited (`action 'login'`, summary "Đăng nhập thất bại"), feeding the dashboard alert card (≥3 failures for one username in 24 h, or a successful login from an IP not seen for that user in 30 days).

## Review Focus

1. **A return dated in a later period than its sale** lowers the later period's net revenue, not the original (Task 1).
2. **Invoice-level discounts and points** are spread over lines so product revenue sums exactly to invoice totals (Task 1).
3. **Cancelled invoices/returns/vouchers** appear in no report (Task 1, Task 5).
4. **A user without `cost.view`** never receives cost/profit numbers from any report or export (Task 3).
5. **Xuất nhập tồn** opening + in − out = closing per product for any period, matching the stock card (Task 4).

---

### Task 1: Fact layer & shared aggregation

`packages/shared/src/reports.ts`: `bucketKey(date, by: 'day' | 'hour' | 'weekday' | 'month')`, `groupFacts(facts, keyFn, fields)`, `pctChange(cur, prev)`, `sameTimeLastMonth(now)`. `apps/api/src/services/reportFacts.ts`: `saleFacts(tx, { from, to, branchId })`, `returnFacts(...)` (fields: at, invoiceId, branchId, sellerId, createdById, channel, customerId, productId, groupId, qty, revenue, cost, discount (line + allocated invoice discount + voucher), isDelivery), `periodSummary(tx, range)` → { revenue, returns, net, cost, profit, invoiceCount }.
- Tests: shared `bucketKey('2026-10-27T17:30:00Z','day') === '2026-10-28'`; `sameTimeLastMonth(31 Oct 10:00) → 30 Sep 10:00`; api `line revenue sums to invoice total with invoice discount and points`, `return in next month counted there`, `cancelled invoice excluded`.

### Task 2: Dashboard

`GET /api/dashboard/today` (revenue, returns, net, invoiceCount + % vs same time last month), `GET /api/dashboard/chart?period&by=day|hour|weekday`, `GET /api/dashboard/top-products?period&metric=revenue|qty`, `GET /api/dashboard/top-customers?period`, `GET /api/dashboard/activity` (latest 20 audit events: sales, returns, receipts, cash vouchers, rendered as sentences), `GET /api/dashboard/alerts` (suspicious logins), `GET /api/dashboard/staff?period` (net revenue per seller). Failed-login auditing in `routes/auth.ts`. Admin `/dashboard`: KPI cards, chart with tabs and period select, top-10 horizontal bars (revenue/qty toggle), top customers, activity feed + alert card + quick links, staff widget (empty state with "Thêm nhân viên" → /employees).
- Tests: api `today compares with the same time last month`, `alerts flag 3 failed logins`; admin `chart tabs switch the by param`.

### Task 3: Sales, channel & order reports

Reports `sales-by-time` (day/hour/weekday/month), `sales-profit` (by invoice: revenue, cost, profit, margin), `sales-discount` (by invoice: line, invoice, voucher, points, promo discount), `sales-returns` (returns list with reason/refund), `sales-by-staff` (seller and creator), `sales-by-branch`, `channels` (revenue/net by channel), `orders-by-product` (ordered/delivered/remaining qty), `orders-by-transaction`. `stripCost(user, report)` removes cost/profit columns and values without `cost.view`.
- Tests: `sales-by-time by hour buckets in VN time`, `sales-profit hides cost without cost.view (report and export)`, `channels sums equal total net`.

### Task 4: Product, stock & partner reports

`products-sales`, `products-profit`, `stock-movement` (xuất nhập tồn: opening, in by type receipt/return/transfer-in/stocktake+, out by type sale/purchase-return/transfer-out/write-off/internal-use/stocktake−, closing; qty and value), `stock-value` (on hand × cost by product/group), `write-offs`; `customers-sales` (net, invoices, debt), `customers-debt` (opening/increase/decrease/closing from PartnerLedger), `suppliers-purchases`, `suppliers-debt`, `staff-sales` (by seller incl. commission base), `staff-payroll` (paysheets in range).
- Tests: `stock-movement opening + in − out = closing and equals stock card balance`, `customers-debt closing equals cached debt`, `stock-value equals Σ onHand × cost`.

### Task 5: End of day & P&L

`end-of-day?date` (sales by method incl. cash collected, returns, cash-book in/out by category, per staff, delivery COD collected; printable slip), `finance-pnl?year` (12 months per Global Constraints).
- Tests: `end-of-day cash collected equals TTHD vouchers of the day minus TTTH`, `P&L month: revenue − returns − COGS − (Chi lương + điện nước + shop-paid delivery fee) + other income`, `cancelled voucher excluded from P&L`.

### Task 6: Admin report framework & report pages

`components/charts` (SVG BarChart/HBarChart/LineChart with axis labels, tooltips via `<title>`, responsive width), `pages/reports/ReportPage.tsx` (sidebar filters from config: date range, branch (admins), staff, channel, group, customer/supplier search; chart/table toggle; totals row; print = window print of a print-styled table; Xuất file), registry entries for every `/reports/*` route with configs.
- Tests: `ReportPage renders columns, totals and switches to chart`, `filters change the query`, `BarChart renders one bar per value`.

### Task 7: Analytics pages

`/analytics/business` (net revenue, profit, invoices, avg ticket — period vs previous period, trend), `/analytics/products` (top/bottom sellers, slow movers = stock with no sale in 30 days, ABC by revenue), `/analytics/customers` (new vs returning, top customers, group mix), `/analytics/efficiency` (revenue per staff, per hour of day, conversion of orders to invoices). API `GET /api/analytics/<name>?from&to` reusing the fact layer.
- Tests: `previous period is the same length immediately before`, `slow movers excludes products sold in 30 days`.

### Task 8: E2E

`e2e/reports.spec.ts`: dashboard shows today's sale made in the test (KPI and top product), end-of-day report lists it under Tiền mặt, sales-by-time export downloads an xlsx, P&L shows this month's expense after a Phiếu chi "Chi khác".
