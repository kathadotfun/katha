# Artist profiles

The `artists` table stores manually onboarded artist profiles. Its UUID is the
artist identifier used by artwork attribution; the unique, lowercase slug is a
public profile locator. This table does not store artwork ownership or physical
custody. Artwork registration preserves attribution separately on chain.

## Stored fields and constraints

| Fields                                | Database rules                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`, `slug`                          | Generated UUID primary key; unique slug up to 160 characters, lowercase ASCII letters/digits separated by single hyphens |
| `display_name`, `biography`, `region` | Required nonblank text, maximum lengths 160, 5000 and 120                                                                |
| `traditions`                          | One-dimensional array with 1–20 nonblank, nonnull items, each up to 120 characters                                       |
| `public_links`                        | Default empty array; at most ten nonnull HTTP(S) URL-shaped strings                                                      |
| `profile_image_url`                   | Optional HTTP(S) URL-shaped string, up to 2048 characters                                                                |
| `creator_wallet`, `payout_wallet`     | Independently nullable, base58-shaped address text of 32–44 characters                                                   |
| `verification_status`                 | Explicit `UNVERIFIED` default or `VERIFIED`                                                                              |
| `verified_by_wallet`, `verified_at`   | Both absent for unverified profiles; both required for verified profiles                                                 |
| `created_at`, `updated_at`            | Required timezone-aware timestamps, default database time; updates must explicitly set `updated_at`                      |

Verification timestamps must fall between creation and the recorded update time;
update time cannot precede creation. Manual verification changes must set the
status, verifier wallet, verification time and update time consistently.

An artist can exist without either wallet. A payout wallet can be configured
without a creator wallet. Wallets are not unique artist identifiers and may be
shared between profiles. Sale eligibility requires a payout wallet in later
marketplace work; creating a profile does not imply eligibility or verification.

Database URL/address checks enforce textual shape. API inputs must still use the
shared profile schemas and full URL parsing, while chain-facing operations must
decode wallet addresses to 32-byte Solana keys. A verifier wallet stored here is
an application attribution field; it is not by itself an authenticated session
or on-chain verification event. Authorized [API onboarding and verification](artist-management-api.md) use
configured admin/verifier sessions; chain artwork verification remains separate. Only approved public media URLs belong in this table;
private evidence and contact/shipping details remain outside public records.

## Apply and verify

Follow [database setup](database-package.md), then review and apply
`packages/db/drizzle/0000_artist_profiles.sql` with:

```bash
pnpm db:migrate
pnpm db:test
```

The migration includes the enum and named table constraints. Its generated
snapshot and journal are published with the SQL. Re-running migration applies no
duplicate schema changes. Subsequent changes use new forward migrations.

The disposable PostgreSQL suite applies and replays the real application history,
then checks profile creation with no wallets, payout-only and shared-wallet
profiles, primary-key/slug uniqueness, malformed or empty values, bounded content,
manual verification consistency and rejection of an invalid update. It asserts
PostgreSQL error codes and named constraints so unrelated connection failures
cannot count as successful rejection tests. No artist fixtures are seeded into
your development database.

The Drizzle schema is exported from the Node-only `@katha/db` package together
with inferred `ArtistRecord` and `NewArtistRecord` persistence types. These storage
types do not replace the shared request/response schemas. The [Drizzle constraint
guide](https://orm.drizzle.team/docs/indexes-constraints) documents the underlying
primary-key, unique, enum and check declarations.
