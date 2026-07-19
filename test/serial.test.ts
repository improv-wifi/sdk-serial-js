import { describe, it, expect } from "vitest";

import { ImprovSerial } from "../src/serial";
import { ImprovSerialCurrentState, ImprovSerialErrorState } from "../src/const";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The constructor only checks that the port is readable and writable; nothing
// else touches the port until we send, which the tests fake out below.
const fakePort = { readable: {}, writable: {} } as unknown as SerialPort;
const silentLogger = { log() {}, error() {}, debug() {} };

const newClient = () => new ImprovSerial(fakePort, silentLogger);

/**
 * Fake the wire so a single-response command resolves `result` shortly after it
 * is sent, mimicking a device that answers. `onSend` runs on every send, so a
 * test can count how many commands are in flight at once.
 */
const fakeDevice = (
  client: any,
  { result = ["ok"], delay = 20, onSend = () => {} }: any = {},
) => {
  client._sendRPC = () => {
    onSend();
    setTimeout(() => {
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

  it("marks network state unsupported on UNKNOWN_RPC_COMMAND and stops asking", async () => {
    const client: any = newClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
      setTimeout(
        () => client._setError(ImprovSerialErrorState.UNKNOWN_RPC_COMMAND),
        5,
      );
    };

    await expect(client.requestNetworkState()).rejects.toBeDefined();
    expect(client.networkState).toBeNull();

    // Polling an unsupported device must not put anything on the wire.
    client.startNetworkStatePolling(20);
    await sleep(80);
    expect(sends).toBe(1);
  });

  it("polls the network state until stopped", async () => {
    const client: any = newClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
      setTimeout(() => {
        const fb = client._rpcFeedback;
        if (!fb) return;
        fb.resolve(["2"]);
        client._rpcFeedback = undefined;
      }, 5);
    };

    client.startNetworkStatePolling(20);
    client.startNetworkStatePolling(20); // idempotent: must not start a second loop
    await sleep(120);
    expect(sends).toBeGreaterThanOrEqual(3);
    expect(client.networkState?.supportsWifi).toBe(true);

    client.stopNetworkStatePolling();
    await sleep(40); // let an in-flight tick settle
    const sendsAfterStop = sends;
    await sleep(100); // a leaked second loop would keep sending here
    expect(sends).toBe(sendsAfterStop);
  });

  it("stops network state polling on close", async () => {
    const client: any = newClient();
    let sends = 0;
    client._sendRPC = () => {
      sends++;
      setTimeout(() => {
        const fb = client._rpcFeedback;
        if (!fb) return;
        fb.resolve(["2"]);
        client._rpcFeedback = undefined;
      }, 5);
    };

    client.startNetworkStatePolling(20);
    await sleep(60);
    await client.close(); // no reader: returns right after stopping the poll
    await sleep(40);
    const sendsAfterClose = sends;
    await sleep(100);
    expect(sends).toBe(sendsAfterClose);
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
