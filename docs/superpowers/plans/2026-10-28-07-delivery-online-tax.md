# Milestone 7 — Delivery, Online Sales & Tax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Delivery partners, waybills and delivery tracking with COD reconciliation; sales channels, an online-orders inbox and a public `/shop` storefront that creates customer orders awaiting confirmation; tax settings, e-invoices behind a stub provider, and a quarterly tax-declaration helper.

**Architecture:** Delivery sales already exist (M5: `Invoice.status 'processing'`, `InvoiceDelivery` with `cod`, the unpaid part kept off customer debt). This milestone adds the lifecycle that finishes them through one service, `services/delivery.ts`, which is the only writer of `InvoiceDelivery.status`. Money still flows through `recordCash` and `postPartnerLedger`; delivery partners become a third ledger party (`partnerType 'deliveryPartner'`, cached `DeliveryPartner.debt`: positive = the partner owes the shop). Carriers and e-invoice providers sit behind adapter interfaces with stub implementations (`adapters/carrier.ts`, `adapters/einvoice.ts`) like `adapters/messaging.ts`. The storefront is a set of public routes in the admin bundle (`/shop…`, outside the authenticated shell), backed by the already-public `/api/shop/*`.

**Tech Stack:** as before (Fastify, Prisma 7/SQLite, React, TanStack, Tailwind, Vitest, Playwright).

**Spec:** requirements §4 (Giao hàng), §9, §10; design §8 (prices include VAT; household vs company mode).

## Global Constraints

- All earlier constraints. Codes: waybill = invoice code (one delivery per invoice); COD reconciliation `DSCOD` + 6 digits; e-invoice number per series, 7 digits, series from settings (default `1C26TPD`).
- Delivery statuses (one machine, `services/transition.ts`): `pending` (Chờ lấy hàng) → `picked` (Đã lấy hàng) → `delivering` (Đang giao) → `delivered` (Giao thành công) | `failed` (Giao thất bại) → `delivering` (giao lại) | `returning` (Đang chuyển hoàn) → `returned` (Đã chuyển hoàn); `pending|picked` → `cancelled` only via invoice cancel.
- `delivered`: invoice → `completed` (completedAt now); customer ledger gets the invoice (+due) and payment (−(paid + cod)) rows exactly once; with a partner: partner ledger +cod (docType `deliveryCod`) and, when `feePayer = 'shop'`, −fee (`deliveryFee`); without a partner (self-delivery): COD is cash in now (`TTHD`, category "Thu tiền khách trả") and the invoice `paid += cod`.
- `returned`: goods back in stock and prepaid money refunded/reversed via the existing `cancelInvoice(…)`; invoice status `cancelled`, the old `undeliverable` label shows as "Không giao được" for `failed|returning`.
- COD reconciliation (Đối soát): select delivered, unreconciled waybills of one partner → one cash voucher in (`DSCOD`, category "Thu tiền đối tác giao hàng", system) for Σcod − Σ(shop-paid fees), partner ledger −that amount; waybills marked `reconciledAt`. Cancel reverses both.
- Storefront: only `Product.sellOnline && isActive`, price = base price (no price book), stock shown as "Còn hàng/Hết hàng" for the first branch the store marks as online (`settings.online.branchId`, default first branch). Checkout creates `CustomerOrder { channel: 'website', status: 'pending' }`, customer matched by normalised phone or created. `pending` orders don't reserve stock until confirmed. Public POST is rate-limited (10/min/IP) and rejects a filled honeypot field.
- Online inbox: customer orders with `channel ≠ 'store'`; "Xác nhận" moves `pending → confirmed` (reserves stock, existing hook) and "Từ chối" → `cancelled`.
- Tax: `settings.tax` gains `householdVatRate` (default 1), `householdPitRate` (default 0.5), `einvoiceSeries` ('1C26TPD'), `autoIssue` (false). VAT per line = `round(amount × r / (100 + r))` with r = product `vatRate ?? defaultVatRate`; household mode reports revenue × (householdVatRate + householdPitRate)%.
- E-invoice statuses `draft → issued → cancelled` (and `draft → deleted`); issuing calls the provider adapter inside the transaction only to obtain number/lookup code (stub is synchronous); one non-cancelled e-invoice per invoice; a cancelled sales invoice with an issued e-invoice is refused (`409 EINVOICE_ISSUED`) until the e-invoice is cancelled.
- Permissions: `deliveries.*`, `online.*`, `tax.*` modules (already in MODULES); reconciliation needs `deliveries.edit` + `cashbook.create`.

## Review Focus

1. **Delivered twice** (double click / two tabs) — COD and ledger rows must post once (conditional transition; Task 2 test).
2. **Returned after a partial prepay** — the prepaid cash is refunded once, stock is back, customer debt unchanged (Task 2).
3. **Reconciling a waybill already reconciled** or from another partner → 409, nothing posted (Task 3).
4. **Storefront order for an inactive / not-online product, a negative quantity or a spoofed price** → 400; the server prices every line itself (Task 5).
5. **VAT for a line with a returned quantity** — the tax report uses net amounts (invoices minus returns in the quarter) (Task 7).

---

### Task 1: Delivery partners API + carrier adapter

Migration: `DeliveryPartner { id, code 'DT'+6, name, phone, email, address, note, isActive, debt Int @default(0), feeMode 'flat'|'byWeight', flatFee, feePerKg, createdAt }`; `InvoiceDelivery` gains `feePayer String @default("shop")`, `reconciledAt DateTime?`, `reconciliationId Int?`, `deliveredAt DateTime?`; `CodReconciliation { id, code, partnerId, branchId, amount, fundId, cashVoucherId, status, createdById, createdAt, cancelledAt }`. Extend `PartnerType` with `'deliveryPartner'` in `postPartnerLedger`. `adapters/carrier.ts`: `interface CarrierAdapter { quote(input): Promise<{ fee: number }>; createShipment(input): Promise<{ trackingCode: string }>; }` + `ManualCarrier` (fee from partner settings, tracking code = invoice code).
Routes `/api/delivery-partners` CRUD (+ `GET /:id/ledger`, delete → deactivate when used), `POST /api/delivery-partners/:id/quote { weight }`.
- Tests: `create partner with flat fee and quote`, `partner with deliveries cannot be deleted (deactivated)`, `ledger for a deliveryPartner keeps cached debt`.

### Task 2: Delivery lifecycle

`services/delivery.ts`: `setDeliveryStatus(tx, ctx, invoiceId, to, user, { note? })` implementing the Global Constraints machine and effects; `cancelInvoice` refuses `delivered`… (existing path handles completed). Routes: `GET /api/deliveries` (filters status[], partnerIds, from/to, reconciled, province, search code/receiver/phone; totals of cod and fee), `GET /api/deliveries/:invoiceId`, `PUT /api/deliveries/:invoiceId` (receiver/address/partner/fee/feePayer/weight/note while `pending|picked`), `POST /api/deliveries/:invoiceId/status { to, note }`, `POST /api/deliveries/bulk-status { invoiceIds, to }` (each in its own transaction; returns per-id result).
- Tests: `delivered with partner posts COD to partner ledger once and completes the invoice`, `double delivered → 409 and no second ledger row`, `self-delivery delivered records TTHD cash for the COD`, `returned refunds prepaid cash once and restores stock`, `illegal transition (pending → delivered) → 409`.

### Task 3: COD reconciliation

`POST /api/cod-reconciliations { partnerId, invoiceIds, fundId, note }`, `GET /api/cod-reconciliations`, `POST /:id/cancel`. System cash category "Thu tiền đối tác giao hàng" (in, affectsPnl false) added to `ensureCashDefaults`; fees paid by shop are netted.
- Tests: `reconcile two waybills → one DSCOD voucher for Σcod − Σfee and partner debt back to 0`, `waybill already reconciled → 409`, `waybill of another partner → 409`, `cancel restores debt and unmarks waybills`.

### Task 4: Admin — waybills, delivery management, partners

`/waybills` (Vận đơn): list of deliveries with columns Mã vận đơn, Thời gian, Khách hàng/Người nhận, SĐT, Địa chỉ, Đối tác, Phí, COD, Trạng thái; sidebar filters (status, partner, date, province, đối soát); bulk status change; expanded row with edit form and status history from the audit log. `/deliveries` (Quản lý giao hàng): status tabs with counts, "Đối soát COD" flow (pick partner → unreconciled delivered waybills checked → fund → Lưu), reconciliation history list. `/delivery-partners`: list + form (fee mode) + ledger tab. Invoice expanded row shows delivery info and a link to the waybill.
- Tests: `bulk status change posts selected ids`, `reconcile dialog totals selected COD minus fees`.

### Task 5: Sales channels, online inbox & shop API

`/api/sales-channels` CRUD (seed: Cửa hàng `store`, Website `website`, Facebook `facebook`, Zalo `zalo`, Shopee `shopee` — stub channel adapters are labels only); `GET /api/online-orders` (customer orders with channel ≠ store; status tabs pending/confirmed/…); `POST /api/customer-orders/:id/accept` (pending → confirmed via existing confirm hook) and `/reject`. Public: `GET /api/shop/info` (store name, logo, hotline), `GET /api/shop/products` (search, groupId, page; price, image, inStock), `GET /api/shop/products/:id` (variants, images, description), `POST /api/shop/orders { customer: { name, phone, address, province, ward, note }, lines: [{ productId, qty }], website: '' }` → `{ code }`. `settings.online { enabled, branchId, hotline }` (shop routes 404 when disabled). Admin Products form already has "Bán trực tuyến".
- Tests: `shop lists only sellOnline active products`, `shop order prices lines server-side and creates a pending website order`, `shop order for a not-online product → 400`, `honeypot filled → 400`, `11th order in a minute → 429`, `accept reserves stock; pending does not`.

### Task 6: Admin — channels, online inbox; public storefront

`/online/channels` (list + form), `/online/orders` (inbox with Chờ xác nhận / Đã xác nhận / Đã hủy tabs, accept/reject, open in order editor), `/online/storefront` (settings: enabled, branch, hotline + link "Mở website"). Storefront routes `/shop`, `/shop/p/$id`, `/shop/cart`, `/shop/done/$code` outside the auth shell: header with store name, product grid with search and group filter, product page with variant pick, cart in `localStorage` (try/catch), checkout form (name, phone, province select from `PROVINCES`, address, note, hidden honeypot), confirmation page. Own palette, no vendor branding.
- Tests: `cart adds and totals lines`, `checkout posts lines and customer and shows the order code`.

### Task 7: Tax — settings, e-invoices, declaration

Migration `EInvoice { id, invoiceId, series, number String?, lookupCode, status, buyerName, buyerTaxCode, buyerAddress, buyerEmail, totalBeforeVat, vatAmount, total, ratesJson, provider, issuedAt, cancelledAt, cancelReason, createdById, createdAt }` (`@@index([invoiceId])`). Shared `vatBreakdown(lines: { amount: number; vatRate: number }[]) → { rate, gross, net, vat }[]`. `adapters/einvoice.ts`: `interface EInvoiceProvider { issue(draft): Promise<{ number: string; lookupCode: string }>; cancel(ref, reason): Promise<void>; }` + `StubEInvoiceProvider` (sequential per series via `DocumentSequence`). Routes: `/api/e-invoices` list/filter, `POST /api/e-invoices { invoiceId, buyer… }` (draft from invoice net of returns), `POST /:id/issue`, `POST /:id/cancel { reason }`, `DELETE /:id` (draft), `GET /:id/print`; `settings.tax.autoIssue` issues on invoice completion. `GET /api/tax/declaration?year&quarter` → by rate rows (gross, net, vat) for company mode or revenue × rates for household mode, net of returns; `/export`. Admin: `/tax/settings` (mode, rates, series, auto issue, per-group VAT bulk update), `/tax/e-invoices` (list, create from invoice, issue, cancel, print layout), `/tax/declaration` (year/quarter pick, table, export).
- Tests: shared `vatBreakdown([{amount:1_080_000,vatRate:8}]) → net 1_000_000, vat 80_000`; `issue gives sequential numbers per series`; `one active e-invoice per invoice`; `cancelling a sales invoice with an issued e-invoice → 409`; `declaration nets returns in the quarter`; `household mode applies 1% + 0.5%`; admin `issue button calls issue endpoint`.

### Task 8: Seed + E2E

Seed: 2 delivery partners, 6 delivery invoices across statuses (2 delivered and reconciled, 1 delivered unreconciled, 1 delivering, 1 returned, 1 pending), channels, 8 products `sellOnline`, 2 pending website orders, 5 issued e-invoices. `e2e/delivery-online.spec.ts`: storefront checkout → order appears in the online inbox → accept → convert to a delivery invoice in POS-free admin flow via API → mark delivered → reconcile COD → cash book shows DSCOD; e-invoice issued for the invoice and printable.
