import { ListItemBase } from "@material/mwc-list/mwc-list-item-base";
import { styles } from "@material/mwc-list/mwc-list-item.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-list-item": IsListItem;
  }
}

export class IsListItem extends ListItemBase {
  static override styles = [styles];
}

customElements.define("is-list-item", IsListItem);
