import Link from "next/link";
import { HomeFragmentFocus } from "./home-fragment-focus";
import { ArtworkCard } from "./artwork-card";
import { KathaMark, kathaMarkPoints } from "./ui/katha-mark";
import { Icon } from "./ui/status";
import { RetryButton } from "./ui/retry-button";
import type { FeaturedArtworks } from "../lib/home-page";

// Decorative stepped band joining two section colours.
function Band({ from, to, id }: { from: string; to: string; id: string }) {
  return (
    <div aria-hidden="true" className="band" style={{ background: from }}>
      <svg width="100%" height="24" style={{ display: "block" }}>
        <defs>
          <pattern id={id} width="48" height="24" patternUnits="userSpaceOnUse">
            <polygon
              points="0,24 0,18 6,18 6,12 12,12 12,6 18,6 18,0 30,0 30,6 36,6 36,12 42,12 42,18 48,18 48,24"
              fill={to}
            />
          </pattern>
        </defs>
        <rect width="100%" height="24" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}

function HeroArt() {
  const { outer, inner, gem } = kathaMarkPoints;
  return (
    <div className="hero-art" aria-hidden="true">
      <svg
        viewBox="-760 -760 1520 1520"
        width="100%"
        height="100%"
        style={{ display: "block", overflow: "visible" }}
      >
        <g className="ring ring-3">
          <polygon className="hr3" transform="scale(2.6)" points={outer} />
        </g>
        <g className="ring ring-2">
          <polygon className="hr2" transform="scale(2.05)" points={outer} />
        </g>
        <g className="ring ring-2">
          <polygon className="hrs" transform="scale(1.8)" points={outer} />
        </g>
        <g className="ring ring-1">
          <polygon className="hr1" transform="scale(1.55)" points={outer} />
        </g>
        <g className="core">
          <g transform="scale(1.2)">
            <polygon points={outer} fill="#F3E8D8" />
            <polygon points={inner} fill="#71332D" />
          </g>
        </g>
        <g className="gem">
          <polygon transform="scale(1.2)" points={gem} fill="#D6A671" />
        </g>
      </svg>
    </div>
  );
}

const petals = [0, 45, 90, 135, 180, 225, 270, 315];
const beads = [60, 90, 120, 150, 180, 210, 240];
function MandalaDrawing() {
  const gate = "M126 128 V119 H134 V111 H166 V119 H174 V128";
  return (
    <svg viewBox="0 0 300 400" width="100%" height="100%" aria-hidden="true">
      <rect x="36" y="26" width="228" height="40" className="d3" />
      <rect x="36" y="334" width="228" height="40" className="d3" />
      {beads.map((x) => (
        <circle key={`t${x}`} cx={x} cy="46" r="9" className="d2" />
      ))}
      {beads.map((x) => (
        <circle key={`b${x}`} cx={x} cy="354" r="9" className="d2" />
      ))}
      <circle cx="150" cy="200" r="126" className="d2" />
      <circle cx="150" cy="200" r="118" className="d3 dash" />
      <circle cx="150" cy="200" r="110" className="d1" />
      <rect x="78" y="128" width="144" height="144" className="d1" />
      <rect x="88" y="138" width="124" height="124" className="d2" />
      {[0, 90, 180, 270].map((angle) => (
        <path
          key={angle}
          d={gate}
          className="d1"
          transform={`rotate(${angle} 150 200)`}
        />
      ))}
      <circle cx="150" cy="200" r="46" className="d1" />
      {petals.map((angle) => (
        <ellipse
          key={angle}
          cx="150"
          cy="175"
          rx="8"
          ry="14"
          className="d2"
          transform={`rotate(${angle} 150 200)`}
        />
      ))}
      <circle cx="150" cy="200" r="8" fill="#D6A671" />
    </svg>
  );
}
function PaubhaDrawing() {
  const niche = (x: number, y: number) =>
    `M${x} ${y + 54} V${y + 18} Q${x} ${y + 4} ${x + 15} ${y} Q${x + 30} ${y + 4} ${x + 30} ${y + 18} V${y + 54} Z`;
  return (
    <svg viewBox="0 0 300 400" width="100%" height="100%" aria-hidden="true">
      <rect x="34" y="20" width="232" height="360" className="d3" />
      <rect x="44" y="30" width="212" height="340" className="d2" />
      {[86, 118, 150, 182, 214].map((x) => (
        <circle key={x} cx={x} cy="52" r="8" className={x === 150 ? "d2" : "d3"} />
      ))}
      {[80, 144, 208].flatMap((y) => [
        <path key={`l${y}`} d={niche(57, y)} className="d3" />,
        <path key={`r${y}`} d={niche(213, y)} className="d3" />,
      ])}
      <path
        d="M100 300 V176 C100 132 124 106 150 94 C176 106 200 132 200 176 V300"
        className="d1"
      />
      <ellipse cx="150" cy="222" rx="38" ry="52" className="d3" />
      <circle cx="150" cy="160" r="26" className="d2" />
      <circle cx="150" cy="162" r="11" className="d1" />
      <path
        d="M150 176 C132 186 126 214 122 254 H178 C174 214 168 186 150 176 Z"
        className="d1"
      />
      <path
        d="M114 280 C124 262 138 264 150 274 C162 264 176 262 186 280 Z"
        className="d2"
      />
      <path d="M100 288 H200" className="d3" />
      <path d="M44 314 H256" className="d2" />
      {[58, 99, 138, 177, 218].map((x) => (
        <rect key={x} x={x} y="326" width="24" height="30" className="d3" />
      ))}
    </svg>
  );
}
function ThangkaDrawing() {
  return (
    <svg viewBox="0 0 300 400" width="100%" height="100%" aria-hidden="true">
      <path d="M44 22 H256" className="d2" />
      <rect x="38" y="18" width="8" height="8" className="d2" />
      <rect x="254" y="18" width="8" height="8" className="d2" />
      <rect x="66" y="26" width="168" height="330" className="d1" />
      <rect x="84" y="60" width="132" height="194" className="d2" />
      <rect x="88" y="64" width="124" height="186" className="d3" />
      <rect x="92" y="68" width="116" height="178" className="d1" />
      {[
        [106, 86],
        [194, 86],
        [106, 228],
        [194, 228],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="6" className="d3" />
      ))}
      <ellipse cx="150" cy="166" rx="27" ry="40" className="d3" />
      <circle cx="150" cy="122" r="18" className="d2" />
      <circle cx="150" cy="124" r="8" className="d1" />
      <path
        d="M150 134 C138 141 134 162 131 190 H169 C166 162 162 141 150 134 Z"
        className="d1"
      />
      <path
        d="M126 208 C133 196 142 197 150 204 C158 197 167 196 174 208 Z"
        className="d2"
      />
      <rect x="118" y="26" width="6" height="132" className="d3" />
      <rect x="176" y="26" width="6" height="132" className="d3" />
      <rect x="126" y="276" width="48" height="56" className="d2" />
      <rect x="132" y="282" width="36" height="44" className="d3" />
      <path d="M50 364 H250" className="d1" />
      <circle cx="44" cy="364" r="7" className="d2" />
      <circle cx="256" cy="364" r="7" className="d2" />
    </svg>
  );
}

const traditions = [
  {
    category: "MANDALA",
    title: "Mandala",
    nepali: "मण्डल",
    description:
      "Sanskrit for circle. A map of a sacred space: rings around a square palace with four gates, read from the outside in as a guide for meditation.",
    Drawing: MandalaDrawing,
  },
  {
    category: "PAUBHA",
    title: "Paubha",
    nepali: "पौभा",
    description:
      "The devotional scroll painting of the Newar artists of the Kathmandu Valley, painted on prepared cotton with mineral pigments and gold.",
    Drawing: PaubhaDrawing,
  },
  {
    category: "THANGKA",
    title: "Thangka",
    nepali: "थाङ्का",
    description:
      "A Himalayan Buddhist scroll painting, mounted in silk brocade to be rolled, carried and hung. Its figures follow set proportions passed from teacher to student.",
    Drawing: ThangkaDrawing,
  },
] as const;

const record = [
  [
    "Artist",
    "Credited permanently. Attribution stays with the artist after every sale.",
  ],
  [
    "Digital ownership",
    "The unique asset for this artwork, held in its owner's wallet.",
  ],
  [
    "Physical custody",
    "Who holds and safeguards the painting, and when that was last recorded.",
  ],
  [
    "Verification",
    "A manual check of the work and its authorship, recorded with its date.",
  ],
  ["Condition", "A dated inspection, graded from excellent to damaged."],
  [
    "History",
    "Registration, inspections, custody changes, minting and every transfer, in order.",
  ],
] as const;

const steps = [
  [
    "Explore the record",
    "Read the story, check the latest inspection and follow the full history of the work.",
  ],
  [
    "Review purchase",
    "Check the exact total, where the proceeds go and who holds the painting, then approve in your wallet.",
  ],
  [
    "Own the digital asset",
    "Once the purchase is confirmed, the artwork's asset is in your wallet. The artist stays credited.",
  ],
  [
    "Request delivery",
    "Have the painting shipped to you, or leave it in Katha's care. Delivery is arranged separately from the purchase.",
  ],
] as const;

export function KathaHomepage({
  featured,
  apiOrigin,
  cluster,
}: {
  featured: FeaturedArtworks;
  apiOrigin: string;
  cluster: "localnet" | "devnet";
}) {
  return (
    <div className="bg-madder-dark text-paper">
      <HomeFragmentFocus />
      <section className="hero" aria-labelledby="purpose">
        <div className="wrap hero-inner">
          <h1 id="purpose" tabIndex={-1} className="h1-hero max-w-[760px]">
            <span className="block">Nepal&apos;s cultural art.</span>
            <span className="block">RWAs on Solana.</span>
          </h1>
          <p className="lead-red mt-7">
            Preserving Nepali culture on chain: every Mandala, Paubha and Thangka
            painting linked to a permanent record of its artist, owner and history.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
            <Link className="btn btn-lg btn-l cut-s" href="/explore">
              Explore artworks
            </Link>
            <a className="lnk-d py-2.5 text-[17px] font-medium" href="#collecting">
              How collecting works
            </a>
          </div>
          <p className="mt-8 mb-0 text-base text-on-red-muted">
            Or start with a tradition:{" "}
            <Link className="lnk-d" href="/explore?category=MANDALA">
              Mandala
            </Link>
            ,{" "}
            <Link className="lnk-d" href="/explore?category=PAUBHA">
              Paubha
            </Link>{" "}
            or{" "}
            <Link className="lnk-d" href="/explore?category=THANGKA">
              Thangka
            </Link>
            .
          </p>
        </div>
        <HeroArt />
      </section>

      <Band from="#71332D" to="#5E2A25" id="band-a" />

      <section aria-labelledby="record-heading" className="sec bg-madder-deep">
        <div
          className="wrap grid items-start"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))",
            gap: "clamp(48px, 6vw, 96px)",
          }}
        >
          <div className="flex max-w-[520px] flex-col gap-6">
            <h2 id="record-heading" className="h-section">
              A painting you can hold, with a record anyone can check.
            </h2>
            <p className="m-0 text-[19px] leading-[1.6] text-on-red">
              An RWA, or real-world asset, is a physical object connected to a
              verifiable digital record. On Katha, the object is a painting, and its
              public record is open to anyone. You don&apos;t need a wallet to read it.
            </p>
            <div className="mt-4 flex items-start gap-4 border-t border-[rgba(243,232,216,0.16)] pt-7">
              <Icon name="nfc" size={28} className="mt-0.5 text-copper" />
              <p className="m-0 text-[16.5px] leading-[1.6] text-on-red-muted">
                <strong className="font-semibold text-paper">
                  Found a Katha tag on a painting?
                </strong>{" "}
                Tap it with your phone to open the work&apos;s public record. The tag
                leads to the record; it doesn&apos;t prove authenticity on its own.
              </p>
            </div>
          </div>
          <div
            className="cut bg-paper text-ink"
            style={{ padding: "clamp(28px, 3.4vw, 44px)" }}
          >
            <div className="flex items-center gap-3.5 pb-5">
              <KathaMark size={28} variant="paper" />
              <h3 className="serif m-0 text-2xl leading-tight font-semibold text-madder">
                What a Katha record holds
              </h3>
            </div>
            <dl className="rec-dl m-0">
              {record.map(([term, description]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
            <div
              className="mt-2 grid border-t-[1.5px] border-madder pt-[22px]"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
                gap: "18px 28px",
              }}
            >
              <div>
                <p className="serif m-0 text-[17px] font-semibold text-madder">
                  Kept on Solana
                </p>
                <p className="mt-1 mb-0 text-[15px] leading-normal text-text-2">
                  Ownership, every transfer, and a fingerprint of each document so any
                  change can be detected.
                </p>
              </div>
              <div>
                <p className="serif m-0 text-[17px] font-semibold text-madder">
                  Kept off chain
                </p>
                <p className="mt-1 mb-0 text-[15px] leading-normal text-text-2">
                  Photographs, artwork stories and private inspection reports.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Band from="#5E2A25" to="#F3E8D8" id="band-b" />

      <section aria-labelledby="traditions" className="sec bg-paper text-ink">
        <div className="wrap">
          <div className="split">
            <h2 id="traditions" tabIndex={-1} className="h-section text-madder">
              Three painting traditions, each its own discipline.
            </h2>
            <p className="m-0 max-w-[34rem] text-[19px] leading-[1.6] text-text-2">
              Katha begins with Mandala, Paubha and Thangka. They share a region and a
              long history, but each has its own purpose, form and method.
            </p>
          </div>
          <div className="grid-cards" style={{ marginTop: "clamp(48px, 5vw, 72px)" }}>
            {traditions.map(({ category, title, nepali, description, Drawing }) => (
              <article key={category} className="flex flex-col">
                <figure
                  className="cut weave m-0 flex items-center justify-center bg-madder"
                  style={{ aspectRatio: "3 / 4", padding: "9%" }}
                >
                  <Drawing />
                </figure>
                <div className="mt-6 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                  <h3 className="serif m-0 text-4xl leading-[1.1] font-semibold text-madder">
                    {title}
                  </h3>
                  <span lang="ne" className="serif text-[22px] text-[#8A5A3A]">
                    {nepali}
                  </span>
                </div>
                <p className="mt-3 mb-0 text-[17px] leading-[1.6] text-text-2">
                  {description}
                </p>
                <Link
                  className="lnk mt-3.5 self-start py-2 text-base"
                  href={`/explore?category=${category}`}
                >
                  Explore {title} works
                </Link>
              </article>
            ))}
          </div>
          <p className="mt-12 mb-0 text-sm text-[#6E5A50]">
            Drawings show the typical layout of each form, not specific works.
            Background reading:{" "}
            <a
              className="lnk"
              href="https://rubinmuseum.org/projecthimalayanart/themes/art-making/"
            >
              Rubin Museum of Himalayan Art
            </a>
            .
          </p>
        </div>
      </section>

      <section
        id="featured"
        aria-labelledby="featured-artworks"
        className="sec bg-paper-2 text-ink"
      >
        <div className="wrap">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
            <h2 id="featured-artworks" className="h-section text-madder">
              Featured works
            </h2>
            <Link className="lnk py-2 text-[17px]" href="/explore">
              See all artworks
            </Link>
          </div>
          {featured.kind === "READY" && featured.items.length > 0 ? (
            <div
              className="grid-cards"
              style={{ marginTop: "clamp(40px, 4vw, 56px)", gap: "48px 32px" }}
            >
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
            <div
              className="cut flex flex-wrap items-center bg-paper"
              role={featured.kind === "UNAVAILABLE" ? "status" : undefined}
              style={{
                marginTop: "clamp(40px, 4vw, 56px)",
                padding: "clamp(32px, 5vw, 64px)",
                gap: "32px 56px",
              }}
            >
              <KathaMark
                size={88}
                variant={featured.kind === "UNAVAILABLE" ? "ink-dashed" : "ink-outline"}
              />
              <div
                className="flex max-w-[580px] flex-col gap-3.5"
                style={{ flex: "1 1 360px" }}
              >
                {featured.kind === "UNAVAILABLE" ? (
                  <>
                    <h3 className="serif m-0 text-3xl leading-[1.15] font-semibold text-madder">
                      Featured works didn&apos;t load
                    </h3>
                    <p className="m-0 text-[17px] leading-[1.6] text-text-2">
                      The Katha catalogue didn&apos;t respond. Try again in a moment, or
                      browse all artworks.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-7 gap-y-3.5">
                      <RetryButton className="btn btn-lg btn-p cut-s" />
                      <Link className="lnk py-2" href="/explore">
                        Explore artworks
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="serif m-0 text-3xl leading-[1.15] font-semibold text-madder">
                      No works are published yet
                    </h3>
                    <p className="m-0 text-[17px] leading-[1.6] text-text-2">
                      Artists and their works are still being documented and inspected.
                      Follow @kathadotfun to see the first works as they&apos;re
                      published.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-7 gap-y-3.5">
                      <a
                        className="btn btn-lg btn-p cut-s"
                        href="https://x.com/kathadotfun"
                      >
                        Follow @kathadotfun
                      </a>
                      <a className="lnk py-2" href="#traditions">
                        Read about the traditions
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <Band from="#EBDDC9" to="#71332D" id="band-c" />

      <section aria-labelledby="collecting" className="sec weave bg-madder">
        <div className="wrap">
          <div className="split" style={{ gap: "20px 64px" }}>
            <h2 id="collecting" tabIndex={-1} className="h-section">
              How collecting works
            </h2>
            <p className="m-0 max-w-[30rem] text-[19px] leading-[1.6] text-on-red">
              Anyone can read a record. You only need a wallet to buy.
            </p>
          </div>
          <ol className="stairs">
            {steps.map(([title, text], index) => (
              <li
                key={title}
                className={`stair${index < 3 ? ` stair-${index + 1}` : ""}`}
              >
                {index > 0 && <span className="riser" aria-hidden="true" />}
                <span className="stair-n" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="serif mt-[18px] mb-2.5 text-[26px] leading-[1.15] font-semibold">
                  {title}
                </h3>
                <p className="m-0 text-[16.5px] leading-[1.6] text-on-red">{text}</p>
              </li>
            ))}
          </ol>
          <div
            className="grid border-t border-[rgba(243,232,216,0.18)] pt-8"
            style={{
              marginTop: "clamp(56px, 6vw, 96px)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
              gap: "24px 48px",
            }}
          >
            <p className="m-0 text-[15.5px] leading-[1.6] text-on-red-muted">
              <strong className="font-semibold text-paper">Selling later?</strong> If
              you keep the painting yourself, it needs a recent condition inspection
              before you can list it.
            </p>
            <p className="m-0 text-[15.5px] leading-[1.6] text-on-red-muted">
              <strong className="font-semibold text-paper">
                Ownership isn&apos;t copyright.
              </strong>{" "}
              Buying a work doesn&apos;t transfer its copyright.
            </p>
            <p className="m-0 text-[15.5px] leading-[1.6] text-on-red-muted">
              <strong className="font-semibold text-paper">Test network.</strong>{" "}
              {cluster === "devnet"
                ? "Katha currently runs on Solana Devnet."
                : "This Katha instance runs on a local Solana network."}{" "}
              Prices are in Katha test token, which has no monetary value.
            </p>
          </div>
        </div>
      </section>

      <Band from="#71332D" to="#5E2A25" id="band-d" />

      <section
        aria-labelledby="story-heading"
        className="bg-madder-deep"
        style={{ padding: "clamp(72px, 8vw, 112px) 0" }}
      >
        <div
          className="wrap flex flex-wrap items-center"
          style={{ gap: "24px clamp(40px, 7vw, 112px)" }}
        >
          <p
            lang="ne"
            className="serif m-0 leading-[1.15] font-semibold text-copper"
            style={{ fontSize: "clamp(120px, 16vw, 240px)" }}
          >
            कथा
          </p>
          <div
            className="flex max-w-[520px] flex-col gap-[18px]"
            style={{ flex: "1 1 340px" }}
          >
            <h2
              id="story-heading"
              className="h-section"
              style={{ fontSize: "clamp(34px, 4.2vw, 56px)" }}
            >
              Katha means story.
            </h2>
            <p className="m-0 text-[19px] leading-[1.6] text-on-red">
              Every work here comes with one: who made it, where it has been and who
              looks after it now.
            </p>
            <div className="mt-3.5">
              <Link className="btn btn-lg btn-l cut-s" href="/explore">
                Explore artworks
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
