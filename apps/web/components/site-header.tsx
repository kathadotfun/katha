"use client";

import { WalletControl } from "./wallet-control";
import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        // This is an in-flow mobile disclosure, not a modal or focus trap.
        if (event.key === "Escape" && menuOpen && menuButton.current?.offsetParent) {
          setMenuOpen(false);
          menuButton.current.focus();
        }
      }}
    >
      <noscript>
        <style>{`.site-menu-panel { display: flex !important; } .site-menu-toggle { display: none !important; }`}</style>
      </noscript>
      <div className="page-container site-header-inner">
        <Link
          href="/"
          aria-label="Katha home"
          className="site-brand"
          onClick={() => setMenuOpen(false)}
        >
          <Image src="/brand/katha-profile.svg" alt="" width={40} height={40} />
          <span className="site-brand-name">Katha</span>
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="site-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span>{menuOpen ? "Close menu" : "Menu"}</span>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d={menuOpen ? "M6 6l12 12M6 18L18 6" : "M4 8h16M4 16h16"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div id="site-navigation" className="site-menu-panel" data-open={menuOpen}>
          <nav aria-label="Primary">
            <ul className="site-nav">
              <li>
                <Link
                  href="/"
                  className="site-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href="/explore"
                  className="site-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  Explore
                </Link>
              </li>
              <li>
                <a
                  href="/#purpose"
                  className="site-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  Our purpose
                </a>
              </li>
              <li>
                <a
                  href="/#traditions"
                  className="site-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  Traditions
                </a>
              </li>
            </ul>
          </nav>
          <Link
            href="/account"
            className="site-nav-link"
            onClick={() => setMenuOpen(false)}
          >
            My account
          </Link>
          <WalletControl />
        </div>
      </div>
    </header>
  );
}
