// ==================================================================
//  POS BACKEND  (NestJS + raw pg)
//  Dat tai:  src/news/news.module.ts
//  >> FILE MOI (tao moi)
// ==================================================================

import { Module } from '@nestjs/common';
import { CloudinaryService } from '../products/cloudinary.service';
import { NewsController } from './news.controller';

@Module({
  controllers: [NewsController],
  providers: [CloudinaryService],
})
export class NewsModule {}