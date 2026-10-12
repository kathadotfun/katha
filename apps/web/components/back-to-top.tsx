"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui/status";

// Appears after roughly one screen of scrolling; hidden buttons leave the tab order.
export function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const update = () => setShown(window.scrollY > window.innerHeight);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <button
      type="button"
      className="to-top cut-s"
      data-shown={shown}
      aria-label="Back to top"
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Focus returns to the start of the content so keyboard users move with the view.
        document.getElementById("main-content")?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
    >
      <Icon name="up" size={18} />
      <span>Top</span>
    </button>
  );
}
