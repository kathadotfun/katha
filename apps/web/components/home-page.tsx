import Link from "next/link";
import { HomeFragmentFocus } from "./home-fragment-focus";
import { ArtworkCard } from "./artwork-card";
import { Icon } from "./ui/status";
import { RetryButton } from "./ui/retry-button";
import type { FeaturedArtworks } from "../lib/home-page";

const traditions = [
  {
    category: "PAUBHA",
    title: "Paubha",
    nepali: "पौभा",
    image: "paubha",
    text: "Devotional scroll painting of the Newar artists of the Kathmandu Valley, in mineral pigments and gold.",
    alt: "AI design illustration of a Paubha with Green Tara beneath a gilded arch.",
  },
  {
    category: "MANDALA",
    title: "Mandala",
    nepali: "मण्डल",
    image: "mandala",
    text: "A map of sacred space: a palace with four gates inside rings of fire and vajra, read from the outside in.",
    alt: "AI design illustration of a mandala with an eight-petal lotus and four gates.",
  },
  {
    category: "THANGKA",
    title: "Thangka",
    nepali: "थाङ्का",
    image: "thangka",
    text: "A Himalayan Buddhist scroll mounted in silk brocade, its figures drawn to set proportions.",
    alt: "AI design illustration of a Buddha thangka mounted in silk brocade.",
  },
] as const;
const own = [
  {
    label: "The painting",
    title: "One physical original",
    image: "paubha-detail",
    alt: "AI illustration: detail of Green Tara, her crown and a lotus flower.",
    text: "Inspected in person and graded for condition. Physical custody is recorded separately from who owns the asset.",
  },
  {
    label: "The asset",
    title: "One asset in your wallet",
    image: "mandala-detail",
    alt: "AI illustration: a lotus at the centre of a mandala.",
    text: "A single Metaplex Core asset on Solana, bound to the painting’s record. Copyright stays with the artist.",
  },
  {
    label: "The record",
    title: "A history anyone can check",
    image: "thangka-detail",
    alt: "AI illustration: Buddha seated before a blue halo.",
    text: "Registration, verification, inspections, custody changes and transfers, with the recorded evidence available to check.",
  },
];
const steps = [
  {
    title: "Document",
    path: "M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M7.5 10h5M7.5 13h5",
    text: "The artist’s identity, the work’s story and authorship evidence are collected and fingerprinted.",
    where: "Off chain",
  },
  {
    title: "Register",
    path: "M3.5 7.5h13M3.5 12.5h13M8 3l-1.5 14M13.5 3L12 17",
    text: "The painting gets a permanent Katha ID, attributed to its artist.",
    where: "On Solana",
  },
  {
    title: "Verify",
    path: "M10 2.5l6 2.3v4.7c0 3.6-2.6 6.4-6 7.9-3.4-1.5-6-4.3-6-7.9V4.8zM7.4 10l1.8 1.8 3.4-3.6",
    text: "A verifier inspects the original in person and grades its condition. Both checks are signed.",
    where: "On Solana",
  },
  {
    title: "Mint",
    path: "M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5zM10 7.5v5M7.5 10h5",
    text: "One asset is minted and bound to the painting’s record. Only one, ever.",
    where: "On Solana",
  },
  {
    title: "Collect",
    path: "M3 6.5h13.5v10H3zM3 6.5l1.5-3h10l2 3M12.5 11.5h2",
    text: "Buy with your wallet, then request delivery or leave the painting in its recorded custody.",
    where: "On Solana",
  },
];
const faq = [
  [
    "What exactly do I own?",
    "A single asset on Solana linked to one physical painting, held in your own wallet. You can request delivery of the painting or leave it in Katha’s custody where available. Copyright stays with the artist.",
  ],
  [
    "How is authenticity checked?",
    "A Katha verifier inspects each work in person and reviews its authorship evidence before anything is minted. The result is signed by the verifier’s wallet. It’s a documented assessment, not a guarantee.",
  ],
  [
    "Does the NFC tag prove it’s authentic?",
    "No. The tag opens the painting’s public record on a phone. Compare the painting with its photographs and documentation. A basic tag can be copied; it isn’t independent authenticity proof.",
  ],
  [
    "Who holds the painting after I buy?",
    "Check the recorded custody on the artwork’s page. Buying changes digital ownership. Physical delivery is requested and coordinated separately, and a custodian records the movement.",
  ],
  [
    "Can I resell it?",
    "Yes, at a fixed price from your collection when the work is eligible. A collector-held painting needs a current manual inspection approval bound to its owner and custody. The artist receives a royalty on resales settled through Katha.",
  ],
  [
    "Which network and wallets?",
    "Localnet and Solana Devnet, using compatible Solana Wallet Standard wallets. Prices use a Katha test token that has no monetary value. Connecting a wallet and signing in are separate steps.",
  ],
  [
    "Is this an investment?",
    "Katha is for collecting physical art with verifiable records. There’s no promise of returns or price growth. Development test tokens have no monetary value.",
  ],
] as const;

function Arrow() {
  return (
    <svg className="ic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
function SectionHead({
  label,
  title,
  children,
  id,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div className="sh">
      <div>
        <p className="kick">{label}</p>
        <h2 id={id} className="h2">
          {title}
        </h2>
      </div>
      <div className="flex flex-col items-start gap-4">{children}</div>
    </div>
  );
}

export function FeaturedArtworksSection({
  featured,
  apiOrigin,
}: {
  featured: FeaturedArtworks;
  apiOrigin: string;
}) {
  return (
    <section className="sec" aria-labelledby="featured-title">
      <div className="wrap">
        <SectionHead
          label="Published works"
          title="From the Katha catalogue."
          id="featured-title"
        >
          <p className="p">
            Documented works and their artists. Open a record to see its current
            condition, custody and sale status.
          </p>
          <Link className="tx" href="/explore">
            Explore all artworks
            <Arrow />
          </Link>
        </SectionHead>
        {featured.kind === "UNAVAILABLE" ? (
          <div className="panel panel-empty" role="alert">
            <h3 className="h3">The catalogue couldn&apos;t load</h3>
            <p className="p">
              The cultural introduction is still available. Try the catalogue again in a
              moment.
            </p>
            <RetryButton className="btn btn-g" />
          </div>
        ) : featured.items.length ? (
          <div className="grid-cards">
            {featured.items.map((artwork) => (
              <ArtworkCard
                key={artwork.kathaId}
                artwork={artwork}
                apiOrigin={apiOrigin}
                heading="h3"
                large
              />
            ))}
          </div>
        ) : (
          <div className="panel panel-empty">
            <h3 className="h3">The first works are being documented</h3>
            <p className="p">
              Published artworks will appear here after verification, minting and
              publication.
            </p>
            <Link className="btn btn-g" href="/explore">
              Explore artworks
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

export function KathaHomepage({
  featured = { kind: "UNAVAILABLE" },
  featuredSection,
  apiOrigin,
  cluster,
}: {
  featured?: FeaturedArtworks;
  featuredSection?: React.ReactNode;
  apiOrigin: string;
  cluster: "localnet" | "devnet";
}) {
  const facts = [
    [
      "Network",
      cluster === "devnet" ? "Solana Devnet" : "Solana Localnet",
      "Development records",
    ],
    ["Asset standard", "Metaplex Core", "Held in your own wallet"],
    ["Per painting", "One asset, ever", "Bound to one physical original"],
    ["Prices", "Katha test token", "No monetary value"],
  ];
  return (
    <div className="home-v2">
      <HomeFragmentFocus />
      <section className="hero" aria-labelledby="hero-title">
        <div className="haze" aria-hidden="true" />
        <div className="haze haze-2" aria-hidden="true" />
        <div className="wrap">
          <div className="hero-grid">
            <div>
              <p className="kick">
                {cluster === "devnet"
                  ? "Live on Solana Devnet"
                  : "Solana development preview"}
              </p>
              <h1 id="hero-title" className="h1 mt-6.5">
                <span>Tokenizing Nepali art</span>
                <span>as RWAs on Solana.</span>
              </h1>
              <p className="lead mt-5.5 max-w-132">
                Own an original Mandala, Paubha or Thangka painting as a single asset on
                Solana. Each work is inspected in person, kept in recorded custody, and
                carries its history on chain.
              </p>
              <div className="ctas mt-8">
                <Link className="btn btn-p" href="/explore">
                  Explore artworks
                </Link>
                <a className="btn btn-g" href="#how">
                  How it works
                </a>
              </div>
            </div>
            <figure className="art">
              <div className="card art-card">
                <div className="well">
                  <img
                    src="/design/paintings/paubha.jpg"
                    width="1024"
                    height="1280"
                    alt="AI design illustration of Green Tara seated on a lotus beneath a gilded arch; not a catalogued artwork."
                    fetchPriority="high"
                  />
                </div>
              </div>
              <div
                className="card float"
                aria-label="On-chain record of Green Tara, a sample artwork"
              >
                <div className="between">
                  <p className="lbl">On-chain record</p>
                  <span className="pill pill-acc nd">Sample</span>
                </div>
                <p className="mt-3.5 mb-0 text-xl leading-[1.2] font-semibold tracking-[-.02em]">
                  Green Tara
                </p>
                <p className="mono mt-1 mb-2.5 text-[12.5px] text-text-3">
                  KATHA-PAUBHA-000001 · Paubha
                </p>
                {[
                  ["Authenticity", "Verified in person"],
                  ["Custody", "Held by Katha"],
                  ["Owner", "8Hq3…Vw2T"],
                ].map(([label, value]) => (
                  <div className="row" key={label}>
                    <span className="lbl">{label}</span>
                    <span className="rv text-sm">
                      {label === "Authenticity" && (
                        <span className="dot" aria-hidden="true" />
                      )}
                      <span>{value}</span>
                    </span>
                  </div>
                ))}
                <a className="tx mt-2 min-h-9 text-sm" href="#record">
                  View full record
                  <Arrow />
                </a>
              </div>
            </figure>
          </div>
          <div className="facts">
            {facts.map(([label, value, text]) => (
              <div className="fact" key={label}>
                <p className="lbl">{label}</p>
                <p className="fact-v">{value}</p>
                <p className="sm mt-1.5 mb-0 text-text-3">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="works"
        tabIndex={-1}
        className="sec"
        aria-labelledby="traditions-title"
      >
        <div className="wrap">
          <span id="traditions" tabIndex={-1} />
          <SectionHead
            label="Artworks"
            title="Three traditions, one record each."
            id="traditions-title"
          >
            <p className="p">
              Mandala, Paubha and Thangka paintings from Nepal. Every published work is
              inspected and registered before it can be listed.
            </p>
            <Link className="tx" href="/explore">
              Explore all artworks
              <Arrow />
            </Link>
          </SectionHead>
          <div className="works">
            {traditions.map((work) => (
              <article className="card work" key={work.category}>
                <Link
                  className="well"
                  href={`/explore?category=${work.category}`}
                  aria-label={`Explore ${work.title} artworks`}
                >
                  <img
                    src={`/design/paintings/${work.image}.jpg`}
                    alt={work.alt}
                    loading="lazy"
                    width="1024"
                    height="1280"
                  />
                </Link>
                <div className="wb">
                  <div className="between">
                    <span className="pill pill-acc nd">{work.title}</span>
                    <span className="ne text-[15px] text-text-3" lang="ne">
                      {work.nepali}
                    </span>
                  </div>
                  <h3 className="h3 mt-3.5">{work.title}</h3>
                  <p className="p sm mt-2.5 mb-5">{work.text}</p>
                  <div className="mt-auto">
                    <div className="meta">
                      <span className="lbl">Browse tradition</span>
                      <Link
                        className="tx text-sm"
                        href={`/explore?category=${work.category}`}
                      >
                        Explore
                        <Arrow />
                      </Link>
                    </div>
                    <div className="meta text-text-3">
                      <span className="text-xs">AI design illustration</span>
                      <span className="text-xs">Not for sale</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="own" tabIndex={-1} className="sec pt-0" aria-labelledby="own-title">
        <div className="wrap">
          <span id="rwa" tabIndex={-1} />
          <SectionHead
            label="What you own"
            title="The painting is real. The record is on chain."
            id="own-title"
          >
            <p className="p">
              Preserving Nepali culture on chain through RWAs: physical artworks
              connected to verifiable digital records. Ownership, custody, authorship
              and condition remain separate facts.
            </p>
          </SectionHead>
          <div className="own">
            {own.map((item) => (
              <article className="card" key={item.label}>
                <img
                  src={`/design/paintings/${item.image}.jpg`}
                  alt={item.alt}
                  loading="lazy"
                  width="1024"
                  height="683"
                />
                <div className="px-6 pt-6 pb-7">
                  <p className="lbl text-madder">{item.label}</p>
                  <h3 className="h3 mt-2.5">{item.title}</h3>
                  <p className="p sm mt-2.5">{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" tabIndex={-1} className="sec pt-0" aria-labelledby="how-title">
        <div className="wrap">
          <span id="collecting" tabIndex={-1} />
          <SectionHead
            label="How it works"
            title="From the studio to your wallet."
            id="how-title"
          >
            <p className="p">
              Five steps, with each recorded action signed by the person responsible.
            </p>
          </SectionHead>
          <ol className="card home-steps m-0 list-none p-0">
            {steps.map((step, index) => (
              <li className="step" key={step.title}>
                <div className="between">
                  <span className="ibox">
                    <svg
                      className="ic"
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d={step.path} />
                    </svg>
                  </span>
                  <span className="mono xs">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="h3 mt-6.5 text-[19px]">{step.title}</h3>
                <p className="p sm mt-2.5 mb-6">{step.text}</p>
                <span className="pill nd mt-auto self-start">{step.where}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="record"
        tabIndex={-1}
        className="sec pt-0"
        aria-labelledby="record-title"
      >
        <div className="wrap">
          <SectionHead
            label="The record"
            title="Every painting carries a public history."
            id="record-title"
          >
            <p className="p">
              Read the evidence before buying. Each artwork page separates what was
              documented, what was inspected, and who owns or holds it.
            </p>
          </SectionHead>
          <div className="card">
            <div className="rc-head">
              <div className="flex items-center gap-4">
                <span className="ibox">
                  <Icon name="check" size={20} />
                </span>
                <div>
                  <h3 className="h3">What a record preserves</h3>
                  <p className="mono xs mt-1 mb-0">One permanent Katha ID</p>
                </div>
              </div>
              <Link className="btn btn-g btn-sm" href="/explore">
                Find an artwork record
              </Link>
            </div>
            <ol className="record-events">
              {[
                ["Artist attribution", "Preserved through every sale"],
                ["Authenticity assessment", "Recorded by an authorized verifier"],
                ["Condition inspections", "Dated, versioned reports"],
                ["Physical custody", "Separate from digital ownership"],
                ["Asset and transfers", "Finalized Solana records"],
                ["Document integrity", "Compare exact SHA-256 commitments"],
              ].map(([label, value]) => (
                <li key={label}>
                  <span className="font-medium">{label}</span>
                  <span className="sm text-text-2 text-right">{value}</span>
                </li>
              ))}
            </ol>
            <div className="border-t border-(--line) px-7 py-5">
              <p className="xs m-0">
                The blockchain preserves recorded claims. It doesn&apos;t inspect a
                physical painting or prove delivery. NFC is a discovery bridge, not
                independent authenticity proof.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" tabIndex={-1} className="sec pt-0" aria-labelledby="faq-title">
        <div className="wrap faq">
          <div>
            <p className="kick mb-5">FAQ</p>
            <h2 id="faq-title" className="h2">
              Straight answers.
            </h2>
            <p className="p mt-4 max-w-96">
              What you&apos;re buying, who holds it, and what the record does and
              doesn&apos;t prove.
            </p>
          </div>
          <div>
            {faq.map(([q, answer]) => (
              <details className="q" key={q}>
                <summary>
                  {q}
                  <Icon name="plus" size={18} className="chev" />
                </summary>
                <div className="ans">{answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
      {featuredSection ?? (
        <FeaturedArtworksSection featured={featured} apiOrigin={apiOrigin} />
      )}
      <section className="sec pt-0" aria-labelledby="cta-title">
        <div className="wrap">
          <div className="card cta">
            <div className="flex max-w-136 flex-col gap-3">
              <h2 id="cta-title" className="h2">
                Start with one painting.
              </h2>
              <p className="p">
                Explore the artist, the original work and its record before you collect.
              </p>
            </div>
            <div className="ctas">
              <Link className="btn btn-p" href="/explore">
                Explore artworks
              </Link>
              <Link className="btn btn-g" href="/account">
                Connect wallet
              </Link>
            </div>
          </div>
          <p className="sample-note">
            The introductory paintings are AI-generated design illustrations supplied
            with the reference. Published catalogue records use approved artwork
            photographs.
          </p>
        </div>
      </section>
    </div>
  );
}
