// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const PATCHED = Symbol.for("improv-wifi-serial-sdk.define-guard");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("custom element registration", () => {
  // Runs first, before the real registry has been patched by any import.
  it("skips installing the guard when customElements is undefined", async () => {
    const registry = window.customElements;
    vi.stubGlobal("customElements", undefined);

    await expect(
      import("../src/util/custom-elements-guard"),
    ).resolves.toBeDefined();
    expect(PATCHED in registry).toBe(false);
  });

  it("installs the guard on the global registry when imported", async () => {
    await import("../src/util/custom-elements-guard");

    expect(PATCHED in customElements).toBe(true);
    const first = class extends HTMLElement {};
    customElements.define("md-guard-test", first);
    expect(() =>
      customElements.define("md-guard-test", class extends HTMLElement {}),
    ).not.toThrow();
    expect(customElements.get("md-guard-test")).toBe(first);
  });

  it("does not throw when the launch button module loads twice", async () => {
    await import("../src/serial-launch-button");
    const first = customElements.get("improv-wifi-serial-launch-button");
    expect(first).toBeDefined();

    vi.resetModules();
    await expect(import("../src/serial-launch-button")).resolves.toBeDefined();
    expect(customElements.get("improv-wifi-serial-launch-button")).toBe(first);
  });

  it("does not throw when Material Web is already defined or the dialog loads twice", async () => {
    // Simulate another bundle (e.g. ESP Web Tools) registering Material Web.
    const ripple = class extends HTMLElement {};
    customElements.define("md-ripple", ripple);

    await import("../src/serial-provision-dialog");
    const first = customElements.get("improv-wifi-serial-provision-dialog");
    expect(first).toBeDefined();
    expect(customElements.get("md-ripple")).toBe(ripple);

    vi.resetModules();
    await expect(
      import("../src/serial-provision-dialog"),
    ).resolves.toBeDefined();
    expect(customElements.get("improv-wifi-serial-provision-dialog")).toBe(
      first,
    );
  });
});
