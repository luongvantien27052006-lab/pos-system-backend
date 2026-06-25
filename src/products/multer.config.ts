import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

/** Thư mục lưu ảnh: <project>/public/uploads */
export const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

// Đảm bảo thư mục tồn tại ngay khi nạp module
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const productImageMulter: MulterOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      // Làm sạch tên gốc (bỏ ký tự lạ/dấu cách) + tiền tố thời gian để không trùng
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext) && ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Chỉ chấp nhận ảnh định dạng .jpg, .jpeg, .png, .webp',
        ),
        false,
      );
    }
  },
  limits: { fileSize: MAX_SIZE },
};