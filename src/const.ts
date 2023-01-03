export interface Logger {
  log(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
}

export const SERIAL_PACKET_HEADER = [
  "I".charCodeAt(0),
  "M".charCodeAt(0),
  "P".charCodeAt(0),
  "R".charCodeAt(0),
  "O".charCodeAt(0),
  "V".charCodeAt(0),
  1, // protocol version
];

export type State = "CONNECTING" | "IMPROV-STATE" | "ERROR";

export enum ImprovSerialMessageType {
  CURRENT_STATE = 0x01, // Device to client
  ERROR_STATE = 0x02, // Device to client
  RPC = 0x03, // Client to device
  RPC_RESULT = 0x04, // Device to client
}

export enum ImprovSerialCurrentState {
  READY = 0x02, // Authorized
  PROVISIONING = 0x03,
  PROVISIONED = 0x04,
}

export const enum ImprovSerialErrorState {
  NO_ERROR = 0x00,
  INVALID_RPC_PACKET = 0x01,
  UNKNOWN_RPC_COMMAND = 0x02,
  UNABLE_TO_CONNECT = 0x03,
  TIMEOUT = 0xfe,
  UNKNOWN_ERROR = 0xff,
}

export const ERROR_MSGS = {
  0x00: "NO_ERROR",
  0x01: "INVALID_RPC_PACKET",
  0x02: "UNKNOWN_RPC_COMMAND",
  0x03: "UNABLE_TO_CONNECT",
  0xfe: "TIMEOUT",
  0xff: "UNKNOWN_ERROR",
};

export const enum ImprovSerialRPCCommand {
  SEND_WIFI_SETTINGS = 0x01,
  REQUEST_CURRENT_STATE = 0x02,
  REQUEST_INFO = 0x03,
  REQUEST_WIFI_NETWORKS = 0x04,
}

export class PortNotReady extends Error {
  constructor() {
    super("Port is not ready");
  }
}
