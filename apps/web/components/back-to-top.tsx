"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./ui/status";
import { headerVariant } from "../lib/site-routes";

// Appears after roughly one screen of scrolling; hidden buttons leave the tab order.
export function BackToTop() {
  const pathname = usePathname() ?? "/";
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const variant = headerVariant(pathname);
    if (variant === "collector" || variant === "ops") return;
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    let frame = 0;
    let target = window.scrollY;
    let position = window.scrollY;
    let previousTime = 0;
    const cancel = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const animate = (time: number) => {
      const remaining = target - position;
      const elapsed = Math.min(time - previousTime, 32);
      previousTime = time;
      if (Math.abs(remaining) < 0.5) {
        window.scrollTo({ top: target, behavior: "instant" });
        frame = 0;
        return;
      }
      // Keep fractional progress between frames; reading rounded scrollY can stall easing.
      position += remaining * (1 - Math.exp(-elapsed / 85));
      window.scrollTo({
        top: position,
        behavior: "instant",
      });
      // A resized document must not leave an animation chasing an unreachable position.
      target = Math.max(
        0,
        Math.min(target, document.documentElement.scrollHeight - window.innerHeight),
      );
      frame = window.requestAnimationFrame(animate);
    };
    const wheel = (event: WheelEvent) => {
      // Preserve native precision gestures, zoom, touch and scrollable form/dialog surfaces.
      if (
        !motion.matches ||
        !event.cancelable ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        (event.deltaMode === 0 &&
          (Math.abs(event.deltaY) < 40 || !Number.isInteger(event.deltaY)))
      ) {
        cancel();
        return;
      }
      let element = event.target instanceof Element ? event.target : null;
      if (
        element?.closest(
          "input, textarea, select, [contenteditable], dialog[open], [role='dialog']",
        )
      ) {
        cancel();
        return;
      }
      while (element && element !== document.body) {
        if (
          element.scrollHeight > element.clientHeight &&
          /auto|scroll/.test(window.getComputedStyle(element).overflowY)
        ) {
          cancel();
          return;
        }
        element = element.parentElement;
      }
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const maximum = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const delta = event.deltaY * scale;
      const current = window.scrollY;
      const pending =
        frame && Math.sign(delta) === Math.sign(target - current) ? target : current;
      target = Math.max(0, Math.min(maximum, pending + delta));
      if (target === window.scrollY) return;
      event.preventDefault();
      if (!frame) {
        position = window.scrollY;
        previousTime = window.performance.now();
        frame = window.requestAnimationFrame(animate);
      }
    };
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    motion.addEventListener("change", cancel);
    return () => {
      cancel();
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel);
      motion.removeEventListener("change", cancel);
    };
  }, [pathname]);
  useEffect(() => {
    const update = () => setShown(window.scrollY > window.innerHeight);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <button
      type="button"
      className="to-top"
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
      <span>Back to top</span>
    </button>
  );
}
