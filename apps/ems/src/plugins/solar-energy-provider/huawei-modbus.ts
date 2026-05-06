import { Socket } from "node:net";

const MODBUS_TIMEOUT_MS = 2_000;

export class ModbusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModbusError";
  }
}

export class ModbusPermissionError extends ModbusError {
  constructor(message: string) {
    super(message);
    this.name = "ModbusPermissionError";
  }
}

export interface HuaweiDeviceIdentification {
  manufacturer: string | null;
  productCode: string | null;
  revision: string | null;
}

export interface ModbusConnectionOptions {
  host: string;
  port: number;
  unitId?: number;
}

export async function withModbusClient<T>(
  options: ModbusConnectionOptions,
  callback: (client: ModbusTcpClient) => Promise<T>,
): Promise<T> {
  const client = new ModbusTcpClient(options);
  await client.connect();

  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

export function decodeStringRegisters(registers: number[]): string | null {
  const bytes: number[] = [];

  for (const register of registers) {
    bytes.push((register >> 8) & 0xff, register & 0xff);
  }

  const text = Buffer.from(bytes).toString("utf8").replace(/\0+/g, "").trim();

  return text.length > 0 ? text : null;
}

export function decodeInt32Registers(registers: number[]): number {
  if (registers.length !== 2) {
    throw new ModbusError(
      `Expected 2 registers for signed 32-bit value, received ${registers.length}.`,
    );
  }

  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt16BE(registers[0] ?? 0, 0);
  buffer.writeUInt16BE(registers[1] ?? 0, 2);
  return buffer.readInt32BE(0);
}

export function decodeUint32Registers(registers: number[]): number {
  if (registers.length !== 2) {
    throw new ModbusError(
      `Expected 2 registers for unsigned 32-bit value, received ${registers.length}.`,
    );
  }

  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt16BE(registers[0] ?? 0, 0);
  buffer.writeUInt16BE(registers[1] ?? 0, 2);
  return buffer.readUInt32BE(0);
}

export class ModbusTcpClient {
  private readonly host: string;
  private readonly port: number;
  private readonly unitId: number;
  private transactionId = 0;
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);

  constructor({ host, port, unitId = 0 }: ModbusConnectionOptions) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(MODBUS_TIMEOUT_MS);
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
        socket.off("timeout", onTimeout);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        socket.destroy();
        this.socket = null;
        reject(
          new ModbusError(
            `Modbus connection failed for ${this.host}:${this.port}: ${error.message}`,
          ),
        );
      };

      const onTimeout = () => {
        cleanup();
        socket.destroy();
        this.socket = null;
        reject(
          new ModbusError(
            `Modbus connection timed out for ${this.host}:${this.port}.`,
          ),
        );
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.once("timeout", onTimeout);
      socket.connect(this.port, this.host);
    });
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  async readHoldingRegisters(
    address: number,
    quantity: number,
  ): Promise<number[]> {
    const response = await this.sendRequest(
      0x03,
      Buffer.from([
        0x03,
        (address >> 8) & 0xff,
        address & 0xff,
        (quantity >> 8) & 0xff,
        quantity & 0xff,
      ]),
      `read holding registers ${address}`,
    );

    const byteCount = response[1];

    if (byteCount !== quantity * 2) {
      throw new ModbusError(
        `Invalid byte count ${byteCount} for register ${address} on ${this.host}:${this.port}.`,
      );
    }

    const registers: number[] = [];
    for (let index = 0; index < quantity; index += 1) {
      const offset = 2 + index * 2;
      registers.push(response.readUInt16BE(offset));
    }

    return registers;
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    await this.sendRequest(
      0x06,
      Buffer.from([
        0x06,
        (address >> 8) & 0xff,
        address & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
      ]),
      `write single register ${address}`,
    );
  }

  async writeMultipleRegisters(
    address: number,
    values: number[],
  ): Promise<void> {
    const body = Buffer.allocUnsafe(values.length * 2);

    for (let index = 0; index < values.length; index += 1) {
      body.writeUInt16BE(values[index] ?? 0, index * 2);
    }

    await this.sendRequest(
      0x10,
      Buffer.concat([
        Buffer.from([
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          (values.length >> 8) & 0xff,
          values.length & 0xff,
          body.length,
        ]),
        body,
      ]),
      `write multiple registers ${address}`,
    );
  }

  async readDeviceIdentification(): Promise<HuaweiDeviceIdentification> {
    const response = await this.sendRequest(
      0x2b,
      Buffer.from([0x2b, 0x0e, 0x01, 0x00]),
      "read device identification",
    );

    if (response[1] !== 0x0e) {
      throw new ModbusError(
        `Unsupported device identification response from ${this.host}:${this.port}.`,
      );
    }

    const objectCount = response[6] ?? 0;
    let offset = 7;
    const objects = new Map<number, string>();

    for (let index = 0; index < objectCount; index += 1) {
      const objectId = response[offset] ?? 0;
      const length = response[offset + 1] ?? 0;
      const value = response
        .subarray(offset + 2, offset + 2 + length)
        .toString("utf8")
        .trim();
      objects.set(objectId, value);
      offset += 2 + length;
    }

    return {
      manufacturer: objects.get(0x00) ?? null,
      productCode: objects.get(0x01) ?? null,
      revision: objects.get(0x02) ?? null,
    };
  }

  private async sendRequest(
    expectedFunctionCode: number,
    pdu: Buffer,
    action: string,
  ): Promise<Buffer> {
    const socket = this.socket;

    if (!socket) {
      throw new ModbusError("Modbus socket is not connected.");
    }

    const transactionId = this.nextTransactionId();
    const header = Buffer.allocUnsafe(7);
    header.writeUInt16BE(transactionId, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(pdu.length + 1, 4);
    header.writeUInt8(this.unitId, 6);

    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat([header, pdu]), (error) => {
        if (error) {
          reject(
            new ModbusError(
              `Modbus ${action} failed for ${this.host}:${this.port}: ${error.message}`,
            ),
          );
          return;
        }

        resolve();
      });
    });

    const frame = await this.readFrame();
    const responseTransactionId = frame.readUInt16BE(0);
    const protocolId = frame.readUInt16BE(2);
    const responseUnitId = frame.readUInt8(6);

    if (responseTransactionId !== transactionId || protocolId !== 0) {
      throw new ModbusError(
        `Invalid Modbus response header from ${this.host}:${this.port}.`,
      );
    }

    if (responseUnitId !== this.unitId) {
      throw new ModbusError(
        `Unexpected Modbus unit ${responseUnitId} from ${this.host}:${this.port}.`,
      );
    }

    const responsePdu = frame.subarray(7);
    const functionCode = responsePdu[0] ?? 0;

    if (functionCode === (expectedFunctionCode | 0x80)) {
      const exceptionCode = responsePdu[1] ?? 0;

      if (exceptionCode === 0x80) {
        throw new ModbusPermissionError(
          `Huawei Modbus permission denied for ${action} at ${this.host}:${this.port}.`,
        );
      }

      throw new ModbusError(
        `Modbus exception 0x${exceptionCode.toString(16).padStart(2, "0")} during ${action} at ${this.host}:${this.port}.`,
      );
    }

    if (functionCode !== expectedFunctionCode) {
      throw new ModbusError(
        `Unexpected Modbus function 0x${functionCode.toString(16)} during ${action} at ${this.host}:${this.port}.`,
      );
    }

    return responsePdu;
  }

  private nextTransactionId(): number {
    this.transactionId = (this.transactionId + 1) & 0xffff;
    return this.transactionId;
  }

  private async readFrame(): Promise<Buffer> {
    const socket = this.socket;

    if (!socket) {
      throw new ModbusError("Modbus socket is not connected.");
    }

    const start = Date.now();

    while (Date.now() - start < MODBUS_TIMEOUT_MS) {
      if (this.buffer.length >= 7) {
        const length = this.buffer.readUInt16BE(4);
        const frameLength = 6 + length;

        if (this.buffer.length >= frameLength) {
          const frame = this.buffer.subarray(0, frameLength);
          this.buffer = this.buffer.subarray(frameLength);
          return frame;
        }
      }

      await new Promise<void>((resolve, reject) => {
        const onData = () => {
          cleanup();
          resolve();
        };
        const onError = (error: Error) => {
          cleanup();
          reject(
            new ModbusError(
              `Modbus read failed for ${this.host}:${this.port}: ${error.message}`,
            ),
          );
        };
        const onTimeout = () => {
          cleanup();
          reject(
            new ModbusError(
              `Modbus read timed out for ${this.host}:${this.port}.`,
            ),
          );
        };
        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("timeout", onTimeout);
        };

        socket.once("data", onData);
        socket.once("error", onError);
        socket.once("timeout", onTimeout);
      });
    }

    throw new ModbusError(
      `Modbus response timed out for ${this.host}:${this.port}.`,
    );
  }
}
