import { DialogBase } from "@material/mwc-dialog/mwc-dialog-base";
import { styles } from "@material/mwc-dialog/mwc-dialog.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-dialog": IsDialog;
  }
}

export class IsDialog extends DialogBase {
  static override styles = [styles];
}

customElements.define("is-dialog", IsDialog);
