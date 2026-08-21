import { IsIn } from 'class-validator';

/** Thu ngân cập nhật trạng thái chế biến đơn online. */
export class UpdatePrepStatusDto {
  @IsIn(['CONFIRMED', 'IN_PROGRESS', 'READY', 'DELIVERING', 'DELIVERED', 'CANCELLED'])
  status!:
    | 'CONFIRMED'
    | 'IN_PROGRESS'
    | 'READY'
    | 'DELIVERING'
    | 'DELIVERED'
    | 'CANCELLED';
}