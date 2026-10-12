"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { artistIdParamsSchema, artworkDraftParamsSchema } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtistOnboarding,
  lockedOnboardingSnapshot,
  type ArtistOnboarding,
} from "../lib/artist-onboarding";
import { parseArtistForm } from "../lib/artist-form";
import { localDateTime, shortAddress } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { Badge, FieldTag, Icon, Notice } from "./ui/status";
import { CopyButton } from "./ui/copy-button";

const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverState = () => lockedOnboardingSnapshot;
const traditions = ["Mandala", "Paubha", "Thangka"] as const;

export function AdministrationPanel() {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const [onboarding, setOnboarding] = useState<ArtistOnboarding | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createArtistOnboarding(session);
    setOnboarding(current);
    return () => current.dispose();
  }, [session]);
  useEffect(() => {
    if (auth.status === "signed-in") void onboarding?.check();
  }, [onboarding, auth.session, auth.status]);
  if (!auth.session)
    return (
      <div className="panel cut panel-empty max-w-[760px]">
        <Badge tone="neu" icon="lock">
          Signed out
        </Badge>
        <h1 className="h1 h1-ops">Sign in to use operations</h1>
        <p className="p text-lg">
          Operations are recorded with your wallet address. Connect your wallet and sign
          in; Katha checks your administrator and verifier roles.
        </p>
        <Link className="btn btn-p cut-s mt-2" href={signInHref("/admin")}>
          Sign in
        </Link>
      </div>
    );
  return (
    <OnboardingForms
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}`}
      onboarding={onboarding}
      wallet={auth.session.walletAddress}
    />
  );
}

function OnboardingForms({
  onboarding,
  wallet,
}: {
  onboarding: ArtistOnboarding | null;
  wallet: string;
}) {
  const state = useSyncExternalStore(
    onboarding?.subscribe ?? emptySubscribe,
    onboarding?.getSnapshot ?? serverState,
    serverState,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [links, setLinks] = useState([0]);
  const [confirmed, setConfirmed] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  useEffect(() => {
    setConfirmed(false);
  }, [state.artist]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    // Checkbox traditions plus free-text ones become the API's line list.
    values.set(
      "traditions",
      [
        ...values.getAll("tradition").map(String),
        ...String(values.get("otherTraditions") ?? "").split(/\r?\n/),
      ]
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    );
    values.set(
      "publicLinks",
      values
        .getAll("publicLink")
        .map((line) => String(line).trim())
        .filter(Boolean)
        .join("\n"),
    );
    const parsed = parseArtistForm(values);
    if (!parsed.data) {
      setErrors(parsed.errors);
      const first = Object.keys(parsed.errors)[0];
      form.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    await onboarding?.create(parsed.data);
  }
  // A record ID opens the profile directly; anything else searches names and slugs.
  function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(
      new FormData(event.currentTarget).get("artistId") ?? "",
    ).trim();
    const parsed = artistIdParamsSchema.safeParse({ artistId: value });
    if (!value || value.length > 160) {
      setIdError("Enter part of the artist's name or slug, or their record ID.");
      event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setIdError(null);
    setConfirmed(false);
    if (parsed.success && verifier) void onboarding?.read(parsed.data.artistId);
    else void onboarding?.search(value);
  }
  if (state.status === "denied")
    return (
      <div className="panel cut panel-empty max-w-[760px]">
        <Badge tone="err" icon="lock">
          No operations role
        </Badge>
        <h1 className="h1 h1-ops">You don&apos;t have access to operations</h1>
        <p className="p text-lg">
          The wallet <span className="id">{shortAddress(wallet)}</span> has no
          administrator or verifier role. If you should have one, ask a Katha
          administrator to grant it, then sign in again.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link className="btn btn-p cut-s" href="/account">
            Switch wallet
          </Link>
          <Link className="lnk" href="/">
            Go to the public site
          </Link>
        </div>
      </div>
    );
  if (state.status !== "ready")
    return (
      <div
        className="panel cut panel-empty max-w-[760px]"
        aria-busy={state.status === "checking"}
      >
        <h1 className="h1 h1-ops">Administration</h1>
        <p role="status" className="p">
          {state.status === "checking"
            ? "Checking wallet permissions…"
            : "Administration access hasn't been confirmed."}
        </p>
        {state.error && (
          <p role="alert" className="ferr">
            {state.error}
          </p>
        )}
        {state.status !== "checking" && (
          <button
            type="button"
            className="btn btn-o btn-sm"
            onClick={() => void onboarding?.check()}
          >
            Check access again
          </button>
        )}
      </div>
    );
  const admin = Boolean(state.permissions?.admin);
  const verifier = Boolean(state.permissions?.verifier);
  const target = artworkDraftParamsSchema.safeParse({ kathaId: lookup.trim() });
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="h1 h1-ops">Administration</h1>
        <p className="p text-lg">
          Document artists, open artwork workflows, and look up works to verify or
          inspect.
        </p>
      </div>
      {!admin && (
        <Notice tone="info" icon="lock" className="mt-6">
          <p>
            <strong>Read-only access.</strong> Your verifier role can review artists and
            open verification and condition work, but can&apos;t create or edit artist
            profiles.
          </p>
        </Notice>
      )}
      {state.error && (
        <Notice tone="err" className="mt-6">
          <p>{state.error}</p>
        </Notice>
      )}

      <section
        aria-labelledby="roles-title"
        className="mt-8 grid gap-4"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
        }}
      >
        <div className="panel cut flex flex-col gap-3">
          <h2 id="roles-title" className="h3">
            Your access
          </h2>
          <p className="p sm">
            Signed in as <span className="id">{wallet}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {admin && (
              <Badge tone="ok" marker={false}>
                Administrator
              </Badge>
            )}
            {verifier && (
              <Badge tone="ok" marker={false}>
                Verifier
              </Badge>
            )}
          </div>
          <p className="xs mut m-0">
            Administrators document and publish. Verifiers record authenticity checks
            and condition inspections.{" "}
            {state.permissions?.session.cluster === "devnet" ? "Devnet" : "Localnet"}{" "}
            test environment.
          </p>
        </div>
        {admin ? (
          <Link
            className="panel cut flex flex-col gap-2 text-inherit no-underline"
            href="/admin/artworks"
          >
            <h2 className="h3 text-madder">Artwork workspace</h2>
            <p className="p sm">
              Drafts, registration, verification, minting and publishing for every work.
            </p>
            <span className="lnk mt-auto pt-2">Open workspace</span>
          </Link>
        ) : (
          <div className="panel cut flex flex-col gap-2">
            <h2 className="h3">Artwork workspace</h2>
            <p className="p sm">
              The draft workspace needs an administrator role. Use the lookup to open a
              specific work.
            </p>
          </div>
        )}
        <div
          className="panel cut flex flex-col gap-3"
          aria-labelledby="authenticity-lookup"
        >
          <h2 id="authenticity-lookup" className="h3">
            Verifier lookup
          </h2>
          <div className="fld">
            <label className="lbl" htmlFor="lookup-katha-id">
              Katha ID
            </label>
            <input
              id="lookup-katha-id"
              className="inp"
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="Paste or scan a Katha ID"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="lookup-help"
            />
            <p id="lookup-help" className="help">
              A full ID such as KATHA-PAUBHA-000001.
            </p>
          </div>
          {target.success ? (
            <div className="flex flex-wrap gap-2">
              <Link
                className="btn btn-p btn-sm cut-s"
                href={`/admin/artworks/${target.data.kathaId}/verification`}
              >
                Open verification
              </Link>
              <Link
                className="btn btn-o btn-sm"
                href={`/admin/artworks/${target.data.kathaId}/condition`}
              >
                Open inspection
              </Link>
              <Link
                className="btn btn-o btn-sm"
                href={`/admin/artworks/${target.data.kathaId}/custody`}
              >
                Open custody
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" type="button" disabled>
                Open verification
              </button>
              <button className="btn btn-sm" type="button" disabled>
                Open inspection
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap items-start gap-8">
        {admin && (
          <section
            className="panel cut flex min-w-0 flex-col gap-6"
            aria-labelledby="artist-create"
            aria-busy={state.busy === "create"}
            style={{ flex: "3 1 560px", padding: "clamp(20px, 3vw, 40px)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="artist-create" className="h2 h2-ops">
                Create artist
              </h2>
            </div>
            {Object.keys(errors).length > 0 && (
              <Notice tone="err">
                <p>
                  <strong>
                    {Object.keys(errors).length === 1
                      ? "One field needs attention."
                      : `${Object.keys(errors).length} fields need attention.`}
                  </strong>{" "}
                  Everything you entered is kept.
                </p>
              </Notice>
            )}
            <form
              className="flex flex-col gap-6"
              noValidate
              onSubmit={(event) => void create(event)}
            >
              <fieldset disabled={state.busy !== null}>
                <legend className="legend">Profile</legend>
                <div className="g2">
                  <ArtistField
                    name="displayName"
                    label="Name"
                    tag="req"
                    max={160}
                    errors={errors}
                    autoComplete="name"
                  />
                  <ArtistField
                    name="slug"
                    label="Slug"
                    tag="req"
                    max={160}
                    errors={errors}
                    help="Lowercase letters, numbers and hyphens. Appears in katha.fun/artists/your-slug."
                  />
                  <ArtistField
                    name="region"
                    label="Region"
                    tag="req"
                    max={120}
                    errors={errors}
                  />
                  <fieldset className="fld">
                    <legend className="lbl mb-1.5">
                      Traditions <FieldTag kind="req" />
                    </legend>
                    <div className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2">
                      {traditions.map((tradition) => (
                        <label key={tradition} className="chk">
                          <input
                            type="checkbox"
                            name="tradition"
                            value={tradition}
                            data-field="traditions"
                          />
                          {tradition}
                        </label>
                      ))}
                    </div>
                    {errors.traditions && (
                      <p className="ferr">Choose at least one tradition.</p>
                    )}
                  </fieldset>
                  <div className="fld span-all">
                    <label className="lbl" htmlFor="artist-otherTraditions">
                      Other traditions <FieldTag kind="opt" />
                    </label>
                    <textarea
                      id="artist-otherTraditions"
                      className="inp"
                      name="otherTraditions"
                      rows={2}
                      maxLength={2500}
                      aria-describedby="artist-otherTraditions-help"
                    />
                    <p id="artist-otherTraditions-help" className="help">
                      One per line, in the artist&apos;s own words.
                    </p>
                  </div>
                  <ArtistField
                    name="biography"
                    label="Biography"
                    tag="req"
                    max={5000}
                    errors={errors}
                    multiline
                  />
                  <ArtistField
                    name="profileImageUrl"
                    label="Approved image URL"
                    tag="opt"
                    max={2048}
                    errors={errors}
                    type="url"
                    help="A portrait the artist has approved for public use. Leave empty if none was supplied."
                  />
                </div>
              </fieldset>
              <fieldset disabled={state.busy !== null}>
                <legend className="legend">Public links</legend>
                <div className="flex flex-col gap-2.5">
                  {links.map((key, index) => (
                    <div key={key} className="flex items-end gap-2.5">
                      <div className="fld flex-1">
                        <label className="lbl" htmlFor={`artist-link-${key}`}>
                          Address {links.length > 1 ? index + 1 : ""}
                        </label>
                        <input
                          id={`artist-link-${key}`}
                          className="inp"
                          name="publicLink"
                          type="url"
                          maxLength={2048}
                          placeholder="https://"
                          data-field={index === 0 ? "publicLinks" : undefined}
                          aria-invalid={errors.publicLinks ? true : undefined}
                        />
                      </div>
                      {links.length > 1 && (
                        <button
                          type="button"
                          className="icon-btn min-h-12 min-w-12"
                          aria-label={`Remove link ${index + 1}`}
                          onClick={() =>
                            setLinks(links.filter((value) => value !== key))
                          }
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  ))}
                  {errors.publicLinks && <p className="ferr">{errors.publicLinks}</p>}
                  {links.length < 10 && (
                    <button
                      type="button"
                      className="lnk self-start"
                      onClick={() => setLinks([...links, Math.max(...links) + 1])}
                    >
                      Add another link
                    </button>
                  )}
                </div>
              </fieldset>
              <fieldset disabled={state.busy !== null}>
                <legend className="legend">Wallets</legend>
                <p className="p sm -mt-1.5 mb-3.5">
                  Who the artist is and where their money goes are recorded separately.
                </p>
                <div className="g2">
                  <ArtistField
                    name="creatorWallet"
                    label="Creator wallet"
                    tag="opt"
                    max={44}
                    errors={errors}
                    placeholder="Artist's own Solana address"
                    help="Identifies the artist as creator. It receives nothing."
                  />
                  <ArtistField
                    name="payoutWallet"
                    label="Payout wallet"
                    tag="opt"
                    max={44}
                    errors={errors}
                    help="Receives the artist's proceeds from every sale; needed before the first sale. It can belong to someone the artist chooses."
                  />
                </div>
              </fieldset>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  className="btn btn-p cut-s"
                  type="submit"
                  disabled={state.busy !== null}
                >
                  {state.busy === "create" ? "Creating artist…" : "Create artist"}
                </button>
                <p className="xs mut m-0">
                  New artists start unverified. A verifier records the profile check
                  separately. Retrying with the same slug won&apos;t create a duplicate.
                </p>
              </div>
            </form>
          </section>
        )}

        <section
          className="panel cut flex min-w-0 flex-col gap-[18px]"
          aria-labelledby="artist-review"
          style={{ flex: "2 1 380px", padding: "clamp(20px, 3vw, 40px)" }}
        >
          <h2 id="artist-review" className="h2 h2-ops">
            Saved artists
          </h2>
          <form className="flex items-end gap-2" onSubmit={read} noValidate>
            <div className="fld flex-1">
              <label className="lbl" htmlFor="artist-review-id">
                Name, slug or record ID
              </label>
              <input
                id="artist-review-id"
                className="inp"
                name="artistId"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={160}
                aria-invalid={idError ? true : undefined}
                aria-describedby={idError ? "artist-id-error" : "artist-id-help"}
                disabled={!!state.busy}
              />
            </div>
            <button className="btn btn-o" type="submit" disabled={!!state.busy}>
              {state.busy === "read" || state.busy === "search"
                ? "Looking up…"
                : "Look up"}
            </button>
          </form>
          {idError ? (
            <p id="artist-id-error" className="ferr -mt-2.5">
              {idError}
            </p>
          ) : (
            <p id="artist-id-help" className="help -mt-2.5">
              Part of a name or slug finds matching artists. A record ID opens the
              profile{verifier ? "" : " in the list"}.
            </p>
          )}
          {state.search && (
            <section aria-labelledby="artist-results" className="flex flex-col gap-2">
              <p id="artist-results" className="sm mut m-0" role="status">
                {state.search.results.pagination.total === 0
                  ? `No artists match “${state.search.query}”.`
                  : `${state.search.results.pagination.total} ${state.search.results.pagination.total === 1 ? "artist matches" : "artists match"} “${state.search.query}”${state.search.results.pagination.hasMore ? "; showing the first 20" : ""}.`}
              </p>
              {state.search.results.items.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {state.search.results.items.map((item) => (
                    <li
                      key={item.id}
                      className="inset flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                    >
                      <div className="min-w-0">
                        <p className="m-0 font-semibold">{item.displayName}</p>
                        <p className="xs mut m-0">
                          {item.slug} · {item.region}
                        </p>
                        <p className="xs id m-0">{item.id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={item.verificationStatus === "VERIFIED" ? "ok" : "warn"}
                        >
                          {item.verificationStatus === "VERIFIED"
                            ? "Verified"
                            : "Not verified"}
                        </Badge>
                        <CopyButton
                          value={item.id}
                          label={`Copy record ID for ${item.displayName}`}
                          text="Copy ID"
                        />
                        {verifier && (
                          <button
                            type="button"
                            className="btn btn-o btn-sm"
                            disabled={!!state.busy}
                            onClick={() => {
                              setConfirmed(false);
                              void onboarding?.read(item.id);
                            }}
                            aria-label={`Review ${item.displayName}`}
                          >
                            Review
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {state.artist && (
            <article
              className="inset flex flex-col gap-3"
              aria-labelledby="saved-artist"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p id="saved-artist" className="serif m-0 text-[22px] font-semibold">
                  {state.artist.displayName}
                </p>
                <Badge
                  tone={state.artist.verificationStatus === "VERIFIED" ? "ok" : "warn"}
                  role="status"
                >
                  {state.artist.verificationStatus === "VERIFIED"
                    ? "Profile verified"
                    : "Not verified"}
                </Badge>
              </div>
              <dl className="m-0">
                <div className="kv kv-ops">
                  <dt>Record ID</dt>
                  <dd className="id">{state.artist.id}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Slug</dt>
                  <dd>{state.artist.slug}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Region</dt>
                  <dd>{state.artist.region}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Traditions</dt>
                  <dd>{state.artist.traditions.join(", ")}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Biography</dt>
                  <dd className="whitespace-pre-wrap">{state.artist.biography}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Creator wallet</dt>
                  <dd className="id">{state.artist.creatorWallet ?? "Not provided"}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Payout wallet</dt>
                  <dd className="id">{state.artist.payoutWallet ?? "Not provided"}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Approved image</dt>
                  <dd className="id">
                    {state.artist.profileImageUrl ?? "Not provided"}
                  </dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Public links</dt>
                  <dd>
                    {state.artist.publicLinks.length
                      ? state.artist.publicLinks.map((url) => (
                          <span key={url} className="id block">
                            {url}
                          </span>
                        ))
                      : "None provided"}
                  </dd>
                </div>
              </dl>
              {state.artist.verificationStatus === "VERIFIED" ? (
                <>
                  <p className="p sm" role="status">
                    Profile verification recorded
                    {state.artist.verifiedByWallet && (
                      <>
                        {" "}
                        by{" "}
                        <span className="id">
                          {shortAddress(state.artist.verifiedByWallet)}
                        </span>
                      </>
                    )}
                    {state.artist.verifiedAt && (
                      <> on {localDateTime(state.artist.verifiedAt)}</>
                    )}
                    . It shows on the public profile.
                  </p>
                  <a
                    className="lnk sm self-start"
                    href={`/artists/${state.artist.slug}`}
                  >
                    View public profile
                  </a>
                </>
              ) : verifier ? (
                <form
                  className="flex flex-col gap-3 border-t-[1.5px] border-madder pt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onboarding?.verify(confirmed);
                  }}
                >
                  <p className="m-0 font-semibold">Verify this profile</p>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      disabled={!!state.busy}
                    />
                    <span>
                      I&apos;ve checked this artist&apos;s identity, region and
                      traditions myself, against documents or in person.
                    </span>
                  </label>
                  <p className="help">
                    This records an off-chain profile check under your verifier wallet.
                    It doesn&apos;t verify an artwork or send a Solana transaction.
                  </p>
                  <button
                    className="btn btn-p cut-s self-start"
                    type="submit"
                    disabled={!confirmed || !!state.busy}
                  >
                    {state.busy === "verify"
                      ? "Recording verification…"
                      : "Record verification"}
                  </button>
                </form>
              ) : (
                <p className="p sm">
                  Give this record ID to an authorized verifier. An administrator role
                  doesn&apos;t include verification.
                </p>
              )}
            </article>
          )}
        </section>
      </div>
    </>
  );
}

function ArtistField({
  name,
  label,
  tag,
  max,
  errors,
  help,
  multiline = false,
  type = "text",
  autoComplete = "off",
  placeholder,
}: {
  name: string;
  label: string;
  tag: "req" | "opt";
  max: number;
  errors: Record<string, string>;
  help?: string;
  multiline?: boolean;
  type?: "text" | "url";
  autoComplete?: string;
  placeholder?: string;
}) {
  const id = `artist-${name}`;
  const described = [errors[name] ? `${id}-error` : null, help ? `${id}-help` : null]
    .filter(Boolean)
    .join(" ");
  const shared = {
    id,
    name,
    className: "inp",
    maxLength: max,
    "data-field": name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": described || undefined,
    autoComplete,
    placeholder,
  };
  return (
    <div className={`fld${multiline || type === "url" ? " span-all" : ""}`}>
      <label className="lbl" htmlFor={id}>
        {label} <FieldTag kind={tag} />
      </label>
      {multiline ? (
        <textarea {...shared} rows={5} />
      ) : (
        <input
          {...shared}
          type={type}
          spellCheck={
            !["slug", "creatorWallet", "payoutWallet", "profileImageUrl"].includes(name)
          }
        />
      )}
      {errors[name] && (
        <p id={`${id}-error`} className="ferr">
          {errors[name]}
        </p>
      )}
      {help && (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
    </div>
  );
}
