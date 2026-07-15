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

const sortSsids = (ssids: Ssid[]): Ssid[] =>
  ssids.sort((a, b) =>
    a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
  );

/** Merge two scans, keyed by name (newest values win), sorted alphabetically. */
const mergeSsids = (previous: Ssid[], latest: Ssid[]): Ssid[] => {
  const byName = new Map<string, Ssid>();
  for (const ssid of previous) {
    byName.set(ssid.name, ssid);
  }
  for (const ssid of latest) {
    byName.set(ssid.name, ssid);
  }
  return sortSsids(Array.from(byName.values()));
};

/** Delay between Wi-Fi scans while subscribed. */
const SCAN_INTERVAL = 3000;

/**
 * Timeout for each scan while subscribed. Generous compared to a real scan
 * (a few seconds) so it only trips when the device stops responding, turning a
 * silent hang into an error the subscriber is told about.
 */
const SCAN_TIMEOUT = 30000;

/**
 * Default timeout for an RPC command that receives feedback. Generous, since
 * it's only a safety net: it guarantees every command eventually settles so the
 * command queue can't wedge on a device that stopped responding.
 */
const DEFAULT_RPC_TIMEOUT = 30000;

/** Whether two (alphabetically sorted) SSID lists differ in any value. */
const ssidsChanged = (a: Ssid[], b: Ssid[]): boolean => {
  if (a.length !== b.length) {
    return true;
  }
  return a.some(
    (ssid, i) =>
      ssid.name !== b[i].name ||
      ssid.rssi !== b[i].rssi ||
      ssid.secured !== b[i].secured,
  );
};

export class ImprovSerial extends EventTarget {
  public info?: {
    name: string;
    firmware: string;
    version: string;
    chipFamily: string;
    osName: string | null;
    osVersion: string | null;
  };

  public improvVersion: number | undefined;

  public nextUrl: string | undefined;

  public state?: ImprovSerialCurrentState | undefined;

  public error = ImprovSerialErrorState.NO_ERROR;

  private _reader?: ReadableStreamDefaultReader<Uint8Array>;

  private _rpcFeedback?: FeedbackSinglePacket | FeedbackMultiplePackets;

  // Improv devices handle one RPC command at a time, so commands are serialized
  // here: each waits for the previous to settle. Every command is bounded by a
  // timeout, so the queue can't wedge on an unresponsive device.
  private _rpcLock: Promise<unknown> = Promise.resolve();

  constructor(
    public port: SerialPort,
    public logger: Logger,
  ) {
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
    // Grabs the reader before its first await, so it is set (or failed to be
    // set) by the time this returns.
    this._processInput();
    if (this._reader === undefined) {
      throw new PortNotReady();
    }
    // The device might still be booting (e.g. right after being flashed) and
    // miss our request, so re-send it every second until it responds.
    let retryInterval: ReturnType<typeof setInterval> | undefined;
    try {
      await new Promise(async (resolve, reject) => {
        setTimeout(
          () => reject(new Error("Improv Wi-Fi Serial not detected")),
          timeout,
        );
        retryInterval = setInterval(
          () => this._sendRPC(ImprovSerialRPCCommand.REQUEST_CURRENT_STATE, []),
          1000,
        );
        await this.requestCurrentState();
        resolve(undefined);
      });
      clearInterval(retryInterval);
      await this.requestInfo();
    } catch (err) {
      await this.close();
      throw err;
    } finally {
      clearInterval(retryInterval);
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
    // Every device reports its state; a provisioned one also returns the next
    // URL. Attach the listener before sending, then wait for the state change;
    // the RPC promise is only used to surface a command error.
    const abort = new AbortController();
    let rpcResult: Promise<string[]>;
    try {
      await new Promise<void>((resolve, reject) => {
        this.addEventListener("state-changed", () => resolve(), {
          once: true,
          signal: abort.signal,
        });
        rpcResult = this._sendRPCWithResponse(
          ImprovSerialRPCCommand.REQUEST_CURRENT_STATE,
          [],
        );
        rpcResult.catch(reject);
      });
    } catch (err) {
      throw new Error(`Error fetching current state: ${err}`);
    } finally {
      abort.abort(); // drop the state-change listener if it never fired
    }

    // Only a provisioned device sends an RPC result. For anything else, settle
    // the pending command ourselves so it releases the lock now.
    if (this.state !== ImprovSerialCurrentState.PROVISIONED) {
      this._rpcFeedback?.resolve([]);
      return;
    }

    this.nextUrl = (await rpcResult!)[0];
  }

  public async requestInfo(timeout?: number) {
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.REQUEST_INFO,
      [],
      timeout,
    );
    this.info = {
      firmware: response[0],
      version: response[1],
      name: response[3],
      chipFamily: response[2],
      osName: response.length > 4 ? response[4] : null,
      osVersion: response.length > 5 ? response[5] : null,
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
      timeout,
    );
    this.nextUrl = response[0];
  }

  public async scan(timeout?: number): Promise<Ssid[]> {
    const results = await this._sendRPCWithMultipleResponses(
      ImprovSerialRPCCommand.REQUEST_WIFI_NETWORKS,
      [],
      timeout,
    );
    const ssids = results.map(([name, rssi, secured]) => ({
      name,
      rssi: parseInt(rssi),
      secured: secured !== "NO",
    }));
    return sortSsids(ssids);
  }

  /**
   * Continuously scan for Wi-Fi networks, calling `onChange` whenever the list
   * of networks changes.
   *
   * Results are merged with previous scans (networks are keyed by name and kept
   * sorted alphabetically), so a network missing from a single scan won't
   * immediately disappear. `onChange` is only called when a value in the list
   * actually changes.
   *
   * Scanning stops on the first error or when the returned function is called.
   * If the first scan fails (e.g. the device doesn't support scanning, or stops
   * responding), `onChange` is called once with `null` to signal that networks
   * are unavailable.
   *
   * The returned function resolves once the in-flight scan has settled, so it
   * can be awaited before sending another RPC command (such as provisioning).
   */
  public subscribeSSIDs(
    onChange: (ssids: Ssid[] | null) => void,
  ): () => Promise<void> {
    let active = true;
    let current: Ssid[] | undefined;
    let wake: (() => void) | undefined;

    const loop = (async () => {
      while (active) {
        let ssids: Ssid[];
        try {
          ssids = await this.scan(SCAN_TIMEOUT);
        } catch (err) {
          this.logger.error("Error while scanning for Wi-Fi networks", err);
          // Only signal unavailability if we never got a result. Once we have
          // networks, scanning is clearly supported, so keep the last list on a
          // transient failure. Either way, stop scanning.
          if (active && current === undefined) {
            onChange(null);
          }
          break;
        }
        if (!active) {
          break;
        }
        const merged =
          current === undefined ? ssids : mergeSsids(current, ssids);
        if (current === undefined || ssidsChanged(current, merged)) {
          current = merged;
          onChange(merged);
        }
        // Wait before the next scan, but wake immediately if unsubscribed.
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, SCAN_INTERVAL);
        });
      }
    })();

    return () => {
      active = false;
      wake?.();
      return loop;
    };
  }

  /**
   * Get the current hostname of the device.
   */
  public async getHostname(timeout?: number): Promise<string> {
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.HOSTNAME,
      [],
      timeout,
    );
    return response[0];
  }

  /**
   * Set the hostname of the device. Returns the hostname as set by the device.
   *
   * Hostnames need to conform to RFC 1123: letters, numbers and hyphens, up to
   * 255 characters. The device rejects other hostnames with a BAD_HOSTNAME error.
   */
  public async setHostname(
    hostname: string,
    timeout?: number,
  ): Promise<string> {
    const encoder = new TextEncoder();
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.HOSTNAME,
      [...encoder.encode(hostname)],
      timeout,
    );
    return response[0];
  }

  /**
   * Get the current device name. This is the same value as `info.name`.
   */
  public async getDeviceName(timeout?: number): Promise<string> {
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.DEVICE_NAME,
      [],
      timeout,
    );
    return response[0];
  }

  /**
   * Set the device name. Returns the device name as set by the device.
   *
   * When setting both the device name and the hostname, set the device name
   * first, as it can change the default hostname.
   */
  public async setDeviceName(
    deviceName: string,
    timeout?: number,
  ): Promise<string> {
    const encoder = new TextEncoder();
    const response = await this._sendRPCWithResponse(
      ImprovSerialRPCCommand.DEVICE_NAME,
      [...encoder.encode(deviceName)],
      timeout,
    );
    if (this.info) {
      this.info.name = response[0];
    }
    return response[0];
  }

  private _sendRPC(command: ImprovSerialRPCCommand, data: number[]) {
    this.writePacketToStream(ImprovSerialMessageType.RPC, [
      command,
      data.length,
      ...data,
    ]);
  }

  /**
   * Run an RPC command once the previous one has settled, so devices that
   * handle a single command at a time never see two at once. The chain is kept
   * alive regardless of each command's outcome.
   */
  private _enqueueRPC<T>(send: () => Promise<T>, timeout: number): Promise<T> {
    const run = () =>
      this._awaitRPCResultWithTimeout(send(), timeout).finally(() => {
        this._rpcFeedback = undefined;
      });
    const result = this._rpcLock.then(run, run);
    this._rpcLock = result.catch(() => {});
    return result;
  }

  private _sendRPCWithResponse(
    command: ImprovSerialRPCCommand,
    data: number[],
    timeout: number = DEFAULT_RPC_TIMEOUT,
  ): Promise<string[]> {
    return this._enqueueRPC(
      () =>
        new Promise<string[]>((resolve, reject) => {
          this._rpcFeedback = { command, resolve, reject };
          this._sendRPC(command, data);
        }),
      timeout,
    );
  }

  private _sendRPCWithMultipleResponses(
    command: ImprovSerialRPCCommand,
    data: number[],
    timeout: number = DEFAULT_RPC_TIMEOUT,
  ): Promise<string[][]> {
    return this._enqueueRPC(
      () =>
        new Promise<string[][]>((resolve, reject) => {
          this._rpcFeedback = { command, resolve, reject, receivedData: [] };
          this._sendRPC(command, data);
        }),
      timeout,
    );
  }

  private async _awaitRPCResultWithTimeout<T>(
    sendRPCPromise: Promise<T>,
    timeout?: number,
  ) {
    if (!timeout) {
      return await sendRPCPromise;
    }

    return await new Promise<T>((resolve, reject) => {
      const timeoutRPC = setTimeout(
        () => this._setError(ImprovSerialErrorState.TIMEOUT),
        timeout,
      );
      sendRPCPromise.then(resolve, reject).finally(() => {
        clearTimeout(timeoutRPC);
      });
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
        `Received invalid checksum ${packetChecksum}. Expected ${calculatedChecksum}`,
      );
      return;
    }

    if (packetType === ImprovSerialMessageType.CURRENT_STATE) {
      this.state = data[0];
      this.dispatchEvent(
        new CustomEvent("state-changed", {
          detail: this.state,
        }),
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
          `Received result for command ${rpcCommand} but expected ${this._rpcFeedback.command}`,
        );
        return;
      }

      // Chop off rpc command and checksum
      const result: string[] = [];
      const totalLength = data[1];
      const decoder = new TextDecoder("utf-8");
      let idx = 2;
      while (idx < 2 + totalLength) {
        result.push(
          decoder.decode(
            new Uint8Array(data.slice(idx + 1, idx + data[idx] + 1)),
          ),
        );
        idx += data[idx] + 1;
      }
      if ("receivedData" in this._rpcFeedback) {
        if (result.length > 0) {
          this._rpcFeedback.receivedData.push(result);
        } else {
          // Result of 0 means we're done.
          this._rpcFeedback.resolve(this._rpcFeedback.receivedData);
        }
      } else {
        this._rpcFeedback.resolve(result);
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
      hexFormatter(new Array(...payload)),
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
    }
    this.dispatchEvent(
      new CustomEvent("error-changed", {
        detail: this.error,
      }),
    );
  }
}
