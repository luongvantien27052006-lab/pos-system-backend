-- =============================================================================
--  HỆ THỐNG OMNI-CHANNEL POS  —  PHẦN 1: THIẾT KẾ CƠ SỞ DỮ LIỆU (PostgreSQL)
-- -----------------------------------------------------------------------------
--  Đặc tính cốt lõi:
--    • order_items APPEND-ONLY (chống xung đột dữ liệu real-time đa nguồn)
--    • Topping cấu trúc Cha–Con qua parent_item_id (để in thụt lề)
--    • Snapshot giá/tên tại thời điểm gọi (đổi giá menu không phá bill cũ)
--    • Partial index cho cảnh báo ghim (PENDING_CASH) & doanh thu (PAID)
--  Lưu ý: Đây là migration khởi tạo, chạy 1 lần trên DB trống.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. ENUM TYPES — chuẩn hóa & ràng buộc toàn vẹn (không dùng VARCHAR rời rạc)
-- -----------------------------------------------------------------------------
CREATE TYPE order_status      AS ENUM ('UNPAID', 'PENDING_CASH', 'PAID', 'CANCELLED');
CREATE TYPE payment_method    AS ENUM ('CASH', 'BANK_TRANSFER');
CREATE TYPE order_channel     AS ENUM ('TABLE_QR', 'COUNTER_POS'); -- nguồn gốc đơn
CREATE TYPE table_status      AS ENUM ('EMPTY', 'OCCUPIED');
CREATE TYPE order_item_type   AS ENUM ('PRODUCT', 'OPTION');       -- Cha = món / Con = topping
CREATE TYPE order_item_status AS ENUM ('ACTIVE', 'VOIDED');        -- ACTIVE / đã hủy món


-- -----------------------------------------------------------------------------
-- Hàm dùng chung: tự cập nhật updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- 1. TABLES (Bàn) — định danh qua table_number trên URL QR (?table=04)
-- -----------------------------------------------------------------------------
CREATE TABLE tables (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_number  VARCHAR(10)  NOT NULL,                 -- "04", "VIP1"...
  display_name  VARCHAR(50),                           -- tên hiển thị tùy chọn
  status        table_status NOT NULL DEFAULT 'EMPTY', -- render nhanh sơ đồ bàn
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,     -- ẩn khi bàn ngừng dùng
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tables_number UNIQUE (table_number)
);

CREATE TRIGGER trg_tables_updated
  BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. CATEGORIES (Danh mục: Cà phê, Trà sữa, Đá xay...)
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  display_order INT          NOT NULL DEFAULT 0,        -- sắp xếp hiển thị menu
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_categories_updated
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. PRODUCTS (Món / Sản phẩm)
-- -----------------------------------------------------------------------------
CREATE TABLE products (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id   BIGINT        NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name          VARCHAR(150)  NOT NULL,                 -- "Cà phê sữa đá"
  short_name    VARCHAR(30),                            -- "CFSĐ" — viết tắt cho quầy bấm nhanh
  description   TEXT,
  price         NUMERIC(12,2) NOT NULL CHECK (price >= 0), -- VND: có thể dùng scale 0 nếu muốn
  image_url     TEXT,
  is_available  BOOLEAN       NOT NULL DEFAULT TRUE,     -- hết hàng tạm thời
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,     -- ngừng kinh doanh
  display_order INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. OPTIONS (Topping / Tùy chọn: Thêm Thạch, Trân châu, Ít đường...)
-- -----------------------------------------------------------------------------
CREATE TABLE options (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,                 -- "Thêm Thạch"
  price         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  group_name    VARCHAR(50),                            -- "Topping", "Đường", "Size"
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_options_updated
  BEFORE UPDATE ON options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- (Bảng nối) PRODUCT_OPTIONS — quy định topping nào áp dụng cho món nào
CREATE TABLE product_options (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_id  BIGINT NOT NULL REFERENCES options(id)  ON DELETE CASCADE,
  PRIMARY KEY (product_id, option_id)
);


-- -----------------------------------------------------------------------------
-- 5. ORDER_SESSIONS (Phiên đơn — vòng đời UNPAID → PENDING_CASH → PAID)
-- -----------------------------------------------------------------------------
CREATE TABLE order_sessions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_code      VARCHAR(30)   NOT NULL,               -- mã đơn nhúng vào nội dung VietQR
  table_id        BIGINT        REFERENCES tables(id) ON DELETE SET NULL, -- NULL = mang đi / tại quầy
  channel         order_channel NOT NULL DEFAULT 'COUNTER_POS',
  status          order_status  NOT NULL DEFAULT 'UNPAID',
  payment_method  payment_method,                       -- NULL cho tới khi khách chọn
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0), -- SNAPSHOT đóng băng khi PAID
  note            TEXT,
  completed_at    TIMESTAMPTZ,                           -- mốc thời gian chốt PAID (tính doanh thu)
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_sessions_order_code UNIQUE (order_code),
  -- Đã PAID thì BẮT BUỘC có completed_at + payment_method (đảm bảo dữ liệu doanh thu sạch)
  CONSTRAINT chk_paid_consistency CHECK (
    status <> 'PAID'
    OR (completed_at IS NOT NULL AND payment_method IS NOT NULL)
  )
);

CREATE TRIGGER trg_sessions_updated
  BEFORE UPDATE ON order_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RÀNG BUỘC VÀNG: mỗi bàn chỉ có TỐI ĐA 1 phiên đang mở (chống mở 2 đơn trùng bàn)
CREATE UNIQUE INDEX uq_active_session_per_table
  ON order_sessions (table_id)
  WHERE status IN ('UNPAID', 'PENDING_CASH') AND table_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6. ORDER_ITEMS (Chi tiết đơn — APPEND-ONLY, cấu trúc Cha–Con)
-- -----------------------------------------------------------------------------
--  Quy tắc:
--    • Thêm món = INSERT 1 dòng mới. KHÔNG bao giờ UPDATE để cộng dồn số lượng.
--      => Khách (điện thoại) và Thu ngân (POS) thêm món đồng thời = 2 dòng khác
--         nhau, không tranh chấp / đè mất dữ liệu của nhau.
--    • Tổng giỏ hiện tại = SUM(line_total) các dòng status = 'ACTIVE'.
--    • Hủy món = đổi cờ status → 'VOIDED' (ngoại lệ có kiểm soát, tác động 1 dòng,
--      không xung đột với các INSERT đồng thời). Không có updated_at chung.
-- -----------------------------------------------------------------------------
CREATE TABLE order_items (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id      BIGINT NOT NULL REFERENCES order_sessions(id) ON DELETE CASCADE,
  parent_item_id  BIGINT REFERENCES order_items(id) ON DELETE CASCADE, -- NULL=món(Cha); NOT NULL=topping(Con)
  item_type       order_item_type NOT NULL,
  product_id      BIGINT REFERENCES products(id) ON DELETE RESTRICT,
  option_id       BIGINT REFERENCES options(id)  ON DELETE RESTRICT,

  name_snapshot   VARCHAR(150)  NOT NULL,                -- snapshot tên tại thời điểm gọi
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0), -- snapshot giá (chống đổi giá làm sai bill)
  quantity        INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total      NUMERIC(12,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,

  note            VARCHAR(255),                          -- "Ít đá", "Không đường"...
  status          order_item_status NOT NULL DEFAULT 'ACTIVE',
  voided_at       TIMESTAMPTZ,                           -- thời điểm hủy món (nếu có)
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- append-only: chỉ có created_at

  -- Toàn vẹn cấu trúc Cha–Con:
  CONSTRAINT chk_product_row CHECK (
    item_type <> 'PRODUCT' OR (product_id IS NOT NULL AND parent_item_id IS NULL)
  ),
  CONSTRAINT chk_option_row CHECK (
    item_type <> 'OPTION'  OR (option_id  IS NOT NULL AND parent_item_id IS NOT NULL)
  )
);


-- =============================================================================
-- 7. INDEXES — tối ưu real-time & tính doanh thu KHÔNG độ trễ
-- =============================================================================

-- [TABLES] render nhanh sơ đồ bàn theo trạng thái
CREATE INDEX idx_tables_status ON tables (status);

-- [PRODUCTS] tải menu nhanh
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_active   ON products (is_active, is_available);

-- [ORDER_SESSIONS] ----------------- nhóm index quan trọng nhất -----------------

-- (a) lọc đơn theo trạng thái
CREATE INDEX idx_sessions_status ON order_sessions (status);

-- (b) tìm đơn đang hoạt động của 1 bàn
CREATE INDEX idx_sessions_table ON order_sessions (table_id);

-- (c) lọc theo phương thức thanh toán (báo cáo CASH / BANK_TRANSFER)
CREATE INDEX idx_sessions_payment_method ON order_sessions (payment_method);

-- (d) PARTIAL INDEX cho cảnh báo ghim "đòi tiền mặt" trên POS:
--     chỉ index các đơn PENDING_CASH -> truy vấn danh sách cảnh báo cực nhẹ
CREATE INDEX idx_sessions_pending_cash
  ON order_sessions (created_at)
  WHERE status = 'PENDING_CASH';

-- (e) PARTIAL + COVERING INDEX cho DOANH THU REAL-TIME (mũi nhọn hệ thống):
--     chỉ index đơn PAID, gom sẵn total_amount -> SUM theo ngày/phương thức
--     chạy index-only-scan, gần như tức thời, không cần chạm bảng gốc.
CREATE INDEX idx_sessions_revenue
  ON order_sessions (completed_at, payment_method)
  INCLUDE (total_amount)
  WHERE status = 'PAID';

-- [ORDER_ITEMS]
-- (f) lấy toàn bộ món của 1 phiên (đường dẫn nóng nhất — render giỏ hàng)
CREATE INDEX idx_items_session ON order_items (session_id);

-- (g) lấy danh sách topping (con) theo món (cha)
CREATE INDEX idx_items_parent ON order_items (parent_item_id);

-- (h) lọc nhanh món ACTIVE trong 1 phiên (bỏ qua món đã VOID)
CREATE INDEX idx_items_session_active
  ON order_items (session_id)
  WHERE status = 'ACTIVE';

-- (i) thống kê sản phẩm bán chạy (tùy chọn)
CREATE INDEX idx_items_product ON order_items (product_id);

-- =============================================================================
--  HẾT PHẦN 1.
-- =============================================================================