# PhuongDong POS — Design

Date: 2026-10-28
Status: draft, awaiting owner approval

## 1. Intent

The owner runs a small Vietnamese fashion/accessories shop on a hosted retail POS (KiotViet, store `phuongdong2`). They want an **original, self-hosted** application that matches that product's *feature set and workflows* across every module, running on their Mac with one command and no cloud services.

The authoritative requirement list is `docs/requirements.md` (the owner's full brief, copied verbatim). This document records intent, decisions, and what was learned from inspecting the hosted app; where they conflict, the owner's brief wins unless marked below.

**Priority:** Products / stock and Suppliers / purchasing (milestones 2–3) are what the owner needs solid first. All 10 milestones are to be built in one run, without stopping for review between milestones.

## 2. Goals

- Every module in the brief: Dashboard, Products & stock, Purchasing, Orders/Invoices/Returns/Delivery, Customers/Loyalty/Promotions, Staff/Payroll, Cash book, Reports, Online storefront, Tax/e-invoice, POS app, Settings.
- One-command local run (`pnpm install && pnpm dev`), SQLite by default, Postgres via `DATABASE_URL`, plus `docker compose up`.
- Vietnamese UI by default (vi + en i18n), VND integers, `DD/MM/YYYY HH:mm`, `Asia/Ho_Chi_Minh`.
- Trustworthy numbers: stock, cost, debts and cash book always agree, because they are derived from immutable ledgers written inside DB transactions.

## 3. Non-goals

- No real integrations with carriers, SMS/Zalo, e-invoice providers, marketplaces, or banks. Each gets an adapter interface + stub implementation.
- No data migration from KiotViet (the hosted account currently holds demo data only — owner's assumption confirmed by not objecting).
- No multi-tenant SaaS; one business per install (branches supported).

## 4. Anti-goals (would be failure even if it "works")

- Copying the vendor's code, assets, logo, colours, icons or text. Own name ("PhuongDong POS", one config constant), own palette and icons. Vietnamese field labels are domain vocabulary and are fine.
- Free-editable debt or stock numbers that drift from documents.
- Hard deletes of completed documents (cancel = reversing entries).
- A POS that needs the mouse for the common path.

## 5. Constraints (decided by the owner's brief)

- Node 24, TypeScript, pnpm workspaces: `apps/api` (Fastify + Prisma), `apps/admin` (React + Vite + TanStack Router/Query + Tailwind), `apps/pos` (React + Vite, served at `/sale`), `packages/shared` (Zod schemas/types).
- Auth: phone/email/username + bcrypt password, httpOnly session cookie; default `admin` / `admin123` with forced change on first login.
- Money as integer đồng; all stock changes in transactions writing a `StockLedger` row.
- Cost = moving weighted average recalculated on each receipt; COGS snapshot on invoice lines.
- Document codes: prefix + 6 digits, auto, editable on create.
- Audit log for every create/update/delete.
- Tests: Vitest for pricing/promotions/stock/cost; Playwright E2E for receive → sell (discount + points) → return → stock card, cash book, reports agree.
- Commit after each milestone.

## 6. Additions learned from inspecting the hosted app (in scope)

Product form (modal with tabs **Thông tin / Mô tả / Bảo hành, bảo trì / Chi nhánh kinh doanh**):
- Fields: Mã hàng (blank = auto), Mã vạch, Tên hàng (required), Nhóm hàng (required, inline "Tạo mới"), Thương hiệu (inline create), images (≤10, ≤2 MB each), Giá vốn, Giá bán (+ link to price books), Tồn kho, Định mức tồn thấp nhất / cao nhất (default 0 / 999,999,999), Tích điểm (points per product; global rate e.g. 10,000đ = 1 điểm), Vị trí (shelf location, inline create), Trọng lượng (g / kg).
- Units: base unit name + extra units with conversion rate, own price, own "bán trực tiếp".
- Attributes → "Hàng cùng loại" table: attribute value × unit rows with own code, barcode, cost, price, stock, points.
- Mô tả tab: rich-text description, Ghi chú, and a "Mẫu ghi chú (hóa đơn, đặt hàng)" note template copied onto invoice/order lines.
- Warranty / periodic maintenance milestones (name + duration) per product.
- Branch availability: whole system or selected branches.
- Combo: component table (code, name, qty, cost, total cost, price, total price, VAT %, new price), discount VND/% → new combo price.
- Footer: "Bán trực tiếp" toggle, buttons Bỏ qua / Lưu & Tạo thêm hàng / Lưu & Sao chép / Lưu.

Product list: left filters (group tree, stock criteria, expected-out-of-stock date, created date …), totals row, expanded row tabs Thông tin / Mô tả, ghi chú / Thẻ kho / Tồn kho with badges (product type, bán trực tiếp, tích điểm).

Mega-menus:
- Hàng hóa → [Hàng hóa: Danh sách hàng hóa, Thiết lập giá] [Kho hàng: Kiểm kho, Xuất dùng nội bộ, Xuất hủy].
- Mua hàng → [Nhà cung cấp: Nhà cung cấp, Hóa đơn đầu vào] [Mua hàng: Nhập hàng, Trả hàng nhập] [Mua dịch vụ].

Nhập hàng:
- List filters: status (Phiếu tạm, Đã nhập hàng, Đã hủy), time (default this month), Số hóa đơn đầu vào. Columns: Mã nhập hàng, Thời gian, Mã NCC, Nhà cung cấp, Cần trả NCC, Trạng thái.
- Full-screen editor: left = product search (F3) + lines table (STT, Mã hàng, Tên hàng, ĐVT, Số lượng, Đơn giá, Giảm giá, Thành tiền), empty state offering Excel import of lines with template; right panel = staff, datetime, supplier search (+ create), Mã phiếu nhập, Mã đặt hàng nhập, Trạng thái, Số hóa đơn đầu vào, Tổng tiền hàng, Giảm giá, Cần trả NCC, Tiền trả NCC, ghi chú; buttons **Lưu tạm** (draft) / **Hoàn thành** (complete).

Nhà cung cấp: filters supplier group, Tổng mua (amount range + date range), Nợ hiện tại (amount range); columns Mã NCC, Tên, Điện thoại, Email, Nợ cần trả hiện tại, Tổng mua; toolbar "+ Nhà cung cấp", Import, Xuất file.

## 7. Architecture (builder's call, recorded)

- **API:** Fastify, one route module per domain; Zod schemas from `packages/shared` validate input and type responses. Prisma client; service layer holds business rules (`stockService.move()`, `costService`, `debtService`, `cashService`, `codeService.next(prefix)`, `auditService`). Every document "complete" runs in one `prisma.$transaction` that writes document + ledger + cash + audit.
- **Ledgers:** `StockLedger` (product, branch, docType, docId, qtyChange, costChange, balanceAfter), `PartnerLedger` (customer/supplier debt), `CashVoucher` (fund), `LoyaltyTransaction`. Balances cached on `BranchStock` / `Customer.debt` / `Supplier.debt` for speed but only ever updated by the services, and a `recompute` check exists for tests.
- **Admin app:** generic `DataTable` (selection, star, sortable, totals row, expandable row with tabs, column chooser, pagination with page size), `FilterSidebar` sections, `ListToolbar` (search, Tạo mới, import, export), mega-menu nav. Excel via `exceljs` on the server.
- **POS app:** separate Vite app at `/sale`; IndexedDB (via `idb`) cache of products/customers/price books; offline invoice queue with client-generated UUIDs for idempotent sync.
- **Storefront** `/shop`: small routes in the admin app bundle (public, no auth) or a minimal third Vite entry — builder's call.
- **Dev serving:** Vite admin on 5173 proxies `/api` to Fastify (3000) and `/sale` to the POS dev server; production build: Fastify serves both static builds.
- **VietQR:** generate EMVCo payload locally + QR via `qrcode` package (no network).
- **Adapters:** `CarrierAdapter`, `MessagingAdapter`, `EInvoiceProvider`, `ChannelAdapter` interfaces with `Stub*` implementations, registered in one place.

## 8. Builder's calls (owner can override)

- Package manager: corepack's pnpm download failed on this Mac; install pnpm with `npm i -g pnpm` (or the standalone script) during setup.
- Seed images: generated SVG silhouettes per product category.
- Fonts/palette: own palette (deep teal + warm amber accent), system font stack with Be Vietnam Pro from Google Fonts optional — no vendor blue.
- Vietnamese administrative data: bundle a static JSON of provinces/wards (post-2025 two-level structure) — builder may ship a trimmed dataset.
- Drag-and-drop schedule: `@dnd-kit`.
- Charts: `recharts`.
- Rich text for product description: lightweight (`tiptap` starter kit).
- Testing Playwright E2E runs against SQLite with a fresh seeded DB.

### Money and stock rules (builder's calls, from design review)

- **Cost price is per branch**: weighted-average cost lives on `BranchStock`; the product list shows the cost at the current branch. COGS is snapshotted on each invoice line from that branch's cost.
- **Receipt "other costs"** are spread into unit cost by line value. **Purchase returns** take stock out at the current average cost, and the difference from the receipt price goes to the supplier ledger only. **Negative stock** (when allowed) keeps the last cost; the next receipt computes the average against max(qty, 0).
- **Units of measure are views of the base SKU**: an extra unit (e.g. hộp = 6 cái) has its own code, barcode and price, but stock and ledger are kept only in base units. **Variants** (attribute combinations) are separate child products, each with its own stock and cost.
- **Prices include VAT** (normal Vietnamese retail). The VAT rate per product is used to back-calculate tax on e-invoices and in the tax report. Household mode reports revenue × the sector rate. Company mode reports VAT by rate.
- **Promotions don't stack by default**: line-level product promotions apply, then at most one invoice-level promotion (the best for the customer), then a voucher if its rules allow combining. A per-promotion "cho phép kết hợp" flag overrides this.
- **Loyalty points are earned on the amount actually paid** after all discounts, excluding the part paid with points, and skipping products marked không tích điểm.
- **Reference for other modules:** the brief is authoritative. The hosted app may be browsed read-only for layout and workflow reference.
- The project folder is not a git repo yet: `git init` happens at the start of milestone 1.

## 9. Milestones

As in the brief §Delivery plan, 1 → 10, each committed with tests. Milestones 2–3 receive the most care (owner's priority).

## 10. Owner decisions (2026-10-28)

- **Every module is fully working.** No skeleton modules. Simpler UI is acceptable, but every listed workflow must work end to end.
- **Added to scope:**
  - **Đặt hàng nhập (purchase orders):** draft → confirmed → partially received → completed / cancelled. A goods receipt can be created from a PO and records the PO code. POs don't change stock, but they show as "Đang về" (incoming) quantity on products. Hóa đơn đầu vào can link to a PO or a receipt. Built in milestone 3.
  - **Chuyển hàng (branch transfers):** draft → in transit (stock leaves the source branch at its cost) → received (stock enters the destination, which recalculates its average cost; a quantity received below the quantity sent is recorded as a shortfall) / cancelled (reversing entries). Lives under Hàng hóa → Kho hàng. Built in milestone 2, with the ledger paths tested.

## 11. Open items

None. Owner asked to proceed through all 10 milestones without stopping.
