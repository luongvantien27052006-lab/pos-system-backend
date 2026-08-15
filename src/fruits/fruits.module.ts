// ==================================================================
//  POS BACKEND  src/fruits/fruits.module.ts  (FILE MOI)
// ==================================================================
import { Module } from '@nestjs/common';
import { FruitsController } from './fruits.controller';

@Module({
  controllers: [FruitsController],
})
export class FruitsModule {}