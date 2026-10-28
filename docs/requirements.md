# Requirements: self-hosted retail management + POS app (Vietnamese market)

Owner's brief, copied verbatim on 2026-10-28.

## Goal

Build a complete, self-hosted retail management and point-of-sale web application for a small-to-medium Vietnamese fashion/accessories retailer (single store with optional multiple branches). It must run entirely on my Mac with one command and no cloud services.

This is an **original application**. Match the *feature set and workflows* of typical Vietnamese retail POS systems described below, but write all code from scratch and use your own name, logo, colour palette and icons. Do not copy, decompile or scrape any existing vendor's code, assets, branding or text. App name: **"PhuongDong POS"** (placeholder, keep it in one config constant).

## Tech stack and run requirements

- Node.js 24 LTS, TypeScript everywhere, pnpm workspaces monorepo.
- `apps/api`: Fastify + Prisma. Default database **SQLite** (file in `./data`) so it runs with zero setup; Postgres supported by changing `DATABASE_URL`.
- `apps/admin`: React + Vite + TanStack Router + TanStack Query + Tailwind. The back-office management app.
- `apps/pos`: React + Vite. The separate full-screen cashier app (served at `/sale`).
- `packages/shared`: Zod schemas and types shared by API and both frontends.
- Auth: email/phone + password, bcrypt, httpOnly session cookie. Roles & permissions (see Staff).
- One command to start: `pnpm install && pnpm dev` (runs migrations, seeds demo data on first run, opens admin at `http://localhost:5173`, POS at `/sale`). Also provide `docker compose up` with Postgres.
- UI language **Vietnamese** by default with an i18n layer (vi + en). Currency **VND**, formatted `1,234,000`, no decimals. Dates `DD/MM/YYYY HH:mm`, timezone `Asia/Ho_Chi_Minh`.
- All money as integers (đồng). All stock-changing operations run in DB transactions and write an immutable stock ledger entry.

## Global UI patterns (apply to every list screen)

- Top bar: logo, Support link, Feedback, notifications bell, settings gear, user menu.
- Main nav (blue bar) with hover dropdown mega-menus, plus a prominent **"Bán hàng"** button that opens the POS app.
- List screen layout: left filter sidebar (collapsible sections: date range with presets "Hôm nay / Tuần này / Tháng này / Toàn thời gian / Tùy chỉnh", status checkboxes, group/category pickers), main table on the right.
- Table toolbar: search box (by code/name, with advanced-filter icon), **"Tạo mới"** dropdown, **Import file** (Excel), **Xuất file** (Excel export of current filter), column chooser, settings, help.
- Table: checkbox column, favourite-star column, sortable columns, a **totals row** under the header for numeric columns, click a row to **expand inline detail** with tabs, pagination with page-size selector ("Hiển thị 15 dòng", "1 - 15 trong 40 …").
- Bulk actions on selected rows (delete, change group, print, export).
- Every document has an auto-generated code with prefix + 6 digits (e.g. `HD000045`), editable on create.
- Every create/update/delete is recorded in an audit log ("Lịch sử thao tác").
- Trial/info banner area at bottom for system notices.

## Modules and screens

### 1. Tổng quan (Dashboard)
- "Kết quả bán hàng hôm nay": revenue, returns, net revenue % change vs same period last month.
- Net revenue chart with tabs **Theo ngày / Theo giờ / Theo thứ** and period selector (today, yesterday, this week, this month, last month…).
- Top 10 products by revenue (horizontal bar chart, toggle revenue/quantity).
- Top 10 customers by revenue.
- Right sidebar: "Hoạt động gần đây" activity feed ("<staff> vừa bán đơn hàng với giá trị 69,128,000 – một ngày trước"), suspicious-login alert card, quick-link cards.
- Staff performance widget (empty state with "Thêm nhân viên" CTA).

### 2. Hàng hóa (Products)
- **Danh sách hàng hóa**: columns Mã hàng, image, Tên hàng, Giá bán, Giá vốn, Tồn kho, Khách đặt, Thời gian tạo, Dự kiến hết hàng. Filters: product group (tree), stock criteria (all / in stock / out of stock / below min / above max), expected-out-of-stock date, created date, supplier, brand, product type, sold directly yes/no, loyalty points yes/no, active/inactive.
- "Tạo mới" → **Hàng hóa** (regular item), **Dịch vụ** (service, no stock), **Combo – đóng gói** (bundle of other items; selling it deducts components).
- Product form: code, barcode, name, group, brand, cost price, sale price, stock, min/max stock, location, weight, up to 10 images, description, notes, variants/attributes (size, colour → generates child SKUs), units of measure with conversion rates, "bán trực tiếp" toggle, "tích điểm" toggle.
- Expanded row tabs: **Thông tin**, **Mô tả, ghi chú**, **Thẻ kho** (stock card: every stock movement with document link, qty change, running balance), **Tồn kho** (per branch).
- Row actions: edit, copy, stop selling, delete, print barcode labels (choose label size, quantity).
- **Thiết lập giá** (price books): multiple named price lists with validity dates, branch/customer-group/staff scoping, formula-based bulk pricing (e.g. cost + 30%), per-product overrides.
- **Kho hàng**:
  - **Kiểm kho** (stock take): draft → balanced; scan/enter actual qty, shows diff and value diff, adjusting stock on completion.
  - **Xuất dùng nội bộ** (internal use) and **Xuất hủy** (write-off/damage): documents that reduce stock with reason.
- Import products from Excel with a downloadable template and row-level error report.

### 3. Mua hàng (Purchasing)
- **Nhà cung cấp**: supplier list with code, name, phone, email, tax code, address, group, current payable debt, total purchased; supplier detail with purchase history and debt ledger; record supplier payments.
- **Hóa đơn đầu vào** (incoming e-invoices): manual entry/import of supplier invoices linked to purchase orders.
- **Nhập hàng** (goods receipt): select supplier, add items (search/scan), qty, unit cost, line discount, order discount, other costs, amount paid now, remaining becomes payable. Statuses: draft / completed / cancelled. Completing updates stock and recalculates weighted-average cost price.
- **Trả hàng nhập** (purchase returns): from a receipt or standalone; reduces stock and payable.
- **Mua dịch vụ**: record non-stock service purchases as expenses.

### 4. Đơn hàng (Orders)
- **Đặt hàng** (customer orders/reservations): reserves stock ("Khách đặt" column), can be converted to invoice, partial fulfilment, deposit.
- **Hóa đơn** (invoices): list columns Mã hóa đơn, Thời gian, Mã trả hàng, Mã KH, Khách hàng, Tổng tiền hàng, Giảm giá, Khách đã trả, etc. with totals row. Filters: date, delivery vs no-delivery, status (Đang xử lý / Hoàn thành / Không giao được / Đã hủy), return status, payment method, sales channel, creator, seller, branch. Expanded row: items, payments, delivery info, history; actions: print, copy, return, cancel, export.
- **Trả hàng** (returns): from an invoice or quick return; refund method; option to exchange (return + new sale in one transaction).
- **Giao hàng**: **Vận đơn** (waybills list), **Quản lý giao hàng** (delivery status tracking, COD reconciliation), **Đối tác giao hàng** (delivery partners: name, contact, fee settings). No real carrier API integration; model it so a carrier adapter can be plugged in later.

### 5. Khách hàng (Customers)
- **Khách hàng**: code, name, phone, email, birthday, gender, address, ward/district/province (Vietnam administrative data), tax code, customer group, notes, current debt, total sales, total net, loyalty points. Detail tabs: info, purchase history, debt ledger (record customer payments), points history.
- **Nhóm khách hàng**: groups with conditions (auto-assign by total spend) and default discount.
- **Ưu đãi**: promotions engine: invoice discount by total, product discount, buy X get Y, gift item, vouchers (generate codes, single/multi use, expiry). Applied automatically in POS when conditions match.
- Loyalty program: points earned per VND spent, redeem points as payment, configurable rates and exclusions.
- **Kênh tiếp cận**: customer messaging log (compose message templates, record "sent" entries; no real SMS/Zalo sending, stub an adapter).

### 6. Nhân viên (Staff)
- **Danh sách nhân viên**: profile, branch, position, phone, linked user login, status.
- **Lịch làm việc**: shift definitions and a weekly drag-and-drop schedule grid.
- **Bảng chấm công**: timesheet with check-in/out per shift, late/early, overtime, manual corrections.
- **Bảng lương**: payroll periods, salary templates (fixed, per shift, per hour, + commission + allowances − deductions), generate paysheet, mark paid (creates cash-book entry).
- **Bảng hoa hồng**: commission tables by product/group, % or fixed amount, assigned to staff.
- **Thiết lập nhân viên**: roles & permissions matrix (per module: view/create/edit/delete/export, plus "view cost price", "edit price at POS", "give discount up to X%"), branch access.

### 7. Sổ quỹ (Cash book)
- Fund tabs: **Tiền mặt**, **Ngân hàng** (multiple bank accounts), **Ví điện tử**, **Tổng quỹ**.
- Header summary: opening balance, total in, total out, closing balance for the selected period.
- List: Mã phiếu, Thời gian, Loại thu chi, Người nộp/nhận, Giá trị. Filters: fund, date, voucher type (Phiếu thu / Phiếu chi), category, creator, counterparty type, "hạch toán kết quả kinh doanh" yes/no.
- Create **Phiếu thu** / **Phiếu chi** with category (user-defined), counterparty (customer/supplier/staff/other), amount, note.
- Auto-entries generated by invoices, returns, purchase receipts, debt payments and payroll, linked back to their source document (prefixes like `TTHD…`, `TTPN…`).

### 8. Báo cáo (Reports)
All reports: filters (date, branch, staff, channel…), chart + table view, print, Excel export.
- **Phân tích**: Kinh doanh, Hàng hóa, Khách hàng, Hiệu quả (KPI dashboards with comparisons).
- **Cuối ngày** (end of day): sales, cash collected by method, returns, cash-book summary, per staff; printable shift-close slip.
- **Bán hàng**: by time, by profit, by discount, by return, by staff, by branch.
- **Đặt hàng**: by product, by transaction.
- **Hàng hóa**: sales by product, profit by product, stock in/out/balance (xuất nhập tồn), stock value, write-offs.
- **Khách hàng**, **Nhà cung cấp**, **Nhân viên**: sales/purchases, debts.
- **Kênh bán hàng**: revenue by channel (store, online, phone, etc.).
- **Tài chính**: simplified P&L (revenue − returns − COGS − expenses = profit) by month.

### 9. Bán online
- Sales channels list and an "online orders" inbox that feeds the same Orders module (stub channel adapters; manual order entry with channel tag).
- **Website bán hàng**: simple public storefront at `/shop` generated from products marked "sell online": product grid, product page, cart, checkout form that creates a customer order (Đặt hàng) with status "chờ xác nhận".

### 10. Thuế & Kế toán
- Tax settings (VAT rates per product, business household vs company mode).
- **Hóa đơn điện tử**: e-invoice records attached to sales invoices with status (draft / issued / cancelled) and a printable layout. Provider integration stubbed behind an interface.
- Tax declaration helper: quarterly revenue summary by tax rate, exportable.

### 11. POS app (`/sale`)
Full-screen, keyboard-first, optimised for 1366×768 and tablets.
- Top bar: product search (F3) with barcode-scanner support (rapid keyboard input + Enter), scan icon, **multiple invoice tabs** ("Hóa đơn 1", "+" to add, switch with keys), quick actions (cart/orders list, return, swap branch, print, user/branch menu).
- Left pane: cart lines (qty stepper, unit price editable per permission, line discount, notes, serial/lot if enabled), order note, totals.
- Right pane: customer search (F4) with "+" to create inline, price book selector, product grid with images, categories filter, pagination, toggle list/grid.
- **THANH TOÁN** (F9) panel: subtotal, discount (amount or %), voucher, points redemption, other income, amount due, multiple payment methods (cash, bank transfer with VietQR image generated from configured bank account, card, e-wallet), cash received → change, print receipt (58mm/80mm thermal and A4 templates, editable).
- Modes at bottom: **Bán nhanh** (fast checkout, auto-complete on scan), **Bán thường** (normal), **Bán giao hàng** (delivery: receiver info, partner, fee, COD).
- Works offline for short outages: cache products/customers in IndexedDB, queue invoices and sync when back online, show sync status.
- Shift open/close with opening cash and end-of-shift count.

### 12. Thiết lập (Settings)
Grouped settings page: Hàng hóa (allow negative stock, cost method, units, attributes), Đơn hàng (code prefixes, rounding, require customer), Khách hàng (loyalty, debt limits), Sổ quỹ (categories, bank accounts), Tiện ích (barcode label templates, print templates editor with placeholders), Cửa hàng (store info, logo, branches, tax info), **Lịch sử dữ liệu** (audit log viewer with filters), data backup/restore (download/upload a full DB export), and reset demo data.

## Data model (minimum)

Branch, User, Role, Permission, Employee, Shift, Timesheet, PayrollPeriod, Paysheet, CommissionTable, ProductGroup (tree), Brand, Product (type: goods/service/combo; parent for variants), ProductUnit, ComboItem, ProductImage, BranchStock, StockLedger, PriceBook, PriceBookItem, Supplier, SupplierGroup, PurchaseReceipt(+Lines), PurchaseReturn(+Lines), CustomerGroup, Customer, LoyaltyTransaction, Promotion, Voucher, CustomerOrder(+Lines), Invoice(+Lines, +Payments), Return(+Lines), Delivery, DeliveryPartner, StockTake(+Lines), WriteOff(+Lines), InternalUse(+Lines), CashFund, CashVoucher, CashCategory, EInvoice, SalesChannel, PrintTemplate, Setting, AuditLog.

Rules:
- Cost price = moving weighted average, recalculated on each receipt; COGS snapshot stored on each invoice line.
- Customer/supplier debt = derived from documents and payments, with a ledger, never a free-edited number.
- Cancelling a completed document creates reversing entries rather than deleting.

## Seed data

Generate realistic **fictional** demo data in Vietnamese: 1 branch "Chi nhánh trung tâm", ~40 fashion products (men's/women's vests, shirts, trousers, ties, belts, shoes, bags, wallets with codes like `NA001…`, `NU001…`), 5 suppliers, 6 customers, 2 staff, ~45 invoices and purchase receipts spread over the last 30 days, matching cash-book entries. Use placeholder product images (generated SVG silhouettes, no stock photos).

## Delivery plan

Work in milestones, committing after each, with tests:
1. Monorepo, auth, roles, layout shell, global list/table components, settings, audit log.
2. Products, groups, price books, stock ledger, stock take/write-off/internal use, Excel import/export.
3. Suppliers, purchasing, purchase returns, cost price.
4. Customers, groups, loyalty, promotions/vouchers.
5. POS app (cart, payments, receipts, multi-tab, offline queue), invoices, returns, customer orders.
6. Cash book and auto-entries; debts.
7. Delivery, online storefront, e-invoice stubs.
8. Staff: schedule, timesheet, payroll, commission.
9. Dashboard and all reports.
10. Polish: keyboard shortcuts, print templates, responsive POS, Docker, README.

Testing: Vitest unit tests for pricing, promotions, stock and cost calculations; Playwright end-to-end tests for "receive goods → sell at POS with discount and points → return → check stock card, cash book and reports agree".

At the end, write a README covering setup, default admin login (`admin` / `admin123`, forced change on first login), backup/restore, and how to add a real carrier, SMS or e-invoice provider adapter.
