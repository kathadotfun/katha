import type { ReactNode } from "react";

const paths = {
  info: ["M8 7.5v3.5M8 5v.01"],
  error: ["M8 5v3.5M8 11v.01"],
  clock: ["M8 5v3.2l2 1.3"],
  cancel: ["M6 6l4 4M10 6l-4 4"],
  warning: ["M8 2.5l6 11H2z", "M8 7v3M8 12v.01"],
  lock: ["M5.5 7V5a2.5 2.5 0 015 0v2"],
  check: ["M3 8.5l3 3 7-7"],
  close: ["M4 4l8 8M12 4l-8 8"],
  back: ["M10 3L5 8l5 5"],
  refresh: ["M13 8a5 5 0 11-1.5-3.6M13 3v3h-3"],
  copy: ["M10.5 5.5v-3h-8v8h3"],
  external: ["M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5"],
  chevron: ["M4 6l4 4 4-4"],
  plus: ["M8 3v10M3 8h10"],
  upload: ["M8 11V3M5 6l3-3 3 3M3 11v2h10v-2"],
  up: ["M4 10l4-4 4 4"],
  down: ["M4 6l4 4 4-4"],
} as const;
const circled = new Set(["info", "error", "clock", "cancel"]);

export type IconName = keyof typeof paths | "nfc";

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const classes = `ic${className ? ` ${className}` : ""}`;
  if (name === "nfc")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 28 28"
        aria-hidden="true"
        className={classes}
      >
        <rect x="4" y="6" width="13" height="17" rx="1" />
        <path d="M20 10.5c1.4 1 1.4 6 0 7" />
        <path d="M23 8c2.6 2 2.6 10 0 12" />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={classes}
    >
      {circled.has(name) && <circle cx="8" cy="8" r="6" />}
      {name === "lock" && <rect x="3.5" y="7" width="9" height="7" />}
      {name === "copy" && <rect x="5.5" y="5.5" width="8" height="8" />}
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export type Tone = "ok" | "warn" | "err" | "info" | "neu";

function Diamond() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0L10 5 5 10 0 5z" fill="currentColor" />
    </svg>
  );
}

// Badges always carry their meaning in text; the tone only supports it.
export function Badge({
  tone,
  children,
  icon,
  marker = true,
  role,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: IconName;
  marker?: boolean;
  role?: "status";
  className?: string;
}) {
  return (
    <span
      className={`bdg ${tone} cut-s${className ? ` ${className}` : ""}`}
      role={role}
    >
      {icon ? <Icon name={icon} /> : marker ? <Diamond /> : null}
      {children}
    </span>
  );
}

const noticeIcons: Readonly<Record<Tone, IconName>> = {
  ok: "check",
  warn: "warning",
  err: "error",
  info: "info",
  neu: "lock",
};

// Bold first sentence says what happened; the rest says what to do next.
export function Notice({
  tone,
  children,
  icon,
  role = tone === "err" ? "alert" : "status",
  className,
  id,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: IconName;
  role?: "status" | "alert" | "none";
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`note ${tone} cut-s${className ? ` ${className}` : ""}`}
      role={role === "none" ? undefined : role}
    >
      <Icon name={icon ?? noticeIcons[tone]} size={20} />
      <div className="note-body">{children}</div>
    </div>
  );
}

export function FieldTag({
  kind,
  children,
}: {
  kind: "req" | "opt" | "priv" | "lock" | "changed";
  children?: ReactNode;
}) {
  const label = {
    req: "Required",
    opt: "Optional",
    priv: "Private",
    lock: "Locked",
    changed: "Changed",
  }[kind];
  return <span className={`tag t-${kind} cut-s`}>{children ?? label}</span>;
}
