import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { AddItemsDto } from './dto/add-items.dto';
import { CreateCounterSessionDto } from './dto/create-session.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Khách quét QR tại bàn -> lấy/tạo phiên. */
  @Post('table/:tableNumber/session')
  getTableSession(@Param('tableNumber') tableNumber: string) {
    return this.orders.getOrCreateTableSession(tableNumber);
  }

  /** Thu ngân lên đơn tại quầy. */
  @Post('counter/session')
  createCounterSession(@Body() dto: CreateCounterSessionDto) {
    return this.orders.createCounterSession(dto.tableNumber);
  }

  /** Danh sách cảnh báo đòi tiền mặt đang chờ (POS tải lại). Phải đặt trước ':sessionId'. */
  @Get('pending-cash')
  listPendingCash() {
    return this.orders.listPendingCash();
  }

  /** Xem chi tiết đơn (đã gom topping). */
  @Get(':sessionId')
  getDetail(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.orders.buildSessionView(sessionId);
  }

  /** Thêm món (append-only). */
  @Post(':sessionId/items')
  addItems(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() dto: AddItemsDto,
  ) {
    return this.orders.addItems(sessionId, dto);
  }

  /** Hủy 1 món. */
  @Post('items/:itemId/void')
  voidItem(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.orders.voidItem(itemId);
  }

  /** KB1 bước 1 / KB2: chọn thanh toán tiền mặt. */
  @Post(':sessionId/pay/cash')
  payCash(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.orders.chooseCashPayment(sessionId);
  }

  /** KB1 bước 2 / KB2 cuối: xác nhận đã nhận tiền mặt -> PAID. */
  @Post(':sessionId/pay/cash/confirm')
  confirmCash(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.orders.confirmCashReceived(sessionId);
  }
}