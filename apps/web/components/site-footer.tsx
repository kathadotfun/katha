export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-container site-footer-inner">
        <div className="max-w-reading">
          <p className="font-serif text-2xl">Katha</p>
          <p className="mt-2 text-sm text-muted">
            Nepali art as Real World Assets. Preserving cultural stories and artist
            authorship through documented provenance.
          </p>
        </div>
        <nav aria-label="Project links" className="flex flex-col items-start gap-2">
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
