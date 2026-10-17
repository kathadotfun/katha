"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "./ui/status";

// Evidence stays on this device. Only its digest enters the existing draft API.
export function EvidenceFingerprint({
  onFingerprint,
  disabled,
}: {
  onFingerprint: (digest: string) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const [state, setState] = useState<"idle" | "reading" | "ready" | "error">("idle");
  async function fingerprint(file: File | undefined) {
    if (!file || disabled) return;
    const request = ++generation.current;
    if (file.size > 25 * 1024 * 1024) {
      setState("error");
      return;
    }
    setState("reading");
    try {
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      if (request !== generation.current) return;
      onFingerprint(
        Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      );
      setState("ready");
    } catch {
      if (request === generation.current) setState("error");
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void fingerprint(event.dataTransfer.files[0]);
  }
  return (
    <div className="drop" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <Icon name="upload" size={22} />
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Private authorship evidence file"
        disabled={disabled || state === "reading"}
        onChange={(event) => void fingerprint(event.currentTarget.files?.[0])}
      />
      <p className="m-0 text-sm font-medium">
        Drop an evidence file or{" "}
        <button
          className="lnk"
          type="button"
          disabled={disabled || state === "reading"}
          onClick={() => input.current?.click()}
        >
          browse files
        </button>
      </p>
      <p className="help">Calculated locally, never uploaded. Maximum 25 MB.</p>
      {state !== "idle" && (
        <p
          className={state === "error" ? "ferr" : "help"}
          role={state === "error" ? "alert" : "status"}
        >
          {state === "reading"
            ? "Calculating fingerprint…"
            : state === "ready"
              ? "Fingerprint calculated. Keep the original evidence privately."
              : "The file couldn’t be read. Choose a file up to 25 MB or enter its SHA-256 fingerprint below."}
        </p>
      )}
    </div>
  );
}
