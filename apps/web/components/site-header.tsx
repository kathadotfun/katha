"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { signedOutSnapshot } from "../lib/wallet-session";
import { useWalletSession } from "./wallet-provider";
import { KathaMark } from "./ui/katha-mark";
import { shortAddress } from "../lib/format";
import { headerVariant } from "../lib/site-routes";

const emptySubscribe = () => () => {};
const serverSessionSnapshot = () => signedOutSnapshot;

type Role = "Admin" | "Verifier" | "No role" | null;

function useSignedInAddress() {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverSessionSnapshot,
    serverSessionSnapshot,
  );
  return { session, address: auth.session?.walletAddress ?? null, auth };
}

// Roles come from the API for the current session; nothing is shown until known.
function useRole(enabled: boolean): Role {
  const { session, auth } = useSignedInAddress();
  const [role, setRole] = useState<{ key: string; value: Role } | null>(null);
  const key =
    enabled && auth.session
      ? `${auth.session.walletId}:${auth.session.expiresAt}`
      : null;
  useEffect(() => {
    if (!key || !session) return;
    const abort = new AbortController();
    session
      .permissions(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted)
          setRole({
            key,
            value: value.admin ? "Admin" : value.verifier ? "Verifier" : "No role",
          });
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [key, session]);
  return role && role.key === key ? role.value : null;
}

// The sticky header leaves the reader's way while they scroll down or pause, and
// returns on any upward scroll. It always shows near the top, under the pointer
// and (through CSS :focus-within) while it holds keyboard focus.
const revealIdleMs = 1500;
function useAutoHide(header: RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    let last = window.scrollY;
    let idle: number | undefined;
    let hovered = false;
    const pastHeader = () => window.scrollY > element.offsetHeight;
    const hideLater = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (!hovered && pastHeader()) setHidden(true);
      }, revealIdleMs);
    };
    const onScroll = () => {
      const y = window.scrollY;
      if (!pastHeader()) {
        window.clearTimeout(idle);
        setHidden(false);
        last = y;
        return;
      }
      if (Math.abs(y - last) < 4) return;
      const up = y < last;
      last = y;
      setHidden(!up);
      if (up) hideLater();
      else window.clearTimeout(idle);
    };
    // Keyboard focus moving into the page must not sit under a revealed header.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !element.contains(target) &&
        target.matches(":focus-visible") &&
        pastHeader()
      )
        setHidden(true);
    };
    const onEnter = () => {
      hovered = true;
      window.clearTimeout(idle);
    };
    const onLeave = () => {
      hovered = false;
      if (pastHeader()) hideLater();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    element.addEventListener("pointerenter", onEnter);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      element.removeEventListener("pointerenter", onEnter);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [header]);
  return hidden;
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const variant = headerVariant(pathname);
  const [menu, setMenu] = useState<{ open: boolean; path: string }>({
    open: false,
    path: pathname,
  });
  // Navigating closes the in-flow menu.
  const open = menu.open && menu.path === pathname;
  const button = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  // An open menu stays on screen until the reader closes it or navigates.
  const hidden = useAutoHide(header) && !open;
  const { address } = useSignedInAddress();
  const role = useRole(variant === "ops");
  const close = () => setMenu({ open: false, path: pathname });
  const chip = address ? shortAddress(address) : "Sign in";
  // On the home page, section links stay native fragments so the browser moves
  // focus to the section; elsewhere the router keeps the wallet session alive.
  const samePage = (href: string) => pathname === "/" && href.startsWith("/#");

  const artworksCurrent =
    pathname === "/explore" ||
    (pathname.startsWith("/art/") && variant !== "collector");
  const links =
    variant === "ops"
      ? [
          { href: "/admin", label: "Administration", current: pathname === "/admin" },
          {
            href: "/admin/artworks",
            label: "Artworks",
            current: pathname.startsWith("/admin/artworks"),
          },
        ]
      : variant === "collector"
        ? [
            { href: "/explore", label: "Artworks", current: false },
            {
              href: "/collection",
              label: "My collection",
              current: pathname.startsWith("/collection"),
            },
          ]
        : [
            { href: "/explore", label: "Artworks", current: artworksCurrent },
            { href: "/#rwa", label: "Why RWAs", current: false },
            { href: "/#collecting", label: "How collecting works", current: false },
          ];
  const mobileAccount =
    variant === "ops"
      ? address
        ? `Signed in as ${shortAddress(address)}`
        : "Sign in"
      : variant === "collector"
        ? address
          ? "Account"
          : "Sign in"
        : address
          ? "Account"
          : "Sign in";

  return (
    <header
      ref={header}
      data-hidden={hidden}
      className={`hdr weave dk${variant === "ops" ? " hdr-ops" : ""}${variant === "home" ? " hdr-home" : ""}`}
      onKeyDown={(event) => {
        // An in-flow disclosure, not a modal: Escape returns focus to its button.
        if (event.key === "Escape" && open && button.current?.offsetParent) {
          close();
          button.current.focus();
        }
      }}
    >
      <noscript>
        <style>{`@media (max-width:860px){.hdr:not(.hdr-ops) .mnav{display:block!important}.hdr:not(.hdr-ops) .menubtn{display:none!important}}@media (max-width:900px){.hdr-ops .mnav{display:block!important}.hdr-ops .menubtn{display:none!important}}`}</style>
      </noscript>
      <div className="wrap hdr-in">
        {variant === "ops" ? (
          <div className="flex items-center gap-3.5">
            <Link
              className="brand"
              href="/admin"
              aria-label="Katha operations home"
              onClick={close}
            >
              <KathaMark size={32} variant="ops" />
              <span className="brand-w">KATHA</span>
            </Link>
            <span className="ctx">Operations</span>
          </div>
        ) : (
          <Link className="brand" href="/" aria-label="Katha home" onClick={close}>
            <KathaMark size={variant === "home" ? 34 : 32} />
            <span className="brand-w">KATHA</span>
          </Link>
        )}
        <nav className="nav" aria-label={variant === "ops" ? "Operations" : "Main"}>
          {links.map((link) =>
            samePage(link.href) ? (
              <a key={link.href} href={link.href.slice(1)}>
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.current ? "page" : undefined}
              >
                {link.label}
              </Link>
            ),
          )}
          {variant === "ops" ? (
            <Link
              className="who cut-s"
              href="/account"
              aria-current={pathname === "/account" ? "page" : undefined}
            >
              {role && <span className="role">{role}</span>}
              <span className="id">{chip}</span>
            </Link>
          ) : (
            <Link
              className="hbtn cut-s"
              href="/account"
              aria-label={address ? `Account, signed in as ${chip}` : undefined}
            >
              {chip}
            </Link>
          )}
        </nav>
        <button
          ref={button}
          type="button"
          className="hbtn menubtn cut-s"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setMenu({ open: !open, path: pathname })}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <nav
        id="mobile-navigation"
        className="mnav wrap"
        data-open={open}
        aria-label={variant === "ops" ? "Operations" : "Main"}
      >
        {links.map((link) =>
          samePage(link.href) ? (
            <a key={link.href} href={link.href.slice(1)} onClick={close}>
              {link.label}
            </a>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              aria-current={link.current ? "page" : undefined}
              onClick={close}
            >
              {link.label}
            </Link>
          ),
        )}
        <Link
          href="/account"
          aria-current={pathname === "/account" ? "page" : undefined}
          onClick={close}
        >
          {mobileAccount}
        </Link>
      </nav>
    </header>
  );
}
