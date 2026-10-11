export type HeaderVariant = "home" | "public" | "collector" | "ops";

// Collector routes use the collector header; administration uses operations chrome.
export function headerVariant(pathname: string): HeaderVariant {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "ops";
  if (
    pathname === "/account" ||
    pathname === "/collection" ||
    pathname.startsWith("/collection/") ||
    /^\/art\/[^/]+\/purchase$/.test(pathname)
  )
    return "collector";
  return pathname === "/" ? "home" : "public";
}
