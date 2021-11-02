# JavaScript SDK for Improv Wi-Fi

## Installation

You can use the JavaScript SDK by adding the following HTML to your website:

```html
<script type="module" src="https://www.improv-wifi.com/sdk-js/launch-button.js"></script>
```

If you are using a bundler and JavaScript package manager, you can install the SDK via NPM:

```
npm install --save improv-wifi-sdk
```

And then import it in your code:

```
import 'improv-wifi-sdk';
```

## Usage

Add the following to your website to show a button to start the provisioning process:

```html
<improv-wifi-serial-launch-button></improv-wifi-serial-launch-button>
```

A warning message will be rendered if the browser does not support WebBluetooth.

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

## Browser Support

This SDK requires a browser with support for WebBluetooth. Currently this is supported by Google Chrome, Microsoft Edge and other browsers based on the Blink engine.

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
improv.addEventListener("disconnect", console.log);

await improv.initialize();

console.log({
  info: improv.info,
  nextUrl: improv.nextUrl,
});

await improv.provision("My Wifi", "My password");
```
