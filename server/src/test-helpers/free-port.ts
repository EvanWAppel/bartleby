import { createServer, AddressInfo } from 'node:net';

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo | null;
      if (addr === null) {
        srv.close();
        reject(new Error('failed to allocate free port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}
