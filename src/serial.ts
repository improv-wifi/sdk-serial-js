import {
  ERROR_MSGS,
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  ImprovSerialMessageType,
  ImprovSerialRPCCommand,
  Logger,
  SERIAL_PACKET_HEADER,
} from "./const.js";
import { hexFormatter, iterateReadableStream, sleep } from "./util.js";

export class ImprovSerial extends EventTarget {
  public info?: { name: string; firmware: string; version: string };

  public nextUrl: string | undefined;

  public state?: ImprovSerialCurrentState | undefined;

  public error = ImprovSerialErrorState.NO_ERROR;

  private _reader?: ReadableStreamReader<Uint8Array>;

  private _rpcFeedback?: {
    command: ImprovSerialRPCCommand;
    resolve: (data: string[]) => void;
    reject: (err: ImprovSerialErrorState) => void;
  };

  constructor(public port: SerialPort, public logger: Logger) {
    super();
  }

  /**
   * Detect Improv Serial, fetch the state and return the next URL if provisioned.
   * @returns
   */
  public async initialize() {
    this.logger.log("Initializing Improv Serial");
    this._processInput();
    // To give the input processing time to start.
    await sleep(1000);
    try {
      await new Promise(async (resolve, reject) => {
        setTimeout(
          () => reject(new Error("Improv Wi-Fi Serial not detected")),
          5000
        );
        await this.requestCurrentState();
        resolve(undefined);
      });
    } catch (err) {
      this.close();
      throw err;
    }
    // TODO TEMP
    this.info = {
      name: "Living Room Tag Reader",
      firmware: "ESPHome",
      version: "2021.10.2",
    };
  }

  public async close() {
    await new Promise((resolve) => {
      if (this._reader) {
        this._reader.cancel();
        this.addEventListener("disconnect", resolve, { once: true });
      }
    });
  }

  /**
   * This command will trigger at least one packet,
   * the Current State and if already provisioned,
   * the same response you would get if device provisioning
   * was successful (see below).
   */
  public async requestCurrentState() {
    // Request current state and wait for 5s
    let rpcResult: Promise<string[]> | undefined;

    try {
      await new Promise(async (resolve, reject) => {
        this.addEventListener("state-changed", resolve, { once: true });
        const cleanupAndReject = (err: Error) => {
          this.removeEventListener("state-changed", resolve);
          reject(err);
        };
        rpcResult = this._sendRPCWithResponse(
          ImprovSerialRPCCommand.REQUEST_CURRENT_STATE,
          new Uint8Array([])
        );
        rpcResult.catch(cleanupAndReject);
      });
    } catch (err) {
      this._rpcFeedback = undefined;
      throw new Error(`Error fetching current state: ${err}`);
    }

    // Only if we are provisioned will we get an rpc result
    if (this.state !== ImprovSerialCurrentState.PROVISIONED) {
      this._rpcFeedback = undefined;
      return;
    }

    const data = await rpcResult!;
    this.nextUrl = data[0];
  }

  public async provision(ssid: string, password: string) {
    const encoder = new TextEncoder();
    const ssidEncoded = encoder.encode(ssid);
    const pwEncoded = encoder.encode(password);
    const data = new Uint8Array([
      ssidEncoded.length,
      ...ssidEncoded,
      pwEncoded.length,
      ...pwEncoded,
    ]);
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.SEND_WIFI_SETTINGS,
      data
    );
    this.nextUrl = response[0];
  }

  // https://github.com/improv-wifi/sdk-js/blob/main/src/provision-dialog.ts#L360
  private _sendRPC(command: ImprovSerialRPCCommand, data: Uint8Array) {
    const payload = new Uint8Array([
      ...SERIAL_PACKET_HEADER,
      ImprovSerialMessageType.RPC,
      3 + data.length,
      command,
      data.length,
      ...data,
      0,
    ]);
    payload[payload.length - 1] =
      // Checksum is only over RPC data itself, not the header or message type
      payload
        .slice(SERIAL_PACKET_HEADER.length + 2)
        .reduce((sum, cur) => sum + cur, 0);
    this.writeToStream(payload);
  }

  private async _sendRPCWithResponse(
    command: ImprovSerialRPCCommand,
    data: Uint8Array
  ) {
    // Commands that receive feedback will finish when either
    // the state changes or the error code becomes not 0.
    if (this._rpcFeedback) {
      throw new Error(
        "Only 1 RPC command that requires feedback can be active"
      );
    }

    return await new Promise<string[]>((resolve, reject) => {
      this._rpcFeedback = { command, resolve, reject };
      this._sendRPC(command, data);
    });
  }

  private async _processInput() {
    // read the data from serial port.
    // current state, error state, rpc result
    this.logger.debug("Starting read loop");

    this._reader = this.port.readable!.getReader();

    try {
      for await (const line of iterateReadableStream(this._reader)) {
        if (
          line.length < 6 ||
          String.fromCharCode(...line.slice(0, 6)) !== "IMPROV"
        ) {
          // console.debug("Ignoring line", String.fromCharCode(...line));
          continue;
        }

        const payload = line.slice(6);
        const version = payload[0];
        const packetType = payload[1];
        const packetLength = payload[2];
        const data = payload.slice(3, 3 + packetLength);

        this.logger.debug("PROCESS", {
          version,
          packetType,
          packetLength,
          data: hexFormatter(data),
        });

        if (version !== 1) {
          this.logger.error("Received unsupported version", version);
          continue;
        }

        // RPC/Result have their own checksum that is just for their data
        let checksum: number;
        let checksumStart: number;
        if (
          packetType === ImprovSerialMessageType.RPC ||
          packetType === ImprovSerialMessageType.RPC_RESULT
        ) {
          checksum = data[data.length - 1];
          checksumStart = SERIAL_PACKET_HEADER.length + 2;
        } else {
          checksum = payload[3 + packetLength];
          checksumStart = 0;
        }
        let calculatedChecksum = 0;
        for (let i = checksumStart; i < line.length - 1; i++) {
          calculatedChecksum += line[i];
        }
        calculatedChecksum = calculatedChecksum % 256;
        if (calculatedChecksum !== checksum) {
          this.logger.error(
            `Received invalid checksum ${checksum}. Expected ${calculatedChecksum}`
          );
          continue;
        }

        if (packetType === ImprovSerialMessageType.CURRENT_STATE) {
          this.state = data[0];
          this.dispatchEvent(
            new CustomEvent("state-changed", {
              detail: this.state,
            })
          );
        } else if (packetType === ImprovSerialMessageType.ERROR_STATE) {
          this.error = data[0];
          if (data[0] > 0 && this._rpcFeedback) {
            this._rpcFeedback.reject(
              ERROR_MSGS[data[0]] || `UNKNOWN_ERROR (${data[0]})`
            );
            this._rpcFeedback = undefined;
          }
          this.dispatchEvent(
            new CustomEvent("error-changed", {
              detail: this.error,
            })
          );
        } else if (packetType === ImprovSerialMessageType.RPC_RESULT) {
          if (!this._rpcFeedback) {
            this.logger.error("Received result while not waiting for one");
            continue;
          }
          const rpcCommand = data[0];

          if (rpcCommand !== this._rpcFeedback.command) {
            this.logger.error(
              `Received result for command ${rpcCommand} but expected ${this._rpcFeedback.command}`
            );
            continue;
          }

          // Chop off rpc command and checksum
          const result: string[] = [];
          const totalLength = data[1];
          let idx = 2;
          while (idx < 2 + totalLength) {
            result.push(
              String.fromCodePoint(...data.slice(idx + 1, idx + data[idx] + 1))
            );
            idx += data[idx];
          }
          this._rpcFeedback.resolve(result);
          this._rpcFeedback = undefined;
        } else {
          this.logger.error("Unable to handle packet", payload);
        }
      }
    } catch (err) {
      this.logger.error("Error while reading serial port", err);
    } finally {
      this._reader.releaseLock();
      this._reader = undefined;
    }

    this.logger.debug("Finished read loop");
    this.dispatchEvent(new Event("disconnect"));
  }

  public async writeToStream(data: Uint8Array) {
    this.logger.debug("Writing to stream:", hexFormatter(new Array(...data)));
    const writer = this.port.writable!.getWriter();
    await writer.write(data);
    try {
      writer.releaseLock();
    } catch (err) {
      console.error("Ignoring release lock error", err);
    }
  }
}

(window as any).ImprovSerial = ImprovSerial;
