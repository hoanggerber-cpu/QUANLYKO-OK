# Giai đoạn 1 — Bảo toàn dữ liệu (24/10/2026)

## Trạng thái
- Nhánh làm việc: `safety/phase1-backup-readonly-20261024`.
- Không thay đổi `main`, không merge, không deploy.
- Chưa truy cập production Supabase/Vercel hoặc localStorage của thiết bị; **chưa có bằng chứng sao lưu thành công**.

## Nguyên tắc
1. Không chạy migration, SQL ghi dữ liệu, RLS, đồng bộ ghi, xóa cache hoặc xóa ảnh.
2. Không tải dữ liệu khách hàng thực lên repository công khai.
3. Mọi bản sao lưu chứa dữ liệu cá nhân phải được mã hóa, lưu ở vị trí riêng tư, giới hạn truy cập.
4. Trước khi thay đổi production, xác nhận backup database + Storage + dữ liệu local của từng thiết bị và diễn tập restore.

## Danh sách công việc và bằng chứng
- [ ] Ghi lại production project ID, URL triển khai, thời điểm và commit đang chạy (không ghi API secrets).
- [ ] Sao lưu toàn bộ database bằng phương pháp được Supabase hỗ trợ; lưu tên file, UTC timestamp, checksum SHA-256, vị trí lưu an toàn.
- [ ] Sao lưu bucket `order-images` và `product-images`; kiểm kê object count, tổng byte và checksum/manifest nếu khả dụng.
- [ ] Sao lưu localStorage và IndexedDB/asset backups của **từng trình duyệt/thiết bị** trước khi đăng xuất hoặc xóa cache; giữ nguyên bản gốc.
- [ ] Đếm số dòng các bảng: orders, order_items, customers, payment_history, products, admin_users (nếu tồn tại).
- [ ] Tạo báo cáo đối soát read-only: tổng tiền đơn, tổng đã thanh toán, dư nợ, giao dịch trùng, đơn thiếu items, tham chiếu ảnh lỗi.
- [ ] Khôi phục database vào **project staging tách biệt**, không dùng credentials production; kiểm tra counts/checksums và quyền truy cập.
- [ ] Khôi phục thử một số ảnh và bản local trong môi trường cách ly.
- [ ] Ghi nhận người kiểm tra, thời gian, kết quả, cách rollback.

## Điều kiện hoàn thành
Chỉ hoàn thành khi có bằng chứng backup đọc được và restore thử thành công, đối chiếu số lượng dữ liệu và các bất thường được ghi lại. Nếu bất kỳ bước nào thất bại: dừng triển khai và giữ nguyên production.

## Cảnh báo hiện có
- `src/components/Login.tsx`: cơ chế đăng nhập dự phòng và kiểm tra mật khẩu trong `admin_users`.
- `rls-policies.sql`: quyền `anon` rộng, tuyệt đối không chạy lại trên production.
- PR #8 và #9 là bản nháp; không merge/deploy.
- Ảnh sản phẩm có dấu hiệu mất tham chiếu theo báo cáo PR #9; giữ nguyên cache các máy.
