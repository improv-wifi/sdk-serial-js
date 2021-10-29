import { LitElement, html, PropertyValues, css, TemplateResult } from "lit";
import { customElement, query, property, state } from "lit/decorators.js";
import "@material/mwc-dialog";
import "@material/mwc-textfield";
import "@material/mwc-button";
import "@material/mwc-circular-progress";
import type { TextField } from "@material/mwc-textfield";
import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  Logger,
  State,
} from "./const.js";
import { ImprovSerial } from "./serial.js";
import { fireEvent } from "./util.js";

const ERROR_ICON = "⚠️";
const OK_ICON = "🎉";

@customElement("improv-wifi-serial-provision-dialog")
class SerialProvisionDialog extends LitElement {
  @property() public port?: SerialPort;

  public logger: Logger = console;

  @state() private _state: State = "CONNECTING";

  private _client?: ImprovSerial;

  @state() private _busy = false;

  @state() private _error?: string;

  @state() private _hasProvisionsed = false;

  @state() private _showProvisionForm = false;

  @query("mwc-textfield[name=ssid]") private _inputSSID!: TextField;
  @query("mwc-textfield[name=password]") private _inputPassword!: TextField;

  protected render() {
    if (!this.port) {
      return html``;
    }
    let content: TemplateResult;
    let hideActions = false;

    if (!this._client || this._state === "CONNECTING") {
      content = this._renderProgress("Connecting");
      hideActions = true;
    } else if (this._state === "ERROR") {
      content = this._renderMessage(
        ERROR_ICON,
        `An error occurred. ${this._error}`,
        true
      );
    } else if (this._showProvisionForm) {
      if (this._busy) {
        content = this._renderProgress("Provisioning");
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
      content = this._renderImprovDashboard();
    } else {
      content = this._renderMessage(
        ERROR_ICON,
        `Unexpected state: ${this._state} - ${this._client.state}`,
        true
      );
    }

    return html`
      <mwc-dialog
        open
        .heading=${this._client?.info?.name}
        scrimClickAction
        @closed=${this._handleClose}
        .hideActions=${hideActions}
        >${content}</mwc-dialog
      >
    `;
  }

  _renderProgress(label: string) {
    return html`
      <div class="center">
        <div>
          <mwc-circular-progress
            active
            indeterminate
            density="8"
          ></mwc-circular-progress>
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
        <mwc-button
          slot="primaryAction"
          dialogAction="ok"
          label="Close"
        ></mwc-button>
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

      default:
        error = `Unknown error (${this._client!.error})`;
    }

    return html`
      <div>
        Enter the Wi-Fi credentials of the network that you want your device to
        connect to.
      </div>
      ${error ? html`<p class="error">${error}</p>` : ""}
      <mwc-textfield label="Wi-Fi SSID" name="ssid"></mwc-textfield>
      <mwc-textfield
        label="Wi-Fi password"
        name="password"
        type="password"
      ></mwc-textfield>
      <mwc-button
        slot="primaryAction"
        label="Save"
        @click=${this._provision}
      ></mwc-button>
      ${this._client!.state === ImprovSerialCurrentState.PROVISIONED
        ? html`
            <mwc-button
              slot="secondaryAction"
              label="Back"
              @click=${this._toggleShowProvisionForm}
            ></mwc-button>
          `
        : html`
            <mwc-button
              slot="secondaryAction"
              dialogAction="close"
              label="Cancel"
            ></mwc-button>
          `}
    `;
  }

  _renderImprovDashboard() {
    return html`
      <div class="device-info">
        Software: ${this._client!.info?.firmware}/${this._client!.info?.version}
      </div>
      ${this._hasProvisionsed
        ? html`
            <div class="center">
              <div class="icon">${OK_ICON}</div>
              Provisioned!
            </div>
          `
        : ""}
      <mwc-button
        slot="primaryAction"
        .label=${this._client!.state === ImprovSerialCurrentState.READY
          ? "Connect to Wi-Fi"
          : "Change Wi-Fi"}
        @click=${this._toggleShowProvisionForm}
      ></mwc-button>
      <mwc-button
        slot="secondaryAction"
        label="Close"
        dialogAction="close"
      ></mwc-button>
      ${this._client!.nextUrl === undefined
        ? ""
        : html`
            <a
              href=${this._client!.nextUrl}
              slot="secondaryAction"
              class="has-button"
              dialogAction="ok"
            >
              <mwc-button label="Configure Device"></mwc-button>
            </a>
          `}
    `;
  }

  private async _toggleShowProvisionForm() {
    this._showProvisionForm = !this._showProvisionForm;
    this._hasProvisionsed = false;
  }

  private async _provision() {
    this._hasProvisionsed = true;
    this._busy = true;
    try {
      // No need to do error handling because we listen for `error-changed` events
      await this._client!.provision(
        this._inputSSID.value,
        this._inputPassword.value
      );
    } finally {
      this._busy = false;
    }
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    if (changedProps.has("port") && this.port) {
      this._connect();
    }

    if (changedProps.has("_showProvisionForm") && this._showProvisionForm) {
      const input = this._inputSSID;
      input.updateComplete.then(() => input.focus());
    }
  }

  private async _connect() {
    this._client = new ImprovSerial(this.port!, this.logger);
    this._client.addEventListener("state-changed", () => {
      this._state = "IMPROV-STATE";
      this._showProvisionForm = false;
      this.requestUpdate();
    });
    this._client.addEventListener("error-changed", () => this.requestUpdate());
    this._client.addEventListener("disconnect", () => {
      this._state = "ERROR";
      this._error = "Disconnected";
    });
    try {
      await this._client.initialize();
    } catch (err: any) {
      this._state = "ERROR";
      this._error = err.message;
      return;
    }
    if (this._client.nextUrl) {
      this.requestUpdate();
    }
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
    mwc-textfield {
      display: block;
      margin-top: 16px;
    }
    .center {
      text-align: center;
    }
    mwc-circular-progress {
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
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "improv-wifi-serial-provision-dialog": SerialProvisionDialog;
  }
}
