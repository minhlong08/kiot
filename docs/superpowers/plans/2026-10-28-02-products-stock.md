# Milestone 2 — Products & Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Full product catalogue (goods / service / combo, variants, units, images, warranty, branch availability), per-branch stock with an immutable ledger and weighted-average cost, price books, stock take, internal use, write-off, branch transfers, Excel import/export and barcode labels.

**Architecture:** One `stockService.move()` is the only writer of `BranchStock` and `StockLedger`; every stock document calls it inside its transaction. Pure pricing/cost helpers live in `packages/shared` so POS (M5) reuses them. Admin screens are built on the M1 list kit; document editors share one `DocumentLinesEditor`.

**Tech Stack:** as M1, plus `jsbarcode` (admin, labels).

**Spec:** `docs/superpowers/specs/2026-10-28-phuongdong-pos-design.md` §6–8, §10; `docs/requirements.md` §2.

## Global Constraints

- All M1 constraints.
- Quantities are **integers** (fashion retail). Units convert by an integer `conversion` ≥ 1 to base units; stock and ledger hold base units only.
- Cost is per branch on `BranchStock.cost` (integer đồng, weighted average, rounded half-up). `Product.cost` is the default/initial cost used when a branch has no stock row and for services.
- Every stock change: one `StockLedger` row per product per document line, written by `moveStock` in the caller's `tx`, with `balanceAfter` and `costAfter`.
- Negative stock is refused (`409 INSUFFICIENT_STOCK`, message names the product code) unless `settings.products.allowNegativeStock`.
- Cancelling a completed document writes reversing ledger rows (docType suffixed `_cancel`), never deletes.
- Codes from `settings.orders.codePrefixes` (`product: 'SP'`, `stockTake: 'KK'`, `writeOff: 'XH'`, `internalUse: 'XDNB'`, `transfer: 'CH'`).
- Product search uses `Product.searchText = normalizeVi(code + ' ' + barcode + ' ' + name)`.

## Review Focus

1. **Selling/issuing a combo** must deduct each component (qty × component qty), never the combo itself → `moveStock` combo expansion test (Task 2).
2. **Receiving into a branch whose stock is negative** must not produce a nonsense average → average uses `max(onHand, 0)`; test with onHand −2 (Task 2).
3. **Balancing a stock take after other sales happened** since it was drafted → diff is recomputed from current onHand at balance time, not the draft snapshot (Task 6).
4. **Import file with duplicate codes or unknown group names** → row-level error list, nothing written (all-or-nothing) (Task 5).
5. **Deleting a product that has ledger history** → becomes inactive instead of disappearing (stock card stays readable) (Task 4).

---

### Task 1: Catalogue schema + shared schemas

**Files:** Modify `apps/api/prisma/schema.prisma`; create migration `products_stock`; create `packages/shared/src/schemas/products.ts`, `packages/shared/src/pricing.ts`; test `packages/shared/test/pricing.test.ts`.

**Prisma models (all `Int` ids autoincrement; strings default `""`):**
- `ProductGroup { id, name, parentId Int?, sort Int @default(0) }` (tree via parentId).
- `Brand { id, name @unique }`, `Location { id, name @unique }`.
- `Product { id, code @unique, barcode String?, name, searchText, type String @default("goods") /* goods|service|combo */, groupId Int?, brandId Int?, locationId Int?, parentId Int? /* variant master */, variantLabel String @default("") /* "Đỏ - M" */, attributes String @default("[]") /* master: [{name, values[]}] ; child: [{name,value}] */, unit String @default(""), price Int @default(0), cost Int @default(0), minStock Int @default(0), maxStock Int @default(999999999), weight Int @default(0) /* grams */, description String, note String, orderNoteTemplate String, vatRate Int? /* null = settings default */, loyaltyEnabled Boolean @default(true), points Int? /* override points per unit, null = rate */, isDirectSale Boolean @default(true), sellOnline Boolean @default(false), isActive Boolean @default(true), allBranches Boolean @default(true), createdAt, updatedAt, @@index([searchText]) @@index([groupId]) }`.
- `ProductBranch { productId, branchId, @@id }` (only when `allBranches=false`).
- `ProductUnit { id, productId, name, conversion Int, code @unique, barcode String?, price Int, isDirectSale Boolean @default(true) }`.
- `ComboItem { comboId, itemId, qty Int, @@id([comboId,itemId]) }`.
- `ProductImage { id, productId, url, sort Int }`.
- `ProductWarranty { id, productId, kind String /* warranty|maintenance */, name, duration Int, durationUnit String /* day|month|year */ }`.
- `BranchStock { productId, branchId, onHand Int @default(0), cost Int @default(0), reserved Int @default(0), incoming Int @default(0), @@id([productId,branchId]) }`.
- `StockLedger { id, productId, branchId, docType String, docId Int, docCode String, qtyChange Int, unitCost Int, balanceAfter Int, costAfter Int, note String, createdAt DateTime @default(now()), @@index([productId,branchId,id]) @@index([docType,docId]) }`.
- `PriceBook { id, name, isActive Boolean @default(true), startAt DateTime?, endAt DateTime?, branchIds String @default("[]"), customerGroupIds String @default("[]"), userIds String @default("[]") /* empty = all */, allowOutsideItems Boolean @default(true), createdAt }`, `PriceBookItem { priceBookId, productId, price Int, @@id }`.
- `StockTake { id, code @unique, branchId, status String /* draft|balanced|cancelled */, note, createdById Int, balancedAt DateTime?, createdAt, totalActualQty Int @default(0), totalDiffQty Int @default(0), totalDiffValue Int @default(0) }`, `StockTakeLine { id, stockTakeId, productId, systemQty Int, actualQty Int, diffQty Int, cost Int, diffValue Int }`.
- `StockIssue { id, code @unique, kind String /* writeOff|internalUse */, branchId, status String /* draft|completed|cancelled */, reason, note, createdById, completedAt DateTime?, createdAt, totalQty Int @default(0), totalValue Int @default(0) }`, `StockIssueLine { id, issueId, productId, qty Int, cost Int, value Int }`.
- `Transfer { id, code @unique, fromBranchId, toBranchId, status String /* draft|inTransit|received|cancelled */, note, createdById, sentAt DateTime?, receivedAt DateTime?, createdAt, totalSentQty Int @default(0), totalReceivedQty Int @default(0), totalValue Int @default(0) }`, `TransferLine { id, transferId, productId, qtySent Int, qtyReceived Int @default(0), cost Int }`.

**Shared — Produces:**
- `PRODUCT_TYPES = ['goods','service','combo']`; `productInputSchema` (zod) with all form fields: `code?` (blank = auto), `barcode?`, `name` (required, "Tên hàng là bắt buộc"), `type`, `groupId` (required for goods/combo: "Chọn nhóm hàng"), `brandId?`, `locationId?`, `price`, `cost` (moneySchema), `onHand?` (initial stock, int ≥ 0, goods only, create only), `minStock`, `maxStock`, `weight`, `unit`, `description`, `note`, `orderNoteTemplate`, `vatRate?`, `loyaltyEnabled`, `points?`, `isDirectSale`, `sellOnline`, `allBranches`, `branchIds[]`, `images: string[]` (≤10), `units: {id?, name, conversion ≥2, code?, barcode?, price, isDirectSale}[]`, `attributes: {name, values: string[]}[]`, `variants: {id?, values: string[], code?, barcode?, price, cost, onHand?}[]`, `comboItems: {itemId, qty ≥1}[]` (required ≥1 when combo), `warranties: {kind, name, duration ≥1, durationUnit}[]`.
- `weightedAverageCost(onHand: number, cost: number, qtyIn: number, unitCost: number): number` → `qtyIn<=0 ? cost : round((max(onHand,0)*cost + qtyIn*unitCost) / (max(onHand,0)+qtyIn))`.
- `applyPriceFormula(base: number, op: '+'|'-', value: number, unit: '%'|'VND', roundTo?: 0|100|1000): number` (never below 0).
- `variantCombos(attributes: {name, values: string[]}[]): string[][]` (cartesian product; `[]` → `[]`).

- [ ] **Step 1: Failing tests** (`pricing.test.ts`):
```ts
expect(weightedAverageCost(10, 100_000, 10, 120_000)).toBe(110_000);
expect(weightedAverageCost(0, 0, 5, 83_000)).toBe(83_000);
expect(weightedAverageCost(-2, 90_000, 4, 100_000)).toBe(100_000);
expect(weightedAverageCost(3, 100_000, 0, 0)).toBe(100_000);
expect(weightedAverageCost(1, 1, 2, 2)).toBe(2); // 5/3 = 1.67 → 2
expect(applyPriceFormula(820_000, '+', 30, '%', 1000)).toBe(1_066_000);
expect(applyPriceFormula(100_000, '-', 150_000, 'VND')).toBe(0);
expect(variantCombos([{ name: 'Màu', values: ['Đen', 'Xám'] }, { name: 'Size', values: ['M', 'L'] }])).toEqual([['Đen','M'],['Đen','L'],['Xám','M'],['Xám','L']]);
expect(productInputSchema.safeParse({ name: 'X', type: 'combo', groupId: 1, comboItems: [] }).success).toBe(false);
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement + `prisma migrate dev --name products_stock`. **Step 4:** shared + api tests PASS. **Step 5:** commit `feat: catalogue schema and pricing helpers`.

### Task 2: Stock service

**Files:** Create `apps/api/src/services/stock.ts`; test `apps/api/test/stock.test.ts`; helper `apps/api/test/factories.ts` (`makeProduct(prisma, overrides)`, `branchId(prisma)`).

**Interfaces — Produces:**
```ts
type MoveInput = { productId: number; branchId: number; qty: number /* signed, in units of productId's own unit (base) */;
  unitCost?: number /* inbound only: updates weighted average */; docType: string; docId: number; docCode: string; note?: string; at?: Date };
moveStock(tx: Tx, m: MoveInput, opts?: { allowNegative?: boolean }): Promise<{ unitCost: number /* cost per base unit used/after */; lines: { productId: number; qtyChange: number; unitCost: number }[] }>
getBranchStock(tx: Tx, productId: number, branchId: number): Promise<{ onHand: number; cost: number; reserved: number; incoming: number }>
setOnHand(tx: Tx, m: Omit<MoveInput,'qty'|'unitCost'> & { target: number }): Promise<{ diff: number; unitCost: number }>  // stock take
adjustCounter(tx: Tx, productId: number, branchId: number, field: 'reserved'|'incoming', delta: number): Promise<void>
reverseDocument(tx: Tx, docType: string, docId: number, cancelDocType: string, allowNegative?: boolean): Promise<void> // replays ledger rows with negated qty at the recorded unitCost
```
Rules: service → no-op returning `{unitCost: product.cost, lines: []}`; combo → recurse into `ComboItem`s with `qty × item.qty`, return summed component cost per combo unit; missing `BranchStock` row created with `cost = product.cost`; inbound with `unitCost` recomputes average via `weightedAverageCost`; outbound and inbound-without-unitCost keep cost; `allowNegative` defaults to `getSettings(tx).products.allowNegativeStock`.

- [ ] **Step 1: Failing tests**: `receive 10 @100k then 10 @120k → onHand 20, cost 110k, two ledger rows with balanceAfter 10 and 20`; `issue beyond stock throws INSUFFICIENT_STOCK with product code in message`; `allowNegative lets onHand go to -2 and next receipt of 4 @100k gives cost 100k`; `combo of 2×A + 1×B issued 3 deducts A by 6 and B by 3 and returns combo unit cost 2*costA+costB`; `service product move is a no-op with no ledger`; `setOnHand to 7 from 10 writes qtyChange -3`; `reverseDocument restores onHand and writes *_cancel rows`; `adjustCounter reserved +2 then -2`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(api): stock service with weighted-average cost`.

### Task 3: Catalogue lookups API

**Files:** Create `apps/api/src/routes/catalog.ts`; test `apps/api/test/catalog.test.ts`.

**Produces:** `GET/POST/PUT/DELETE /api/product-groups` (GET returns flat list with `parentId`, `productCount`; DELETE refuses `GROUP_IN_USE` when products or children exist), same CRUD for `/api/brands` and `/api/locations` (DELETE → `IN_USE`). Perms `products.*`. Audited.

- [ ] Tests: `create nested group`, `delete group with child → 409 GROUP_IN_USE`, `brand duplicate name → 409 DUPLICATE`. FAIL → implement → PASS → commit.

### Task 4: Products API

**Files:** Create `apps/api/src/services/products.ts`, `apps/api/src/routes/products.ts`; test `apps/api/test/products.test.ts`.

**Interfaces — Produces:**
- `saveProduct(tx, ctx, input: ProductInput, id?: number): Promise<Product>` — auto code `nextCode(prefix 'SP')` when blank, `reserveCode` when typed; recomputes `searchText`; replaces units/images/warranties/comboItems/branches; **variants:** master keeps `attributes`, each `variants[]` entry becomes/updates a child product (`parentId`, `variantLabel = values.join(' - ')`, name = `${name} - ${label}`, code auto `${masterCode}-${n}` when blank), children removed from the list are deactivated; initial `onHand` (create only, goods & variants) writes a ledger row `docType 'opening'` at `cost`.
- `GET /api/products` query: `search`, `groupIds` (includes descendants), `stock` (`all|inStock|outOfStock|belowMin|aboveMax`), `types`, `brandIds`, `isDirectSale`, `loyalty`, `status` (`active|inactive|all`, default active), `createdFrom/To`, `sort`, page. Masters with variants are listed as their variants (children) — the master itself is hidden from the list (KiotViet-style "hàng cùng loại"). Row: `id, code, name, imageUrl, type, groupName, price, cost (0 and omitted unless cost.view), onHand, reserved, incoming, createdAt, expectedOutDate, isActive, unit`; `totals: { onHand, reserved }` over the whole filter (not just page). Stock figures are for the session branch.
- `expectedOutDate(tx, productId, branchId, onHand): Promise<Date|null>` — average daily outflow over last 30 days from ledger rows with `docType in ('invoice')`; null when no outflow or onHand ≤ 0.
- `GET /api/products/:id` full detail incl. units, combo items, images, warranties, variants, per-branch stock array.
- `GET /api/products/:id/stock-card?branchId&page` → ledger rows newest first: `createdAt, docType, docCode, docId, qtyChange, unitCost, balanceAfter, costAfter, note`.
- `POST /api/products`, `PUT /api/products/:id`, `POST /api/products/:id/copy` (returns unsaved draft input with code blank), `POST /api/products/bulk` `{ ids, action: 'activate'|'deactivate'|'delete'|'setGroup', groupId? }`, `DELETE /api/products/:id` (hard delete only if no ledger rows and not used in combos; otherwise deactivate and return `{ deactivated: true }`).
- `GET /api/products/lookup?q=` → ≤20 active direct-sale items incl. units as separate rows `{ productId, unitId?, code, name, unitName, conversion, price, cost?, onHand, imageUrl }` matching code/barcode exactly first, then search (used by every document editor and POS).
- `GET /api/products/export` → xlsx of current filter (columns as list + group, brand, barcode, unit).

- [ ] Tests: `create goods with initial stock writes opening ledger and onHand`, `auto code SP000001 then typed SP000050 then next SP000051`, `variants create 4 children named with labels and the list shows children not master`, `combo requires items`, `search 'ao vest' finds 'Áo vest nam'`, `stock filter belowMin`, `cost hidden for cashier role`, `delete with history deactivates`, `lookup by barcode returns exact match first`, `lookup returns unit rows with conversion`. FAIL → implement → PASS → commit.

### Task 5: Product import

**Files:** Create `apps/api/src/services/productImport.ts`, route additions in `routes/products.ts`; test `apps/api/test/productImport.test.ts`.

**Produces:** `GET /api/products/import-template` (xlsx with headers: `Loại hàng, Nhóm hàng, Mã hàng, Mã vạch, Tên hàng, Thương hiệu, Giá bán, Giá vốn, Tồn kho, Tồn nhỏ nhất, Tồn lớn nhất, ĐVT, Trọng lượng (g), Được bán trực tiếp, Mô tả` + one example row). `POST /api/products/import` multipart file, `?mode=create|upsert` → `{ created, updated, errors: { row: number; message: string }[] }`; any error → nothing written. Group path `Thời trang Nam>Áo` creates missing groups; unknown brand created. Audited once as `import`.

- [ ] Tests: `imports 2 rows with group path creation`, `duplicate code inside file → error row 3, nothing written`, `negative price → error`, `upsert updates by code`. FAIL → implement → PASS → commit.

### Task 6: Stock documents API (stock take, issues, transfers)

**Files:** Create `apps/api/src/services/stockDocs.ts`, `apps/api/src/routes/stockTakes.ts`, `routes/stockIssues.ts`, `routes/transfers.ts`; tests `apps/api/test/stockDocs.test.ts`.

**Produces (all lists support `search` on code, `status[]`, `from/to`, `branchId`; detail includes lines with product code/name):**
- Stock take: `POST /api/stock-takes {code?, note, lines:[{productId, actualQty}], balance: boolean}`; `PUT /:id` (draft only); `POST /:id/balance`; `POST /:id/cancel` (draft → cancelled; balanced → reverse ledger, status cancelled). Balance recomputes `systemQty` from current onHand, writes via `setOnHand` (`docType 'stockTake'`), stores diff and `diffValue = diffQty × cost`. Option `{ zeroMissing: true }` on balance sets unlisted products of the branch with onHand ≠ 0 to 0 (KiotViet "Hoàn thành & cân bằng tất cả").
- Issues: `POST /api/stock-issues {kind, code?, reason, note, lines:[{productId, qty}], complete: boolean}`; `PUT /:id` (draft); `POST /:id/complete`; `POST /:id/cancel`. Complete moves `-qty` with `docType = kind`, snapshots line `cost` and `value`.
- Transfers: `POST /api/transfers {code?, toBranchId, note, lines:[{productId, qtySent}], send: boolean}` (from = session branch); `POST /:id/send` (draft → inTransit, moves `-qtySent` at source, snapshot cost; `incoming += qtySent` at destination); `POST /:id/receive {lines:[{productId, qtyReceived}]}` (inTransit → received, only by a user with access to destination; moves `+qtyReceived` at destination with `unitCost = line.cost`, `incoming -= qtySent`); `POST /:id/cancel` (draft → cancelled; inTransit → reverse source moves and incoming; received → refused `409 TRANSFER_RECEIVED`).
- Perms: `stockTakes.*`, `writeOffs.*` / `internalUse.*` by kind, `transfers.*`. All audited.

- [ ] Tests: `stock take balance writes diff from current onHand (sale between draft and balance)`, `zeroMissing zeroes unlisted stock`, `cancel balanced stock take restores stock`, `write-off completes with value snapshot and cancel restores`, `internal use beyond stock refused`, `transfer send/receive moves stock between branches and destination cost averages`, `transfer short receipt records qtyReceived < qtySent`, `cancel inTransit transfer restores source`. FAIL → implement → PASS → commit.

### Task 7: Price books API

**Files:** Create `apps/api/src/routes/priceBooks.ts`, `apps/api/src/services/priceBooks.ts`; test `apps/api/test/priceBooks.test.ts`.

**Produces:** CRUD `/api/price-books`; `GET /api/price-books/:id/items?search&groupIds&page` → rows `{productId, code, name, cost?, basePrice, price|null}` for all active products (null = not in book); `PUT /api/price-books/:id/items` `{ items: {productId, price|null}[] }` (null removes); `POST /api/price-books/:id/apply-formula` `{ productIds?: number[] /* default all in filter */, groupIds?, base: 'cost'|'price'|'book', baseBookId?, op, value, unit, roundTo }`. `applicablePriceBooks(tx, { branchId, userId, customerGroupId?, at })` and `priceFor(tx, productId, priceBookId|null)` for POS.

- [ ] Tests: `formula cost+30% rounded to 1000`, `item override and removal`, `book outside validity window not applicable`, `book scoped to another branch not applicable`. FAIL → implement → PASS → commit.

### Task 8: Uploads

**Files:** Create `apps/api/src/routes/files.ts`; test `apps/api/test/files.test.ts`.

**Produces:** `POST /api/uploads` (multipart image ≤2 MB, png/jpeg/webp/svg → stored `data/uploads/<uuid>.<ext>`) → `{ url: '/files/<name>' }`; `GET /files/:name` serves from `data/uploads` (public, `/api/files/` alias). Reject other types `400 BAD_FILE`, oversize `413`.

- [ ] Tests: `uploads a png and serves it`, `rejects a .txt`, `rejects 3 MB`. FAIL → implement → PASS → commit.

### Task 9: Admin — product list

**Files:** Create `apps/admin/src/pages/products/{ProductsPage.tsx,ProductDetail.tsx,StockCard.tsx,GroupTreeFilter.tsx,useLookups.ts}`; test `apps/admin/test/ProductsPage.test.tsx`; register `/products`.

Sidebar: Nhóm hàng (tree with search + "Tạo mới"), Tồn kho (select), Dự kiến hết hàng & Thời gian tạo (DateRangeFilter), Loại hàng (checkbox), Thương hiệu, Bán trực tiếp, Tích điểm, Trạng thái. Columns: Mã hàng, image thumb, Tên hàng, Giá bán, Giá vốn (only `cost.view`), Tồn kho (total), Khách đặt (total), Thời gian tạo, Dự kiến hết hàng. Expanded tabs: **Thông tin** (badges type / bán trực tiếp / tích điểm, fields grid, action bar: Cập nhật, In mã vạch, Sao chép, Ngừng kinh doanh/Cho phép kinh doanh, Xóa), **Mô tả, ghi chú**, **Thẻ kho** (paginated ledger with doc links), **Tồn kho** (per branch onHand/reserved/incoming/cost). Bulk: Ngừng kinh doanh, Đổi nhóm hàng, In mã vạch, Xóa. Toolbar: Tạo mới ▾ (Hàng hóa, Dịch vụ, Combo - đóng gói), Import, Xuất file.

- [ ] Test: `renders rows and totals from api; selecting group filter sends groupIds; expanding a row shows Thẻ kho tab`. FAIL → implement → PASS → commit.

### Task 10: Admin — product form

**Files:** Create `apps/admin/src/pages/products/{ProductForm.tsx,UnitsEditor.tsx,VariantsEditor.tsx,ComboEditor.tsx,ImagesEditor.tsx,WarrantyEditor.tsx,QuickCreate.tsx}`; test `apps/admin/test/ProductForm.test.tsx`.

Modal titled "Tạo hàng hóa" / "Tạo dịch vụ" / "Tạo combo - đóng gói" / "Cập nhật hàng hóa". Tabs: Thông tin, Mô tả (description textarea with basic formatting toolbar via `contentEditable` + `document.execCommand`-free markdown-lite? → **ruling: plain textarea + preview**), Bảo hành bảo trì, Chi nhánh kinh doanh. Sections in Thông tin as in spec §6 (Giá vốn/giá bán, Tồn kho, Tích điểm, Vị trí trọng lượng, Đơn vị tính, Thuộc tính → Hàng cùng loại table, Hàng thành phần for combos). Footer: Bán trực tiếp checkbox, Bỏ qua, Lưu & Tạo thêm hàng, Lưu & Sao chép, Lưu. Inline "Tạo mới" for group/brand/location opens `QuickCreate`. Server validation errors show under fields (`VALIDATION` issues by path).

- [ ] Test: `adding attributes Màu[Đen,Xám] × Size[M,L] shows 4 variant rows`; `combo save posts comboItems`; `required name error shown`. FAIL → implement → PASS → commit.

### Task 11: Admin — price books, stock documents, import, labels

**Files:** Create `apps/admin/src/pages/priceBooks/PriceBooksPage.tsx`, `apps/admin/src/components/docs/{DocumentLinesEditor.tsx,ProductPicker.tsx,DocStatusBadge.tsx}`, `apps/admin/src/pages/stock/{StockTakesPage.tsx,StockTakeEditor.tsx,StockIssuesPage.tsx,StockIssueEditor.tsx,TransfersPage.tsx,TransferEditor.tsx}`, `apps/admin/src/pages/products/{ImportDialog.tsx,BarcodeLabels.tsx}`; tests `apps/admin/test/{DocumentLinesEditor,PriceBooks}.test.tsx`.

- `ProductPicker`: input with F3 focus, debounced `/products/lookup`, Enter on exact barcode adds immediately (scanner support).
- `DocumentLinesEditor<L>`: lines table (STT, Mã hàng, Tên hàng, ĐVT, configurable numeric columns, remove), duplicate scan increments qty.
- Price books page: left list of books + create/edit modal (name, validity, scopes), right grid of products with editable price per book column (KiotViet-style "Bảng giá chung" + selected books), "Thiết lập công thức" modal.
- Stock pages: list (code, time, branch, status, totals; expanded detail with lines + actions: Mở phiếu, Hoàn thành, Hủy, Xuất file) and full-screen editors at `/stock-takes/new`, `/stock-takes/$id`, etc.
- Import dialog: download template, choose file, mode, show error rows table.
- Labels: choose size (`50x30`, `40x25`, `A4 3x10`), quantity per product (default = onHand), print via a hidden iframe page rendering JsBarcode SVGs.

- [ ] Tests: `scanning the same barcode twice increments qty to 2`; `price books grid edits post item price`. FAIL → implement → PASS → commit.

### Task 12: Catalogue seed + E2E

**Files:** Create `apps/api/src/seed/catalog.ts` (groups Thời trang Nam/Nữ, Phụ kiện Nam/Nữ; brands; 40 products NA001–NA024, NU001–NU016 with fictional names/prices like the inspected store, generated SVG silhouette per category written to `data/uploads/seed-*.svg`), call from `prisma/seed.ts` after `seedBase`; `e2e/products.spec.ts`.

- [ ] E2E: create product "Áo test" with stock 5 → list shows it with Tồn kho 5 → stock take to 3 balanced → Thẻ kho shows −2 row → write-off 1 → Tồn kho 2. FAIL → implement → PASS; full `pnpm test && pnpm typecheck && pnpm e2e` → commit `feat: catalogue seed and products e2e`.
