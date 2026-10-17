"use client";

import { useSyncExternalStore } from "react";

const eventName = "katha-theme";
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  const storage = (event: StorageEvent) => {
    if (event.key !== "katha-theme") return;
    const dark = event.newValue !== "light";
    document.documentElement.classList.toggle("t-dark", dark);
    document.documentElement.classList.toggle("t-light", !dark);
    listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", storage);
  };
}
const snapshot = () => document.documentElement.classList.contains("t-dark");
const serverSnapshot = () => true;

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <button
      className="tgl"
      type="button"
      aria-label="Dark theme"
      aria-pressed={dark}
      onClick={() => {
        const next = !snapshot();
        document.documentElement.classList.toggle("t-dark", next);
        document.documentElement.classList.toggle("t-light", !next);
        try {
          localStorage.setItem("katha-theme", next ? "dark" : "light");
        } catch {
          // A blocked storage policy still allows a theme for this visit.
        }
        window.dispatchEvent(new Event(eventName));
      }}
    >
      <span className="tgl-t">
        <span className="tgl-k">
          <svg
            className="ic"
            width="14"
            height="14"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            {dark ? (
              <path d="M15.8 12.4A6.5 6.5 0 017.6 4.2a6.5 6.5 0 108.2 8.2z" />
            ) : (
              <>
                <circle cx="10" cy="10" r="3.4" />
                <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7L6 6M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3" />
              </>
            )}
          </svg>
        </span>
      </span>
    </button>
  );
}
