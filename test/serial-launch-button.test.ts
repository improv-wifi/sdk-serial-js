// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SerialLaunchButton as SerialLaunchButtonType } from "../src/serial-launch-button";

let SerialLaunchButton: typeof SerialLaunchButtonType;

beforeAll(async () => {
  // happy-dom has no Web Serial and reports an insecure context. Mark the
  // context secure before the module evaluates its static support checks, so
  // the "unsupported" path is reached through real detection.
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  ({ SerialLaunchButton } = await import("../src/serial-launch-button"));
});

const render = () => {
  const el = document.createElement(
    "improv-wifi-serial-launch-button",
  ) as SerialLaunchButtonType;
  document.body.append(el);
  return el;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SerialLaunchButton", () => {
  it("recommends supported browsers when Web Serial is unavailable", () => {
    expect("serial" in navigator).toBe(false);
    expect(SerialLaunchButton.isSupported).toBe(false);

    const el = render();

    expect(el.hasAttribute("not-supported")).toBe(true);
    const slot = el.shadowRoot!.querySelector("slot")!;
    expect(slot.name).toBe("unsupported");
    expect(slot.textContent).toBe(
      "Your browser does not support serial provisioning. Use Google Chrome, Microsoft Edge or Mozilla Firefox.",
    );
  });

  it("renders the activate slot when Web Serial is available", () => {
    const original = SerialLaunchButton.isSupported;
    SerialLaunchButton.isSupported = true;
    try {
      const el = render();

      expect(el.hasAttribute("supported")).toBe(true);
      const slot = el.shadowRoot!.querySelector("slot")!;
      expect(slot.name).toBe("activate");
      expect(slot.querySelector("button")).not.toBeNull();
    } finally {
      SerialLaunchButton.isSupported = original;
    }
  });

  it("defaults the baud rate to 115200", () => {
    const el = render();
    expect(el.baudRate).toBe(115200);
  });

  it("reads the baud rate from the baudRate attribute", () => {
    const el = render();
    el.setAttribute("baudRate", "921600");
    expect(el.baudRate).toBe(921600);

    el.baudRate = 460800;
    expect(el.getAttribute("baudrate")).toBe("460800");
    expect(el.baudRate).toBe(460800);
  });

  it("falls back to the default baud rate for invalid values", () => {
    const el = render();
    for (const value of ["", "abc", "0", "-9600", "1.5"]) {
      el.setAttribute("baudRate", value);
      expect(el.baudRate).toBe(115200);
    }
  });
});
