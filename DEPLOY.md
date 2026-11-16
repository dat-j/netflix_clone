# Deploy lên Railway

Một project Railway gồm 5 service:

| Service | Nguồn | Ghi chú |
|---|---|---|
| Postgres | Plugin Postgres của Railway | Cần extension `pg_trgm`, `unaccent`, `citext` (xem bước 2) |
| Redis | Plugin Redis của Railway | Hàng đợi BullMQ + phiên xem |
| `api` | Repo này, `RAILWAY_DOCKERFILE_PATH=infra/api.Dockerfile` | Tự chạy `prisma migrate deploy` khi khởi động |
| `worker` | Repo này, `RAILWAY_DOCKERFILE_PATH=infra/worker.Dockerfile` | Gắn Volume vào `/work`, không cần domain |
| `web` | Repo này, `RAILWAY_DOCKERFILE_PATH=infra/web.Dockerfile` | Service duy nhất có domain public |

Trình duyệt chỉ nói chuyện với `web`; `web` chuyển `/api/*` sang `api` qua mạng private của Railway.

## 1. Đẩy code lên GitHub

Repo chưa có commit nào. `.env` đã nằm trong `.gitignore`, không được đẩy lên.

## 2. Postgres: bật extension

Một lần, trong tab Query/psql của service Postgres:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
```

## 3. Biến môi trường

Tạo secret mới, không dùng giá trị trong `.env` local:

```bash
openssl rand -hex 32   # MEDIA_KEY_ENCRYPTION_SECRET (bắt buộc đúng 64 ký tự hex)
openssl rand -base64 48   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CDN_SIGNING_SECRET (mỗi biến một giá trị)
```

> `MEDIA_KEY_ENCRYPTION_SECRET` mã hóa key giải mã của mọi phim đã transcode. Mất hoặc đổi nó là phải transcode lại toàn bộ kho.

### Dùng chung cho `api` và `worker` (nên đặt thành Shared Variables)

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `MEDIA_KEY_ENCRYPTION_SECRET` | secret hex ở trên |
| `SOURCE_S3_ENDPOINT` | `https://s3-hcm-r2.s3cloud.vn` |
| `SOURCE_S3_REGION` | `us-east-1` |
| `SOURCE_S3_BUCKET` | `daothe` |
| `SOURCE_S3_ACCESS_KEY_ID`, `SOURCE_S3_SECRET_ACCESS_KEY` | key do infra cấp |
| `SOURCE_S3_FORCE_PATH_STYLE` | `true` |
| `SOURCE_S3_PREFIX` | `streaming/source/` — **bắt buộc**: bucket dùng chung với app khác, worker từ chối quét nếu để trống |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, `MEDIA_S3_FORCE_PATH_STYLE` | giống hệt các biến `SOURCE_S3_*` tương ứng (cùng bucket) |
| `MEDIA_S3_PREFIX` | `streaming/media` — `api` và `worker` phải đặt giống nhau |

Bố cục trong bucket `daothe`:

```
streaming/source/   ← upload phim gốc vào đây (đặt thư mục con tùy ý)
streaming/media/    ← app tự ghi HLS + ảnh, không sửa tay
```

`streaming/source/samples/` đang có 4 video mẫu ngắn để thử pipeline sau khi deploy; xóa đi khi không cần.
Bucket ở chế độ riêng tư và không cần sửa CORS: trình duyệt không bao giờ gọi thẳng S3, mọi thứ đi qua `api`.

### Chỉ `api`

| Biến | Giá trị |
|---|---|
| `PORT` | `4000` (cố định để `web` gọi được qua mạng private) |
| `NODE_ENV` | `production` |
| `PUBLIC_WEB_URL` | `https://<domain-web>` (dùng trong link email) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | secret ở trên |
| `CDN_PROVIDER` | `local` (API tự phát segment; CDN thật chưa làm) |
| `CDN_BASE_URL` | `https://<domain-web>/api/v1/dev-cdn` |
| `CDN_SIGNING_SECRET` | secret ở trên |
| `TMDB_API_KEY` | để trống nếu chưa có (các nút TMDB trong admin báo "chưa cấu hình") |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | nhà cung cấp email (Resend, SES…) |

### Chỉ `worker`

| Biến | Giá trị |
|---|---|
| `TRANSCODE_CONCURRENCY` | `1` (mỗi job 1080p cần ~1 GB RAM) |
| `RAILWAY_RUN_UID` | `0`, để container ghi được vào Volume `/work` |

Gắn một Volume vào `/work`, dung lượng ≥ 2,5 lần file phim lớn nhất.

### Chỉ `web`

Hai biến đầu được nướng vào bản build, nên đổi giá trị là phải redeploy.

| Biến | Giá trị |
|---|---|
| `API_INTERNAL_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000` |
| `MEDIA_IMAGE_ORIGINS` | `https://<domain-web>/api/v1/dev-cdn/p/**` |
| `NODE_ENV` | `production` |

## 4. Dữ liệu ban đầu

Mở shell của service `api` (Railway CLI: `railway ssh --service api`):

```bash
cd /app/packages/db && node_modules/.bin/tsx prisma/seed.ts
```

Lệnh này tạo 3 gói cước và 3 tài khoản mẫu (`admin@example.com` / `Admin@12345`, `demo@…`, `free@…`). **Đổi mật khẩu admin ngay** và xóa hoặc khóa `demo`/`free` trong trang `/admin`.

Không chạy `seed:catalog` trên production: nó sinh 36 phim giả.

## 5. Đưa phim lên

1. Upload phim vào `SOURCE_S3_PREFIX`.
2. `/admin` → **Kho file nguồn** → **Quét bucket**.
3. **Phim** → **Thêm phim** → gắn file nguồn làm video chính → chờ job transcode xong → **Xuất bản**.
4. **Trang chủ**: tạo các hàng phim và billboard.

## Kiểm tra sau deploy

- `https://<domain-web>/api/v1/health` trả `{"status":"ok"}`.
- Log `worker` có dòng `consuming queues=media-probe,media-transcode`.
- Đăng nhập admin, transcode một phim ngắn, rồi phát thử bằng một tài khoản có gói.

## Giới hạn hiện tại

- Video đi qua service `api` (chưa có CDN), nên băng thông và CPU của `api` tăng theo số người xem. Gắn Bunny/Cloudflare là bước tiếp theo khi có người dùng thật.
- Chưa có cổng thanh toán; admin cấp gói thủ công trong `/admin` → **Người dùng**.
