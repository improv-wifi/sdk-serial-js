import { IconButtonBase } from "@material/mwc-icon-button/mwc-icon-button-base";
import { styles } from "@material/mwc-icon-button/mwc-icon-button.css";

declare global {
  interface HTMLElementTagNameMap {
    "ewt-icon-button": IsIconButton;
  }
}

export class IsIconButton extends IconButtonBase {
  static override styles = [styles];
}

customElements.define("ewt-icon-button", IsIconButton);
