# Hướng Dẫn Deploy Hệ Thống Lên Vercel & Cấu Hình Supabase (100% Sẵn Sàng)

Dự án đã được tối ưu hóa toàn bộ (Production-Ready) với khả năng hỗ trợ các biến môi trường cấu hình linh hoạt, tối ưu hóa ảnh lưu trữ độc lập trên Supabase và tạo dựng luồng đối soát công nợ chuyên nghiệp.

---

## 1. Các Biến Môi Trường Cần Thiết Trên Vercel
Khi deploy dự án lên Vercel, hãy truy cập **Project Settings > Environment Variables** và điền 2 biến môi trường sau để kết nối với cơ sở dữ liệu Supabase của bạn:

| Tên biến (Key) | Giá trị mẫu (Value) | Ghi chú |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | `https://ykbsykqqdjqgnpslemsw.supabase.co` | Link API dẫn tới Supabase Project của bạn |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Mã khóa công khai (Anon/Public API key) |

*Mẹo: Nếu bạn không điền, hệ thống sẽ tự động dùng thông tin cấu hình dự phòng mặc định cực kỳ an toàn của xưởng để đảm bảo ứng dụng chạy được ngay.*

---

## 2. Cấu Hình Supabase Storage (Quan Trong Để Hiển Thị Ảnh)

Để tránh lỗi 403 (Forbidden) khi người dùng hoặc khách hàng không cần đăng nhập vẫn xem được ảnh (link gửi Zalo) trên thiết bị di động, bạn cần cấu hình bảo mật chính sách như sau:

### Bước A: Tạo Buckets Lưu Trữ Ảnh
1. Truy cập vào Dashboard Supabase, bấm vào mục **Storage** bên thanh trái.
2. Tạo mới 2 buckets với tên chính xác:
   * **`order-images`** (Để lưu trữ Maket, ảnh in PET, ảnh in kẹp áo thun)
   * **`product-images`** (Để lưu trữ hình ảnh sản phẩm tồn kho thiết kế)
3. Chắc chắn rằng lựa chọn **Public Bucket** của từng bucket trên được bật lên (để cho phép sinh public URL).

### Bước B: Cấu Hình RLS Policies (Nhà phân phối anon truy cập tự do)
Nếu bạn kích hoạt tính năng Row Level Security (RLS) để bảo vệ tệp tin, hãy chạy đoạn lệnh SQL sau trong **SQL Editor** của Supabase để cấp quyền cho phép mọi người (anon) có thể Xem hình ảnh và upload ẩn danh:

```sql
-- Cập nhật chính sách hữu hiệu cho bucket "order-images"
CREATE POLICY "Cho pheps anon doc anh don hang"
ON storage.objects FOR SELECT
USING (bucket_id = 'order-images');

CREATE POLICY "Cho pheps upload anh don hang"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'order-images');

-- Cập nhật chính sách hữu hiệu cho bucket "product-images"
CREATE POLICY "Cho pheps anon doc anh san pham"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

CREATE POLICY "Cho pheps upload anh san pham"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images');
```

---

## 3. Các Tính Năng Đã Được Rà Soát Độ Ổn Định

Trong đợt rà soát chuẩn bị Deploy này, xướng đã chạy Sanity Check và tối ưu hóa toàn diện:
1. **Lưu trữ ảnh tuyệt đối không rò rỉ:** File upload qua Form Tạo Đơn (In PET DTF & Áo thun) hoặc Nhập Kho được tải trực tiếp lên Supabase Storage thông qua hàm xử lý chuyên nghiệp, trả về URL an toàn và lưu trữ trực tiếp vào Hệ thống, hoàn toàn không lưu trữ chuỗi base64 nặng nề vào Database.
2. **Miễn lỗi 403 cho Link công nợ:** Thiết kế luồng Dynamic route ngắn gọn dạng `/c/[id]` giúp khách hàng truy cập trực tiếp xem công nợ tức thì mà không bị chặn bởi Middleware kiểm soát quyền Admin.
3. **Phông chữ Tiếng Việt hoàn mỹ:** Tích hợp bộ font chữ `Inter` và `JetBrains Mono` chính xác từ Google Fonts hỗ trợ định dạng bảng đối soát, phông chữ tiếng Việt trên PDF xuất khổ A5 và ảnh 9:16 chia sẻ Zalo siêu rõ nét, không bị lỗi hiển thị ký tự (font-breaking).
