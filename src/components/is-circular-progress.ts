import { CircularProgressBase } from "@material/mwc-circular-progress/mwc-circular-progress-base";
import { styles } from "@material/mwc-circular-progress/mwc-circular-progress.css";

declare global {
  interface HTMLElementTagNameMap {
    "is-circular-progress": IsCircularProgress;
  }
}

export class IsCircularProgress extends CircularProgressBase {
  static override styles = [styles];
}

customElements.define("is-circular-progress", IsCircularProgress);
