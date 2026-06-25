import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  EVENTS,
  OrderPaidPayload,
  OrderPendingCashPayload,
  RevenueUpdatedPayload,
  ROOMS,
} from './realtime.events';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`Client kết nối: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ngắt kết nối: ${client.id}`);
  }

  // ---------------- Client chủ động tham gia phòng ----------------

  /** Màn hình thu ngân tham gia phòng POS. */
  @SubscribeMessage('join:pos')
  joinPos(@ConnectedSocket() client: Socket) {
    client.join(ROOMS.POS);
    return { ok: true, room: ROOMS.POS };
  }

  /** Dashboard chủ quán. */
  @SubscribeMessage('join:admin')
  joinAdmin(@ConnectedSocket() client: Socket) {
    client.join(ROOMS.ADMIN);
    return { ok: true, room: ROOMS.ADMIN };
  }

  /** Màn hình khách tại bàn (truyền tableNumber từ tham số ?table=). */
  @SubscribeMessage('join:table')
  joinTable(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tableNumber: string },
  ) {
    const room = ROOMS.table(data.tableNumber);
    client.join(room);
    return { ok: true, room };
  }

  // ---------------- Hàm để các module khác gọi phát sự kiện ----------------

  /** Cảnh báo ghim "đòi tiền mặt" — chỉ gửi tới các máy POS. */
  emitPendingCash(payload: OrderPendingCashPayload): void {
    this.server.to(ROOMS.POS).emit(EVENTS.ORDER_PENDING_CASH, payload);
  }

  /** Đã thu tiền: tắt cảnh báo trên POS + báo cho màn hình khách (nếu có bàn). */
  emitOrderPaid(payload: OrderPaidPayload): void {
    this.server.to(ROOMS.POS).emit(EVENTS.ORDER_PAID, payload);
    if (payload.tableNumber) {
      this.server
        .to(ROOMS.table(payload.tableNumber))
        .emit(EVENTS.ORDER_PAID, payload);
    }
  }

  /** Đẩy số liệu doanh thu mới tới dashboard. */
  emitRevenueUpdated(payload: RevenueUpdatedPayload): void {
    this.server.to(ROOMS.ADMIN).emit(EVENTS.REVENUE_UPDATED, payload);
  }

  /** Đơn có thay đổi (thêm món...) — đồng bộ POS và màn hình khách. */
  emitOrderUpdated(sessionId: number, tableNumber: string | null): void {
    this.server.to(ROOMS.POS).emit(EVENTS.ORDER_UPDATED, { sessionId });
    if (tableNumber) {
      this.server
        .to(ROOMS.table(tableNumber))
        .emit(EVENTS.ORDER_UPDATED, { sessionId });
    }
  }
}