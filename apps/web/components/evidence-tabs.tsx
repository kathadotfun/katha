"use client";

import { useEffect, useState, type ReactNode } from "react";

export type EvidenceTab = Readonly<{ id: string; label: string; content: ReactNode }>;

// Progressive enhancement: the server renders every panel in order, so the record
// reads fully without JavaScript. After hydration the panels become tabs, and
// fragment links (#ev-condition, #provenance) select the matching tab.
export function EvidenceTabs({ tabs }: { tabs: EvidenceTab[] }) {
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState(tabs[0]?.id ?? "");
  useEffect(() => {
    const select = () => {
      const hash = window.location.hash.slice(1);
      if (!tabs.some((tab) => tab.id === hash)) return;
      setSelected(hash);
      // A hidden panel can't be the scroll target, so scroll once it is shown.
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    };
    setEnhanced(true);
    select();
    window.addEventListener("hashchange", select);
    return () => window.removeEventListener("hashchange", select);
  }, [tabs]);
  if (!enhanced)
    return (
      <div className="flex flex-col gap-6">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={tab.id}
            className="panel"
            style={{ padding: "clamp(20px, 3vw, 40px)" }}
          >
            {tab.content}
          </div>
        ))}
      </div>
    );
  return (
    <>
      <div className="tabbar" role="tablist" aria-label="Evidence">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab.id === selected}
            aria-controls={tab.id}
            tabIndex={tab.id === selected ? 0 : -1}
            onClick={() => setSelected(tab.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab.id);
              const next =
                event.key === "ArrowRight"
                  ? tabs[(index + 1) % tabs.length]
                  : event.key === "ArrowLeft"
                    ? tabs[(index - 1 + tabs.length) % tabs.length]
                    : event.key === "Home"
                      ? tabs[0]
                      : event.key === "End"
                        ? tabs.at(-1)
                        : undefined;
              if (!next) return;
              event.preventDefault();
              setSelected(next.id);
              document.getElementById(`${next.id}-tab`)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={tab.id}
          role="tabpanel"
          aria-labelledby={`${tab.id}-tab`}
          tabIndex={0}
          hidden={tab.id !== selected}
          className="panel"
          style={{ padding: "clamp(20px, 3vw, 40px)" }}
        >
          {tab.content}
        </div>
      ))}
    </>
  );
}
