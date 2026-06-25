import * as net from 'net';

/**
 * Gửi dữ liệu ESC/POS thô tới máy in nhiệt qua TCP/IP (mặc định cổng 9100).
 * Mở socket -> ghi dữ liệu -> đóng. Có timeout để không treo nếu máy in offline.
 */
export function sendToPrinter(
  host: string,
  port: number,
  data: Buffer,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', done);
    socket.once('timeout', () =>
      done(new Error(`Hết thời gian kết nối máy in ${host}:${port}`)),
    );
    socket.once('close', () => done());

    socket.connect(port, host, () => {
      socket.write(data, () => socket.end());
    });
  });
}