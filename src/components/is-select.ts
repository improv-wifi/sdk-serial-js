import { SelectBase } from "@material/mwc-select/mwc-select-base";
import { styles } from "@material/mwc-select/mwc-select.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-select": IsSelect;
  }
}

export class IsSelect extends SelectBase {
  static override styles = [styles];
}

customElements.define("is-select", IsSelect);
