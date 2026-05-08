import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { ModbusTcpClient } from "./huawei-modbus";

test("ModbusTcpClient can reconnect after an initial connection failure", async () => {
  const port = await getAvailablePort();
  const server = createServer((socket) => {
    socket.destroy();
  });

  const client = new ModbusTcpClient({
    host: "127.0.0.1",
    port,
  });

  await expect(client.connect()).rejects.toThrow(
    /Modbus connection failed|Modbus connection timed out/,
  );

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );

  try {
    await expect(client.connect()).resolves.toBeUndefined();
  } finally {
    client.close();
    server.close();
  }
});

test("ModbusTcpClient retries the first timed out request", async () => {
  const port = await getAvailablePort();
  let requestCount = 0;
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      requestCount += 1;

      if (requestCount === 1) {
        return;
      }

      const transactionId = data.readUInt16BE(0);
      const unitId = data.readUInt8(6);
      socket.write(
        buildModbusFrame(
          transactionId,
          unitId,
          Buffer.from([0x03, 0x04, 0x00, 0x00, 0x0b, 0xb8]),
        ),
      );
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );

  const client = new ModbusTcpClient({
    host: "127.0.0.1",
    port,
    requestRetryCount: 1,
    requestRetryDelayMs: 0,
    responseTimeoutMs: 100,
    unitId: 1,
  });

  try {
    await client.connect();
    await expect(client.readHoldingRegisters(40126, 2)).resolves.toEqual([
      0, 3000,
    ]);
    expect(requestCount).toBe(2);
  } finally {
    client.close();
    server.close();
  }
});

function buildModbusFrame(
  transactionId: number,
  unitId: number,
  pdu: Buffer,
): Buffer {
  const header = Buffer.allocUnsafe(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pdu.length + 1, 4);
  header.writeUInt8(unitId, 6);
  return Buffer.concat([header, pdu]);
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to reserve a local TCP port for testing.");
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}
