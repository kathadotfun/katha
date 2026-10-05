export default function HomePage() {
  return (
    <section
      aria-labelledby="purpose"
      className="page-container py-[var(--section-space)]"
    >
      <p className="eyebrow text-brand">Katha · Real World Assets</p>
      <h1 id="purpose" tabIndex={-1} className="mt-8 max-w-4xl text-display">
        Real World Assets, rooted in Nepali culture.
      </h1>
      <p
        id="traditions"
        tabIndex={-1}
        className="mt-6 max-w-[42ch] text-lead text-muted"
      >
        Preserving Nepal&apos;s Mandala, Paubha and Thangka traditions through
        documented artworks, permanent artist attribution and verifiable provenance.
      </p>
      <a href="/explore" className="button-primary mt-8 inline-flex">
        Explore the artworks
      </a>
    </section>
  );
}
