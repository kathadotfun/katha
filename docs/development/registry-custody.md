# Registry physical custody attestations

The Registry records the last _attested_ physical location relationship for a
registered artwork. This state is separate from the artist's permanent attribution,
Core ownership, verification, condition, and marketplace listing. A purchase or
listing does not call a custody instruction. Katha's configured custody authority
signs an attestation after staff confirm a real handover; the chain cannot inspect
or move the physical work.

`initialize_custody` creates a current `CustodyHead` at
`["custody", artwork address]` and immutable revision 1 at
`["custody-transition", artwork address, 1 as little-endian u64]`. It accepts
`ATTEST_KATHA_CUSTODY` or `ATTEST_COLLECTOR_CUSTODY` from `UNKNOWN`. Collector
custody requires the actual custodian's nonzero wallet address. Katha custody
stores the configured custody-authority address as its subject.

`transition_custody` requires the caller's current revision and its exact
successor. The only later movements are:

| Current state    | Action                    | New state        |
| ---------------- | ------------------------- | ---------------- |
| `KATHA_HELD`     | `DISPATCH_FROM_KATHA`     | `IN_TRANSIT`     |
| `COLLECTOR_HELD` | `DISPATCH_FROM_COLLECTOR` | `IN_TRANSIT`     |
| `IN_TRANSIT`     | `RECEIVE_AT_KATHA`        | `KATHA_HELD`     |
| `IN_TRANSIT`     | `RECEIVE_BY_COLLECTOR`    | `COLLECTOR_HELD` |

A dispatch clears the current subject; the immutable transition retains the
previous one. A collector receipt names the actual receiving custodian, who need
not be the current Core owner. Invalid, missing, or unexpected subject addresses
fail. Duplicate initial attestations, repeated revisions, stale writes, invalid
state transitions, wrong authorities, forged artwork/head relationships, and
wrong collections fail without changing the head or creating a transition.

Each transition stores its artwork, revision, action, old and new state and subject,
attesting authority, chain timestamp, and PDA bump. `CustodyUpdated` emits the
same public facts plus the permanent Katha ID and transition address. Earlier
transition accounts are never rewritten. Private postal addresses, shipment details,
photographs, and handover evidence belong in authorized off-chain fulfillment
records, not on-chain accounts, events, or public Git files.

The current head is evidence of the last authorized attestation, not proof of the
work's physical location. A later mint or sale must validate the current custody
facts it relies on; collector-held resale also needs owner- and custody-scoped
inspection approval. This step does not assert a Core owner or grant resale
eligibility.

`pnpm program:test` runs the six-action path and both initial states in LiteSVM,
including failure and rollback cases. The normal Anchor build regenerates
`target/idl/katha_registry.json`; generated application clients come later.
