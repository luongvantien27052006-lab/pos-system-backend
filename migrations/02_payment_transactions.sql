-- =============================================================================
--  PHẦN 2.4 — MIGRATION BỔ SUNG (chạy SAU 01_schema.sql)
--  Mục tiêu: chống xử lý trùng webhook (idempotency) + chống in trùng bill.
-- =============================================================================

-- Cờ đánh dấu đơn đã bắn lệnh in. Dùng để webhook chuyển khoản KHÔNG in lại
-- nếu bill đã in từ trước (ví dụ Kịch bản 3: khách chọn tiền mặt -> đã in -> quay
-- xe sang chuyển khoản).
ALTER TABLE order_sessions
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

-- Lưu mọi giao dịch tiền về nhận từ webhook (SePay...).
-- UNIQUE(provider, provider_tx_id) là chốt chặn idempotency ở tầng CSDL:
-- SePay gửi lại cùng một giao dịch -> INSERT trùng -> bị chặn -> ta bỏ qua an toàn.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider        VARCHAR(20)   NOT NULL DEFAULT 'SEPAY',
  provider_tx_id  VARCHAR(50)   NOT NULL,            -- mã giao dịch phía SePay
  session_id      BIGINT        REFERENCES order_sessions(id) ON DELETE SET NULL,
  order_code      VARCHAR(30),
  amount          NUMERIC(12,2) NOT NULL,
  gateway         VARCHAR(50),                        -- tên ngân hàng
  reference_code  VARCHAR(100),
  raw_content     TEXT,
  processed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_provider_tx UNIQUE (provider, provider_tx_id)
);

CREATE INDEX IF NOT EXISTS idx_paytx_session    ON payment_transactions (session_id);
CREATE INDEX IF NOT EXISTS idx_paytx_order_code ON payment_transactions (order_code);