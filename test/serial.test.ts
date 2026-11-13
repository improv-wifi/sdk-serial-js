import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImprovSerial } from "../src/serial";
import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  ImprovSerialRPCCommand,
} from "../src/const";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The constructor only checks that the port is readable and writable; nothing
// else touches the port until we send, which the tests fake out below.
const fakePort = { readable: {}, writable: {} } as unknown as SerialPort;
const silentLogger = { log() {}, error() {}, debug() {} };

const newClient = () => new ImprovSerial(fakePort, silentLogger);

/**
 * Fake the wire so a single-response command resolves `result` shortly after it
 * is sent, mimicking a device that answers. `onSend` runs on every send, so a
 * test can count how many commands are in flight at once. With `state`, a state
 * request is answered like an unprovisioned device does: a state change only.
 */
const fakeDevice = (
  client: any,
  { result = ["ok"], delay = 20, onSend = () => {}, state }: any = {},
) => {
  client._sendRPC = (command: ImprovSerialRPCCommand) => {
    onSend();
    setTimeout(() => {
      if (
        state !== undefined &&
        command === ImprovSerialRPCCommand.REQUEST_CURRENT_STATE
      ) {
        client.state = state;
        client.dispatchEvent(
          new CustomEvent("state-changed", { detail: state }),
        );
        return;
      }
      const fb = client._rpcFeedback;
      if (!fb) return;
      "receivedData" in fb ? fb.resolve(fb.receivedData) : fb.resolve(result);
      client._rpcFeedback = undefined;
    }, delay);
  };
};

describe("ImprovSerial RPC serialization", () => {
  it("never puts two scans on the wire when a subscription restarts", async () => {
    // Reproduces the Wi-Fi picker bug: leaving and immediately re-opening the
    // network form used to send a scan while the previous one was still
    // settling, throwing "Only 1 RPC command that requires feedback can be
    // active" and dropping the picker to "Join other".
    const client: any = newClient();
    let inFlight = 0;
    let maxInFlight = 0;
    client._sendRPC = () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        const fb = client._rpcFeedback;
        if (fb && "receivedData" in fb) {
          fb.resolve([["Home", "-55", "YES"]]);
          client._rpcFeedback = undefined;
        }
        inFlight--;
      }, 50);
    };

    let sawNull = false;
    const unsubA = client.subscribeSSIDs(() => {});
    await sleep(10);
    unsubA(); // not awaited — exactly what the dialog does when leaving the form
    const unsubB = client.subscribeSSIDs((ssids: unknown) => {
      if (ssids === null) sawNull = true;
    });
    await sleep(200);
    await unsubB();

    expect(maxInFlight).toBe(1);
    expect(sawNull).toBe(false); // restart got real networks, not "can't scan"
  });

  it("serializes concurrent commands instead of throwing", async () => {
    const client: any = newClient();
    let concurrent = 0;
    let maxConcurrent = 0;
    fakeDevice(client, {
      onSend: () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        setTimeout(() => concurrent--, 20);
      },
    });

    const results = await Promise.allSettled([
      client._sendRPCWithResponse(1, []),
      client._sendRPCWithResponse(2, []),
      client._sendRPCWithResponse(3, []),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(maxConcurrent).toBe(1);
  });

  it("times a dead command out without wedging the queue", async () => {
    const client: any = newClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
      if (sends === 1) return; // first command: device never answers
      setTimeout(() => {
        const fb = client._rpcFeedback;
        if (fb) {
          fb.resolve(["ok"]);
          client._rpcFeedback = undefined;
        }
      }, 10);
    };

    const first = client._sendRPCWithResponse(1, [], 80);
    const second = client._sendRPCWithResponse(2, [], 500);

    await expect(first).rejects.toBeDefined();
    await expect(second).resolves.toEqual(["ok"]); // queue released after timeout
  });

  it("resolves requestCurrentState for an unprovisioned device and releases the lock", async () => {
    const client: any = newClient();
    // An unprovisioned device (READY) only fires a state change and sends no
    // RPC result; requestCurrentState settles the pending command itself.
    client._sendRPC = () => {
      setTimeout(() => {
        client.state = ImprovSerialCurrentState.READY;
        client.dispatchEvent(
          new CustomEvent("state-changed", { detail: client.state }),
        );
      }, 10);
    };

    await expect(client.requestCurrentState()).resolves.toBeUndefined();
    expect(client._rpcFeedback).toBeUndefined();

    // A command queued right after must still run: the lock was released.
    fakeDevice(client, { result: ["v"] });
    await expect(client._sendRPCWithResponse(9, [], 500)).resolves.toEqual([
      "v",
    ]);
  });

  it("reads the next URL from requestCurrentState when provisioned", async () => {
    const client: any = newClient();
    // A provisioned device fires a state change and returns an RPC result.
    client._sendRPC = () => {
      setTimeout(() => {
        client.state = ImprovSerialCurrentState.PROVISIONED;
        client.dispatchEvent(
          new CustomEvent("state-changed", { detail: client.state }),
        );
        client._rpcFeedback?.resolve(["http://device.local"]);
      }, 10);
    };

    await client.requestCurrentState();
    expect(client.nextUrl).toBe("http://device.local");
    expect(client._rpcFeedback).toBeUndefined();
  });

  it("throws from requestCurrentState when the command errors", async () => {
    const client: any = newClient();
    // Device rejects the command (e.g. unable to connect) before any state
    // change; _setError rejects the pending RPC.
    client._sendRPC = () => {
      setTimeout(
        () => client._setError(ImprovSerialErrorState.UNABLE_TO_CONNECT),
        10,
      );
    };

    await expect(client.requestCurrentState()).rejects.toThrow(
      "Error fetching current state",
    );
    expect(client._rpcFeedback).toBeUndefined();
  });

  it("decodes the network state flags and URLs", async () => {
    const client: any = newClient();
    // Spec example: flags 7 (online + Wi-Fi + Ethernet) followed by the URL.
    fakeDevice(client, { result: ["7", "http://192.168.1.10"] });

    await expect(client.requestNetworkState()).resolves.toEqual({
      online: true,
      supportsWifi: true,
      supportsEthernet: true,
      supportsThread: false,
      supportsModem: false,
      urls: ["http://192.168.1.10"],
    });
  });

  it("times requestCurrentState out with the caller's timeout", async () => {
    const client: any = newClient();
    // Device never answers (e.g. it is rebooting to switch network
    // interfaces). Without the forwarded timeout this would sit out the 30s
    // default and blow the test timeout.
    client._sendRPC = () => {};

    await expect(client.requestCurrentState(50)).rejects.toThrow(
      "Error fetching current state",
    );
    expect(client._rpcFeedback).toBeUndefined();
  });

  it("doesn't settle another in-flight command on a state change", async () => {
    const client: any = newClient();
    const sent: number[] = [];
    // Only answers requestCurrentState, with a READY state change.
    client._sendRPC = (command: number) => {
      sent.push(command);
      if (command !== 2) return;
      setTimeout(() => {
        client.state = ImprovSerialCurrentState.READY;
        client.dispatchEvent(
          new CustomEvent("state-changed", { detail: client.state }),
        );
      }, 10);
    };

    const other = client._sendRPCWithResponse(3, [], 100);
    await sleep(10);
    const currentState = client.requestCurrentState(1000);
    await sleep(10);
    // Unsolicited state change while the other command is in flight.
    client.state = ImprovSerialCurrentState.READY;
    client.dispatchEvent(
      new CustomEvent("state-changed", { detail: client.state }),
    );

    await expect(other).rejects.toBeDefined(); // times out, not resolved with []
    await expect(currentState).resolves.toBeUndefined();
    expect(sent).toEqual([3, 2]);
    expect(client._rpcFeedback).toBeUndefined();
    expect(client.error).toBe(ImprovSerialErrorState.TIMEOUT); // from `other` only
  });

  it("clears nextUrl when the device leaves the provisioned state", async () => {
    const client: any = newClient();
    client.state = ImprovSerialCurrentState.PROVISIONED;
    client.nextUrl = "http://192.168.1.5";

    // I M P R O V <VERSION> <TYPE> <LENGTH> <DATA> <CHECKSUM>
    const currentStatePacket = (state: number) => {
      const line = [
        ..."IMPROV".split("").map((c) => c.charCodeAt(0)),
        1, // version
        1, // CURRENT_STATE
        1, // length
        state,
      ];
      line.push(line.reduce((sum, b) => sum + b, 0) & 0xff);
      return line;
    };

    // Device reboots onto Ethernet with Wi-Fi disabled: provisioning stops
    // and the old Wi-Fi URL is no longer valid.
    client._handleIncomingPacket(
      currentStatePacket(ImprovSerialCurrentState.STOPPED),
    );
    expect(client.state).toBe(ImprovSerialCurrentState.STOPPED);
    expect(client.nextUrl).toBeUndefined();

    // Staying provisioned keeps it.
    client.state = ImprovSerialCurrentState.PROVISIONED;
    client.nextUrl = "http://192.168.1.5";
    client._handleIncomingPacket(
      currentStatePacket(ImprovSerialCurrentState.PROVISIONED),
    );
    expect(client.nextUrl).toBe("http://192.168.1.5");
  });

  it("stores the network state and dispatches network-state-changed only on change", async () => {
    const client: any = newClient();
    let result = ["6"]; // Wi-Fi + Ethernet, offline
    client._sendRPC = () => {
      setTimeout(() => {
        const fb = client._rpcFeedback;
        if (!fb) return;
        fb.resolve(result);
        client._rpcFeedback = undefined;
      }, 5);
    };
    const events: any[] = [];
    client.addEventListener("network-state-changed", (ev: CustomEvent) =>
      events.push(ev.detail),
    );

    await client.requestNetworkState();
    expect(client.networkState).toEqual({
      online: false,
      supportsWifi: true,
      supportsEthernet: true,
      supportsThread: false,
      supportsModem: false,
      urls: [],
    });

    await client.requestNetworkState(); // same answer: no new event

    result = ["7", "http://192.168.1.10"]; // device came online
    await client.requestNetworkState();

    expect(events.length).toBe(2);
    expect(events[1].online).toBe(true);
    expect(events[1].urls).toEqual(["http://192.168.1.10"]);
  });

  it("classifies UNKNOWN_RPC_COMMAND even when a later error overwrites client.error", async () => {
    const client: any = newClient();
    client._sendRPC = () => {
      setTimeout(() => {
        client._setError(ImprovSerialErrorState.UNKNOWN_RPC_COMMAND);
        // Lands before the rejection's catch (a microtask) can read it.
        client.error = ImprovSerialErrorState.TIMEOUT;
      }, 5);
    };

    await expect(client.requestNetworkState()).rejects.toBeDefined();
    expect(client.networkState).toBeNull();
  });

  it("catches a state change fired synchronously on send", async () => {
    const client: any = newClient();
    // An instant device that answers the moment the request goes out: the
    // listener must already be attached, or we'd miss the state change.
    client._sendRPC = () => {
      client.state = ImprovSerialCurrentState.READY;
      client.dispatchEvent(
        new CustomEvent("state-changed", { detail: client.state }),
      );
    };

    await expect(client.requestCurrentState()).resolves.toBeUndefined();
  });
});

describe("ImprovSerial network state polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Polling only starts while the read loop runs. Cancelling the fake reader
  // ends it the way a real reader does: with a disconnect.
  const pollingClient = () => {
    const client: any = newClient();
    client._reader = {
      cancel: () =>
        setTimeout(() => client.dispatchEvent(new Event("disconnect"))),
    };
    return client;
  };

  it("polls until stopped", async () => {
    const client = pollingClient();
    let sends = 0;
    fakeDevice(client, {
      result: ["2"],
      delay: 5,
      onSend: () => sends++,
      state: ImprovSerialCurrentState.READY,
    });

    client.startNetworkStatePolling(20);
    client.startNetworkStatePolling(20); // idempotent: must not start a second loop
    // Polls at 0, 30, 60 and 90ms: two answers of 5ms each, then 20ms of sleep.
    await vi.advanceTimersByTimeAsync(110);
    expect(sends).toBe(8);
    expect(client.networkState?.supportsWifi).toBe(true);

    client.stopNetworkStatePolling();
    await vi.advanceTimersByTimeAsync(200);
    expect(sends).toBe(8);
  });

  it("picks up a Wi-Fi state the device never announced", async () => {
    const client = pollingClient();
    client.state = ImprovSerialCurrentState.STOPPED;
    fakeDevice(client, {
      result: ["2"],
      delay: 5,
      state: ImprovSerialCurrentState.READY,
    });

    client.startNetworkStatePolling(20);
    await vi.advanceTimersByTimeAsync(15);
    client.stopNetworkStatePolling();

    expect(client.state).toBe(ImprovSerialCurrentState.READY);
  });

  it("keeps a single poll loop across a stop and start during an in-flight poll", async () => {
    const client = pollingClient();
    let sends = 0;
    fakeDevice(client, {
      result: ["2"],
      delay: 20,
      onSend: () => sends++,
      state: ImprovSerialCurrentState.READY,
    });

    client.startNetworkStatePolling(50);
    await vi.advanceTimersByTimeAsync(10); // first poll is now in flight
    client.stopNetworkStatePolling();
    client.startNetworkStatePolling(50);

    // After the first request at 0ms, the new loop queues behind it and sends
    // two requests per poll at 20, 110 and 200ms. A leaked old loop would add more.
    await vi.advanceTimersByTimeAsync(250);
    expect(sends).toBe(7);
  });

  it("does not poll a device that reports the command unsupported", async () => {
    const client = pollingClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
      setTimeout(
        () => client._setError(ImprovSerialErrorState.UNKNOWN_RPC_COMMAND),
        5,
      );
    };
    const states: unknown[] = [];
    client.addEventListener("network-state-changed", (ev: CustomEvent) =>
      states.push(ev.detail),
    );

    client.startNetworkStatePolling(20);
    await vi.advanceTimersByTimeAsync(100);
    expect(client.networkState).toBeNull();
    expect(sends).toBe(1);

    client.stopNetworkStatePolling();
    client.startNetworkStatePolling(20);
    await vi.advanceTimersByTimeAsync(100);
    expect(sends).toBe(1);
    expect(states).toEqual([null]);
    expect(client._stopNetworkStatePolling).toBeUndefined(); // no stale handle
  });

  it("does not absorb a queued command's error after a quiet poll", async () => {
    const client = pollingClient();
    client._sendRPC = (command: ImprovSerialRPCCommand) => {
      setTimeout(() => {
        if (command === ImprovSerialRPCCommand.REQUEST_NETWORK_STATE) {
          const fb = client._rpcFeedback;
          if (!fb) return;
          fb.resolve(["2"]);
          client._rpcFeedback = undefined;
        } else {
          client._setError(ImprovSerialErrorState.UNABLE_TO_CONNECT);
        }
      }, 5);
    };
    const errors: ImprovSerialErrorState[] = [];
    client.addEventListener("error-changed", (ev: CustomEvent) =>
      errors.push(ev.detail),
    );

    client.startNetworkStatePolling(50);
    const scan = client.scan(100); // queued behind the in-flight quiet poll
    const rejected = expect(scan).rejects.toBe("UNABLE_TO_CONNECT");
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    client.stopNetworkStatePolling();

    expect(client.error).toBe(ImprovSerialErrorState.UNABLE_TO_CONNECT);
    expect(errors).toEqual([ImprovSerialErrorState.UNABLE_TO_CONNECT]);
  });

  it("leaves error untouched when a poll fails", async () => {
    const client = pollingClient();
    client._sendRPC = () => {}; // a busy device that never answers
    const errors: ImprovSerialErrorState[] = [];
    client.addEventListener("error-changed", (ev: CustomEvent) =>
      errors.push(ev.detail),
    );

    client.startNetworkStatePolling(20, 10);
    await vi.advanceTimersByTimeAsync(100);
    client.stopNetworkStatePolling();

    expect(client.error).toBe(ImprovSerialErrorState.NO_ERROR);
    expect(errors).toEqual([]);
    expect(client.networkState).toBeUndefined();
  });

  it("leaves error untouched when the Wi-Fi state poll fails", async () => {
    const client = pollingClient();
    client._sendRPC = (command: ImprovSerialRPCCommand) => {
      if (command === ImprovSerialRPCCommand.REQUEST_NETWORK_STATE) {
        setTimeout(() => client._rpcFeedback?.resolve(["2"]), 5);
      }
    };
    const errors: ImprovSerialErrorState[] = [];
    client.addEventListener("error-changed", (ev: CustomEvent) =>
      errors.push(ev.detail),
    );

    client.startNetworkStatePolling(20, 10);
    await vi.advanceTimersByTimeAsync(100);
    client.stopNetworkStatePolling();

    expect(client.error).toBe(ImprovSerialErrorState.NO_ERROR);
    expect(errors).toEqual([]);
    expect(client.networkState?.supportsWifi).toBe(true);
  });

  it("still reports a failed direct request in error", async () => {
    const client: any = newClient();
    client._sendRPC = () => {};

    const request = client.requestNetworkState(10);
    const rejected = expect(request).rejects.toBe("TIMEOUT");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(client.error).toBe(ImprovSerialErrorState.TIMEOUT);
  });

  it("does not start without a read loop", async () => {
    const client: any = newClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
    };

    client.startNetworkStatePolling(20);
    await vi.advanceTimersByTimeAsync(100);
    expect(sends).toBe(0);
  });

  it("stops on close", async () => {
    const client = pollingClient();
    let sends = 0;
    fakeDevice(client, {
      result: ["2"],
      delay: 5,
      onSend: () => sends++,
      state: ImprovSerialCurrentState.READY,
    });

    client.startNetworkStatePolling(20);
    await vi.advanceTimersByTimeAsync(60);
    const closed = client.close();
    await vi.advanceTimersByTimeAsync(0);
    await closed;
    const sendsAtClose = sends;
    await vi.advanceTimersByTimeAsync(200);
    expect(sends).toBe(sendsAtClose);
  });
});
