\# POS Backend — Omni-channel (NestJS + PostgreSQL + Socket.io)



Backend cho hệ thống POS quán cà phê. Phần 2 được chia nhỏ để build chắc từng bước.



\## Tech

\- \*\*NestJS\*\* (TypeScript)

\- \*\*PostgreSQL\*\* qua `pg` — SQL thuần, schema ở Phần 1 (`01\_schema.sql`) là nguồn sự thật

\- \*\*Socket.io\*\* cho real-time



\## Cấu trúc

```

src/

&#x20; main.ts                    # bootstrap, CORS, prefix /api

&#x20; app.module.ts              # gom module (chừa chỗ cho 2.2–2.5)

&#x20; app.controller.ts          # GET /api/health

&#x20; config/env.validation.ts   # kiểm tra biến môi trường bắt buộc

&#x20; database/                  # pool pg + helper query() / queryOne() / transaction()

&#x20; realtime/                  # Socket.io gateway + định nghĩa room \& event dùng chung

```



\## Chạy thử

1\. Tạo database và chạy `01\_schema.sql` (Phần 1).

2\. `cp .env.example .env` rồi sửa `DATABASE\_URL`...

3\. `npm install`

4\. `npm run start:dev`

5\. Kiểm tra: `GET http://localhost:4000/api/health`



\## Mô hình real-time (đã thống nhất sẵn ở 2.1)

\- \*\*Room `pos`\*\*: tất cả máy thu ngân — nhận đơn mới, cảnh báo ghim, xác nhận trả tiền.

\- \*\*Room `admin`\*\*: dashboard chủ quán — nhận số doanh thu.

\- \*\*Room `table:<số bàn>`\*\*: màn hình khách của đúng 1 bàn.



Các module sau chỉ việc inject `RealtimeGateway` và gọi `emitPendingCash()`,

`emitOrderPaid()`, `emitRevenueUpdated()`, `emitOrderUpdated()`.



\## Lộ trình Phần 2 (đang ở 2.1)

\- \[x] \*\*2.1 Nền tảng\*\*: scaffolding, DB layer, realtime gateway

\- \[ ] \*\*2.2 Module Đơn hàng\*\*: tạo phiên, thêm món (append-only), 3 kịch bản nghiệp vụ

\- \[ ] \*\*2.3 In kép ESC/POS\*\* (TCP 9100, K80, topping thụt lề)

\- \[ ] \*\*2.4 VietQR động + Webhook ngân hàng\*\* (idempotency) → auto `PAID` + bắn lệnh in

\- \[ ] \*\*2.5 Dashboard doanh thu real-time\*\* qua Socket.io

