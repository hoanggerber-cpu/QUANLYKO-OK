-- =========================================================================
-- TỆP TIN KHỞI TẠO BẢNG & PHÂN QUYỀN BẢO MẬT TRỌN GÓI SUPABASE (SQL EDITOR)
-- Hướng dẫn: Copy toàn bộ nội dung file này, dán vào SQL Editor trên Supabase và bấm RUN!
-- =========================================================================

-- ==========================================
-- 1. TẠO CÁC BẢNG DỮ LIỆU (NẾU CHƯA TỒN TẠI)
-- ==========================================

-- Bảng lưu trữ sản phẩm (Kho)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image TEXT,
    color TEXT,
    size TEXT,
    stock INTEGER DEFAULT 0,
    import_price NUMERIC DEFAULT 0,
    sale_price NUMERIC DEFAULT 0,
    source TEXT DEFAULT 'self_produced',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bảng lưu trữ hóa đơn (Đơn hàng)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_code TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    type TEXT NOT NULL, -- dtf hoặc tshirt
    product_name TEXT,
    color TEXT,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    paid_amount NUMERIC DEFAULT 0,
    debt_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pending',
    order_images TEXT, -- Lưu trữ URL/Đường dẫn ảnh maket minh họa hoặc mảng ảnh dạng văn bản
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bảng lưu trữ chi tiết mặt hàng trong hóa đơn
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT, -- Sẽ liên kết tay với bảng orders
    type TEXT NOT NULL,
    product_name TEXT NOT NULL,
    color TEXT,
    size TEXT,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    image TEXT, -- URL ảnh chi tiết mảng PET hoặc áo mẫu
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bảng lưu trữ mã PIN công nợ khách hàng
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    pin_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. KÍCH HOẠT HỆ THỐNG BẢO MẬT RLS POLICIES
-- ==========================================
ALTER TABLE IF EXISTS products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 3. ĐỊNH NGHĨA QUYỀN TRUY CẬP (POLICIES) CHO BẢNG DỮ LIỆU
-- ==========================================

-- --- QUYỀN CHO BẢNG CUSTOMERS ---
DROP POLICY IF EXISTS "Cho pheps doc customers an danh" ON customers;
CREATE POLICY "Cho pheps doc customers an danh"
ON customers FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Toan quyen customers cho moi vai tro" ON customers;
CREATE POLICY "Toan quyen customers cho moi vai tro"
ON customers FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- --- QUYỀN CHO BẢNG PRODUCTS ---
DROP POLICY IF EXISTS "Cho pheps doc products an danh" ON products;
CREATE POLICY "Cho pheps doc products an danh"
ON products FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Toan quyen products cho moi vai tro" ON products;
CREATE POLICY "Toan quyen products cho moi vai tro"
ON products FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- --- QUYỀN CHO BẢNG ORDERS ---
DROP POLICY IF EXISTS "Cho pheps doc orders an danh" ON orders;
CREATE POLICY "Cho pheps doc orders an danh"
ON orders FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Toan quyen orders cho moi vai tro" ON orders;
CREATE POLICY "Toan quyen orders cho moi vai tro"
ON orders FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- --- QUYỀN CHO BẢNG ORDER_ITEMS ---
DROP POLICY IF EXISTS "Cho pheps doc order_items an danh" ON order_items;
CREATE POLICY "Cho pheps doc order_items an danh"
ON order_items FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Toan quyen order_items cho moi vai tro" ON order_items;
CREATE POLICY "Toan quyen order_items cho moi vai tro"
ON order_items FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);


-- =======================================================
-- 4. ĐỊNH NGHĨA CHÍNH SÁCH CHO BUCKETS HÌNH ẢNH (STORAGE)
-- =======================================================

-- Tạo các buckets "order-images" và "product-images" nếu chưa có (lệnh SQL này giúp kích hoạt chính sách bảo vệ tệp)
-- Cho phép xem hình ảnh công khai trong bucket "order-images"
DROP POLICY IF EXISTS "Cho pheps anon doc anh don hang" ON storage.objects;
CREATE POLICY "Cho pheps anon doc anh don hang"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'order-images');

-- Cho phép upload ảnh ẩn danh vào bucket "order-images"
DROP POLICY IF EXISTS "Cho pheps upload anh don hang" ON storage.objects;
CREATE POLICY "Cho pheps upload anh don hang"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'order-images');

-- Cho phép xem hình ảnh công khai trong bucket "product-images"
DROP POLICY IF EXISTS "Cho pheps anon doc anh san pham" ON storage.objects;
CREATE POLICY "Cho pheps anon doc anh san pham"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'product-images');

-- Cho phép upload ảnh ẩn danh vào bucket "product-images"
DROP POLICY IF EXISTS "Cho pheps upload anh san pham" ON storage.objects;
CREATE POLICY "Cho pheps upload anh san pham"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'product-images');
