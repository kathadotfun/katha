// The approved stepped Dhaka diamond, drawn inline so it can sit on red, paper
// or ink surfaces without a raster background. Geometry matches katha-profile.svg.
const outer =
  "-48,280 48,280 48,208 120,208 120,136 192,136 192,64 264,64 264,-64 192,-64 192,-136 120,-136 120,-208 48,-208 48,-280 -48,-280 -48,-208 -120,-208 -120,-136 -192,-136 -192,-64 -264,-64 -264,64 -192,64 -192,136 -120,136 -120,208 -48,208";
const inner = "0,160 160,0 0,-160 -160,0";
const gem = "0,46 46,0 0,-46 -46,0";

const fills = {
  red: ["#F3E8D8", "#71332D", "#D6A671"],
  footer: ["#F3E8D8", "#4A1F1B", "#D6A671"],
  ops: ["#F3E8D8", "#2A1714", "#D6A671"],
  paper: ["#71332D", "#F3E8D8", "#D6A671"],
} as const;

export const kathaMarkPoints = { outer, inner, gem } as const;

export function KathaMark({
  size,
  variant = "red",
}: {
  size: number;
  variant?: keyof typeof fills | "outline" | "ink-outline" | "ink-dashed";
}) {
  if (variant === "outline" || variant === "ink-outline" || variant === "ink-dashed") {
    const className =
      variant === "outline"
        ? "php"
        : `ph-ink${variant === "ink-dashed" ? " dash" : ""}`;
    return (
      <svg width={size} height={size} viewBox="-340 -340 680 680" aria-hidden="true">
        <g transform="scale(1.2)">
          <polygon points={outer} className={className} />
          <polygon points={inner} className={className} />
        </g>
      </svg>
    );
  }
  const [a, b, c] = fills[variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="-340 -340 680 680"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <g transform="scale(1.2)">
        <polygon points={outer} fill={a} className="logo-outer" />
        <polygon points={inner} fill={b} className="logo-inner" />
        <polygon points={gem} fill={c} className="logo-centre" />
      </g>
    </svg>
  );
}
