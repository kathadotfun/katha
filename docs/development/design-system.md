# Katha visual system

Katha presents Nepal's cultural art the way a well-made exhibition catalogue does.
The artwork photograph, the artist's name and a readable story come first.
Verification, condition, custody and provenance follow, each with a labelled
source. English is the MVP interface language. Use the owned domain `katha.fun`
and the official X handle `@kathadotfun` where relevant.

The homepage headline reads “Nepal's cultural art. RWAs on Solana.” Supporting copy
names Mandala, Paubha and Thangka. Preserve specific traditions and artists' own
explanations; don't treat them as interchangeable decoration. Madder red, warm
paper, copper and the stepped Dhaka diamond establish the identity. Avoid generic
crypto imagery, invented cultural motifs, invented statistics and any claim that
ownership grants copyright.

The [application shell](application-shell.md) provides the headers, footers and
skip link. The [homepage](homepage.md), catalogue, artwork records, artist profiles,
collector pages and operations workflows all use these foundations.

## Rules every page keeps

- Artist authorship, digital ownership, physical custody, authenticity
  verification, condition, listing status and resale approval are separate facts
  with separate labels. Never merge them into one "verified" badge.
- A quote doesn't reserve a work. A finalized purchase isn't delivery.
- An unknown transaction outcome keeps its reference and offers "Check status";
  it is never shown as success or failure.
- Private data (delivery requests, inspection notes, unpublished drafts) disappears
  when a session signs out, expires, is revoked or the wallet switches accounts.
- Fees come from the server and are labelled as development settings. Payments use
  "Katha test token — no monetary value".
- An NFC tag only points to the record; a tap doesn't prove authenticity, ownership
  or custody.
- Use sentence case, plain words for unavailable and stale states, and say what to
  do next.

## Identity

The mark is the approved stepped diamond from `logo/katha-profile.svg`, drawn
inline by `components/ui/katha-mark.tsx` so it can sit on red, footer, operations
or paper surfaces with the approved recolourings. Its geometry is never redrawn,
cropped or distorted. A standalone logo link has the accessible name `Katha home`
(`Katha operations home` in operations). The reviewed SVG copy stays at
`/brand/katha-profile.svg`.

The `cut` and `cut-s` classes apply the stepped Dhaka corner to panels, buttons and
badges with `clip-path`. `weave` adds the faint woven texture to red surfaces.
Neither carries meaning on its own.

Use artist-approved photographs without recolouring them to match the UI. Keep
full-work images uncropped (`object-fit: contain`); label detail crops. Private
inspection photographs stay private. A missing or failed photograph shows a
labelled placeholder, never a stock image.

## Colours

Tokens live in `apps/web/app/globals.css` as
[Tailwind theme variables](https://tailwindcss.com/docs/theme), so CSS and utility
classes share values (`bg-paper`, `text-madder`, `text-ink`).

| Token                  | Value                 | Role                                         |
| ---------------------- | --------------------- | -------------------------------------------- |
| `madder`               | `#71332D`             | Brand red: headers, primary actions, links   |
| `madder-mid` / `-deep` | `#652D28` / `#5E2A25` | Layered red surfaces and the mark            |
| `madder-dark`          | `#4A1F1B`             | Footer and hover                             |
| `ink` / `ink-2`        | `#2A1714` / `#3A221D` | Primary text; operations header              |
| `paper`                | `#F3E8D8`             | Page canvas                                  |
| `paper-2` / `paper-3`  | `#EBDDC9` / `#E1CFB6` | Insets, segmented controls                   |
| `sheet`                | `#FBF6EE`             | Panels and form surfaces                     |
| `copper`               | `#D6A671`             | Decorative accent and focus on red; not text |
| `text-2` / `text-3`    | `#4F3D36` / `#5B4840` | Secondary and tertiary text                  |
| `field-border`         | `#8F7563`             | Visible control boundaries                   |
| `ok`, `warn`, `err`    | text + `-soft` pairs  | Status text on its tinted background         |
| `info`, `neutral`      | text + `-soft` pairs  | Informational and neutral status             |

Status always has a text label; colour only supports it. Check new text/background
pairs against [WCAG contrast minimums](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html);
the automated axe scans in the browser suites cover the shipped combinations.

## Typography

Fonts load through `next/font/google`, self-hosted at build time:

- **Eczar** (`font-serif`, `.serif`) for display headings, record titles and the
  Devanagari कथा mark.
- **Mukta** (`font-sans`) for body text, labels and controls, with Latin and
  Devanagari subsets.

Classes: `.h1-hero` (homepage), `.h1` / `.h1-record` / `.h1-ops`, `.h-section`,
`.h2` / `.h2-ops`, `.h3`, `.lead`, `.p`, `.sm`, `.xs`, `.mut`, and `.id` for Katha IDs,
addresses and hashes (wraps anywhere). Keep ordinary prose near 65 characters per
line and a real heading hierarchy.

## Components

All components are CSS classes in `globals.css` plus small React helpers in
`components/ui/`:

- Buttons: `.btn` with `.btn-p` (primary), `.btn-o` (outline), `.btn-l` (light on
  red), `.btn-ok`, `.btn-d` (danger), sizes `.btn-lg` / `.btn-sm`. Links: `.lnk`.
- `Badge` and `Notice` (`ui/status.tsx`) with tones `ok`, `warn`, `err`, `info`,
  `neu`. An error notice is an `alert`; others are `status`.
- Forms: `.fld`, `.lbl`, `.inp`, `.help`, `.ferr`, `.chk`, `.choice`, and `FieldTag`
  for Required, Optional, Private, Locked and Changed.
- Key–value rows: `.kv` (public) and `.kv-ops` (operations).
- `TransactionReviewView` shows the step list, exact amounts, fee payer, network
  fee, affected accounts and reference. Wallet approval is always a separate button.
- `.tblbox` scrolls wide tables sideways inside a labelled region.
- `.skel` skeletons, `.flow` request steps, `.tabs` workflow tabs, native
  `dialog.dialog` for the wallet chooser.

## Responsive and interaction rules

Design from 320 CSS pixels upward with fluid type and gutters (`--gutter`).
Navigation collapses into an in-flow menu below 860px (900px in operations).
Controls are at least 44px tall. Focus is always visible; forced-colours mode uses
system colours. Reduced motion removes transitions and the homepage animation.
Content never depends on JavaScript to appear: evidence tabs render every panel on
the server and become tabs after hydration.

## Verify

```bash
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web test
pnpm --filter @katha/web build
pnpm format:check
```

Browser suites (production build, synthetic HTTP fixture, axe on every state):

```bash
pnpm --filter @katha/web test:responsive-shell
pnpm --filter @katha/web test:account
pnpm --filter @katha/web test:public-journeys
```

When an environment blocks Turbopack's worker socket,
`pnpm --filter @katha/web exec next build --webpack` verifies the same app.
Keep screenshots and review notes outside Git.
