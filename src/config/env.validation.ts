/**
 * Kiểm tra các biến môi trường bắt buộc ngay khi khởi động.
 * Thiếu biến quan trọng -> app dừng ngay thay vì lỗi mơ hồ lúc chạy.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const required = ['DATABASE_URL'];
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`[ENV] Thiếu biến môi trường bắt buộc: ${key}`);
    }
  }
  return config;
}