# Collector delivery and physical receipt

Sign in with the current Core owner wallet, open `/collection`, and select
**Delivery and receipt**. The private route is `/collection/{kathaId}/delivery`.
Select **Refresh requests** to load finalized ownership/custody and your
own saved requests. Other owners' shipping details are never included in this page.
The original requester can still access their individual request through the
existing private API after a sale; a new owner cannot access that request.

## Request delivery

Katha-held custody and no open delivery for this owner are required. Enter the
recipient, at least one contact method, address, city and uppercase two-letter
country code (NP by default). Select **Request delivery**. Shipping
and charges are coordinated manually. This form makes no wallet transaction.

The browser generates a request UUID. Identical retries reuse the UUID and exact
submitted details; changed details conflict. A parent artwork lock serializes
competing requests so concurrent submissions cannot create two open deliveries
for the same artwork/owner. A confirmed saved request receives its own private
status; ownership, custody, condition and sale history remain independent.

Private form and response data live only in memory. Wallet/session changes,
sign-out and navigation discard them. A failed private read/write clears displayed
requests. After an uncertain submission, refresh saved state first; the retry UUID
is retained in the active controller. If the request was saved, it appears in the
list. A new UUID does not bypass the open-delivery guard. No contact/address data
belongs in public metadata, URL parameters, logs or Git.

## Cancel a request

Until Katha dispatches it, the original requester can withdraw a request with
**Cancel request** and the confirmation that follows. The browser posts
`POST /fulfillment/:requestId/cancel` with the saved version and
`cancellationConfirmed: true`. The API requires the requester's session and current
Core ownership, accepts only `REQUESTED` or `APPROVED`, and returns 409 for stale
versions or later statuses. Cancelling changes no custody, ownership or chain
record; a new request can follow.

## Reporting receipt

Katha operators approve and dispatch requests using the existing
[administration flow](custody-administration-web.md). When a DELIVERY request is
DISPATCHED, its original requester must still be the current Core owner to report
receipt. Check **I physically received this artwork**, then select **Report
physical receipt**. The API rechecks finalized ownership and the saved request
version. Stale versions, other wallets, return requests and earlier statuses fail.

A separate immutable `fulfillment_receipt_reports` record stores the requester and
server timestamp. Repeated identical reports reuse that claim. The request remains
DISPATCHED. Katha must confirm receipt manually, submit the separate authorized
custody attestation and perform any post-delivery condition inspection. A collector
cannot self-verify custody, condition or resale approval through this form.

## Setup and verification

Start PostgreSQL and apply migration `0014_collector_receipt_reports`:

```bash
pnpm db:start
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm db:test
pnpm --filter @katha/web test:account
```

`db:migrate` needs the ignored local `.env` with a valid `DATABASE_URL`; see
[local services](local-services.md). The integration command uses disposable
PostgreSQL with synthetic recipients. The browser journey uses an isolated API
and synthetic wallet, checks the form and receipt flow at 375/768/1280 pixels,
accessibility, horizontal overflow and clearing private details after a failure.
It does not prove physical delivery. For a manual check, use a configured localnet
or Devnet Core asset and approved synthetic contact details, inspect the private
request in administration, dispatch it, then report receipt from the owner wallet.
Confirm that Registry custody and condition history change only through their
separate authorized workflows.
