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
