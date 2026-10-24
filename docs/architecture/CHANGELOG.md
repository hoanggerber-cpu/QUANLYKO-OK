# Nhật ký thay đổi kiến trúc

Mục đích: người mới hoặc AI agent đọc được **lý do, phạm vi và rủi ro** của mỗi thay đổi. Ghi mục mới ở đầu, không xóa lịch sử cũ.

## Mẫu bắt buộc cho mỗi PR

### YYYY-MM-DD · Tên thay đổi
- **PR / nhánh / commit:** liên kết
- **Mục tiêu và lý do:** vấn đề cần giải quyết
- **Trước → Sau:** mô tả luồng và sơ đồ tương ứng
- **File, hàm, bảng liên quan:** đường dẫn chính xác
- **Tác động:** nhập đơn, công nợ, thanh toán, realtime, PDF, local backup, thiết bị khác
- **Dữ liệu / migration:** có hay không, cách bảo vệ dữ liệu
- **Kiểm thử:** lệnh và kết quả thực tế, trường hợp chưa thử
- **Rollback:** cách trở về an toàn
- **Còn chưa xác minh:** nêu rõ

## 2026-10-24 · Khởi tạo bản đồ kiến trúc
- **PR:** #7, nhánh `docs/architecture-map`.
- **Mục tiêu:** ghi lại sơ đồ module và các luồng PET/công nợ/thu tiền/đồng bộ để sửa app có cơ sở.
- **Thay đổi:** `docs/architecture/README.md`, `flows.md`; bổ sung quy tắc bảo trì `AGENTS.md`, `CLAUDE.md` và nhật ký này.
- **Ứng dụng / Supabase:** không thay đổi.
- **Kiểm thử:** chưa chạy lint/build; tài liệu được đối chiếu thủ công với các file nguồn đã đọc.
- **Giới hạn:** chưa chạy Archify, chưa kiểm thử runtime đa thiết bị.
