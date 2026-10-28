# PhuongDong POS

A self-hosted retail management + point-of-sale application for a Vietnamese fashion / accessories shop: products and stock, purchasing, POS, invoices / returns / delivery, customers and loyalty, promotions, staff / timesheets / payroll, cash book, reports, an online shop and e-invoices. It runs on your own computer — no cloud service.

*Phần mềm quản lý bán hàng tự cài đặt: hàng hóa – kho, nhập hàng, bán hàng tại quầy, đơn hàng – trả hàng – giao hàng, khách hàng – tích điểm, khuyến mại, nhân viên – chấm công – bảng lương, sổ quỹ, báo cáo, website bán hàng, hóa đơn điện tử.*

> The app name is a placeholder kept in one place: `packages/shared/src/config.ts` (`APP_NAME`).

---

## 1. Set up and run locally (step by step)

The steps below are for **macOS** (they also work on Linux; on Windows use WSL2).

### Step 1 — Install Node.js 24 with nvm

The project needs **Node.js 24** (it will not run on Node 20).

```bash
# if you don't have nvm yet: https://github.com/nvm-sh/nvm#installing-and-updating
nvm install 24
nvm use 24
node -v          # should print v24.x.x
```

Optional — make Node 24 the default for every new terminal:

```bash
nvm alias default 24
```

The repo contains an `.nvmrc`, so inside the project folder `nvm use` alone also picks Node 24.

### Step 2 — Install pnpm 10

```bash
npm install -g pnpm@10
pnpm -v          # should print 10.x
```

(Alternative: `corepack enable && corepack prepare pnpm@10 --activate`.)

> **"pnpm: command not found"?** pnpm is installed *per Node version* when you use nvm. If your terminal opened on another Node version (e.g. your nvm default is 20), run `nvm use 24` — and run Step 2 again if pnpm was never installed for Node 24.

### Step 3 — Get the code and install dependencies

```bash
cd /path/to/kiotviet          # the project folder
nvm use                       # Node 24 from .nvmrc
pnpm install                  # installs everything and generates the database client
```

### Step 4 — Start the app

```bash
pnpm dev
```

This command:

1. creates the SQLite database `data/app.db` (or migrates it to the latest structure),
2. on the **first** run only, loads **demo data** (40 products, suppliers, customers, ~45 invoices over 30 days, deliveries, staff, last month's payroll…),
3. starts the API and both web apps.

Wait until you see the three servers running, then open:

| What | URL |
|---|---|
| Back office (Trang quản lý) | <http://localhost:5173> |
| POS / cashier screen (Bán hàng) | <http://localhost:5174/sale/> |
| Public online shop (Website bán hàng) | <http://localhost:5173/shop> |
| API health check | <http://localhost:3000/api/health> |

### Step 5 — Sign in

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Administrator (all permissions) |
| `thu.ngan` | `nhanvien123` | Cashier — Lê Thị Bình |
| `ban.hang` | `nhanvien123` | Sales assistant — Trần Văn Cường |

Every demo account must **change its password at first sign-in**. Then:

- In the back office, start from **Tổng quan** (dashboard), **Hàng hóa**, **Đơn hàng › Hóa đơn**, **Sổ quỹ**, **Báo cáo**.
- In the POS, you can **Mở ca** (open a shift with opening cash) or choose **Để sau**; scan or search a product (`F3`), pick a customer (`F4`), pay (`F9`).

### Step 6 — Stop, restart, reset

- Stop: `Ctrl + C` in the terminal running `pnpm dev`.
- Restart: `pnpm dev` again — your data is kept.
- Start over with fresh demo data:
  - from the app (admin only): **Thiết lập › Sao lưu & khôi phục › Xóa và tạo lại dữ liệu mẫu** (type `XOA DU LIEU` to confirm), or
  - from the terminal (with the app stopped): `pnpm reset-db` and then `pnpm dev`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm: command not found` | `nvm use 24`, then `npm install -g pnpm@10` if needed (see Step 2). |
| `Unsupported engine` / syntax errors on start | You are on an older Node: `nvm use 24`. |
| `EADDRINUSE` (port 3000 / 5173 / 5174 in use) | Another copy is running. Stop it, or find it with `lsof -i :3000` and quit that process. |
| Errors building `better-sqlite3` during install | Install the Xcode command line tools (`xcode-select --install`) and run `pnpm install` again. |
| Login page keeps coming back | Your session cookie expired or you changed the database — sign in again. |

### Other ways to run

**Production build on one port (:3000):**

```bash
pnpm start     # builds admin + POS, migrates, seeds if empty, serves API + /, /sale/, /shop on :3000
```

**Docker + PostgreSQL:**

```bash
docker compose up --build      # then open http://localhost:3000
```

The image generates a PostgreSQL database client from `apps/api/prisma/schema.prisma` (provider switched by `scripts/prisma-provider.mjs`) and creates the tables with `prisma db push`. Data lives in the `pgdata` volume, uploaded images in `uploads`.

**PostgreSQL without Docker:** set `DATABASE_URL=postgresql://user:pass@host:5432/db`, then in `apps/api`: `node ../../scripts/prisma-provider.mjs`, `npx prisma generate --schema prisma/pg/schema.prisma`, `npx prisma db push --schema prisma/pg/schema.prisma`, `npx tsx prisma/seed.ts`, `npx tsx src/server.ts`. (Don't run `pnpm install` / `pnpm start` afterwards — they regenerate the SQLite client.)

### Tests

```bash
pnpm test        # unit + integration tests (shared logic, API, admin, POS)
pnpm typecheck
pnpm e2e         # end-to-end browser tests; uses its own database data/e2e.db, rebuilt on every run
```

---

## 2. Calculation and accounting rules

All money is stored as **whole đồng (integers)** — never decimals. Times are bucketed in **Vietnam time (UTC+7)**. Every stock change writes an immutable **stock ledger** row; every debt change writes a **partner ledger** row; cancelling a document posts **reversing entries** instead of deleting anything. The formulas below are the ones the code uses (file references in brackets).

### 2.1 Selling price, discounts and the amount the customer pays  *(`packages/shared/src/sale.ts`)*

For each line: `line amount = qty × unit price − line discount − promotion discount` (never below 0; gift lines are 0).

```
Tổng tiền hàng (subtotal) = Σ line amounts
raw total                 = subtotal − invoice-level promotion − invoice discount − voucher + other income (thu khác)
Khách cần trả (total)     = raw total rounded per setting (none / nearest 100 / nearest 1,000);
                            the difference is stored as "làm tròn" (rounding adjustment)
Amount due in money       = total − points paid (điểm × giá trị 1 điểm)
Tiền thừa (change)        = paid − due, given back only from cash (or exchange credit), never from card/transfer
Còn nợ (debt)             = due − paid  (only allowed for a named customer, within the debt limit)
```

- **Promotions** *(`promotions.ts`)*: per line the best non-combinable promotion applies, plus any combinable ones, capped so a line can't go below 0.
- **Discount limit**: manual line + invoice discounts may not exceed the role's "max discount %" of the list price (promotions don't count).

### 2.2 Cost of goods — moving weighted average  *(`pricing.ts`, `purchasing.ts`, `services/stock.ts`)*

Each branch keeps its own average cost per product. On every **inbound** movement (goods receipt, customer return, transfer in):

```
new average cost = (max(on hand, 0) × current cost + qty in × unit cost in) ÷ (max(on hand, 0) + qty in)
```

On a **goods receipt** the unit cost that enters the average is the landed cost per base unit:

```
line amount   = qty × unit cost − line discount
landed cost   = (line amount − share of receipt discount + share of other costs) ÷ (qty × unit conversion)
```

(the receipt-level discount and other costs are split across lines in proportion to line amount).

Outbound movements (sales, purchase returns, write-offs, transfers out) leave the average unchanged and record the **current average as the cost snapshot** on the document line — that snapshot is the COGS used by every report.

### 2.3 Returns and refunds  *(`services/returns.ts`)*

- A returned unit is refunded at its **net unit price** — the line amount after its share of invoice-level discounts:
  `net unit price = (line amount − invoice-level discount × line amount ÷ subtotal) ÷ qty`.
- `refund total = returned goods − return fee`, never more than what is left of the invoice.
- If the sale was partly paid with points, the same share of points is given back as points, and the money refund is reduced by their value.
- Cash refunds can't exceed what the customer actually paid; the refund can also go to debt (trừ công nợ) or become credit for an exchange.
- Returned goods come back into stock at the **sale's cost snapshot**, so COGS is reversed exactly.

### 2.4 Revenue, gross profit and P&L  *(`services/reportFacts.ts`, `reports/finance.ts`)*

| Term | Definition in this app |
|---|---|
| **Doanh thu** (revenue) | Σ totals of **completed** invoices in the period, *excluding* "thu khác" (other income such as a delivery charge). It is **after** all discounts and **includes** the part paid with points. Each invoice total is spread over its lines in proportion to line amount, so per-product revenue adds up exactly. |
| **Giá trị trả hàng** (returns) | Goods value of completed returns, counted on the **return's date** (a return in November lowers November, not the month of the sale). |
| **Doanh thu thuần** (net revenue) | Doanh thu − giá trị trả hàng. |
| **Giá vốn** (COGS) | Σ cost snapshot × qty of sold lines − the same for returned lines. |
| **Lợi nhuận gộp** (gross profit) | Doanh thu thuần − giá vốn. |

Cancelled invoices, returns and vouchers are excluded everywhere. Delivery invoices count only when **delivered** (they are "completed" then).

**Monthly P&L (Báo cáo tài chính › Lãi lỗ):**

```
Doanh thu bán hàng
− Hàng bán bị trả lại
= Doanh thu thuần
− Giá vốn hàng bán
= Lợi nhuận gộp
− Chi phí      = cash-book PAYMENTS whose category is marked "hạch toán vào kết quả kinh doanh"
                 (e.g. Chi lương, Chi phí điện nước, Chi khác — the flag is stored on each voucher when it is written)
                 + service purchases (Mua dịch vụ) at their full amount on the purchase date (paid or not)
                 + delivery fees paid by the shop to carriers
+ Thu nhập khác = cash-book RECEIPTS marked "hạch toán KQKD" (e.g. Thu khác)
                 + "thu khác" charged on invoices + return fees kept from customers
= Lợi nhuận
```

Not expenses (they are debt settlements or internal moves): paying suppliers, refunding customers, fund transfers, COD reconciliation receipts. The P&L requires the **view cost price** permission.

### 2.5 Cash book (Sổ quỹ)  *(`services/cash.ts`, `routes/cashbook.ts`)*

```
Quỹ đầu kỳ (opening) = fund opening balance + Σ(in − out) of completed vouchers before the period
Tồn quỹ (closing)    = opening + Tổng thu − Tổng chi within the period
```

Balances are always computed from vouchers, never stored. Sales, returns, receipts, deposits and payroll create their vouchers automatically (prefixes such as TTHD sale, TTTH refund, TTPN goods-receipt payment, TTNCC supplier payment, TTKH customer payment, TTDH deposit, TTMDV service purchase, PCPL payroll, DSCOD COD reconciliation); those can only be cancelled through their source document.

### 2.6 Customer and supplier debt (công nợ)  *(`services/partnerLedger.ts`)*

Debt is the running sum of ledger rows, never a typed-in number. Sign convention: **positive = the customer owes the shop / the shop owes the supplier**.

- Sale on credit: `+ invoice due`, `− amount paid`. Deposits are credited when collected.
- Return to debt: `− refund`.
- Manual Phiếu thu from a customer with "Tính vào công nợ": `− amount`; Phiếu chi to a supplier: `− amount`.
- Goods receipt: `+ total − paid`; supplier payment `− amount`; purchase return `− value`.

Delivery partners have a ledger too: delivered COD `+ COD`, shop-paid fee `− fee`, reconciliation `− (COD − fees)`.

### 2.7 Loyalty points  *(`loyalty.ts`)*

```
eligible amount = Σ amounts of loyalty-enabled lines − their share of (invoice discount + points paid)
points earned   = floor(eligible amount ÷ "số tiền để được 1 điểm")  + fixed points of products that have them
```

Default: 1 point per 10,000 đ; 1 point is worth 1,000 đ when paying. Points from a returned sale are taken back proportionally.

### 2.8 Tax  *(`packages/shared/src/tax.ts`, `services/tax.ts`)*

Retail prices **include VAT**. VAT is backed out per rate (rounded once per rate, not per line):

```
VAT        = gross × r ÷ (100 + r)          e.g. 1,080,000 at 8% → VAT 80,000, before VAT 1,000,000
before VAT = gross − VAT
```

`r` is the product's VAT rate, or the store default (8%) when empty; "Áp thuế suất cho nhóm hàng" sets it for a whole group.

- **Company mode (doanh nghiệp):** the quarterly declaration groups net revenue (sales − returns in the quarter) by VAT rate.
- **Household mode (hộ kinh doanh):** `VAT = revenue × 1%`, `PIT (thuế TNCN) = revenue × 0.5%` (the rates for goods distribution; both editable).
- **E-invoices:** a draft is built from the invoice net of its returns; numbers are sequential per series (`1C26TPD`, 7 digits); an issued e-invoice must be cancelled before its sale can be.

### 2.9 Delivery and COD  *(`services/delivery.ts`, `services/codReconciliation.ts`)*

- A delivery sale keeps the unpaid part as **COD** (not customer debt) until it is **delivered**; then the invoice completes and COD counts as paid.
- Self-delivery: COD becomes a cash receipt when delivered.
- Carrier: the carrier owes the COD; **Đối soát COD** records one receipt for `Σ COD − Σ fees the shop pays`.
- Returned parcel (đã chuyển hoàn): the invoice is cancelled, goods return to stock, prepaid money is refunded.

### 2.10 Staff pay  *(`packages/shared/src/staff.ts`, `services/payroll.ts`)*

- **Attendance per shift:** late = minutes after start beyond the grace (5'); early = minutes before end beyond the grace (5'); overtime = minutes after end beyond 30'; worked = minutes inside the shift − break + overtime. Overnight shifts (22:00–06:00) end the next day.
- **Salary:**
  - monthly: `salary × paid days ÷ standard days (26)` (paid days = present + paid leave),
  - per shift: `rate × shifts`,
  - per hour: `rate × hours worked (excluding overtime)`,
  - overtime: `hourly rate × overtime hours × overtime % (150%)`,
  - plus allowances (per month / per shift), minus deductions (per month / per late arrival), plus commission and bonus.
- **Commission:** on the seller's net sales in the period (their completed invoices minus returns of those invoices dated in the period); per line the most specific rule applies — product, then product group, then "all"; percent of revenue or a fixed amount per unit.
- Paying a paysheet writes a "Chi lương" cash payment (an expense in the P&L).

### 2.11 Stock reports  *(`reports/products.ts`)*

```
Xuất nhập tồn:  closing qty = opening qty (Σ movements before the period) + qty in − qty out
Giá trị tồn:    Σ on hand × average cost   (and on hand × selling price for the retail value)
```

---

## 3. Is this the same as KiotViet's logic?

**Short answer: mostly similar in spirit, but not guaranteed identical.** This app was built from scratch from the feature brief and from looking at KiotViet's screens. I did not have KiotViet's source code or its internal formulas, so every comparison below is based on KiotViet's visible behaviour and its published report layouts. Where I'm not sure, it says so. If exact parity matters (for example, to reconcile numbers with your old KiotViet reports), compare a few months of real figures side by side.

| Area | This app | KiotViet (as far as can be seen from the outside) | Same? |
|---|---|---|---|
| Cost method | Moving weighted average per branch; landed cost includes receipt discount and other costs | Weighted average cost (giá vốn bình quân) | **Likely the same** |
| COGS on sale | Cost snapshot at sale time; returns reverse at that snapshot | Same idea | **Likely the same** |
| "Doanh thu" line | Already **after** invoice discounts and vouchers | Shows **gross** goods value; invoice discounts appear as *giảm trừ doanh thu* | **Different presentation** — **Doanh thu thuần** should match, the "Doanh thu" line will be higher in KiotViet |
| Points paid | Counted as revenue (a payment method) | Treated as a *giảm trừ* / reduction | **Probably different — not verified** |
| Returns timing | Reduce revenue on the **return date** | Return date | **Likely the same** |
| Write-offs (xuất hủy) and stock-take losses | **Not** in the P&L (stock value drops, profit doesn't) | Counted as expenses (*chi phí*) in the financial report | **Different — gap in this app** |
| Delivery fees paid to carriers | Expense | Expense (*phí giao hàng trả đối tác*) | **Likely the same** |
| Return fee | Other income | Other income | **Likely the same** |
| Cash-book categories in P&L | Per-category flag "hạch toán KQKD", stored on each voucher | Same concept | **Likely the same** |
| Debt | Ledger-based, positive = owed to us | Same | **Likely the same** |
| Loyalty | 1 point per X đ after discounts; points value when redeemed | Configurable similarly; exact eligibility rules not verified | **Similar, not verified** |
| VAT | Prices include VAT, backed out per rate; household 1% + 0.5% | Household rates follow Vietnamese law (same numbers); company-mode details not verified | **Rates same; method not verified** |
| Payroll / commission | Formulas in §2.10 | Similar options; exact proration (e.g. paid days vs. shifts) not verified | **Similar, not verified** |

**Known gaps to fix if you want closer parity:**
1. Add **write-offs (xuất hủy)** and **stock-take shortages** as expenses in the P&L, and stock-take surpluses as other income.
2. Optionally show the P&L KiotViet-style: gross "Doanh thu" with *invoice discounts* and *points* as separate *giảm trừ* lines.

---

## 4. Reference

### Project layout

```
apps/api        Fastify + Prisma API (SQLite by default, PostgreSQL via DATABASE_URL)
apps/admin      Back office — React, Vite, TanStack Router/Query, Tailwind (also serves /shop)
apps/pos        Cashier screen at /sale — React, Vite; keeps selling through short offline periods
packages/shared Shared schemas and calculation logic (sale totals, promotions, tax, payroll, reports, print templates)
e2e             Playwright end-to-end tests
docs            Requirements, design, per-milestone plans, decision log
```

### Backup and data

- **Thiết lập › Sao lưu & khôi phục** (admin only): download a full JSON backup, restore it (all-or-nothing, up to 1 GB), or reset to demo data.
- Uploaded product images and the logo are in `data/uploads` — back that folder up separately.
- A backup restores only into the same database structure (version).

### Integrations (adapters)

There are **no real connections** to carriers, SMS/Zalo, e-invoice providers, marketplaces or banks. Each has an interface and a stub; plug in a real provider by registering it at start-up (e.g. in `apps/api/src/server.ts`, before `listen`):

| Kind | File | Interface | Register with |
|---|---|---|---|
| Carrier | `apps/api/src/adapters/carrier.ts` | `CarrierAdapter` (`quote`, `createShipment`) | `registerCarrierAdapter(partnerCode, adapter)` |
| SMS / Zalo / Email | `apps/api/src/adapters/messaging.ts` | `MessagingAdapter` (`send`) | `registerMessagingAdapter('sms' \| 'zalo' \| 'email', adapter)` |
| E-invoice | `apps/api/src/adapters/einvoice.ts` | `EInvoiceProvider` (`issue`, `cancel`) | `registerEInvoiceProvider(provider)` |

E-invoice auto-issue calls the provider **after** the sale is saved, so a provider failure never blocks a sale; the draft stays for manual issue.

### Print templates

**Thiết lập › Mẫu in**: edit the invoice (K58, K80, A4) and cash voucher (A5) layouts in HTML with fields such as `{{code}}`, `{{money total}}`, `{{date createdAt}}`, `{{words total}}` and loops `{{#lines}}…{{/lines}}`, with live preview; restore the default at any time. Printing runs in a sandboxed frame, so a template can't run scripts.

### Keyboard shortcuts

- POS: `F1` help · `F2` new invoice tab · `F3` search products · `F4` search customers · `F8` reprint last receipt · `F9` pay · `Alt+1…9` switch tab · `Ctrl+Tab` next tab.
- Back office: `F2` create on list screens · `/` focus search · `Esc` close dialogs.

### Known limitations

- Integrations are stubs (see above).
- On PostgreSQL some name/note searches (waybills, cash book, e-invoices, online orders, promotions) are case-sensitive.
- The P&L doesn't yet include write-offs / stock-take differences (see §3).
- Smaller deferred items are listed per milestone in [`docs/superpowers/decisions.md`](docs/superpowers/decisions.md).
