-- =============================================================================
--  REPO 1 (POS) · MIGRATION 04 — HẠ TẦNG ĐỒNG BỘ SANG APP F&B
--  Chạy 1 lần trên DB POS. An toàn (IF NOT EXISTS).
-- =============================================================================

-- 1) Mỗi danh mục POS khai báo nó thuộc nhóm nào của App (enum cố định).
--    App chỉ có 3 nhóm: COFFEE | MILK_TEA | TEA.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS app_category VARCHAR(20);

--    >>> SAU KHI MIGRATE, BẠN GÁN NHÓM CHO TỪNG DANH MỤC, ví dụ:
--    UPDATE categories SET app_category = 'COFFEE'   WHERE name ILIKE '%cà phê%';
--    UPDATE categories SET app_category = 'MILK_TEA' WHERE name ILIKE '%trà sữa%';
--    UPDATE categories SET app_category = 'TEA'      WHERE name ILIKE '%trà%' AND app_category IS NULL;
--    (Danh mục chưa gán -> món của nó sẽ KHÔNG đồng bộ, kèm cảnh báo trong log.)

-- 2) Lưu app_product_id sau lần đồng bộ đầu (để các lần sau là UPDATE, không tạo trùng).
ALTER TABLE products ADD COLUMN IF NOT EXISTS app_product_id UUID;
CREATE INDEX IF NOT EXISTS idx_products_app_id ON products (app_product_id);

-- 3) Outbox — đảm bảo không mất dữ liệu khi App tạm chết / quá tải.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      UUID        NOT NULL DEFAULT gen_random_uuid(),
  event_type    VARCHAR(40) NOT NULL,   -- 'product.upsert' | 'availability'
  payload       JSONB       NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING | DONE | FAILED
  attempts      INT         NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox (status, next_retry_at);

-- 4) Chống xử lý trùng event nhận từ App (cho luồng đơn hàng App->POS sau này).
CREATE TABLE IF NOT EXISTS processed_events (
  event_id   UUID PRIMARY KEY,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) (Cho bước đơn hàng sau) ánh xạ đơn App <-> phiên POS.
CREATE TABLE IF NOT EXISTS app_order_map (
  app_order_id UUID PRIMARY KEY,
  session_id   BIGINT REFERENCES order_sessions(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);