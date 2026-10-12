# Application shell

The root layout loads Eczar and Mukta, renders one header, one main landmark
(`#main-content`), a skip link and one footer. Public browsing never needs a wallet.
The [design system](design-system.md) describes colours, type and components.

## Headers

`SiteHeader` picks one of four variants from the path (`lib/site-routes.ts`):

| Variant    | Paths                                            | Navigation                                     |
| ---------- | ------------------------------------------------ | ---------------------------------------------- |
| Home       | `/`                                              | Artworks, Why RWAs, How collecting works, chip |
| Public     | Other public pages                               | Same as home                                   |
| Collector  | `/account`, `/collection…`, `/art/{id}/purchase` | Artworks, My collection, account chip          |
| Operations | `/admin…`                                        | Administration, Artworks, role and wallet chip |

The account chip reads "Sign in" or the short wallet address (accessible name
"Account, signed in as …"). In operations it also shows the role reported by the
API for the current session (Admin, Verifier or No role); nothing is shown until
the API answers.

The wallet session lives in memory, so every internal link uses `next/link`. A full
page load signs the wallet out. Pages that need a session link to
`/account?next=<path>`; after sign-in the account page offers "Continue where you
left off". `lib/return-path.ts` only accepts same-site `/art`, `/collection` and
`/admin` paths.

On the home page, Why RWAs and How collecting works are native fragment links so
the browser moves focus to the section. From other pages they navigate to `/#rwa`
or `/#collecting`, and `HomeFragmentFocus` focuses the section after the page
mounts. The home footer also links to `/#traditions`.

## Footers

`SiteFooter` renders the operations footer under `/admin`, the full footer with
Explore, Collectors and Follow columns on the home page, and a compact footer
elsewhere. Every footer states the network and that test tokens have no monetary
value. The official X link is `https://x.com/kathadotfun`.

## Responsive behaviour

Below 860px (900px in operations) a Menu button controls an in-flow navigation
panel through `aria-expanded` and `aria-controls`. It is not a modal: there's no
overlay or focus trap. Choosing a destination closes it; Escape closes it and
returns focus to the button. Below 400px the operations header hides the wordmark
so the role chip fits. With JavaScript disabled, a scoped `noscript` style shows
the links and hides the inert button.

## Keyboard and accessibility

The first focusable element is `Skip to content`, which moves focus to
`#main-content`. Navigation landmarks are named "Main" or "Operations"; the
current page is marked with `aria-current`. Controls are at least 44px, focus is
always visible, and reduced motion and forced colours are respected.

## Verification

```bash
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web test
pnpm --filter @katha/web build
pnpm --filter @katha/web test:responsive-shell
pnpm --filter @katha/web test:account
pnpm --filter @katha/web test:public-journeys
pnpm format:check
```

The shell suite runs the production build against the synthetic HTTP fixture at
320/390/640/768/1023/1024/1280/1440px. It covers public, collector, operations and
not-found shells, menu opening and Escape, route closure, the wallet chooser
dialog, axe accessibility, 200% text and browsing without JavaScript. Screenshots
stay under the ignored helper directory. Human screen-reader review remains
separate from automated checks.
