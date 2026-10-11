"use client";

import { useState } from "react";
import { Icon } from "./status";

export function CopyButton({
  value,
  label,
  text = "Copy",
}: {
  value: string;
  label: string;
  text?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cpy cut-s"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      <Icon name="copy" size={14} />
      <span aria-live="polite">{copied ? "Copied" : text}</span>
    </button>
  );
}
