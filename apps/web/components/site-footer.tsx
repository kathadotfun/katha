export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-container site-footer-inner">
        <div className="max-w-reading">
          <Link href="/" className="site-brand" aria-label="Katha home">
            <Image src="/brand/katha-profile.svg" alt="" width={32} height={32} />
            <span className="font-display text-2xl font-semibold tracking-tight">
              Katha
            </span>
          </Link>
          <p className="mt-4 max-w-[48ch] text-sm text-muted">
            Nepali art as Real World Assets. Preserving cultural stories and artist
            authorship through documented provenance.
          </p>
        </div>
        <nav aria-label="Project links" className="flex flex-col items-start gap-2">
          <Link href="/explore" className="text-link min-h-11 py-2 text-sm">
            Explore artworks
          </Link>
          <a
            href="https://x.com/kathadotfun"
            className="text-link min-h-11 py-2 text-sm"
          >
            @kathadotfun on X
          </a>
          <p className="text-caption text-muted">katha.fun</p>
        </nav>
      </div>
    </footer>
  );
}
import Image from "next/image";
import Link from "next/link";
