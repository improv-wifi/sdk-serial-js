import { TextFieldBase } from "@material/mwc-textfield/mwc-textfield-base";
import { styles } from "@material/mwc-textfield/mwc-textfield.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-textfield": IsTextfield;
  }
}

export class IsTextfield extends TextFieldBase {
  static override styles = [styles];
}

customElements.define("is-textfield", IsTextfield);
