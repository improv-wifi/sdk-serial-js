export const fireEvent = <Event extends keyof HTMLElementEventMap>(
  eventTarget: EventTarget,
  type: Event,
  // @ts-ignore
  detail?: HTMLElementEventMap[Event]["detail"],
  options?: {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }
): void => {
  options = options || {};
  const event = new CustomEvent(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
    detail,
  });
  eventTarget.dispatchEvent(event);
};

export const hexFormatter = (bytes: number[] | Uint8Array) =>
  "[" + bytes.map((value) => toHex(value) as any).join(", ") + "]";

export const toHex = (value: number, size = 2) => {
  let hex = value.toString(16).toUpperCase();
  if (hex.startsWith("-")) {
    return "-0x" + hex.substring(1).padStart(size, "0");
  } else {
    return "0x" + hex.padStart(size, "0");
  }
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
