# Public application shell

The root layout supplies the approved Katha emblem, responsive header navigation,
one shared main landmark, a skip link and the project footer. The visual foundation
is the [design system](design-system.md): warm paper, charcoal, muted emblem red,
editorial headings and the Real World Assets caption grounded in Nepali art.

## Structure and destinations

`SiteHeader` and `SiteFooter` are server components. The header's logo link has the
accessible name `Katha home`; its image is decorative next to the visible Katha
name. The footer describes Nepali cultural stories and permanent artist authorship,
links to `https://x.com/kathadotfun`, and displays the owned domain `katha.fun` as
text. There is no embedded social widget or assumption that hosted services are live.

Current primary navigation has four implemented destinations:

| Label       | Destination                                                      |
| ----------- | ---------------------------------------------------------------- |
| Explore     | `/explore`                                                       |
| Home        | `/`                                                              |
| Our purpose | `/#purpose`, the existing main heading                           |
| Traditions  | `/#traditions`, the existing Mandala/Paubha/Thangka introduction |

Home and Explore use Next.js links. Purpose and Traditions use native anchors so
same-page keyboard activation transfers focus to the target. A small homepage
mount effect restores focus to these two headings when cross-page navigation
arrives before streamed content exists. No other fragment is intercepted.
Artist profiles are reached from artwork attribution; wallet and collector pages
remain planned. No placeholder collecting action is exposed.

The header and footer are normal document content, not fixed overlays. Navigation
is always visible, wraps when necessary and stacks below the brand on narrow
screens. At 40rem and above, header/footer groups align horizontally when space
allows. There is no hidden mobile drawer, modal focus trap or menu state to maintain.
All layout uses the shared container/gutter tokens; the body grid fills the viewport
without adding a second full-height hero under the header. Content can grow naturally.

## Keyboard and accessibility

The first link is `Skip to content`. It appears when focused and targets
`#main-content`, whose `tabIndex={-1}` permits focus without adding an extra stop
to ordinary tab order. Purpose and tradition fragment targets are also focusable.
A global visible focus outline is retained. All navigation links have at least the
44px-equivalent control height, and both navigation landmarks have distinct names.

The root layout owns the only `main` landmark. Feature pages must render sections
or other ordinary content beneath it rather than nest another main landmark.
Use unique heading/fragment IDs and preserve heading order. The shell contains no
wallet provider or script that injects `window.ethereum`.

Reduced-motion and forced-colour preferences retain the design foundation's
rules. Nothing in the shell relies on animation or JavaScript to become visible.
The current main heading and body explicitly describe Real World Assets, Nepali
culture, Mandala, Paubha and Thangka; the cultural homepage and its published works are implemented.

## Verification

```bash
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
pnpm format:check
```

The supported webpack alternative is documented in the design guide for execution
environments that block Turbopack's worker socket. Inspect the production HTML for
one main landmark, header/footer navigation, skip/fragment targets and the approved
logo. Generated HTML, screenshots and reports remain outside Git.

Run `pnpm --filter @katha/web dev` for visual checks at 320px, 390px and desktop
widths, with 200% zoom, keyboard-only navigation, reduced motion and forced colours.
Tab first to the skip link, activate it, then verify Home, Our purpose, Traditions
and the footer X link. Check wrapping and horizontal overflow. Repeat with JavaScript
disabled. The [public browsing suite](public-browsing-tests.md) exercises these journeys
in Chromium. Human screen-reader and real-artwork reviews remain necessary.
