import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

/**
 * Upload ảnh lên Cloudinary qua REST API (signed upload) — KHÔNG cần SDK.
 *
 * BẬT khi có đủ 3 biến môi trường (lấy ở Cloudinary Dashboard → Account Details):
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 * Tuỳ chọn: CLOUDINARY_FOLDER (mặc định 'bavia-products').
 *
 * Không cấu hình -> isEnabled() = false -> hệ thống tự dùng lưu đĩa như cũ.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger('Cloudinary');
  private readonly cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
  private readonly apiKey = process.env.CLOUDINARY_API_KEY ?? '';
  private readonly apiSecret = process.env.CLOUDINARY_API_SECRET ?? '';
  private readonly folder = process.env.CLOUDINARY_FOLDER ?? 'bavia-products';

  isEnabled(): boolean {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  /**
   * Upload 1 file ảnh (đường dẫn local tạm) lên Cloudinary, trả về secure_url (https CDN).
   * Ném lỗi nếu Cloudinary trả mã lỗi -> caller quyết định fallback.
   */
  async uploadImage(localPath: string): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Ký: các param gửi kèm (trừ file/api_key/signature) sắp xếp a→z, nối 'k=v&...',
    // rồi nối api_secret, băm SHA-1 hex. Ở đây chỉ có folder + timestamp.
    const toSign = `folder=${this.folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(toSign + this.apiSecret)
      .digest('hex');

    const buf = await readFile(localPath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)]), 'upload');
    form.append('api_key', this.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', this.folder);
    form.append('signature', signature);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(20000) },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudinary ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { secure_url?: string };
    if (!json.secure_url) {
      throw new Error('Cloudinary không trả secure_url');
    }
    this.logger.log(`Upload ảnh OK -> ${json.secure_url}`);
    return json.secure_url;
  }
}