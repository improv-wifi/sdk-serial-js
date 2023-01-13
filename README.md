# JavaScript SDK for Improv Wi-Fi over Serial

## Installation

If you are using a bundler and JavaScript package manager, you can install the SDK via NPM:

```
npm install --save improv-wifi-sdk
```

And then import it in your code:

```
import 'improv-wifi-serial-sdk';
```

## Usage

Add the following to your website to show a button to start the provisioning process:

```html
<improv-wifi-serial-launch-button></improv-wifi-serial-launch-button>
```

A warning message will be rendered if the browser does not support WebSerial.

The SDK will render an error when the connected device does not support Improv. If it is opt-in for your software, you can set a link as the `learnMoreUrl` attribute to include this link in the error message.

```html
<improv-wifi-serial-launch-button
  learnMoreUrl="https://www.esphome.io/components/improv_serial.html"
></improv-wifi-serial-launch-button>
```

### Attributes

The following attributes are automatically added to `<improv-wifi-serial-launch-button>` and can be used for styling:

| Attribute | Description |
| -- | -- |
| `supported` | Added if this browser is supported
| `unsupported` | Added if this browser is not supported

### Slots

It is possible to customize the button and the message. You do this by putting your elements inside the `<improv-wifi-serial-launch-button>` element and adding the appropriate `slot` attribute. Use `activate` to replace the activation button and `unsupported` to replace the unsupported message:

```html
<improv-wifi-serial-launch-button>
  <button slot='activate'>Start provisioning!</button>
  <span slot='unsupported'>Your browser does not support provisioning.</span>
</improv-wifi-serial-launch-button>
```

### Events

When the dialog is closed, a `closed` event will be fired on both `<improv-wifi-serial-launch-button>` and `<improv-wifi-serial-provision-dialog>`. This event will have a `detail` property with the following properties:

 - `improv`: Boolean indicating if we connected to a device running Improv.
 - `provisioned`: Boolean indicating if the device is connected to Wi-Fi.

## Browser Support

This SDK requires a browser with support for WebSerial. Currently this is supported by Google Chrome, Microsoft Edge and other browsers based on the Blink engine.

No iOS devices are supported.

## Standalone usage

The serial SDK can also be used standalone without the UI.

```ts
import { ImprovSerial } from "improv-wifi-serial-sdk/dist/serial.ts";

const port = await navigator.serial.requestPort();
await port.open({ baudRate: 115200 });
const improv = new ImprovSerial(port, console);

improv.addEventListener("state-changed", console.log);
improv.addEventListener("error-changed", console.log);

await improv.initialize();

improv.addEventListener("disconnect", console.log);

console.log({
  info: improv.info,
  nextUrl: improv.nextUrl,
});

await improv.provision(
  "My Wifi",
  "My password",
  30000  // Optional: Timeout in ms
);
```
