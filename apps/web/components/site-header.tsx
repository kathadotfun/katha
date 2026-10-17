"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signedOutSnapshot } from "../lib/wallet-session";
import { useWalletSession } from "./wallet-provider";
import { KathaMark } from "./ui/katha-mark";
import { shortAddress } from "../lib/format";
import { headerVariant } from "../lib/site-routes";
import { ThemeToggle } from "./theme-toggle";

const noop = () => () => {};
const signedOut = () => signedOutSnapshot;
type Role = "Administrator" | "Verifier" | "No operations role" | null;

export function SiteHeader({
  cluster = "localnet",
}: {
  cluster?: "localnet" | "devnet";
}) {
  const pathname = usePathname() ?? "/";
  const variant = headerVariant(pathname);
  const dashboard = variant === "ops" || variant === "collector";
  const ops = variant === "ops";
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? signedOut,
    signedOut,
  );
  const address = auth.session?.walletAddress ?? null;
  const [role, setRole] = useState<{ key: string; value: Role } | null>(null);
  const key = auth.session
    ? `${auth.session.walletId}:${auth.session.expiresAt}`
    : null;
  useEffect(() => {
    if (!session || !key) return;
    const abort = new AbortController();
    session
      .permissions(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted)
          setRole({
            key,
            value: value.admin
              ? "Administrator"
              : value.verifier
                ? "Verifier"
                : "No operations role",
          });
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [session, key, pathname]);
  const currentRole = role?.key === key ? role?.value : null;
  const [menu, setMenu] = useState({ path: pathname, open: false });
  const open = menu.path === pathname && menu.open;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (dashboard || !header) return;
    let previousY = window.scrollY;
    let frame = 0;
    let idle: number | undefined;
    const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
    const protectedInteraction = () =>
      (hover.matches && header.matches(":hover")) ||
      header.querySelector(":focus-visible") !== null ||
      header.dataset.menuOpen === "true";
    const hide = () => {
      if (window.scrollY > 96 && !protectedInteraction())
        header.dataset.scrollHidden = "true";
    };
    const settle = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(hide, 900);
    };
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      header.dataset.scrolled = String(y > 96);
      if (y <= 96) {
        header.dataset.scrollHidden = "false";
        window.clearTimeout(idle);
      } else if (y < previousY - 0.75) {
        header.dataset.scrollHidden = "false";
        settle();
      } else if (y > previousY + 0.75) {
        hide();
      }
      previousY = y;
    };
    const scroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    header.dataset.scrollHidden = String(previousY > 96);
    header.dataset.scrolled = String(previousY > 96);
    window.addEventListener("scroll", scroll, { passive: true });
    header.addEventListener("mouseleave", settle);
    header.addEventListener("focusout", settle);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      window.removeEventListener("scroll", scroll);
      header.removeEventListener("mouseleave", settle);
      header.removeEventListener("focusout", settle);
    };
  }, [dashboard, pathname]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = () => setMenu({ path: pathname, open: false });
  const homeLinks = [
    { href: "/#works", label: "Artworks" },
    { href: "/#own", label: "What you own" },
    { href: "/#how", label: "How it works" },
    { href: "/#record", label: "Record" },
    { href: "/#faq", label: "FAQ" },
  ];
  const publicLinks = [
    { href: "/explore", label: "Artworks" },
    { href: "/#own", label: "What you own" },
    { href: "/#how", label: "How it works" },
  ];
  const links = ops
    ? [
        { href: "/admin", label: "Overview" },
        { href: "/admin/artworks", label: "Artworks" },
        { href: "/admin/artworks/new", label: "New artwork" },
        { href: "/admin/devnet", label: "Devnet setup" },
      ]
    : dashboard
      ? [
          { href: "/collection", label: "My collection" },
          { href: "/explore", label: "Artworks" },
          { href: "/account", label: "Account" },
          ...(currentRole === "Administrator" || currentRole === "Verifier"
            ? [{ href: "/admin", label: "Operations" }]
            : []),
        ]
      : variant === "home"
        ? homeLinks
        : publicLinks;
  function isCurrent(href: string) {
    if (href === "/admin/artworks")
      return pathname.startsWith(href) && pathname !== "/admin/artworks/new";
    if (href === "/collection") return pathname.startsWith(href);
    if (href === "/explore")
      return pathname === href || (pathname.startsWith("/art/") && !dashboard);
    return pathname === href;
  }
  function navigation(mobile = false) {
    return links.map((link, index) =>
      variant === "home" && link.href.startsWith("/#") ? (
        <a key={link.href} href={link.href.slice(1)} onClick={close}>
          {link.label}
        </a>
      ) : (
        <Link
          key={link.href}
          href={link.href}
          onClick={close}
          aria-current={isCurrent(link.href) ? "page" : undefined}
        >
          {dashboard && !mobile && (
            <svg
              className="ic"
              width="18"
              height="18"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                d={
                  link.href.endsWith("/new")
                    ? "M10 4v12M4 10h12"
                    : index === 0
                      ? "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z"
                      : link.href === "/account"
                        ? "M10 10a3 3 0 100-6 3 3 0 000 6M4 17c1-3 3-4.5 6-4.5s5 1.5 6 4.5"
                        : "M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5"
                }
              />
            </svg>
          )}
          {link.label}
        </Link>
      ),
    );
  }
  const brand = (
    <Link className="brand" href="/" aria-label="Katha home" onClick={close}>
      <KathaMark size={28} />
      <span className="brand-w">KATHA</span>
    </Link>
  );
  const network = (
    <span className="net">
      <span className="dot" aria-hidden="true" />
      {cluster === "devnet" ? "Devnet" : "Localnet"}
    </span>
  );
  const toggle = (
    <button
      ref={menuButton}
      className="iconbtn menubtn"
      type="button"
      aria-label={open ? "Close menu" : "Menu"}
      aria-expanded={open}
      aria-controls="mobile-navigation"
      onClick={() => setMenu({ path: pathname, open: !open })}
    >
      <svg className="ic" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
        <path d={open ? "M5 5l10 10M15 5L5 15" : "M3 6h14M3 10h14M3 14h14"} />
      </svg>
    </button>
  );
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const crumb =
    pathname === "/account"
      ? "Account"
      : pathname === "/collection"
        ? "My collection"
        : pathname === "/admin"
          ? "Overview"
          : pathname.endsWith("/new")
            ? "New artwork"
            : segment.startsWith("KATHA-")
              ? segment
              : ((
                  {
                    list: "Manage listing",
                    delivery: "Delivery and returns",
                    resale: "Resale approval",
                    purchase: "Review purchase",
                    artworks: "Artworks",
                    devnet: "Devnet setup",
                  } as Record<string, string>
                )[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1));

  return (
    <header
      ref={headerRef}
      className={dashboard ? "dashboard-header" : "hdr"}
      data-menu-open={open}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          close();
          menuButton.current?.focus();
        }
      }}
    >
      <noscript>
        <style>{`@media(max-width:900px){.mnav[data-open="false"]{display:flex!important}.menubtn{display:none!important}}`}</style>
      </noscript>
      {dashboard ? (
        <>
          <aside className="side" aria-label="Sidebar">
            {brand}
            <span className="net">
              <span className="dot" aria-hidden="true" />
              {ops ? "Operations · " : "Solana "}
              {cluster === "devnet" ? "Devnet" : "Localnet"}
            </span>
            <nav className="navi" aria-label={ops ? "Operations" : "Collector"}>
              {navigation()}
            </nav>
            <div className="side-foot">
              <Link className="tx px-2 py-1.5 text-sm" href="/">
                Back to katha.fun
              </Link>
              <Link
                className="who"
                href="/account"
                aria-label={
                  address ? `Account, signed in as ${shortAddress(address)}` : "Sign in"
                }
              >
                <span className="ava">{address ? address.slice(0, 2) : "··"}</span>
                <span className="min-w-0">
                  <span className="mono block text-[13px]">
                    {address ? shortAddress(address) : "No wallet"}
                  </span>
                  <span className="xs">
                    {address
                      ? ops
                        ? (currentRole ?? "Checking access")
                        : "Signed in"
                      : "Not signed in"}
                  </span>
                </span>
              </Link>
            </div>
          </aside>
          <div className="topbar">
            <div className="row min-w-0">
              {toggle}
              <nav className="crumbs" aria-label="Workspace breadcrumb">
                <Link href={ops ? "/admin" : "/collection"}>
                  {ops ? "Operations" : "Collector"}
                </Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page" className="wrap-break-word">
                  {crumb}
                </span>
              </nav>
            </div>
            <div className="hright">
              {network}
              <ThemeToggle />
            </div>
          </div>
        </>
      ) : (
        <div className="wrap hdr-in">
          {brand}
          <nav className="nav" aria-label="Main">
            {navigation()}
          </nav>
          <div className="hright">
            {network}
            <ThemeToggle />
            <Link className="btn btn-p btn-sm hide-sm" href="/account">
              {address ? shortAddress(address) : "Connect wallet"}
            </Link>
            {toggle}
          </div>
        </div>
      )}
      <nav
        id="mobile-navigation"
        className={`mnav ${dashboard ? "" : "wrap"}`}
        data-open={open}
        aria-label={
          ops ? "Operations mobile" : dashboard ? "Collector mobile" : "Main mobile"
        }
      >
        {variant === "home" && (
          <noscript>
            <style>{`#mobile-navigation a[href="#works"]{display:none}`}</style>
            <a href="/explore">Artworks</a>
          </noscript>
        )}
        {navigation(true)}
        {!links.some((link) => link.href === "/account") && (
          <Link href="/account" onClick={close}>
            {address ? "Account" : "Sign in"}
          </Link>
        )}
        {dashboard && (
          <Link href="/" onClick={close}>
            Back to katha.fun
          </Link>
        )}
      </nav>
    </header>
  );
}
