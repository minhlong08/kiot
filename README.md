# PhuongDong POS

Phần mềm quản lý bán hàng tự cài đặt cho cửa hàng thời trang / phụ kiện: hàng hóa và kho, nhập hàng, bán hàng tại quầy (POS), đơn hàng – trả hàng – giao hàng, khách hàng và tích điểm, khuyến mại, nhân viên – chấm công – bảng lương, sổ quỹ, báo cáo, website bán hàng và hóa đơn điện tử. Chạy trên máy của bạn, không cần dịch vụ đám mây.

*A self-hosted retail management + POS application for a Vietnamese shop. English notes follow each section.*

> Tên ứng dụng là giá trị tạm, đặt ở một chỗ: `packages/shared/src/config.ts` (`APP_NAME`).

## Chạy nhanh · Quick start

Yêu cầu: **Node.js 24**, **pnpm 10**.

```bash
pnpm install
pnpm dev
```

- Trang quản lý: <http://localhost:5173>
- Màn hình bán hàng (POS): <http://localhost:5174/sale/>
- Website bán hàng công khai: <http://localhost:5173/shop>
- API: <http://localhost:3000/api/health>

Lần chạy đầu tiên tự tạo cơ sở dữ liệu SQLite trong `data/app.db` và nạp **dữ liệu mẫu** (40 mặt hàng, nhà cung cấp, khách hàng, ~45 hóa đơn, giao hàng, nhân viên, bảng lương…). Các lần sau chỉ chạy migration và giữ nguyên dữ liệu.

*First run creates `data/app.db` (SQLite) and loads demo data; later runs only migrate.*

### Tài khoản mẫu · Demo logins

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `admin123` | Quản trị (toàn quyền) |
| `thu.ngan` | `nhanvien123` | Thu ngân (Lê Thị Bình) |
| `ban.hang` | `nhanvien123` | Nhân viên bán hàng (Trần Văn Cường) |

Mọi tài khoản mẫu phải **đổi mật khẩu ở lần đăng nhập đầu tiên**. *All demo accounts must change their password on first sign-in.*

### Chạy bản production (một cổng) · Production on one port

```bash
pnpm start        # build admin + POS, migrate, seed if empty, serve everything on :3000
```

API phục vụ luôn trang quản lý tại `/`, POS tại `/sale/` và website tại `/shop`.

### Docker + PostgreSQL

```bash
docker compose up --build
```

Mở <http://localhost:3000>. Dữ liệu nằm trong volume `pgdata`, ảnh tải lên trong volume `uploads`.

*`docker compose up` runs the app against PostgreSQL 17. The image generates a Postgres Prisma client from `apps/api/prisma/schema.prisma` (provider swapped by `scripts/prisma-provider.mjs`) and creates tables with `prisma db push`.*

Dùng PostgreSQL ngoài Docker: đặt `DATABASE_URL=postgresql://user:pass@host:5432/db`, chạy `node scripts/prisma-provider.mjs`, rồi `npx prisma generate --schema prisma/pg/schema.prisma` và `npx prisma db push --schema prisma/pg/schema.prisma` trong `apps/api`.

## Sao lưu & dữ liệu · Backup and data

- **Thiết lập › Sao lưu & khôi phục** (chỉ quản trị viên): tải toàn bộ dữ liệu về một file JSON, khôi phục từ file (toàn bộ hoặc không gì cả), hoặc xóa và tạo lại dữ liệu mẫu (gõ `XOA DU LIEU` để xác nhận).
- Ảnh hàng hóa / logo nằm trong `data/uploads` — hãy sao lưu thư mục này riêng.
- Bản sao lưu chỉ khôi phục vào cùng phiên bản cấu trúc dữ liệu; file khôi phục tối đa 1 GB.

*Admins can download a full JSON backup, restore it atomically, or reset to demo data. Uploaded images live in `data/uploads` and are not part of the JSON.*

## Cấu trúc dự án · Project layout

```
apps/api        Fastify + Prisma (SQLite mặc định, PostgreSQL qua DATABASE_URL)
apps/admin      Trang quản lý — React, Vite, TanStack Router/Query, Tailwind (kèm website /shop)
apps/pos        Màn hình bán hàng /sale — React, Vite, chạy được khi mất mạng ngắn
packages/shared Zod schema và logic dùng chung (tính tiền, khuyến mại, thuế, lương, báo cáo, mẫu in)
e2e             Kiểm thử Playwright
docs            Yêu cầu, thiết kế, kế hoạch từng giai đoạn, nhật ký quyết định
```

Quy tắc chính: tiền là số nguyên (đồng); mọi thay đổi tồn kho chạy trong transaction và ghi sổ kho; công nợ chỉ đổi qua sổ công nợ; hủy chứng từ tạo bút toán đảo, không xóa. Múi giờ Asia/Ho_Chi_Minh.

## Kết nối bên ngoài (adapter) · Integrations

Ứng dụng **không** kết nối thật với hãng vận chuyển, SMS/Zalo hay nhà cung cấp hóa đơn điện tử. Mỗi loại có một interface và một bản giả lập; cắm nhà cung cấp thật bằng cách đăng ký adapter khi khởi động (ví dụ trong `apps/api/src/server.ts`, trước `listen`).

| Loại | File | Interface | Đăng ký |
|---|---|---|---|
| Hãng vận chuyển | `apps/api/src/adapters/carrier.ts` | `CarrierAdapter` (`quote`, `createShipment`) | `registerCarrierAdapter(partnerCode, adapter)` — theo mã đối tác giao hàng (`DT…`) |
| SMS / Zalo / Email | `apps/api/src/adapters/messaging.ts` | `MessagingAdapter` (`send`) | `registerMessagingAdapter('sms' \| 'zalo' \| 'email', adapter)` |
| Hóa đơn điện tử | `apps/api/src/adapters/einvoice.ts` | `EInvoiceProvider` (`issue`, `cancel`) | `registerEInvoiceProvider(provider)` |

```ts
// apps/api/src/server.ts
import { registerEInvoiceProvider } from './adapters/einvoice';
registerEInvoiceProvider({ name: 'my-provider', async issue(draft, seq) { /* call the provider */ return { number, lookupCode }; }, async cancel(ref, reason) { /* … */ } });
```

Chế độ tự phát hành hóa đơn điện tử (Thiết lập thuế) gọi nhà cung cấp **sau** khi hóa đơn bán đã lưu, nên lỗi phía nhà cung cấp không làm hỏng việc bán hàng; bản nháp ở lại để phát hành tay.

*Carriers, messaging and e-invoices are stubs behind interfaces; register a real implementation at startup. E-invoice auto-issue runs after the sale commits.*

## Mẫu in · Print templates

**Thiết lập › Mẫu in**: sửa mẫu hóa đơn (K58, K80, A4) và phiếu thu/chi (A5) bằng HTML với các trường `{{code}}`, `{{money total}}`, `{{date createdAt}}`, `{{words total}}`, vòng lặp `{{#lines}}…{{/lines}}`; xem trước trực tiếp; khôi phục mẫu mặc định bất cứ lúc nào.

## Phím tắt · Keyboard

- POS: `F1` bảng phím tắt · `F2` hóa đơn mới · `F3` tìm hàng · `F4` tìm khách · `F8` in lại hóa đơn vừa bán · `F9` thanh toán · `Alt+1…9` chuyển hóa đơn · `Ctrl+Tab` hóa đơn kế tiếp.
- Trang quản lý: `F2` thêm mới trên màn hình danh sách · `/` tìm kiếm · `Esc` đóng hộp thoại.

## Kiểm thử · Testing

```bash
pnpm test        # unit/integration (Vitest): shared, api, admin, pos
pnpm typecheck
pnpm e2e         # Playwright: dùng cơ sở dữ liệu riêng data/e2e.db, tự tạo lại mỗi lần chạy
```

## Giới hạn đã biết · Known limitations

- Không có kết nối thật với hãng vận chuyển, SMS/Zalo, hóa đơn điện tử, sàn TMĐT hay ngân hàng (chỉ adapter giả lập).
- Trên PostgreSQL, một số ô tìm kiếm theo tên/ghi chú (vận đơn, sổ quỹ, hóa đơn điện tử, đơn online, khuyến mại) phân biệt chữ hoa/thường.
- PostgreSQL ngoài Docker: chạy server bằng `npx tsx src/server.ts` trong `apps/api` (đừng dùng `pnpm start`/`pnpm install` sau khi đã sinh client Postgres — chúng sinh lại client SQLite).
- Các điểm nhỏ đã ghi nhận nhưng hoãn lại được liệt kê theo từng giai đoạn trong [`docs/superpowers/decisions.md`](docs/superpowers/decisions.md).
