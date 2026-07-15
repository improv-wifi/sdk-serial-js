import { describe, it, expect, vi } from "vitest";

import { ImprovSerial } from "../src/serial";
import { ImprovSerialCurrentState } from "../src/const";

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

  it("keeps requestCurrentState working and releases the lock after it", async () => {
    const client: any = newClient();
    // Device reports it is not provisioned (READY); requestCurrentState then
    // resolves itself, since an unprovisioned device sends no RPC result.
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
});
