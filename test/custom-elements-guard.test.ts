import { describe, expect, it } from "vitest";

import { guardCustomElementsDefine } from "../src/util/custom-elements-guard";

const fakeRegistry = () => {
  const defined = new Map<string, unknown>();
  return {
    get: (name: string) => defined.get(name),
    define(name: string, ctor: unknown) {
      if (defined.has(name)) {
        throw new DOMException(
          `the name "${name}" has already been used with this registry`,
        );
      }
      defined.set(name, ctor);
    },
  } as unknown as CustomElementRegistry;
};

describe("guardCustomElementsDefine", () => {
  it("skips Material Web elements that are already defined", () => {
    const registry = fakeRegistry();
    guardCustomElementsDefine(registry);
    const first = class {} as unknown as CustomElementConstructor;
    registry.define("md-ripple", first);
    expect(() =>
      registry.define(
        "md-ripple",
        class {} as unknown as CustomElementConstructor,
      ),
    ).not.toThrow();
    expect(registry.get("md-ripple")).toBe(first);
  });

  it("still throws for other duplicate elements", () => {
    const registry = fakeRegistry();
    guardCustomElementsDefine(registry);
    const ctor = class {} as unknown as CustomElementConstructor;
    registry.define("other-element", ctor);
    expect(() => registry.define("other-element", ctor)).toThrow();
  });

  it("only patches a registry once", () => {
    const registry = fakeRegistry();
    guardCustomElementsDefine(registry);
    const patched = registry.define;
    guardCustomElementsDefine(registry);
    expect(registry.define).toBe(patched);
  });
});
