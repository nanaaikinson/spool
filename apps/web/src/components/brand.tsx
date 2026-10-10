import logoOnDark from "../assets/brand/spool-horizontal-dark.svg";
import logoOnLight from "../assets/brand/spool-horizontal-color.svg";
/**
 * The Spool symbol, using the kit's small-size drawing (broader flanges and a
 * wider opening), which stays legible at the 16–24px sizes the UI uses.
 */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M32 32 H224 V72 H196 C168 72 156 78 156 90.67 L100 123 C100 94 88 72 60 72 H32 Z"
      />
      <path
        fillRule="evenodd"
        d="M224 224 H32 V184 H60 C88 184 100 178 100 165.33 L156 133 C156 162 168 184 196 184 H224 Z"
      />
    </svg>
  );
}
/**
 * The horizontal lockup (symbol and wordmark), drawn for the current theme, or
 * always in its dark-background version when `onDark` is set.
 */
export function BrandLogo({
  height = 32,
  onDark = false,
}: {
  height?: number;
  onDark?: boolean;
}) {
  if (onDark)
    return (
      <span
        className="brand-logo"
        role="img"
        aria-label="Spool"
        style={{ height }}
      >
        <img src={logoOnDark} alt="" />
      </span>
    );
  return (
    <span
      className="brand-logo"
      role="img"
      aria-label="Spool"
      style={{ height }}
    >
      <img src={logoOnLight} alt="" className="on-light" />
      <img src={logoOnDark} alt="" className="on-dark" />
    </span>
  );
}
