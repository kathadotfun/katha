# Katha visual system

Katha presents Nepal's cultural art with the pacing of an exhibition catalogue:
artwork photography, an artist's name and a readable story lead; verification,
condition, custody and provenance follow with clearly labelled sources. English
is the MVP interface language. Use the owned domain `katha.fun` and official X
handle `@kathadotfun` where relevant.

The main caption leads with **Real World Assets**, grounded in physical Nepali art,
not speculative token prices. The current headline is “Real World Assets, rooted
in Nepali culture.” Name Mandala, Paubha and Thangka in supporting copy. Preserve
specific traditions and artists' own explanations rather than treating them as
interchangeable decoration. The approved Dhaka-inspired stepped emblem, warm paper
and deep red establish the identity; artwork photography and documented cultural
context will carry that identity through the later public pages. Avoid generic
crypto imagery, invented cultural motifs, or claims that ownership grants copyright.

The current page applies these foundations to the existing scaffold. Navigation,
artwork photography and public feature pages are implemented in subsequent steps.
Do not imply that an unsigned operation, an NFC scan or an indexing observation
independently proves physical authenticity. Keep authorship, ownership and physical
custody visibly distinct. Show unavailable, unknown and stale states in plain words.

## Identity and artwork

The approved profile emblem uses stepped geometry, warm paper, copper and deep red.
The reviewed application asset is `/brand/katha-profile.svg` (1024-square viewBox).
It contains geometry, title and description only; no scripts, external references,
embedded images or unintended metadata. Display it without recolouring, cropping,
distorting or removing its red background. Use at least 32 CSS pixels for the mark;
56 pixels are used in the current scaffold. Preserve its square proportions and
leave at least one quarter of its displayed width as clear space around it.

When a nearby label already says Katha, the image has empty alt text to avoid
repetition. A standalone logo link must have the accessible name `Katha home`.
The SVG title is not a substitute for an image's alt text or link label.
The selected PNG is the raster alternative; an application copy should be added
only when a concrete raster use needs it. The selected X banner is for social
use and is not artwork photography or a website hero. Original design assets and
unused variants remain outside public history; only the reviewed SVG is needed here.

Use artist-approved photographs without changing artwork colours to match the UI.
Keep full-work images uncropped; detail crops need explicit labels. Do not substitute
stock photography or invented artwork for verified works. Private inspection
photographs must remain private. Photography, not decorative cards or icons,
should carry visual interest on the completed artwork pages.

## Colours

Tokens live in `apps/web/app/globals.css`. They use
[Tailwind theme variables](https://tailwindcss.com/docs/theme) so CSS and utility
classes share the same values (`bg-paper`, `text-ink`, `border-line`).

| Token                      | Value                 | Role                                                       |
| -------------------------- | --------------------- | ---------------------------------------------------------- |
| `paper`                    | `#FAF7F0`             | Warm ivory page canvas                                     |
| `surface`                  | `#FFFDF8`             | Raised contrast for form surfaces, without shadows         |
| `ink`                      | `#292723`             | Charcoal primary text                                      |
| `muted`                    | `#686057`             | Secondary text, never disabled-looking essential content   |
| `line`                     | `#D8CFC2`             | Quiet structural rules, not the sole boundary of a control |
| `control`                  | `#847767`             | Visible control boundaries                                 |
| `brand`                    | `#71332D`             | Approved emblem red, links, actions and focus              |
| `brand-hover`              | `#54241F`             | Action hover                                               |
| `brand-soft`               | `#EFE1DD`             | Restrained red tint                                        |
| `copper`                   | `#D6A671`             | Decorative identity accent; not ordinary text on ivory     |
| `success` / `success-soft` | `#375948` / `#E8EEE7` | Positive state text/background                             |
| `warning` / `warning-soft` | `#775014` / `#F4EBD7` | Caution state text/background                              |

Use colour sparingly. Errors may use brand red but always include a textual
explanation. Statuses need explicit labels; a green mark alone cannot communicate
verification. Avoid gradients, dark hero panels, heavy shadows and unrelated
bright accents. Photography remains in its approved natural colours.

Normal text must meet [WCAG contrast minimums](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Measured pairs: ink/paper 13.93:1, muted/paper 5.77:1, brand/paper 8.87:1,
surface/brand 9.33:1, surface/brand-hover 12.53:1, success/success-soft 6.64:1,
warning/warning-soft 6.02:1. Control/surface is 4.29:1. Light structural rules and
copper are decorative; do not use them as essential text or focus indicators.
Check new combinations before using them. These palette measurements do not
constitute a complete application accessibility audit.

## Typography and rhythm

Use the `font-serif` stack for editorial headings (Iowan Old Style, Palatino,
Book Antiqua, Georgia, then the platform serif). Use `font-sans` for reading text,
labels and controls (Helvetica Neue, Arial, then the platform sans). Use
`font-mono` for hashes, transaction references and exact amounts when needed.
All stacks are local: there is no font download, hosted font service, new package
or font asset licence dependency. Exact glyphs and line wrapping vary by platform.

| Token          | Size / leading              | Use                       |
| -------------- | --------------------------- | ------------------------- |
| `text-caption` | 0.75rem / 1.5               | Short labels and metadata |
| `text-body`    | 1rem / 1.7                  | Ordinary reading text     |
| `text-lead`    | Fluid 1.125–1.375rem / 1.65 | Introductions             |
| `text-section` | Fluid 1.875–3.25rem / 1.15  | Section headings          |
| `text-display` | Fluid 2.75–5.5rem / 1.08    | Main editorial title      |

Heading weight is 400; display tracking is -0.035em, section tracking -0.025em.
Use balanced headings and natural paragraph wrapping. The `eyebrow` class is a
short uppercase sans label at 0.75rem with 0.12em tracking. Do not use uppercase
for paragraphs. Limit ordinary prose to about 65 characters per line; short
introductions may use 42ch. Preserve real heading hierarchy and descriptive labels.

Use the existing 0.25rem spacing unit and its multiples. Section spacing is fluid
3.5–7rem, page gutters 1.25–4rem, and maximum page width 76rem. `page-container`
implements width and centred gutters. Keep related items close and separate
chapters with generous whitespace and thin rules. Avoid making every section a
rounded card; controls use a modest 0.25rem radius and no shadow.

## Responsive and interaction rules

Design from 320 CSS pixels upward. Use a single column on narrow screens;
introduce secondary columns only when the content fits. Named breakpoints are
`sm` 40rem, `md` 48rem and `lg` 64rem. Use fluid typography and container gutters,
not fixed desktop coordinates. Keep photographs proportional, allow labels and
long wallet references to wrap, and never truncate provenance meaning to fit a card.

`button-primary` provides a 44px-equivalent minimum height, a textual label,
contrasting red background and an actual native disabled state. `text-link` uses
an underline so links are not distinguished by colour alone. Preserve native
button/link semantics; do not apply button styling to noninteractive content.
Controls need keyboard access, visible labels and useful validation messages.

Focus has a 2px red outline and 4px offset; never remove it. In forced-colour mode
it uses the system Highlight colour, and buttons retain a visible system border.
Reduced-motion preference sets the defined transition duration to zero. Current
foundations have no entrance animation, scroll listener or hidden-until-JavaScript
content. Later motion must respect the same preference and must not delay access
to artwork or transaction information. Light mode is the MVP baseline.

## Verify

```bash
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
pnpm format:check
```

When an execution environment blocks Turbopack's local worker socket, the supported
alternative compiler can verify the same application with
`pnpm --filter @katha/web exec next build --webpack`. This does not change the
default project build command.

For visual review, run `pnpm --filter @katha/web dev` and inspect the current scaffold
at desktop and 320–390px widths, plus zoom and keyboard focus as controls are added.
Keep screenshots and personal review notes outside Git. Comprehensive public-page
accessibility and browser journeys are verified in their dedicated phase step.
