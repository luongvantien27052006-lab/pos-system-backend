const { Client } = require('pg');
const crypto = require('crypto');

// Bê nguyên cấu trúc mã hóa chuẩn của bạn sang đây
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pin, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function run() {
  const client = new Client({
    // DÁN ĐƯỜNG LINK DATABASE PUBLIC URL CỦA RAILWAY VÀO ĐÂY
    connectionString: "postgresql://postgres:TmZZzMFNhtSpJHYKaWCczGFuGJMHAhqf@gondola.proxy.rlwy.net:48322/railway"
  });

  try {
    console.log('🔄 Đang kết nối thẳng tới Database Railway...');
    await client.connect();

    // 1. Ép tạo bảng app_settings nếu chưa có
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key         VARCHAR(50) PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Tiến hành băm số 1234 bằng công thức chuẩn
    const secureHash = hashPin('1234');

    // 3. Bắn thẳng dòng dữ liệu này vào két sắt Cloud
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      ['staff_pin_hash', secureHash]
    );

    console.log('🎉 [THÀNH CÔNG] Đã ép nạp mã PIN 1234 chuẩn mã hóa lên Railway!');
  } catch (err) {
    console.error('❌ Lỗi thực thi:', err);
  } finally {
    await client.end();
  }
}

run();