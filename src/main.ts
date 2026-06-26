import 'dotenv/config'; // Ép nạp file .env ngay khi bật server local
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Phục vụ file tĩnh: public/uploads/x.png -> truy cập tại /uploads/x.png
  app.useStaticAssets(join(process.cwd(), 'public'));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );

  const origins = (config.get<string>('CORS_ORIGINS') ?? '*')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
  });

  const port = Number(config.get('PORT') ?? 4000);
  await app.listen(port, '::');
  new Logger('Bootstrap').log(
    `POS backend đang chạy tại http://localhost:${port}/api`,
  );
}

void bootstrap();