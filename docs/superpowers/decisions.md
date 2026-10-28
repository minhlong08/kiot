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
