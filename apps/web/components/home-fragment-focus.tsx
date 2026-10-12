"use client";

import { useEffect } from "react";

const targets = new Set(["#purpose", "#rwa", "#traditions", "#collecting"]);

export function HomeFragmentFocus() {
  useEffect(() => {
    // A cross-page fragment can arrive before the streamed home content exists.
    // Run after this page mounts; same-page anchors retain native focus behavior.
    const fragment = window.location.hash;
    if (targets.has(fragment)) document.getElementById(fragment.slice(1))?.focus();
  }, []);
  return null;
}
