import { ButtonBase } from "@material/mwc-button/mwc-button-base";
import { styles } from "@material/mwc-button/styles.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-button": IsButton;
  }
}

export class IsButton extends ButtonBase {
  static override styles = [styles];
}

customElements.define("is-button", IsButton);
