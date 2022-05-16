export const toHex = (value: number, size = 2) => {
  let hex = value.toString(16).toUpperCase();
  if (hex.startsWith("-")) {
    return "-0x" + hex.substring(1).padStart(size, "0");
  } else {
    return "0x" + hex.padStart(size, "0");
  }
};
