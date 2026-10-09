# Public application shell

The root layout supplies the approved Katha emblem, responsive navigation, one
shared main landmark, a skip link and the project footer. The [design system](design-system.md)
uses warm ivory, charcoal, muted red, straight sans typography and generous spacing.
Public browsing is available without connecting a wallet.

## Structure and destinations

`SiteHeader` is a client component for the mobile disclosure. `SiteFooter` remains
server-rendered. The logo links have the accessible name `Katha home`; their images
are decorative beside the visible name. The approved SVG is displayed without
recolouring or cropping. The footer links to artwork exploration and the official
`https://x.com/kathadotfun`, and displays `katha.fun` as text.

| Label       | Destination    |
| ----------- | -------------- |
| Home        | `/`            |
| Explore     | `/explore`     |
| Our purpose | `/#purpose`    |
| Traditions  | `/#traditions` |
| My account  | `/account`     |

The existing `WalletControl` uses the same provider, sessions and transaction review
boundary. Connecting does not sign in or approve a transaction. Network and wallet
information remain in its disclosure, separate from the artwork's content.

## Responsive behavior

Below 64rem, a menu button controls the in-flow navigation panel. Its label,
`aria-expanded` and `aria-controls` describe the disclosure. Closed content is
removed from display and the keyboard order. Opening exposes navigation, account
access and wallet controls. Selecting a shell destination closes the menu. Escape
closes an open mobile menu and returns focus to its button. It is not a modal and
has no focus trap or overlay over artwork.

At 64rem and above, navigation is visible and the toggle is hidden. Intermediate
widths and enlarged text wrap naturally. An expanded wallet review takes a full
row in the desktop header rather than covering the navigation. The body fills the
viewport, and content grows in the document without horizontal clipping.

With JavaScript disabled, a scoped `noscript` style exposes the browsing links and
hides the inert toggle. Wallet connection and signing require JavaScript as before.

## Keyboard and accessibility

The first link is `Skip to content`. Its visible focus targets `#main-content`,
which has `tabIndex={-1}`. Purpose and traditions also have focusable targets.
Keep the global focus outline, at least 44px controls, distinct navigation landmark
names and one main landmark. Reduced motion and forced colours retain visible
controls. The shell has no entrance animation or external font dependency.

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

The shell suite uses the owned synthetic HTTP fixture and production web build.
It checks 320/390/640/768/1023/1024/1280/1440px, public and account routes, keyboard
opening/dismissal, route closure, wallet expansion, axe accessibility, 200% text
and mobile browsing without JavaScript. Screenshots stay under the ignored helper
directory. The [public browsing suite](public-browsing-tests.md) and collector tests
retain their existing assertions and open the mobile disclosure when needed.

The supported webpack alternative for restricted build environments is documented
in the design guide. Human screen-reader and real-artwork reviews remain separate
from automated accessibility checks.
