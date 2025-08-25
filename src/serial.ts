import {
  ERROR_MSGS,
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  ImprovSerialMessageType,
  ImprovSerialRPCCommand,
  Logger,
  PortNotReady,
  SERIAL_PACKET_HEADER,
} from "./const.js";
import { sleep } from "./util/sleep";
import { hexFormatter } from "./util/hex-formatter";

interface FeedbackBase {
  command: ImprovSerialRPCCommand;
  reject: (err: string) => void;
}

interface FeedbackSinglePacket extends FeedbackBase {
  resolve: (data: string[]) => void;
}

interface FeedbackMultiplePackets extends FeedbackBase {
  resolve: (data: string[][]) => void;
  receivedData: string[][];
}

export interface Ssid {
  name: string;
  rssi: number;
  secured: boolean;
}

export class ImprovSerial extends EventTarget {
  public info?: {
    name: string;
    firmware: string;
    version: string;
    chipFamily: string;
  };

  public nextUrl: string | undefined;

  public state?: ImprovSerialCurrentState | undefined;

  public error = ImprovSerialErrorState.NO_ERROR;

  private _reader?: ReadableStreamReader<Uint8Array>;

  private _rpcFeedback?: FeedbackSinglePacket | FeedbackMultiplePackets;

  constructor(public port: SerialPort, public logger: Logger) {
    super();
    if (port.readable === null) {
      throw new Error("Port is not readable");
    }
    if (port.writable === null) {
      throw new Error("Port is not writable");
    }
  }

  /**
   * Detect Improv Serial, fetch the state and return the next URL if provisioned.
   * @param timeout Timeout in ms to wait for the device to respond. Default to 1000ms.
   */
  public async initialize(timeout = 1000): Promise<this["info"]> {
    this.logger.log("Initializing Improv Serial");
    this._processInput();
    // To give the input processing time to start.
    await sleep(1000);
    if (this._reader === undefined) {
      throw new PortNotReady();
    }
    try {
      await new Promise(async (resolve, reject) => {
        setTimeout(
          () => reject(new Error("Improv Wi-Fi Serial not detected")),
          timeout
        );
        await this.requestCurrentState();
        resolve(undefined);
      });
      await this.requestInfo();
    } catch (err) {
      await this.close();
      throw err;
    }
    return this.info!;
  }

  public async close() {
    if (!this._reader) {
      return;
    }
    await new Promise((resolve) => {
      this._reader!.cancel();
      this.addEventListener("disconnect", resolve, { once: true });
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
          []
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

  public async requestInfo(timeout?: number) {
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.REQUEST_INFO,
      [],
      timeout
    );
    this.info = {
      firmware: response[0],
      version: response[1],
      name: response[3],
      chipFamily: response[2],
    };
  }

  public async provision(ssid: string, password: string, timeout?: number) {
    const encoder = new TextEncoder();
    const ssidEncoded = encoder.encode(ssid);
    const pwEncoded = encoder.encode(password);
    const data = [
      ssidEncoded.length,
      ...ssidEncoded,
      pwEncoded.length,
      ...pwEncoded,
    ];
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.SEND_WIFI_SETTINGS,
      data,
      timeout
    );
    this.nextUrl = response[0];
  }

  public async scan(): Promise<Ssid[]> {
    const results = await this._sendRPCWithMultipleResponses(
      ImprovSerialRPCCommand.REQUEST_WIFI_NETWORKS,
      []
    );
    const ssids = results.map(([name, rssi, secured]) => ({
      name,
      rssi: parseInt(rssi),
      secured: secured === "YES",
    }));
    ssids.sort((a, b) =>
      a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase())
    );
    return ssids;
  }

  private _sendRPC(command: ImprovSerialRPCCommand, data: number[]) {
    this.writePacketToStream(ImprovSerialMessageType.RPC, [
      command,
      data.length,
      ...data,
    ]);
  }

  private async _sendRPCWithResponse(
    command: ImprovSerialRPCCommand,
    data: number[],
    timeout?: number
  ) {
    // Commands that receive feedback will finish when either
    // the state changes or the error code becomes not 0.
    if (this._rpcFeedback) {
      throw new Error(
        "Only 1 RPC command that requires feedback can be active"
      );
    }

    return await this._awaitRPCResultWithTimeout(
      new Promise<string[]>((resolve, reject) => {
        this._rpcFeedback = { command, resolve, reject };
        this._sendRPC(command, data);
      }),
      timeout
    );
  }

  private async _sendRPCWithMultipleResponses(
    command: ImprovSerialRPCCommand,
    data: number[],
    timeout?: number
  ) {
    // Commands that receive multiple feedbacks will finish when either
    // the state changes or the error code becomes not 0.
    if (this._rpcFeedback) {
      throw new Error(
        "Only 1 RPC command that requires feedback can be active"
      );
    }

    return await this._awaitRPCResultWithTimeout(
      new Promise<string[][]>((resolve, reject) => {
        this._rpcFeedback = {
          command,
          resolve,
          reject,
          receivedData: [],
        };
        this._sendRPC(command, data);
      }),
      timeout
    );
  }

  private async _awaitRPCResultWithTimeout<T>(
    sendRPCPromise: Promise<T>,
    timeout?: number
  ) {
    if (!timeout) {
      return await sendRPCPromise;
    }

    return await new Promise<T>((resolve, reject) => {
      const timeoutRPC = setTimeout(
        () => this._setError(ImprovSerialErrorState.TIMEOUT),
        timeout
      );
      sendRPCPromise.finally(() => clearTimeout(timeoutRPC));
      sendRPCPromise.then(resolve, reject);
    });
  }

  private async _processInput() {
    // read the data from serial port.
    // current state, error state, rpc result
    this.logger.debug("Starting read loop");

    this._reader = this.port.readable!.getReader();

    try {
      let line: number[] = [];
      // undefined = not sure if improv packet
      let isImprov: boolean | undefined;
      // length of improv bytes that we expect
      let improvLength = 0;

      while (true) {
        const { value, done } = await this._reader.read();
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }
        for (const byte of value) {
          if (isImprov === false) {
            // When it wasn't an improv line, discard everything unti we find new line char
            if (byte === 10) {
              isImprov = undefined;
            }
            continue;
          }

          if (isImprov === true) {
            line.push(byte);
            if (line.length === improvLength) {
              this._handleIncomingPacket(line);
              isImprov = undefined;
              line = [];
            }
            continue;
          }

          if (byte === 10) {
            line = [];
            continue;
          }

          line.push(byte);

          if (line.length !== 9) {
            continue;
          }

          // Check if it's improv
          isImprov = String.fromCharCode(...line.slice(0, 6)) === "IMPROV";
          if (!isImprov) {
            line = [];
            continue;
          }
          // Format:
          // I M P R O V <VERSION> <TYPE> <LENGTH> <DATA> <CHECKSUM>
          // Once we have 9 bytes, we can check if it's an improv packet
          // and extract how much more we need to fetch.
          const packetLength = line[8];
          improvLength = 9 + packetLength + 1; // header + data length + checksum
        }
      }
    } catch (err) {
      this.logger.error("Error while reading serial port", err);
    } finally {
      this._reader!.releaseLock();
      this._reader = undefined;
    }

    this.logger.debug("Finished read loop");
    this.dispatchEvent(new Event("disconnect"));
  }

  private _handleIncomingPacket(line: number[]) {
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
      return;
    }

    // Verify checksum
    let packetChecksum = payload[3 + packetLength];
    let calculatedChecksum = 0;
    for (let i = 0; i < line.length - 1; i++) {
      calculatedChecksum += line[i];
    }
    calculatedChecksum = calculatedChecksum & 0xff;
    if (calculatedChecksum !== packetChecksum) {
      this.logger.error(
        `Received invalid checksum ${packetChecksum}. Expected ${calculatedChecksum}`
      );
      return;
    }

    if (packetType === ImprovSerialMessageType.CURRENT_STATE) {
      this.state = data[0];
      this.dispatchEvent(
        new CustomEvent("state-changed", {
          detail: this.state,
        })
      );
    } else if (packetType === ImprovSerialMessageType.ERROR_STATE) {
      this._setError(data[0]);
    } else if (packetType === ImprovSerialMessageType.RPC_RESULT) {
      if (!this._rpcFeedback) {
        this.logger.error("Received result while not waiting for one");
        return;
      }
      const rpcCommand = data[0];

      if (rpcCommand !== this._rpcFeedback.command) {
        this.logger.error(
          `Received result for command ${rpcCommand} but expected ${this._rpcFeedback.command}`
        );
        return;
      }

      // Chop off rpc command and checksum
      const result: string[] = [];
      const totalLength = data[1];
      const decoder = new TextDecoder("utf-8");
      let idx = 2;
      while (idx < 2 + totalLength) {
        result.push(decoder.decode(new Uint8Array(data.slice(idx + 1, idx + data[idx] + 1))));
        idx += data[idx] + 1;
      }
      if ("receivedData" in this._rpcFeedback) {
        if (result.length > 0) {
          this._rpcFeedback.receivedData.push(result);
        } else {
          // Result of 0 means we're done.
          this._rpcFeedback.resolve(this._rpcFeedback.receivedData);
          this._rpcFeedback = undefined;
        }
      } else {
        this._rpcFeedback.resolve(result);
        this._rpcFeedback = undefined;
      }
    } else {
      this.logger.error("Unable to handle packet", payload);
    }
  }

  /**
   * Add header + checksum and write packet to stream
   */
  public async writePacketToStream(type: number, data: number[]) {
    const payload = new Uint8Array([
      ...SERIAL_PACKET_HEADER,
      type,
      data.length,
      ...data,
      0, // Will be checksum
      0, // Will be newline
    ]);
    // Calculate checksum
    payload[payload.length - 2] =
      payload.reduce((sum, cur) => sum + cur, 0) & 0xff;
    payload[payload.length - 1] = 10; // Newline

    this.logger.debug(
      "Writing to stream:",
      hexFormatter(new Array(...payload))
    );
    const writer = this.port.writable!.getWriter();
    await writer.write(payload);
    try {
      writer.releaseLock();
    } catch (err) {
      console.error("Ignoring release lock error", err);
    }
  }

  // Error is either received from device or is a timeout
  private _setError(error: ImprovSerialErrorState) {
    this.error = error;
    if (error > 0 && this._rpcFeedback) {
      this._rpcFeedback.reject(ERROR_MSGS[error] || `UNKNOWN_ERROR (${error})`);
      this._rpcFeedback = undefined;
    }
    this.dispatchEvent(
      new CustomEvent("error-changed", {
        detail: this.error,
      })
    );
  }
}
