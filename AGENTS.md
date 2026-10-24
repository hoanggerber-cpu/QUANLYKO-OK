# Quy tắc bảo trì QUANLYKO-OK (dành cho mọi AI agent và lập trình viên)

**Bắt buộc đọc trước khi sửa mã nguồn:** [docs/architecture/README.md](docs/architecture/README.md), [docs/architecture/flows.md](docs/architecture/flows.md), [docs/architecture/CHANGELOG.md](docs/architecture/CHANGELOG.md).

## Quy trình bắt buộc cho MỖI thay đổi

1. **Trước khi sửa:** xem sơ đồ liên quan, đọc trực tiếp mã nguồn thực tế, ghi nhận hành vi hiện tại, các module/bảng Supabase/localStorage/PDF bị ảnh hưởng. Sơ đồ có thể cũ; **mã nguồn là bằng chứng ưu tiên**.
2. **Thiết kế:** mô tả luồng trước/sau, rủi ro dữ liệu, migration (nếu có), kế hoạch rollback và test. Phân biệt ĐÃ TRIỂN KHAI, DỰ KIẾN và CHƯA KIỂM CHỨNG.
3. **Sửa tối thiểu:** chỉ sửa phần liên quan, trên nhánh riêng. Không tự ý merge, deploy Vercel hoặc thao tác dữ liệu thật.
4. **Sau khi sửa:** cập nhật `docs/architecture/README.md` nếu quan hệ module thay đổi, `docs/architecture/flows.md` nếu luồng nghiệp vụ/thanh toán/đồng bộ thay đổi. Ghi một mục vào `docs/architecture/CHANGELOG.md` với ngày, nhánh/commit, lý do, file/hàm thay đổi, hành vi trước/sau, test và giới hạn.
5. **Xác minh:** chạy `npm run lint`, `npm run build`, kiểm thử nghiệp vụ liên quan. Không ghi PASS khi chưa chạy. Nêu rõ nếu không có môi trường chạy.
6. **Bàn giao:** PR phải liên kết tới sơ đồ đã cập nhật, giải thích ảnh hưởng, nguy cơ, kiểm thử, cách rollback. Người tiếp theo phải hiểu được **tại sao** thay đổi chứ không chỉ **đã sửa gì**.

## Quy tắc an toàn kế toán

- Bảo toàn toàn bộ đơn PET, lịch sử thu tiền, công nợ và bản sao lưu local. Không xóa cache, localStorage, backup hoặc dữ liệu Supabase để giải quyết chênh lệch.
- Không tự động gộp, ghi đè, backfill hoặc sửa công nợ mà chưa có kiểm toán và chấp thuận rõ ràng.
- Phân biệt số tiền đã thu (`payment_history`) với số tiền phân bổ vào đơn (`paid_amount`).
- Các luồng thanh toán nhiều bước phải được xem xét về atomicity, idempotency, retry, conflict, mất mạng và đa thiết bị.
- Nếu không thể xác minh dữ liệu hoặc môi trường, dừng thao tác nguy hiểm và báo giới hạn.

## Archify / Mermaid

- Mermaid trong `docs/architecture` là tài liệu nguồn hiện có; Archify có thể bổ sung HTML tương tác sau khi được cài và chạy thật.
- Không ghi rằng đã chạy Archify nếu chưa chạy. Mỗi cạnh trên sơ đồ cần đối chiếu được với file/hàm hoặc ghi là giả thuyết.
- Mỗi PR thay đổi luồng phải cập nhật sơ đồ **cùng PR**, không để thành việc làm sau.
