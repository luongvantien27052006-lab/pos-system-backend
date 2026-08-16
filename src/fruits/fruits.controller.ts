// ==================================================================
//  POS BACKEND  src/fruits/fruits.controller.ts
//  >> CHEP DE — giờ dùng FruitsService (tạo SẢN PHẨM POS + đồng bộ app),
//     không proxy sang app nữa.
//  Route: /api/fruits/...
// ==================================================================
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { FruitsService } from './fruits.service';

@Controller('fruits')
export class FruitsController {
  constructor(private readonly fruits: FruitsService) {}

  @Get()
  list() {
    return this.fruits.list();
  }

  @Post()
  create(@Body() body: any) {
    return this.fruits.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.fruits.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fruits.remove(id);
  }
}