import {
  LitElement,
  html,
  PropertyValues,
  css,
  TemplateResult,
  nothing,
  svg,
} from "lit";
import { customElement, query, property, state } from "lit/decorators.js";
import "@material/web/dialog/dialog.js";
import "@material/web/iconbutton/filled-tonal-icon-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/filled-button.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/list/list.js";
import "@material/web/list/list-item.js";

import type { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field";
import type { MdOutlinedSelect } from "@material/web/select/outlined-select.js";

import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  Logger,
  State,
} from "./const.js";
import { ImprovSerial, Ssid } from "./serial.js";
import { fireEvent } from "./util/fire-event";

const ERROR_ICON = "⚠️";
const OK_ICON = "🎉";
const infoIcon = svg`
  <svg viewBox="0 -960 960 960" width="24px">
      <path 
        fill="currentColor"
        d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
      />
  </svg>
`;
const wifiIcon = svg`
  <svg viewBox="0 -960 960 960">
    <path 
      fill="currentColor"
      d="M480-120q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29ZM254-346l-84-86q59-59 138.5-93.5T480-560q92 0 171.5 35T790-430l-84 84q-44-44-102-69t-124-25q-66 0-124 25t-102 69ZM84-516 0-600q92-94 215-147t265-53q142 0 265 53t215 147l-84 84q-77-77-178.5-120.5T480-680q-116 0-217.5 43.5T84-516Z"
    />
  </svg>
`;
const networkWifiFull = svg`
  <svg viewBox="0 -960 960 960" width="24px">
    <path 
      fill="currentColor"
      d="M480-120 0-600q95-97 219.5-148.5T480-800q137 0 261 51t219 149L480-120ZM174-540q67-48 145-74t161-26q83 0 161 26t145 74l58-58q-79-60-172-91t-192-31q-99 0-192 31t-172 91l58 58Z"
    />
  </svg>
`;
const networkWifi3Bar = svg`
  <svg viewBox="0 -960 960 960" width="24px">
    <path 
      fill="currentColor"
      d="M480-120 0-600q96-98 220-149t260-51q137 0 261 51t219 149L480-120ZM232-482q53-38 116-59.5T480-563q69 0 132 21.5T728-482l116-116q-78-59-170.5-90.5T480-720q-101 0-193.5 31.5T116-598l116 116Z"
    />
  </svg>
`;
const networkWifi2Bar = svg`
  <svg viewBox="0 -960 960 960" width="24px">
    <path 
      fill="currentColor"
      d="M480-120 0-600q96-98 220-149t260-51q137 0 261 51t219 149L480-120ZM299-415q38-28 84-43.5t97-15.5q51 0 97 15.5t84 43.5l183-183q-78-59-170.5-90.5T480-720q-101 0-193.5 31.5T116-598l183 183Z"    
    />
  </svg>
`;
const networkWifi1Bar = svg`
    <svg viewBox="0 -960 960 960" width="24px">
      <path
        fill="currentColor" 
        d="M480-120 0-600q96-98 220-149t260-51q137 0 261 51t219 149L480-120ZM361-353q25-18 55.5-28t63.5-10q33 0 63.5 10t55.5 28l245-245q-78-59-170.5-90.5T480-720q-101 0-193.5 31.5T116-598l245 245Z"
      />
    </svg>
`;
const lockIcon = svg`
    <svg viewBox="0 -960 960 960" width="24px">
      <path 
        fill="currentColor" 
        d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"
      />
    </svg>
`;
const lockUnlockedRightIcon = svg`
    <svg viewBox="0 -960 960 960" width="24px">
      <path
        fill="currentColor" 
        d="M240-160h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM240-160v-400 400Zm0 80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h280v-80q0-83 58.5-141.5T720-920q83 0 141.5 58.5T920-720h-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Z"
      />
    </svg>
`;
const visibilityIcon = svg`
  <svg viewBox="0 -960 960 960">
    <path 
        fill="currentColor" 
        d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z"
    />
  </svg>
`;
const visibilityOffIcon = svg`
  <svg viewBox="0 -960 960 960">
    <path
      fill="currentColor" 
      d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"
    />
  </svg>
`;

function getWifiIcon(rssi: number): TemplateResult {
  if (rssi >= -50) return networkWifiFull;
  if (rssi >= -60) return networkWifi3Bar;
  if (rssi >= -70) return networkWifi2Bar;
  return networkWifi1Bar;
}

function getSignalStrengthClass(rssi: number): string {
  if (rssi >= -50) return "signal-excellent";
  if (rssi >= -60) return "signal-good";
  if (rssi >= -70) return "signal-fair";
  return "signal-weak";
}

@customElement("improv-wifi-serial-provision-dialog")
class SerialProvisionDialog extends LitElement {
  @property() public port?: SerialPort;

  public logger: Logger = console;

  public learnMoreUrl?: TemplateResult;

  @state() private _state: State = "CONNECTING";

  @state() private _client?: ImprovSerial;

  @state() private _busy = false;

  @state() private _error?: string | TemplateResult;

  @state() private _selectedSsid: string | null = null;

  // undefined = not loaded
  // null = not available
  @state() private _ssids?: Ssid[] | null;

  @state() private _showPassword = false;

  // Show the configure form while already provisioned, to change the network.
  @state() private _reprovision = false;

  private _unsubSSIDs?: () => Promise<void>;

  @query("md-outlined-select") private _selectSSID!: MdOutlinedSelect;
  @query("md-outlined-text-field[name=ssid]")
  private _inputSSID!: MdOutlinedTextField;
  @query("md-outlined-text-field[name=password]")
  private _inputPassword?: MdOutlinedTextField;

  protected render() {
    if (!this.port) {
      return html``;
    }
    let heading: TemplateResult = html`${this._client?.info?.name ?? nothing}`;
    let content: TemplateResult;
    let actions: TemplateResult | undefined;

    if (this._state === "CONNECTING" || !this._client) {
      content = this._renderProgress("Connecting");
    } else if (this._state === "ERROR") {
      content = this._renderMessage(
        ERROR_ICON,
        `An error occurred. ${this._error}`,
      );
      actions = this._renderCloseAction();
    } else if (this._client!.state === ImprovSerialCurrentState.STOPPED) {
      content = this._renderMessage(
        ERROR_ICON,
        "The connected device has Wi-Fi turned off, so it can't be configured right now. Enable the device's Wi-Fi, then try again.",
      );
      actions = this._renderCloseAction();
    } else if (this._showConfigureForm) {
      if (this._busy) {
        content = this._renderProgress("Provisioning");
      } else {
        heading = html`<md-filled-tonal-icon-button
            >${wifiIcon}</md-filled-tonal-icon-button
          >Configure Wi-Fi`;
        if (this._ssids === undefined) {
          content = this._renderProgress("Searching for networks");
        } else {
          content = this._renderImprovReady();
          actions = html`${this._renderCloseAction()}
            <md-filled-button @click=${this._provision}
              >Connect</md-filled-button
            > `;
        }
      }
    } else if (this._client!.state === ImprovSerialCurrentState.PROVISIONING) {
      content = this._renderProgress("Provisioning");
    } else if (this._client!.state === ImprovSerialCurrentState.PROVISIONED) {
      content = html`
        ${this._client?.info ? this._renderDeviceInfo() : nothing}
        <div class="center">
          <div class="icon">${OK_ICON}</div>
          Provisioned!
        </div>
      `;
      actions = html`${this._renderCloseAction()}
        <md-outlined-button @click=${this._changeWifi}
          >Change Wi-Fi</md-outlined-button
        >
        ${this._client!.nextUrl === undefined
          ? nothing
          : html`<md-filled-button
              href=${this._client!.nextUrl}
              form="improv-form"
              >Visit Device</md-filled-button
            >`}`;
    } else {
      content = this._renderMessage(
        ERROR_ICON,
        `Unexpected state: ${this._state} - ${this._client!.state}`,
      );
      actions = this._renderCloseAction();
    }

    return html`
      <md-dialog open @close=${this._handleClose}>
        <div slot="headline">${heading}</div>
        <form slot="content" id="improv-form" method="dialog">${content}</form>
        ${actions ? html`<div slot="actions">${actions}</div>` : nothing}
      </md-dialog>
    `;
  }

  _renderCloseAction() {
    return html`<md-outlined-button
      form="improv-form"
      @click=${this._handleClose}
      >Close</md-outlined-button
    >`;
  }

  _renderProgress(label: string) {
    return html`
      <div class="center">
        <div>
          <md-circular-progress indeterminate></md-circular-progress>
        </div>
        ${label}
      </div>
    `;
  }

  _renderMessage(icon: string, label: string) {
    return html`
      <div class="center">
        <div class="icon">${icon}</div>
        ${label}
      </div>
    `;
  }

  _renderImprovReady() {
    let error: string | undefined;

    switch (this._client!.error) {
      case ImprovSerialErrorState.UNABLE_TO_CONNECT:
        error = "Unable to connect";
        break;

      case ImprovSerialErrorState.NO_ERROR:
        break;

      // Happens after scanning for networks if device
      // doesn't support the command.
      case ImprovSerialErrorState.UNKNOWN_RPC_COMMAND:
        if (this._ssids !== null) {
          error = `Unknown RPC command`;
        }
        break;

      case ImprovSerialErrorState.TIMEOUT:
        error = `Timeout`;
        break;

      default:
        error = `Unknown error (${this._client!.error})`;
    }

    const selectedSsid = this._ssids?.find(
      (info) => info.name === this._selectedSsid,
    );

    return html`
      ${this._client?.info ? this._renderDeviceInfo() : nothing}
      <div>
        Enter the credentials of the Wi-Fi network that you want your device to
        connect to.
      </div>
      ${error ? html`<p class="error">${error}</p>` : nothing}
      ${this._ssids !== null
        ? html`
            <md-outlined-select
              name="ssid_select"
              required
              label="Network"
              @change=${(ev: Event) => {
                const index = (ev.target as MdOutlinedSelect).selectedIndex;
                // The "Join Other" item is always the last item.
                this._selectedSsid =
                  index === this._ssids!.length
                    ? null
                    : this._ssids![index].name;
              }}
              @closed=${(ev: Event) => ev.stopPropagation()}
            >
              ${this._ssids!.map(
                (info, idx) => html`
                  <md-select-option
                    .selected=${selectedSsid === info}
                    value=${idx}
                  >
                    <span
                      slot="start"
                      class=${getSignalStrengthClass(info.rssi)}
                      >${getWifiIcon(info.rssi)}</span
                    >
                    <span slot="headline">${info.name}</span>
                    <span slot="end" class="network-details">
                      <span class="signal-strength">${info.rssi}dB</span>
                      <span
                        class="lock-icon ${info.secured
                          ? "lock-secured"
                          : "lock-unsecured"}"
                        >${info.secured
                          ? lockIcon
                          : lockUnlockedRightIcon}</span
                      >
                    </span>
                  </md-select-option>
                `,
              )}
              <md-select-option .selected=${!selectedSsid} value="-1">
                Join other…
              </md-select-option>
            </md-outlined-select>
          `
        : nothing}
      ${
        // Show input box if no wifi networks found or "Join Other" selected
        this._selectedSsid === null
          ? html`
              <md-outlined-text-field
                required
                label="Network Name"
                name="ssid"
              ></md-outlined-text-field>
            `
          : nothing
      }
      ${
        // Show password if custom SSID or needs password
        !selectedSsid || selectedSsid.secured
          ? html`
              <md-outlined-text-field
                required
                label="Password"
                name="password"
                type=${this._showPassword ? "text" : "password"}
              >
                <md-icon-button
                  slot="trailing-icon"
                  @click=${this._togglePasswordVisibility}
                  toggle
                  .selected=${this._showPassword}
                >
                  ${this._showPassword ? visibilityOffIcon : visibilityIcon}
                </md-icon-button>
              </md-outlined-text-field>
            `
          : nothing
      }
    `;
  }

  _renderDeviceInfo(): TemplateResult {
    return html`<div class="device-info">
      <div>${infoIcon}Device Info</div>
      <div>Name<span>${this._client!.info!.name}</span></div>
      <div>Firmware<span>${this._client!.info!.firmware}</span></div>
      <div>Version<span>${this._client!.info!.version}</span></div>
      <div>Chip<span>${this._client!.info!.chipFamily}</span></div>
      ${this._client!.info!.osName
        ? html`<div>OS<span>${this._client!.info!.osName}</span></div>`
        : nothing}
      ${this._client!.info!.osVersion
        ? html`<div>
            OS Version<span>${this._client!.info!.osVersion}</span>
          </div>`
        : nothing}
    </div>`;
  }

  private _togglePasswordVisibility(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this._showPassword = !this._showPassword;
  }

  // Whether the network configuration form is the active view.
  private get _showConfigureForm(): boolean {
    return (
      this._client?.state === ImprovSerialCurrentState.READY ||
      (this._client?.state === ImprovSerialCurrentState.PROVISIONED &&
        this._reprovision)
    );
  }

  // Scan while (and only while) the configure form is shown. Driven from
  // `updated()`, so entering the form starts scanning and leaving it stops.
  private _syncScanning() {
    const shouldScan =
      this._state === "IMPROV-STATE" && !this._busy && this._showConfigureForm;
    if (shouldScan === !!this._unsubSSIDs) {
      return;
    }
    if (shouldScan) {
      this._unsubSSIDs = this._client!.subscribeSSIDs((networks) => {
        if (networks === null) {
          // Scanning isn't available; fall back to manual network entry.
          this._selectedSsid = null;
        } else if (this._ssids == null) {
          // First result: default to the strongest (first alphabetical) one.
          this._selectedSsid = networks.length ? networks[0].name : null;
        } else if (
          this._selectedSsid !== null &&
          !networks.some((s) => s.name === this._selectedSsid)
        ) {
          // A merged scan never drops networks, but the selection persists
          // across scan restarts (after a failed provision, or reopening to
          // change Wi-Fi), and the first fresh scan may not include it yet.
          // Re-default when that happens; keep "Join other" (null) as-is.
          this._selectedSsid = networks.length ? networks[0].name : null;
        }
        this._ssids = networks;
      });
    } else {
      this._stopScanning();
    }
  }

  private async _stopScanning() {
    if (!this._unsubSSIDs) {
      return;
    }
    const unsubscribe = this._unsubSSIDs;
    this._unsubSSIDs = undefined;
    await unsubscribe();
  }

  private async _provision() {
    this._busy = true;
    // Wait for any in-flight scan to settle before provisioning so we don't
    // have two RPC commands in flight at once. Marking busy above already tells
    // `_syncScanning` to stop, but the provision RPC needs it stopped *now*.
    await this._stopScanning();
    try {
      await this._client!.provision(
        this._selectedSsid === null
          ? this._inputSSID.value
          : this._selectedSsid,
        this._inputPassword?.value || "",
        30000, // Timeout in 30 seconds
      );
      // Success: leave the change-Wi-Fi form and show the provisioned screen.
      this._reprovision = false;
    } catch (err) {
      // No need to do error handling because we listen for `error-changed`
      // events. Clearing busy resumes scanning via `_syncScanning`.
      console.log(err);
    } finally {
      this._busy = false;
    }
  }

  private _changeWifi() {
    this._reprovision = true;
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    if (changedProps.has("port") && this.port) {
      this._connect();
    }

    this._syncScanning();

    let toFocus: LitElement | undefined;

    if (
      changedProps.has("_ssids") &&
      changedProps.get("_ssids") === undefined &&
      this._ssids != null
    ) {
      // Only focus on the first result, not on every background scan update.
      toFocus = this._selectSSID;
    } else if (
      changedProps.has("_selectedSsid") &&
      this._selectedSsid === null
    ) {
      toFocus = this._inputSSID;
    }

    if (toFocus) {
      toFocus.updateComplete.then(() => toFocus!.focus());
    }
  }

  private async _connect() {
    let client: ImprovSerial;
    try {
      client = new ImprovSerial(this.port!, this.logger);
    } catch (err) {
      this._state = "ERROR";
      this._error = (err as any).message || err || "Unknown error";
      return;
    }
    client.addEventListener("state-changed", () => {
      this._state = "IMPROV-STATE";
      this.requestUpdate();
    });
    client.addEventListener("error-changed", () => this.requestUpdate());
    try {
      await client.initialize(10000);
    } catch (err: any) {
      this._state = "ERROR";
      this._error = this.learnMoreUrl
        ? html`
            Unable to detect Improv service on connected device.
            <a href=${this.learnMoreUrl} target="_blank"
              >Learn how to resolve this</a
            >
          `
        : err.message;
      return;
    }
    client.addEventListener("disconnect", () => {
      this._state = "ERROR";
      this._error = "Disconnected";
    });
    if (client.nextUrl) {
      this.requestUpdate();
    }
    this._client = client;
    // Scanning starts from `_syncScanning` once the configure form is shown.
  }

  private async _handleClose() {
    const eventData = {
      improv: false,
      provisioned: false,
    };
    if (this._client) {
      eventData.improv = true;
      eventData.provisioned =
        this._client.state === ImprovSerialCurrentState.PROVISIONED;
      await this._client.close();
      this._client = undefined;
    }
    fireEvent(this, "closed" as any, eventData);
    this.parentNode!.removeChild(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Stop scanning when the dialog goes away. Not awaited: closing the client
    // cancels the reader, which may leave the in-flight scan unsettled.
    this._stopScanning();
  }

  static styles = css`
    :host {
      --md-dialog-max-width: 390px;
      --md-dialog-container-max-block-size: none !important;
      --md-sys-color-primary: var(--improv-primary-color, #03a9f4);
      --md-sys-color-on-primary: var(--improv-on-primary-color, #fff);
      --md-ref-typeface-brand: system-ui, sans-serif;
      --md-ref-typeface-plain: system-ui, sans-serif;
      font-family: system-ui, sans-serif;
    }

    md-dialog {
      --md-dialog-container-color: var(--improv-container-color, #fff);
      --md-dialog-container-max-block-size: none !important;
      max-height: 90vh !important;
    }

    md-dialog [slot="content"],
    form[slot="content"] {
      overflow: visible !important;
      max-height: none !important;
    }

    md-outlined-text-field,
    md-outlined-select {
      display: block;
      margin-top: 16px;
    }

    .center {
      text-align: center;
    }

    md-circular-progress {
      margin-bottom: 16px;
    }

    a.has-button {
      text-decoration: none;
    }

    .icon {
      font-size: 50px;
      line-height: 80px;
      color: black;
    }

    .error {
      color: #db4437;
    }

    .device-info {
      margin-bottom: 16px;
      padding: 16px;
      background-color: #d6d6d6;
      border-radius: 8px;
      border: 1px solid #676767;
    }

    .device-info > div:first-child {
      justify-content: flex-start;
      align-items: center;
      gap: 8px;
    }

    .device-info > div {
      display: flex;
      color: #5f6368;
      justify-content: space-between;
    }

    .device-info > div > span {
      color: #1f1f1f;
    }

    md-select-option[value="-1"] {
      border-top: 1px solid #ccc;
    }
    md-outlined-select[name="ssid_select"] {
      width: 100%;
    }

    .network-details {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #5f6368;
      font-size: 0.85em;
    }

    .signal-strength {
      min-width: 45px;
      text-align: right;
    }

    .lock-icon {
      font-size: 18px;
    }

    .lock-secured {
      color: #34a853;
    }

    .lock-unsecured {
      color: #ea4335;
    }

    .signal-excellent {
      color: #34a853;
    }

    .signal-good {
      color: #4285f4;
    }

    .signal-fair {
      color: #fbbc04;
    }

    .signal-weak {
      color: #ea4335;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "improv-wifi-serial-provision-dialog": SerialProvisionDialog;
  }
}
