import { SerialLaunchButton } from "./serial-launch-button.js";
import "./serial-provision-dialog.js";

export const startProvisioning = async (button: SerialLaunchButton) => {
  let port: SerialPort | undefined;
  try {
    port = await navigator.serial.requestPort();
  } catch (err: any) {
    if ((err as DOMException).name === "NotFoundError") {
      return;
    }
    alert(`Error: ${err.message}`);
    return;
  }

  if (!port) {
    return;
  }
  let timeout: string | null ;
<<<<<<< HEAD
  if((timeout = button.getAttribute('timeout')) == null){
=======
  try {
    if((timeout = button.getAttribute('timeout')) == null){
      timeout = '1000';
    }
    
  } catch (error) {
>>>>>>> main
    timeout = '1000';
  }
  await port.open({ baudRate: 115200 });

  const el = document.createElement("improv-wifi-serial-provision-dialog");
  el.port = port;
  el.timeout = Number(timeout);
  el.addEventListener(
    "closed",
    () => {
      port!.close();
    },
    { once: true }
  );
  document.body.appendChild(el);
};
