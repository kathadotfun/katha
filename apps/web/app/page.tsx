import Image from "next/image";

export default function HomePage() {
  return (
    <main className="page-container flex min-h-svh flex-col justify-center py-[var(--section-space)]">
      <div className="flex items-center gap-4">
        <Image src="/brand/katha-profile.svg" alt="" width={56} height={56} />
        <p className="eyebrow text-brand">Katha · Real World Assets</p>
      </div>
      <h1 className="mt-8 max-w-4xl text-display">
        Real World Assets, rooted in Nepali culture.
      </h1>
      <p className="mt-6 max-w-[42ch] text-lead text-muted">
        Preserving Nepal&apos;s Mandala, Paubha and Thangka traditions through
        documented artworks, permanent artist attribution and verifiable provenance.
      </p>
    </main>
  );
}
