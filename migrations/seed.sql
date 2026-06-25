-- =============================================================================
--  DỮ LIỆU MẪU (tuỳ chọn) — chạy SAU 01_schema.sql + 02_payment_transactions.sql
--  Dùng để test nhanh: vài danh mục, món cà phê/trà sữa, topping và bàn.
--  An toàn: tự dừng nếu DB đã có sản phẩm (tránh seed trùng).
-- =============================================================================

BEGIN;

-- Chặn seed trùng
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products LIMIT 1) THEN
    RAISE EXCEPTION 'Đã có dữ liệu sản phẩm — bỏ qua seed để tránh trùng.';
  END IF;
END $$;

-- ----- Bàn -----
INSERT INTO tables (table_number, display_name) VALUES
  ('01', 'Bàn 1'), ('02', 'Bàn 2'), ('03', 'Bàn 3'), ('04', 'Bàn 4'),
  ('05', 'Bàn 5'), ('06', 'Bàn 6'), ('07', 'Bàn 7'), ('08', 'Bàn 8'),
  ('V1', 'VIP 1'), ('V2', 'VIP 2');

-- ----- Danh mục -----
INSERT INTO categories (name, display_order) VALUES
  ('Cà phê', 1),
  ('Trà & Trà sữa', 2),
  ('Đá xay', 3),
  ('Bánh', 4);

-- ----- Món -----
INSERT INTO products (category_id, name, short_name, price, display_order)
SELECT c.id, v.name, v.short_name, v.price, v.ord
FROM (VALUES
  ('Cà phê',        'Cà phê đen',              'CFĐ',  25000, 1),
  ('Cà phê',        'Cà phê sữa',              'CFS',  29000, 2),
  ('Cà phê',        'Bạc xỉu',                 'BX',   35000, 3),
  ('Cà phê',        'Cà phê dừa',              'CFD',  45000, 4),
  ('Trà & Trà sữa', 'Trà sữa truyền thống',    'TSTT', 39000, 1),
  ('Trà & Trà sữa', 'Trà đào cam sả',          'TĐCS', 45000, 2),
  ('Trà & Trà sữa', 'Trà sữa khoai môn',       'TSKM', 42000, 3),
  ('Trà & Trà sữa', 'Hồng trà sữa',            'HTS',  39000, 4),
  ('Đá xay',        'Đá xay socola',           'DXSC', 55000, 1),
  ('Đá xay',        'Đá xay matcha',           'DXMC', 55000, 2),
  ('Đá xay',        'Cookie đá xay',           'CKĐX', 59000, 3),
  ('Bánh',          'Bánh tiramisu',           'TIRA', 35000, 1),
  ('Bánh',          'Croissant',               'CROI', 30000, 2)
) AS v(cat, name, short_name, price, ord)
JOIN categories c ON c.name = v.cat;

-- ----- Topping -----
INSERT INTO options (name, price, group_name) VALUES
  ('Trân châu đen',      7000,  'Topping'),
  ('Trân châu trắng',    7000,  'Topping'),
  ('Thạch dừa',          7000,  'Topping'),
  ('Pudding trứng',     10000,  'Topping'),
  ('Kem cheese',        12000,  'Topping'),
  ('Thêm shot espresso',10000,  'Khác');

-- ----- Gán topping cho nhóm Trà sữa & Đá xay (mọi món trong nhóm có mọi topping) -----
INSERT INTO product_options (product_id, option_id)
SELECT p.id, o.id
FROM products p
JOIN categories c ON c.id = p.category_id
CROSS JOIN options o
WHERE c.name IN ('Trà & Trà sữa', 'Đá xay');

COMMIT;