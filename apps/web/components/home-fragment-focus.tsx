"use client";

import { useEffect } from "react";

export function HomeFragmentFocus() {
  useEffect(() => {
    // A cross-page fragment can arrive before the streamed home content exists.
    // Run after this page mounts; same-page anchors retain native focus behavior.
    const fragment = window.location.hash;
    if (fragment === "#purpose" || fragment === "#traditions")
      document.getElementById(fragment.slice(1))?.focus();
  }, []);
  return null;
}
