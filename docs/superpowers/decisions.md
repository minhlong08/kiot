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
