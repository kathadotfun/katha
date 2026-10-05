import { HomeFragmentFocus } from "./home-fragment-focus";
import { ArtworkPhoto } from "./artwork-photo";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { explorationPhotoUrl } from "../lib/artwork-exploration";
import type { FeaturedArtworks } from "../lib/home-page";

const traditions = [
  {
    category: "MANDALA",
    title: "Mandala",
    description:
      "In Buddhist art, the mandala represents a sacred space, often arranged as a square within a circle. Each artwork carries its own documented meaning.",
    source: "https://rubinmuseum.org/highlights/mandala/",
  },
  {
    category: "PAUBHA",
    title: "Paubha",
    description:
      "Paubha is a Newar painting tradition, including hanging scrolls painted on cloth. Discover the artists and the stories recorded with their works.",
    source: "https://rubinmuseum.org/projecthimalayanart/themes/art-making/",
  },
  {
    category: "THANGKA",
    title: "Thangka",
    description:
      "Thangka is a Tibetan hanging-scroll tradition, including paintings on cloth. Explore these works through their individual artists, materials and cultural context.",
    source: "https://rubinmuseum.org/projecthimalayanart/themes/art-making/",
  },
] as const;

export function KathaHomepage({
  featured,
  apiOrigin,
}: {
  featured: FeaturedArtworks;
  apiOrigin: string;
}) {
  return (
    <div className="page-container py-[var(--section-space)]">
      <HomeFragmentFocus />
      <section aria-labelledby="purpose">
        <p className="eyebrow text-brand">Katha · Real World Assets</p>
        <h1 id="purpose" tabIndex={-1} className="mt-8 max-w-4xl text-display">
          Real World Assets, rooted in Nepali culture.
        </h1>
        <p className="mt-6 max-w-[48ch] text-lead text-muted">
          Art carries the stories of its makers. Katha brings documented Nepali artworks
          together with permanent artist attribution and verifiable provenance, so those
          stories stay with the work as ownership changes.
        </p>
        <a href="/explore" className="button-primary mt-8 inline-flex">
          Explore the artworks
        </a>
      </section>

      <section
        aria-labelledby="featured-artworks"
        className="mt-[var(--section-space)] border-t border-line pt-10"
      >
        <p className="eyebrow text-brand">Featured artworks</p>
        <h2 id="featured-artworks" className="mt-3 text-section">
          From the public catalogue
        </h2>
        <p className="mt-4 max-w-reading text-muted">
          Up to three published works, in permanent Katha ID order. Open a record to
          read its story, Katha verification, condition and provenance.
        </p>
        {featured.kind === "UNAVAILABLE" ? (
          <p role="status" className="mt-8 text-muted">
            Featured artworks are temporarily unavailable. Please try again later.
          </p>
        ) : featured.items.length === 0 ? (
          <p className="mt-8 text-muted">
            No published artworks are available yet. Their stories will appear here when
            their public records are ready.
          </p>
        ) : (
          <ul className="mt-8 grid gap-10 md:grid-cols-3">
            {featured.items.map((artwork) => {
              const photo = explorationPhotoUrl(apiOrigin, artwork.heroImage);
              return (
                <li key={artwork.kathaId} className="min-w-0">
                  {photo && artwork.heroImage ? (
                    <ArtworkPhoto
                      src={photo}
                      alt={artwork.heroImage.altText}
                      caption={artwork.title}
                    />
                  ) : (
                    <p className="border-y border-line py-10 text-muted">
                      Artwork photograph is not available.
                    </p>
                  )}
                  <p className="eyebrow mt-5 text-muted">
                    {artworkCategoryLabels[artwork.category]} · {artwork.creationYear}
                  </p>
                  <h3 className="mt-2 text-2xl">
                    <a href={`/art/${artwork.kathaId}`} className="text-link">
                      {artwork.title}
                    </a>
                  </h3>
                  <p className="mt-3">
                    By{" "}
                    <a href={`/artists/${artwork.artist.slug}`} className="text-link">
                      {artwork.artist.displayName}
                    </a>
                  </p>
                  <p className="mt-2 break-words text-sm text-muted">
                    {artwork.kathaId}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <a href="/explore" className="text-link mt-8 inline-flex">
          View the full catalogue
        </a>
      </section>

      <section
        aria-labelledby="traditions"
        className="mt-[var(--section-space)] border-t border-line pt-10"
      >
        <p className="eyebrow text-brand">Living traditions</p>
        <h2 id="traditions" tabIndex={-1} className="mt-3 text-section">
          Begin with the art and its makers.
        </h2>
        <p className="mt-4 max-w-reading text-lead text-muted">
          Preserving Nepali culture begins with documenting the people, materials and
          meanings behind each work. These introductions are a starting point; each
          artist&apos;s account belongs alongside their artwork.
        </p>
        <ul className="mt-10 grid gap-10 md:grid-cols-3">
          {traditions.map((tradition) => (
            <li key={tradition.category}>
              <h3 className="text-2xl">{tradition.title}</h3>
              <p className="mt-4 text-muted">{tradition.description}</p>
              <a
                href={`/explore?category=${tradition.category}`}
                className="text-link mt-4 inline-flex"
              >
                Explore {tradition.title}
              </a>
              <p className="mt-3 text-sm text-muted">
                Background:{" "}
                <a href={tradition.source} className="text-link">
                  Rubin Museum of Himalayan Art
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="record-purpose"
        className="mt-[var(--section-space)] border-t border-line pt-10"
      >
        <p className="eyebrow text-brand">The artwork and its record</p>
        <h2 id="record-purpose" className="mt-3 max-w-3xl text-section">
          A changing owner. An enduring attribution.
        </h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          <div>
            <h3 className="text-xl">Documented authorship</h3>
            <p className="mt-3 text-muted">
              The artist&apos;s identity stays with the permanent Katha ID. A change of
              digital ownership does not transfer authorship or copyright.
            </p>
          </div>
          <div>
            <h3 className="text-xl">Recorded verification</h3>
            <p className="mt-3 text-muted">
              Katha verification records a manual assessment. Condition reports describe
              an inspection at a recorded time, not a guarantee of the artwork&apos;s
              present condition.
            </p>
          </div>
          <div>
            <h3 className="text-xl">Separate ownership and custody</h3>
            <p className="mt-3 text-muted">
              Solana records digital ownership. Physical custody is documented
              separately; owning a digital asset does not confirm physical delivery.
              This demonstration uses Devnet.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
