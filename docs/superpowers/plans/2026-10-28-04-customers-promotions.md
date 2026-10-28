# Milestone 4 — Customers, Loyalty, Promotions & Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Customers with groups, derived debt and loyalty points; a pure promotions engine (invoice discount, product discount, buy X get Y, gift item, vouchers) that the POS (M5) calls; a messaging log behind a stub provider adapter.

**Architecture:** Pricing logic that both the API and the POS need lives in `packages/shared` as pure functions (`evaluatePromotions`, `pointsEarned`), so POS can preview offline and the API re-evaluates authoritatively when an invoice is saved. Customer debt reuses `postPartnerLedger` (customer side added); points get their own single writer `postLoyalty`. Messaging goes through a `MessagingAdapter` registry with a `StubMessagingAdapter`.

**Tech Stack:** as M3.

**Spec:** requirements §5; design §8 (promotions don't stack by default; `combinable` flag; points earned on the amount actually paid after discounts, excluding the part paid with points and excluding non-loyalty products).

## Global Constraints

- All earlier constraints. Customer code prefix `KH`; voucher codes 8 chars `[A-Z0-9]` (no `0/O/1/I`); customer debt payment voucher prefix `TTKH`.
- Customer sign convention: `PartnerLedger.amount > 0` → customer owes the shop more.
- `Customer.debt` and `Customer.points` are caches written only by `postPartnerLedger` / `postLoyalty`; both have recompute checks.
- `Customer.totalSpent` (net sales) is updated only by the M5 invoice/return services; M4 exposes it read-only.
- Vietnam administrative data: bundled list of the 34 provinces/cities (post-2025 two-level structure) in `packages/shared/src/data/provinces.ts`; ward is free text. Ruling (design §8 allowed a trimmed dataset).
- Promotion stacking: line-level product promotions (productDiscount, buyXGetY) apply first; then at most one invoice-level promotion (invoiceDiscount or giftItem — the best value for the customer) unless promotions are `combinable`; then one voucher if its campaign is `combinable` or no invoice promotion applied.

## Review Focus

1. **Promotion outside its hours/days/branch/customer group** must not apply (Task 1 tests).
2. **Single-use voucher used twice** (two tills at once) → second use refused atomically (`UPDATE … WHERE status='unused'`) (Task 5).
3. **Points redeemed exceed balance** → refused (Task 2 `postLoyalty` with `allowNegative=false`).
4. **Customer phone duplicates** → warn (409 `DUPLICATE_PHONE`) unless `force` (Task 3).
5. **Deleting a customer with history** → deactivated, history kept (Task 3).

---

### Task 1: Shared customer schemas, loyalty and promotion engine

**Files:** Create `packages/shared/src/schemas/customers.ts`, `packages/shared/src/loyalty.ts`, `packages/shared/src/promotions.ts`, `packages/shared/src/data/provinces.ts`; tests `packages/shared/test/{loyalty,promotions}.test.ts`.

**Produces:**
- `customerInputSchema { code?, name (required "Tên khách hàng là bắt buộc"), phone, phone2, email, birthday?: 'YYYY-MM-DD'|null, gender: 'male'|'female'|'', type: 'person'|'company', company, taxCode, address, ward, province, groupId?, note, isActive }`; `PROVINCES: string[]` (34).
- `pointsEarned(lines: { amount: number; loyaltyEnabled: boolean; fixedPoints?: number | null; qty: number }[], invoiceDiscount: number, pointsPaid: number, vndPerPoint: number): number` — invoice discount and points-paid are spread over loyalty-eligible line amounts by value; fixed-points lines earn `fixedPoints × qty`; floor.
- Promotion types:
```ts
type PromoBase = { id: number; code: string; name: string; combinable: boolean; startAt: string | null; endAt: string | null; daysOfWeek: number[] /* 0=CN..6, [] = all */; hours: [number, number][] /* [startHour, endHour) */; branchIds: number[]; customerGroupIds: number[] };
type InvoiceDiscount = PromoBase & { type: 'invoiceDiscount'; tiers: { minTotal: number; value: number; unit: '%' | 'VND'; maxDiscount?: number }[] };
type ProductDiscount = PromoBase & { type: 'productDiscount'; productIds: number[]; groupIds: number[]; minQty: number; value: number; unit: '%' | 'VND' /* per unit */ };
type BuyXGetY = PromoBase & { type: 'buyXGetY'; buyProductIds: number[]; buyQty: number; getProductIds: number[]; getQty: number; getDiscountPercent: number /* 100 = free */ };
type GiftItem = PromoBase & { type: 'giftItem'; minTotal: number; giftProductId: number; giftQty: number };
type Promotion = InvoiceDiscount | ProductDiscount | BuyXGetY | GiftItem;
type CartLine = { key: string; productId: number; groupId: number | null; qty: number; price: number /* unit price after manual line discount */ };
type PromoContext = { at: Date; branchId: number; customerGroupId: number | null };
type PromoResult = { lineDiscounts: Record<string, number> /* total per line key */; invoiceDiscount: number; gifts: { productId: number; qty: number; promotionId: number }[]; applied: { promotionId: number; name: string; amount: number }[] };
```
- `promotionActive(p, ctx): boolean` (dates, Vietnam-local weekday and hour, branch, group).
- `evaluatePromotions(lines: CartLine[], promos: Promotion[], ctx: PromoContext): PromoResult`.
- `voucherDiscount(campaign: { value: number; unit: '%'|'VND'; maxDiscount: number | null; minOrder: number }, orderTotal: number): number` (0 when below minOrder).

- [ ] **Failing tests** (selection): `pointsEarned` — `[{amount: 1_000_000, loyaltyEnabled: true, qty: 1}] , 0, 0, 10_000 → 100`; non-loyalty line excluded; invoice discount 100k on two lines 600k/400k with one excluded reduces eligible 600k by 60k → 54 points; fixed points 5 × qty 2 → 10. `evaluatePromotions` — invoice tiers pick highest reached tier; % with maxDiscount cap; productDiscount by group with minQty; buy 2 get 1 free on 5 items → 2 free (floor(5/3)… rule: every buyQty paid items give getQty discounted items among getProductIds, cheapest first); gift item when total ≥ min; two non-combinable invoice promos → only the larger; combinable both apply; promotion outside hours (Vietnam time 22:00 vs hours [[8,21]]) not applied; promotion scoped to another branch / customer group not applied; `voucherDiscount` with min order and cap.
- [ ] FAIL → implement → PASS → commit `feat(shared): loyalty and promotion engine`.

### Task 2: Schema + customer ledger + loyalty service

**Files:** schema (migration `customers`), `apps/api/src/services/partnerLedger.ts` (customer branch of `bumpDebt`), `apps/api/src/services/loyalty.ts`; tests `apps/api/test/loyalty.test.ts`, extend `partnerLedger.test.ts`.

**Models:** `CustomerGroup { id, name @unique, discountPercent Int @default(0), minTotalSpent Int? /* auto-assign threshold */, note }`; `Customer { id, code @unique, name, searchText, phone, phone2, email, birthday DateTime?, gender, type, company, taxCode, address, ward, province, groupId Int?, note, isActive, debt Int @default(0), points Int @default(0), totalSpent Int @default(0), lastPurchaseAt DateTime?, createdById Int?, createdAt, updatedAt, @@index([phone]) @@index([searchText]) }`; `LoyaltyTransaction { id, customerId, docType, docId, docCode, points Int, balanceAfter Int, note, createdAt, @@index([customerId, id]) }`; `Promotion { id, code @unique, name, type, isActive, startAt?, endAt?, daysOfWeek String "[]", hours String "[]", branchIds "[]", customerGroupIds "[]", combinable Boolean, config String /* type-specific JSON */, note, createdAt }`; `VoucherCampaign { id, code @unique, name, value Int, unit String, maxDiscount Int?, minOrder Int @default(0), startAt?, endAt?, multiUse Boolean @default(false), combinable Boolean @default(false), isActive, createdAt }`; `Voucher { id, campaignId, code @unique, status String @default("unused") /* unused|used|cancelled */, usedAt?, usedInvoiceId Int?, usageCount Int @default(0), createdAt }`; `MessageTemplate { id, name, channel, body, createdAt }`; `MessageLog { id, customerId Int?, phone, channel, body, status, provider, error String @default(""), createdById, createdAt }`.

**Produces:** `postLoyalty(tx, e: { customerId; points; docType; docId; docCode; note?; at?; allowNegative?: boolean }): Promise<{ balanceAfter }>` (refuses `INSUFFICIENT_POINTS` when balance would go < 0 and `allowNegative` false); `reverseLoyaltyDocument(tx, docType, docId, cancelDocType)`; `recomputePoints(tx, id)`.
- [ ] Tests: `customer debt via postPartnerLedger`, `points earn/redeem/insufficient`, `reverse`. FAIL → implement → PASS → commit.

### Task 3: Customers API

**Files:** `apps/api/src/services/customers.ts`, `apps/api/src/routes/customers.ts`; test `apps/api/test/customers.test.ts`.

**Produces:** `/api/customers` list (filters: `search` (code/name/phone, accent-insensitive), `groupIds`, `createdFrom/To`, `birthdayMonth` (1–12, Vietnam time), `gender`, `type`, `totalFrom/To` (totalSpent), `debtFrom/To`, `pointsFrom/To`, `status`; DB-side filtering and pagination; `totals { debt, totalSpent, points }`); `GET /:id`; `POST` / `PUT /:id` (phone duplicate → `409 DUPLICATE_PHONE` with existing code unless `force: true`); `DELETE /:id` (deactivate when any ledger/loyalty/doc history); `GET /:id/ledger`, `GET /:id/points`, `GET /:id/history` (invoices/returns — empty until M5; implemented against those tables in M5); `POST /:id/payments { amount, fundId?, note }` → cash in `TTKH` category `Thu tiền khách trả` + ledger −amount; `POST /:id/adjust-debt`, `POST /:id/adjust-points { newPoints, note }`; `GET /lookup?q=` (≤10, for POS: id, code, name, phone, groupId, groupName, discountPercent, debt, points); import/export (template columns: Mã KH, Tên, Điện thoại, Email, Ngày sinh (DD/MM/YYYY), Giới tính (Nam/Nữ), Địa chỉ, Phường/Xã, Tỉnh/Thành, Nhóm, Mã số thuế, Ghi chú).
- [ ] Tests: `auto code KH000001`, `duplicate phone 409 then force`, `birthdayMonth filter`, `payment reduces debt and writes TTKH voucher`, `adjust-points writes loyalty row`, `lookup by phone`, `delete with history deactivates`, `import errors`. FAIL → implement → PASS → commit.

### Task 4: Customer groups API

**Files:** `apps/api/src/routes/customerGroups.ts`, `apps/api/src/services/customerGroups.ts`; test `apps/api/test/customerGroups.test.ts`.

**Produces:** CRUD `/api/customer-groups` (with `customerCount`); `POST /api/customer-groups/apply-auto` — assigns every active customer to the group with the highest `minTotalSpent ≤ totalSpent` (customers whose group has no threshold keep it); `autoAssignGroup(tx, customerId)` exported for M5. Delete refused `IN_USE` when customers or price books reference it.
- [ ] Tests: `auto assign picks highest reached tier`, `manual group without threshold untouched`, `delete in use refused`.

### Task 5: Promotions & vouchers API

**Files:** `apps/api/src/routes/promotions.ts`, `apps/api/src/services/promotions.ts`; test `apps/api/test/promotions.test.ts`.

**Produces:** CRUD `/api/promotions` (zod per type for `config`; list filters status (running/upcoming/ended/inactive), type, search); `GET /api/promotions/active?customerId=` → active `Promotion[]` in shared shape for the session branch/now (POS caches it); `POST /api/promotions/evaluate { lines, customerId? }` → `PromoResult` (server-side re-evaluation used by M5); CRUD `/api/voucher-campaigns`; `POST /api/voucher-campaigns/:id/generate { count ≤ 1000 }` → codes; `GET /api/voucher-campaigns/:id/vouchers` (+ export); `GET /api/vouchers/check?code=&total=` → `{ valid, discount, reason? }`; `redeemVoucher(tx, code, invoiceId, orderTotal)` (single-use: conditional update `where status='unused'`, refuses `VOUCHER_USED`; multi-use increments `usageCount`); `releaseVoucher(tx, code, invoiceId)` for M5 cancellations.
- [ ] Tests: `evaluate applies best invoice tier`, `active list excludes other branch`, `generate 50 unique codes`, `check below min order`, `single-use voucher second redeem refused`, `release makes it usable again`.

### Task 6: Messaging API

**Files:** `apps/api/src/adapters/messaging.ts` (`MessagingAdapter { name; send(to: string, body: string): Promise<{ ok: boolean; error?: string }> }`, `StubMessagingAdapter` logs to console and returns ok, `getMessagingAdapter(channel)`), `apps/api/src/routes/messaging.ts`; test `apps/api/test/messaging.test.ts`.

**Produces:** CRUD `/api/message-templates`; `renderTemplate(body, customer, extra)` placeholders `{TenKhachHang} {MaKhachHang} {DiemHienTai} {CongNo} {TenCuaHang}`; `POST /api/messages/send { templateId? , body?, channel, customerIds?: number[], filter?: customer list query }` → one `MessageLog` per recipient (skips customers without phone, counted as `skipped`); `GET /api/messages` log list.
- [ ] Tests: `placeholders rendered`, `send to filter of 3 customers writes 3 logs`, `no phone skipped`.

### Task 7: Admin — customers & groups

**Files:** `apps/admin/src/pages/customers/{CustomersPage.tsx,CustomerForm.tsx,CustomerDetail.tsx,CustomerGroupsPage.tsx,CustomerPicker.tsx}`; test `apps/admin/test/CustomerForm.test.tsx`; register `/customers`, `/customer-groups`.
List per spec (sidebar: Nhóm khách hàng, Ngày tạo, Sinh nhật (tháng), Tổng bán (từ/tới), Nợ hiện tại, Điểm, Giới tính, Loại khách, Trạng thái; columns Mã KH, Tên, Điện thoại, Nhóm, Nợ hiện tại, Điểm, Tổng bán (totals)). Detail tabs: Thông tin, Lịch sử bán/trả hàng, Nợ cần thu từ khách (ledger + Thu tiền + Điều chỉnh), Lịch sử tích điểm (+ Điều chỉnh điểm). Form: province select (34) + ward text; duplicate-phone confirm dialog then `force`. `CustomerPicker` (search + quick create) exported for POS and orders.
- [ ] Test: `duplicate phone shows confirm and resubmits with force`.

### Task 8: Admin — promotions & vouchers

**Files:** `apps/admin/src/pages/promotions/{PromotionsPage.tsx,PromotionForm.tsx,VoucherCampaignForm.tsx,VouchersDialog.tsx}`; test `apps/admin/test/PromotionForm.test.tsx`; register `/promotions`.
Tabs Khuyến mại / Voucher. Promotion form: name, code, type select changes the config editor (tiers table; product/group pickers; buy/get pickers; gift picker), validity (dates, weekdays checkboxes, hour ranges), scope (branches, customer groups), "Cho phép kết hợp". Voucher campaign form + generate + list codes + export.
- [ ] Test: `invoiceDiscount form posts tiers config`.

### Task 9: Admin — messaging

**Files:** `apps/admin/src/pages/messaging/MessagingPage.tsx`; register `/messaging`. Templates list/editor with placeholder chips, send dialog (to selected customers from a customer search or "all customers in group"), log table with status. Banner: "Đang dùng nhà cung cấp mô phỏng — tin nhắn không thực sự được gửi".

### Task 10: Seed + E2E

**Files:** `apps/api/src/seed/customers.ts` (2 groups "Khách VIP" 5% minTotalSpent 20,000,000, "Khách thân thiết" 2% minTotalSpent 5,000,000; 6 fictional customers with Vietnamese names/phones/provinces; 1 invoiceDiscount promo (≥ 2,000,000 → 5%, ≥ 5,000,000 → 8% max 1,000,000), 1 productDiscount on group Phụ kiện Nữ 10%, 1 buy 2 ties get 1 free, 1 voucher campaign "GIAM50K" 50,000 min 500,000 with 20 codes; 2 message templates), wired into `prisma/seed.ts`; `e2e/customers.spec.ts`.
- [ ] E2E: create customer with duplicate phone → confirm → saved; record a debt payment via adjust-debt then "Thu tiền" → debt 0 and voucher in ledger; create invoiceDiscount promotion via the form → appears as "Đang chạy". Full suite → commit.
