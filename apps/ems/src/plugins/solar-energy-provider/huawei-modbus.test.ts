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

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  try {
    await expect(client.connect()).resolves.toBeUndefined();
  } finally {
    client.close();
    server.close();
  }
});

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
