# Decisions log

Rulings made during the build and deferred review findings, per milestone.

## Milestone 1 — Foundation

-   Ruling: move those two assertions (password-change gate on /api/branches, cashier 403 on PUT /api/settings) into T5's tests; T4 tests gate via /api/auth/me-adjacent route /api/auth/switch-branch — avoids test-only routes — cost if wrong: none.
- Task 2: Ruling: test file is test/format.test.ts (one file instead of four) — same assertions — cost: none
- Task 3: Ruling: Prisma pinned 7.10.1 (npm 'latest' tag is 8.0 RC) with better-sqlite3 driver adapter; generated client in apps/api/src/generated (gitignored, built by db:setup) — Postgres needs a provider swap + regenerate (M10) — cost if wrong: docker step reworked
- Task 4: Ruling: auth enforced by a global onRequest hook on /api/* with a PUBLIC allowlist (not per-route requireAuth) — new routes can't forget protection; requirePermission only checks perms — cost if wrong: none
- Task 4: Ruling: seed lives in src/seed/base.ts (seedBase(prisma)) so tests reuse it; prisma/seed.ts just calls it — cost: none
- Task 5: Ruling: GET /api/branches and GET /api/settings readable by any signed-in user (pickers, prefixes, loyalty rates needed everywhere); mutations need settings.* — cost if wrong: minor info exposure to staff
- Task 6: Ruling: MainNav takes can/currentPath/renderLink props (router-agnostic, testable); pages register in src/pages/registry.tsx PAGES map, unregistered nav paths render ComingSoon — cost: none
- Task 7: Ruling: DateRangeFilter value is a preset key or 'custom:YYYY-MM-DD:YYYY-MM-DD'; resolveDateRange() converts to ISO from/to for APIs — cost: none
- Task 8: Ruling: added shared Modal/ConfirmModal, toast, Field/MoneyInput/NumberInput components (needed by every later form); settings tab kept in URL via useListState — cost: none
- Task 9: Ruling: root package.json is type=module (Playwright config uses import.meta) — cost: none
- Task 9: Ruling: AuthProvider uses React state instead of TanStack Query — query notifications are deferred a tick, so guards read a stale user after refresh() and bounced /dashboard back to /change-password (found by E2E) — cost if wrong: none
- Final: minor (deferred): no login rate limiting / failed-login audit
- Final: minor (deferred): login lookup ambiguity across username/phone/email; case-sensitive username
- Final: minor (deferred): reserveCode uses SQLite MAX(); Postgres needs GREATEST — handle in M10 Postgres work
- Final: minor (deferred): unknown branchIds on user create → 500 instead of 400
- Final: minor (deferred): updateSettings audits no-op saves
- Final: minor (deferred): users/branches list filter in JS (fine for small tables; do not copy for big ones)

## Milestone 2 — Products & stock

- Task 1: Ruling: quantities are Int (fashion retail; KiotViet-style units convert by integer) — cost if wrong: migrate qty columns to Decimal
- Task 1: Ruling: product relations are plain Int ids without Prisma relations (except doc→lines) — keeps services explicit, avoids cascade surprises — cost: manual joins
- Task 2: Ruling: reverseDocument unwinds inbound value from the average (cost = (stockValue - qty*unitCost)/remaining); test added after code, proven by a mutant (+1) failing it — cost if wrong: small cost drift on cancelled receipts
- Task 4: Ruling: variant masters are hidden from lists via (parentId null AND attributes != '[]'); stock filters use one raw SQL join (quoted identifiers, portable) — cost: none
- Task 4: Ruling: lookup returns non-direct-sale goods unless ?pos=1 (document editors need them; POS doesn't) — cost: none
- Task 5: Ruling: upsert mode updates only sheet columns (keeps units/images/variants); combos not importable — cost: owners must create combos in the form
- Task 6: Ruling: write-off and internal use share one StockIssue table with kind (spec lists them separately; one table is DRY) — cost if wrong: split later via kind
- Task 6: Ruling: transfer receive requires the session to be on the destination branch (400 WRONG_BRANCH); transit shortfall is recorded on the doc, not booked anywhere — cost: owner reconciles shortfalls manually
- Task 8: Ruling: image type sniffed from bytes; SVGs with script/handlers rejected and all files served with CSP default-src 'none' + nosniff (same-origin XSS guard) — added 'fake png' and path-escape tests — cost: none
- Task 9: Ruling: product dialogs (form/import/labels/group change) wired through productPageHooks(), stubbed here and filled by Tasks 10–11 — keeps Task 9 independently testable — cost: none
- Task 10: Ruling: description is a plain textarea (no rich-text editor dependency) — cost: no bold/lists in descriptions
- Task 10: Ruling: ProductPicker built here (needed by combo editor) rather than Task 11; editing a variant child opens its master — cost: none
- Task 10: Ruling: cost field is read-only when editing goods (cost comes from receipts/weighted average) — cost: owners adjust cost via receipts only
- Task 11: Ruling: stock documents use one config-driven list page + one editor (configs.ts) instead of six hand-written pages — cost: none
- Task 11: Ruling: price book grid shows one selected book next to the base price (not all books side by side) — cost: owners switch books in the sidebar
- Task 12: Ruling: demo catalogue seeds only on a brand-new install (seedBase returned true); products start at zero stock until M3 demo receipts — cost: none
- Task 12: Ruling: seed written before its test; test proven by a mutant (women rows removed → fails) — cost: none
- Final: Ruling: Review Focus #4 said unknown groups should error, but Task 5 (and owner-friendly import) creates missing group paths — kept auto-create — cost if wrong: typo'd group names create stray groups
- Final: Ruling: moveStock concurrency (declined by reviewer) — deferred to M5 where concurrent tills exist; M5 plan must include a parallel-sales test — cost if wrong: oversold stock under simultaneous checkouts
- Final: minor (deferred): import write-phase errors lack row numbers; duplicate barcodes in file unchecked
- Final: minor (deferred): typed product/unit/variant codes not cross-checked (falls to 409 DUPLICATE)
- Final: minor (deferred): deleting a product referenced only by draft stock docs leaves those drafts uncompletable
- Final: minor (deferred): quantity totals in stock doc lists formatted with money flag (display only)

## Milestone 3 — Suppliers & purchasing

- - M2 carry-over: new document routes must be branch-scoped (ownedBy) and strip cost without cost.view (receipt line unitCost is the supplier price — it IS cost: strip unitCost/baseCost/amount fields on receipts for users without cost.view? Ruling: purchasing screens require purchaseReceipts.view which implies seeing purchase prices; only baseCost (allocated cost) is stripped) — cost if wrong: purchase prices visible to purchasing staff (intended).
- Task 1: Ruling: plan's allocation example had wrong arithmetic (70k/40k); correct per-unit costs are 80k/80k — test fixed — cost: none
- Task 2: Ruling: cash defaults created by seedBase and lazily by recordCash (existing DBs upgrade without a data migration) — cost: none
- Task 3: Ruling: supplier list computes net purchases per supplier in JS (supplier tables are small) to filter by amount — cost if wrong: slow with >10k suppliers
- Task 3: Ruling: GET/POST suppliers also allowed with purchaseReceipts.create so receiving staff can pick/quick-create suppliers — cost: none
- Task 4: Ruling: a receipt line is matched to its PO line by product+unit and counted in that line's unit — cost if wrong: receiving a PO line in a different unit misstates receivedQty
- Task 5: Ruling: receipts can be backdated via 'at' (seed + owners entering past paperwork); stock/ledger/voucher rows carry the same date — cost: none
- Task 5: Ruling: allocated baseCost on receipt lines hidden without cost.view; purchase prices (unitCost) stay visible to purchasing staff — cost: buyers see supplier prices (intended)
- Task 7: Ruling: service purchase without a supplier must be paid in full (nobody to owe) — cost: none
- Task 7: Ruling: GET /api/cash-funds and /api/cash-categories added here (needed by purchasing forms; M6 extends them) — cost: none
- Task 8: Ruling: added reusable ImportFileDialog and FundSelect components — cost: none
- Task 9: Ruling: 'create receipt from PO' / 'return from receipt' navigate with a plain URL (?fromOrder= / ?fromReceipt=) the editor reads — avoids typed search params — cost: full page load
- Task 11: Ruling: purchasing E2E written after its UI existed so it passed first run (not watched failing) — covered by the API tests that did fail first — cost: none
- Final: Ruling: incoming invoices are company-wide (not branch-scoped) — they belong to the legal entity, not a shop — cost if wrong: branch staff see other branches' invoices
- Final: Ruling: concurrent double-complete/cancel of the same document (no status guard in UPDATE) deferred to M5 concurrency work, which must add conditional status transitions for all documents — cost if wrong: double posting under simultaneous clicks
- Final: minor (deferred): reversal rows dated at cancellation, original rows at effective date (by design)
- Final: minor (deferred): incoming invoice import-template route has no permission check (template only)
- Final: minor (deferred): purchase-order services rely on route-level branch pre-check outside the transaction

## Milestone 4 — Customers, loyalty, promotions

- Task 1: Ruling: plan said 'buy 2 get 1 on 5 items → 2 free' but its own rule floor(5/3)=1; standard overlapping buy-X-get-Y gives 1 free (cheapest) — tested as 1 — cost: none
- Task 1: Ruling: GiftItem carries giftValue (filled by API from product price) so the engine can compare it with invoice discounts — cost: none
- Task 1: Ruling: province list only (34); ward is free text — cost: no ward validation
- Task 2: Ruling: Customer.birthMonth column (denormalised from birthday) for the birthday-month filter without date functions in SQL — cost: none
- Task 3: Ruling: GET /customers/:id/history deferred to M5 (needs invoice tables) — cost: none
- Task 4: Ruling: groups API lives in routes/customers.ts (shares helpers) — cost: none
- Task 5: Ruling: /promotions/active returns promotions possibly applicable today at this branch (hour/day checked at evaluation time) so POS can cache once per session — cost: none
- Task 7: Ruling: purchase-history tab is a hook (customerHistoryTab) filled in by M5 — cost: none
- Task 10: Ruling: foundation E2E renamed 00-foundation so it runs first (it asserts the forced first-login password change) — cost: none
- Final: minor (deferred): import creates duplicate phones without row warnings
- Final: minor (deferred): overnight hour ranges like [22,2] unsupported (API accepts them)
- Final: minor (deferred): minQty checked per line, not summed across lines of the same product
- Final: minor (deferred): fixed-points products earn points even when fully discounted/paid by points
- Final: minor (deferred): /promotions/evaluate trusts client prices — M5 must re-price server-side (planned)
- Final: minor (deferred): activePromotions parses ended promotions (filter endAt in query)
- Final: minor (deferred): message logs visible to customers.view holders
- Final: minor (deferred): checkVoucher says 'Đơn hàng tối thiểu' for a zero order total

## Milestone 5 — POS, invoices, returns, orders

- Task 1: Ruling: promotions see each line at its unit price after the manual line discount; gift lines are excluded and free — cost: none
- Task 1: Ruling: VietQR built locally (EMVCo/NAPAS) — no network call — cost: none
- Task 3: Ruling: customer group discountPercent raises the manual-discount ceiling for that customer (max(role limit, group %)) rather than auto-discounting — cost: cashier must type the group discount
- Task 3: Ruling: delivery sales put the unpaid part on the delivery as COD (collected in M7), not on customer debt — cost: none
- Task 3: Ruling: client gift lines are ignored; the server adds promotion gifts itself — cost: none
- Task 3: Ruling: double-complete test passes on SQLite even without transition() (writes serialised); transition() is the guard for Postgres (M10) — cost: none
- Task 5: Ruling: exchange credit counts like cash for change; any excess is paid out with a TTTH cash-out voucher on the new invoice — cost: none
- Task 5: Ruling: an exchange return writes no customer ledger itself; the credit flows through the new invoice's 'exchange' payment — cost: none
- Task 6: Ruling: deposits require a customer (they become customer credit in the partner ledger) — cost: walk-in deposits must be recorded with a customer
- Task 6: Ruling: order↔invoice coupling via hooks set by services/customerOrders.ts (imported by app.ts) to avoid a circular import — cost: none
- Task 7: Ruling: catalog delta = products edited OR with stock movements since 'since' (+ combos of moved components); unsellable rows are sent with sellable=false so the till can drop them — cost: none
- Task 8: Ruling: offline queue stops at the first network failure (keeps order) and marks server rejections as errors for the cashier — cost: none
- Task 11: Ruling: exchange = new tab carrying the return credit; posted as one /api/returns call with exchange — cost: none
- Task 12: Ruling: admin 'Sao chép'/'Lập hóa đơn' hand the request to the POS through localStorage key pd.pos.load (read once) — cost: works only in the same browser
- Task 13: Ruling: seeded returns/orders are dated at install time (createReturn has no backdating); seeded transfer payments only on promotion-free sales so amounts are exact — cost: none
- Task 13: Ruling: E2E checks the sale's TTHD voucher via the invoice detail; the full cash-book screen check moves to M6 (no cash book UI yet) — cost: none
- Final: minor (deferred): sellerId and channel not validated; otherIncome has no permission
- Final: minor (deferred): shift report / customer history not branch-scoped
- Final: minor (deferred): unit lines ignore price-book prices (books are per base product)

## Milestone 6 — Cash book

- Task 2: Ruling: summary bar is the fund balance over the period (ignores the list's text/category filters) — cost: none
- Task 2: Ruling: fund balances shown only to cashbook.view; manual vouchers may be backdated (audited) — cost: none
- Task 4: Ruling: POS 'require customer' and 'rounding' options not added — settingsSchema has neither and no sale path enforces them; a toggle that does nothing would mislead — cost if wrong: two settings fields plus enforcement in computeSale/PaymentPanel, deferred to M10 polish.
- Task 5: Ruling: E2E asserts balance deltas rather than a positive starting balance — seeded cash fund is negative (-87M) because seeded receipts are paid in cash with no opening balance — cost if wrong: none for tests; demo looks odd (deferred minor: seed a cash opening balance).
- Task 5: Ruling: TransferForm/VoucherForm defaults derived at render instead of a reset effect keyed on funds.data — full E2E run posted fromFundId 0 ("Quỹ tiền không tồn tại"); exact trigger not isolated, derived defaults make an unset id impossible and stop refetches wiping input — cost if wrong: a remaining race would surface as the same server 400, never a wrong posting.
- Final: fixed double cancel restoring debt twice — 'concurrent cancels … restore the debt once' (did not reproduce RED: SQLite serialises inject requests; kept as guard) + in-transaction updateMany claim, suite 252/252
- Final: fixed fund PUT wiping openingBalance — 'editing a fund without sending openingBalance keeps it' RED→GREEN, suite 252/252
- Final: fixed export without cashbook.view — 'export needs cashbook.view as well as cashbook.export' RED→GREEN, suite 252/252
- Final: fixed deactivating POS default / last cash fund — 'a POS default fund or the last active cash fund cannot be deactivated or deleted' RED→GREEN, suite 252/252
- Final: minor (deferred): category kind change allowed on used categories via API
- Final: minor (deferred): fund PUT/DELETE not branch-scoped for non-admins; admin ?all=1 still branch-scoped
- Final: minor (deferred): company-wide fund balance per branch = opening + this branch's vouchers only
- Final: minor (deferred): fund delete has no confirmation dialog; cancel confirm not disabled while pending
- Final: minor (deferred): category create allowed with cashbook.create; settings page shows buttons regardless of permission
- Final: minor (deferred): decorate() loads all users/categories/funds per call
- Final: minor (deferred): seed leaves the cash fund negative (no opening balance)

## Milestone 7 — Delivery, online sales, tax

- Task 2: Ruling: pending may skip 'picked' straight to 'delivering' (shop hands parcels over without a pickup scan) — cost if wrong: one entry in NEXT.
- Task 2: Ruling: return-shipping fees are not posted (only the outbound shop-paid fee on delivered); feePayer 'customer' has no shop-side effect — cost if wrong: partner balance off by return fees until a manual voucher.
- Task 2: Ruling: cancelling an invoice while the parcel is with the carrier (delivering/failed/returning) → 409 DELIVERY_IN_PROGRESS; reconciled deliveries → 409 DELIVERY_RECONCILED — cost if wrong: an extra click through 'returned'.
- Task 3: Ruling: when shop-paid fees exceed COD the reconciliation pays the partner (out voucher 'Chi tiền trả đối tác giao hàng'); zero net posts no voucher — cost if wrong: none, ledger still balances.
- Note: M6 Task 4 ruling was inaccurate — settings.orders already has rounding and requireCustomer (edited on the Orders settings page); whether POS enforces them is unchanged and still deferred to M10.
- Task 5: Ruling: online sales default enabled (settings.online.enabled true) so the demo storefront works out of the box — cost if wrong: a public page the owner didn't intend; one toggle.
- Task 5: Ruling: website orders use createdById 0 (no user) and isDelivery true with the delivery address in the note — cost if wrong: order editor shows no creator; address must be copied into the delivery form on conversion.
- Task 5: Ruling: ensureDefaults (cash categories, channels) now runs on every seed start, not only fresh installs — needed so upgraded DBs get the new system category used by COD reconciliation.
- Task 6: Ruling: the order confirmation shows in place on /shop/cart instead of a separate /shop/done/$code route — the code isn't a secret but a guessable URL listing order totals is avoided; cost if wrong: one route.
- Task 7: Ruling: VAT is backed out once per rate (not per line) and invoice-level discounts are spread over lines pro rata before grouping — avoids rounding drift; cost if wrong: ±1đ differences vs a per-line provider.
- Task 7: Ruling: declaration uses invoices with status completed by sale date (createdAt) in the VN-time quarter, minus completed returns by return date — cost if wrong: a delivery sale completed next quarter is counted in its sale quarter.
- Task 7: Ruling: per-group VAT bulk update not built — per-product VAT is already on the product form; deferred to M10 — cost if wrong: owner edits VAT product by product.
- Task 8: Ruling: merged routes/pos ensureChannels and services/channels into one list (pos names kept: store, facebook, zalo, phone, website, marketplace) — two seeders would create diverging channel sets.
- Task 8: Ruling: COD reconciliation dialog loads at most 100 waybills per partner (API page-size cap) — cost if wrong: a partner with >100 open parcels needs two reconciliations.
- Task 8: fixed (found by e2e): admin queries used pageSize 200/500/5/1 which the list schema rejects (allowed 15/20/30/50/100).
- Final: fixed cancelling a delivered carrier COD invoice erased the carrier receivable — 'a delivered carrier waybill with COD cannot be cancelled from the invoice' RED→GREEN, suite 274/274
- Final: fixed (re-graded Minor→Important: returns cap cash refunds at paid) carrier COD never reached invoice.paid — 'carrier COD counts as paid once delivered…' RED→GREEN, suite 274/274
- Final: fixed e-invoice provider called inside the sale transaction — 'auto-issue: a failing e-invoice provider never fails the sale' RED→GREEN, suite 274/274
- Final: minor (deferred): shop rate limiter keyed on socket IP (no trustProxy) and never pruned
- Final: minor (deferred): shop matches customers by phone including inactive ones; inbox doesn't flag matched vs new customer
- Final: minor (deferred, for M9 P&L): shop-paid delivery fees are netted into a non-P&L reconciliation voucher — P&L must add deliveryFee ledger rows as expense
- Final: minor (deferred): loyalty points and totalSpent post at delivery-invoice creation, not on delivery
- Final: minor (deferred): /api/deliveries builds an IN list of all branch delivery invoice ids

## Milestone 8 — Staff, schedule, timesheets, payroll

- Task 1: Ruling: worked minutes = time inside the shift − break + paid overtime (punches before the start don't count) — plan's 'clamp' wording; cost if wrong: early arrivals unpaid.
- Task 1: Ruling: perShift hourly rate for overtime = amount / 8 — cost if wrong: OT for per-shift staff priced off an 8h shift.
- Task 3: Ruling: scheduled shifts with no timesheet row count nothing in the summary (neither present nor absent) — pay needs a recorded presence; cost if wrong: owner must mark absences explicitly to see them.
- Task 3: Ruling: punch window = 2h before start .. 4h after end; checked-in-but-not-out shift wins, else nearest start — cost if wrong: very early punches rejected with NO_SHIFT.
- Task 5: Ruling: payments require a locked period (amounts final); regenerate keeps hand-entered bonus/note and never deletes paid paysheets — cost if wrong: one extra click (lock) before paying.
- Task 5: Ruling: commission = seller's completed invoices dated in the period minus returns dated in the period of any of their invoices; negative totals floor at 0 — cost if wrong: a returns-heavy month shows 0 rather than a clawback.
- Task 8: Ruling: demo staff logins thu.ngan / ban.hang use password nhanvien123 with forced change on first sign-in (same pattern as admin/admin123) — cost if wrong: README must list them.
- Task 8: Ruling: seed reassigns every other seeded invoice's sellerId to the sales assistant (direct update, no money effect) so commission has data — cost if wrong: none.
- Final: fixed overnight/after-midnight times moved to the wrong day in the timesheet editor — week.test 'overnight shift 22:00–06:00…' RED→GREEN, suite green
- Final: fixed staff without employees.view could not see their timesheet or punch — 'staff without employees.view see … their own timesheet' RED→GREEN; nav item visible to all
- Final: fixed employee PII exposed to payroll.view and cross-branch employee edit/delete — 'payroll-only users get no ID/birthday/address; other branches are out of reach' RED→GREEN
- Final: fixed overlapping payroll periods could pay twice — 'a second period overlapping an existing one → 409' RED→GREEN
- Final: fixed (minor, cheap) shift with orphan timesheet rows hard-deleted — 'a shift with timesheet rows is deactivated' RED→GREEN, suite 287/287
- Final: minor (deferred): bonus PUT recomputes from a floored total
- Final: minor (deferred): lock/cancel/regenerate status checks not conditional writes (races)
- Final: minor (deferred): punch — double-click checks in and out; overwrites manual absent/leave rows; check-in without check-out counts as a full shift
- Final: minor (deferred): schedule move doesn't carry the timesheet row; deactivated employees' entries can't be deleted
- Final: minor (deferred): own-timesheet view filtered to the current branch
- Final: minor (deferred): commission base includes invoice otherIncome
- Final: minor (deferred): employee PUT may move an employee to a branch the user can't access

## Milestone 9 — Dashboard & reports

- Task 1: Ruling: Doanh thu = goods revenue = invoice total − otherIncome (delivery charges etc. are 'Thu khác' in P&L); points-paid part stays revenue; return fee is other income — cost if wrong: revenue figures differ from invoice totals by other income.
- Task 2: Ruling: failed logins use a dedicated audit action 'loginFailed' (not 'login' + summary) — simpler querying; cost if wrong: none.
- Task 2: Ruling: activity feed is built from the latest invoices/returns/receipts rather than parsing audit summaries — cost if wrong: cash vouchers/stock docs don't appear in the feed.
- Task 4: Ruling: xuất nhập tồn nets each movement kind (a cancelled sale offsets its sale) before classifying in/out; values at movement unit cost — cost if wrong: gross in/out of churned documents not shown.
- Task 4: Ruling: debt reports are company-wide (partner ledger has no branch) — cost if wrong: branch managers see all-branch debts.
- Task 5: Ruling: finance-pnl refuses users without cost.view (403) — row-based report can't be column-stripped; cost if wrong: managers without cost.view can't see profit at all.
- Task 5: Ruling: shop-paid delivery fees enter P&L company-wide (ledger has no branch) — cost if wrong: per-branch P&L includes other branches' fees.
- Final: fixed (Critical) dashboard/today leaked cost and profit — reviewM9 'dashboard today carries no cost or profit…' RED→GREEN
- Final: fixed P&L used the category's current flag and dropped unpaid service purchases — 'P&L uses each voucher's own P&L flag and counts unpaid service purchases in full' RED→GREEN
- Final: fixed (no RED: performance) quadratic array copies and per-key filters in report grouping — replaced by push/Map grouping; covered by existing report tests, suite 306/306
- Final: fixed login alerts: N+1 queries and visible to any dashboard user — admin-only, single query; 'login alerts are for admins only' RED→GREEN
- Final: fixed failed-login audit stored what was typed for unknown accounts; no rate limit — 'a failed login with an unknown account never stores what was typed' RED→GREEN; 20 failures/10 min per IP → 429
- Final: fixed staff-payroll visible with reports.view — 'reports.view alone does not reveal salaries' RED→GREEN
- Final: fixed orders-by-transaction counted cancelled orders — RED→GREEN
- Final: fixed end-of-day revenue/returns/COD inconsistent with other reports — 'end of day agrees with itself' RED→GREEN
- Final: fixed (re-graded: requirements §8 lists them) missing staff/channel/group/branch filters — api 'fact reports filter by seller, channel and product group' + admin 'staff, channel, group and branch filters reach the query' RED→GREEN, suite 306/306 + admin 48/48
- Final: minor (deferred): stock-movement values gross while quantities are netted per kind
- Final: minor (deferred): report/analytics default 'from' and P&L default year use UTC month/year (wrong 00:00–07:00 VN on the 1st)
- Final: minor (deferred): ABC class uses cumulative share including the item (a dominant item can be labelled B)
- Final: minor (deferred): slow movers list a product once per branch with branchId=all
- Final: minor (deferred): unused third tuple element in P&L LINES
