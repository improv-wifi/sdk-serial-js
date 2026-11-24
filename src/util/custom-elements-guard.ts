const PATCHED = Symbol.for("improv-wifi-serial-sdk.define-guard");

type GuardedRegistry = CustomElementRegistry & { [PATCHED]?: true };

/**
 * Other libraries on the same page (e.g. ESP Web Tools) can bundle their own
 * copy of Material Web. Registering an element twice throws, so skip defining
 * Material Web elements that have already been registered by someone else.
 */
export const guardCustomElementsDefine = (registry: GuardedRegistry) => {
  if (registry[PATCHED]) {
    return;
  }
  const define = registry.define;
  registry.define = function (
    this: CustomElementRegistry,
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ) {
    if (name.startsWith("md-") && registry.get(name)) {
      return;
    }
    return define.call(this, name, constructor, options);
  };
  registry[PATCHED] = true;
};

if (typeof customElements !== "undefined") {
  guardCustomElementsDefine(customElements);
}
