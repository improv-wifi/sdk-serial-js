import { SerialLaunchButton } from "./serial-launch-button.js";
import "./serial-provision-dialog.js";

export const startProvisioning = async (button: SerialLaunchButton) => {
  let port: SerialPort | undefined;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    console.error("User cancelled request", err);
    return;
  }

  if (!port) {
    return;
  }

  await port.open({ baudRate: 115200 });

  const el = document.createElement("improv-wifi-serial-provision-dialog");
  el.port = port;
  el.addEventListener(
    "closed",
    () => {
      port!.close();
    },
    { once: true }
  );
  document.body.appendChild(el);
};
