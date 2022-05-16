import { toHex } from "./to-hex";

export const hexFormatter = (bytes: number[] | Uint8Array) =>
  "[" + bytes.map((value) => toHex(value) as any).join(", ") + "]";
