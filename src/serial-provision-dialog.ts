import { LitElement, html, PropertyValues, css, TemplateResult } from "lit";
import { customElement, query, property, state } from "lit/decorators.js";
import "./components/is-dialog";
import "./components/is-textfield";
import "./components/is-button";
import "./components/is-circular-progress";
import "./components/is-select";
import "./components/is-list-item";
import type { IsTextfield } from "./components/is-textfield";
import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  Logger,
  State,
} from "./const.js";
import { ImprovSerial, Ssid } from "./serial.js";
import { fireEvent } from "./util.js";
import { IsSelect } from "./components/is-select";

const ERROR_ICON = "⚠️";
const OK_ICON = "🎉";

@customElement("improv-wifi-serial-provision-dialog")
class SerialProvisionDialog extends LitElement {
  @property() public port?: SerialPort;

  public logger: Logger = console;

  public learnMoreUrl?: TemplateResult;

  @state() private _state: State = "CONNECTING";

  @state() private _client?: ImprovSerial;

  @state() private _busy = false;

  @state() private _error?: string | TemplateResult;

  @state() private _hasProvisioned = false;

  @state() private _showProvisionForm = false;

  @state() private _selectedSsid = 0;

  // undefined = not loaded
  // null = not available
  @state() private _ssids?: Ssid[] | null;

  @query("is-select") private _selectSSID!: IsSelect;
  @query("is-textfield[name=ssid]") private _inputSSID!: IsTextfield;
  @query("is-textfield[name=password]") private _inputPassword!: IsTextfield;

  protected render() {
    if (!this.port) {
      return html``;
    }
    let content: TemplateResult;
    let hideActions = false;

    if (this._state === "ERROR") {
      content = this._renderMessage(
        ERROR_ICON,
        `An error occurred. ${this._error}`,
        true
      );
    } else if (!this._client || this._state === "CONNECTING") {
      content = this._renderProgress("Connecting");
      hideActions = true;
    } else if (this._showProvisionForm) {
      if (this._busy) {
        content = this._renderProgress("Provisioning");
        hideActions = true;
      } else if (this._ssids === undefined) {
        content = this._renderProgress("Scanning for networks");
        hideActions = true;
      } else {
        content = this._renderImprovReady();
      }
    } else if (this._client.state === ImprovSerialCurrentState.PROVISIONING) {
      content = this._renderProgress("Provisioning");
      hideActions = true;
    } else if (
      this._client.state === ImprovSerialCurrentState.PROVISIONED ||
      this._client.state === ImprovSerialCurrentState.READY
    ) {
      [content, hideActions] = this._renderImprovDashboard();
    } else {
      content = this._renderMessage(
        ERROR_ICON,
        `Unexpected state: ${this._state} - ${this._client.state}`,
        true
      );
    }

    return html`
      <is-dialog
        open
        .heading=${this._client?.info?.name}
        scrimClickAction
        @closed=${this._handleClose}
        .hideActions=${hideActions}
        >${content}</is-dialog
      >
    `;
  }

  _renderProgress(label: string) {
    return html`
      <div class="center">
        <div>
          <is-circular-progress
            active
            indeterminate
            density="8"
          ></is-circular-progress>
        </div>
        ${label}
      </div>
    `;
  }

  _renderMessage(icon: string, label: string, showClose: boolean) {
    return html`
      <div class="center">
        <div class="icon">${icon}</div>
        ${label}
      </div>
      ${showClose &&
      html`
        <is-button
          slot="primaryAction"
          dialogAction="ok"
          label="Close"
        ></is-button>
      `}
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

      default:
        error = `Unknown error (${this._client!.error})`;
    }

    return html`
      <div>
        Enter the credentials of the Wi-Fi network that you want your device to
        connect to.
      </div>
      ${error ? html`<p class="error">${error}</p>` : ""}
      ${this._ssids !== null
        ? html`
            <is-select
              fixedMenuPosition
              label="Network"
              @selected=${(ev: { detail: { index: number } }) => {
                const index = ev.detail.index;
                // The "Join Other" item is always the last item.
                this._selectedSsid = index === this._ssids!.length ? -1 : index;
              }}
              @closed=${(ev: Event) => ev.stopPropagation()}
            >
              ${this._ssids!.map(
                (info, idx) => html`
                  <is-list-item
                    .selected=${this._selectedSsid === idx}
                    value=${idx}
                  >
                    ${info.name}
                  </is-list-item>
                `
              )}
              <is-list-item .selected=${this._selectedSsid === -1} value="-1">
                Join other…
              </is-list-item>
            </is-select>
          `
        : ""}
      ${
        // Show input box if command not supported or "Join Other" selected
        this._selectedSsid === -1
          ? html`
              <is-textfield label="Network Name" name="ssid"></is-textfield>
            `
          : ""
      }
      ${
        // Show password if custom SSID or needs password
        this._selectedSsid === -1 || this._ssids![this._selectedSsid].secured
          ? html`
              <is-textfield
                label="Password"
                name="password"
                type="password"
              ></is-textfield>
            `
          : ""
      }
      <is-button
        slot="primaryAction"
        label="Connect"
        @click=${this._provision}
      ></is-button>
      ${this._client!.state === ImprovSerialCurrentState.PROVISIONED
        ? html`
            <is-button
              slot="secondaryAction"
              label="Back"
              @click=${this._toggleShowProvisionForm}
            ></is-button>
          `
        : html`
            <is-button
              slot="secondaryAction"
              dialogAction="close"
              label="Cancel"
            ></is-button>
          `}
    `;
  }

  _renderImprovDashboard(): [TemplateResult, boolean] {
    const hideActions = true;
    const content = html`
      <div class="device-info">
        Software: ${this._client!.info?.firmware}/${this._client!.info?.version}
      </div>
      ${this._hasProvisioned
        ? html`
            <div class="center">
              <div class="icon">${OK_ICON}</div>
              Provisioned!
            </div>
          `
        : ""}
      <div class="dashboard-buttons">
        ${this._client!.nextUrl === undefined
          ? ""
          : html`
              <div>
                <a
                  target="_blank"
                  href=${this._client!.nextUrl}
                  class="has-button"
                >
                  <is-button label="Visit Device"></is-button>
                </a>
              </div>
            `}
        <div>
          <is-button
            .label=${this._client!.state === ImprovSerialCurrentState.READY
              ? "Connect to Wi-Fi"
              : "Change Wi-Fi"}
            @click=${this._toggleShowProvisionForm}
          ></is-button>
        </div>
        <div>
          <is-button label="Close" dialogAction="close"></is-button>
        </div>
      </div>
    `;
    return [content, hideActions];
  }

  private async _toggleShowProvisionForm() {
    this._showProvisionForm = !this._showProvisionForm;
    this._hasProvisioned = false;
  }

  private async _provision() {
    this._hasProvisioned = true;
    this._busy = true;
    try {
      // No need to do error handling because we listen for `error-changed` events
      await this._client!.provision(
        this._selectedSsid === -1
          ? this._inputSSID.value
          : this._ssids![this._selectedSsid].name,
        this._inputPassword.value
      );
    } finally {
      this._busy = false;
    }
  }

  protected override willUpdate(changedProps: PropertyValues) {
    super.willUpdate(changedProps);

    if (changedProps.has("_showProvisionForm") && this._showProvisionForm) {
      this._ssids = undefined;
      this._client!.scan().then(
        (ssids) => {
          this._ssids = ssids;
          this._selectedSsid = ssids.length ? 0 : -1;
        },
        () => {
          this._ssids = null;
          this._selectedSsid = -1;
        }
      );
    }
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    if (changedProps.has("port") && this.port) {
      this._connect();
    }

    let toFocus: LitElement | undefined;

    if (changedProps.has("_ssids") && this._ssids !== undefined) {
      toFocus = this._selectSSID;
    } else if (changedProps.has("_selectedSsid") && this._selectedSsid === -1) {
      toFocus = this._inputSSID;
    }

    if (toFocus) {
      toFocus.updateComplete.then(() => toFocus!.focus());
    }
  }

  private async _connect() {
    const client = new ImprovSerial(this.port!, this.logger);
    client.addEventListener("state-changed", () => {
      this._state = "IMPROV-STATE";
      this._showProvisionForm = false;
      this.requestUpdate();
    });
    client.addEventListener("error-changed", () => this.requestUpdate());
    try {
      await client.initialize();
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
  }

  private async _handleClose() {
    await this._client?.close();
    this._client = undefined;
    fireEvent(this, "closed" as any);
    this.parentNode!.removeChild(this);
  }

  static styles = css`
    :host {
      --mdc-dialog-max-width: 390px;
      --mdc-theme-primary: var(--improv-primary-color, #03a9f4);
      --mdc-theme-on-primary: var(--improv-on-primary-color, #fff);
    }
    is-textfield,
    is-select {
      display: block;
      margin-top: 16px;
    }
    .center {
      text-align: center;
    }
    is-circular-progress {
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
    button.link {
      background: none;
      color: inherit;
      border: none;
      padding: 0;
      font: inherit;
      text-align: left;
      text-decoration: underline;
      cursor: pointer;
    }
    is-list-item[value="-1"] {
      border-top: 1px solid #ccc;
    }
    .dashboard-buttons {
      margin: 16px 0 -16px -8px;
    }
    .dashboard-buttons div {
      display: block;
      margin: 4px 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "improv-wifi-serial-provision-dialog": SerialProvisionDialog;
  }
}
