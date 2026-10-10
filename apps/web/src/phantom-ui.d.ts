import type { PhantomUiAttributes } from "@aejkatappaja/phantom-ui";
import type { HTMLAttributes } from "react";

declare module "react/jsx-runtime" {
  export namespace JSX {
    interface IntrinsicElements {
      "phantom-ui": PhantomUiAttributes & HTMLAttributes<HTMLElement>;
    }
  }
}
