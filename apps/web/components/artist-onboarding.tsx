"use client";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { artistIdParamsSchema } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtistOnboarding,
  lockedOnboardingSnapshot,
  type ArtistOnboarding,
} from "../lib/artist-onboarding";
import { parseArtistForm } from "../lib/artist-form";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverState = () => lockedOnboardingSnapshot;
export function ArtistOnboardingPanel() {
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
      <section className="mt-10" aria-labelledby="admin-access">
        <h2 id="admin-access" className="text-2xl">
          Sign in to administer Katha
        </h2>
        <p className="mt-4">
          Connect your wallet and choose “Sign in to Katha” in the header. The API
          checks your current permissions.
        </p>
      </section>
    );
  return (
    <OnboardingForms
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}`}
      onboarding={onboarding}
    />
  );
}
const fields = [
  ["displayName", "Artist display name", 160],
  ["slug", "Public profile slug", 160],
  ["biography", "Biography", 5000],
  ["region", "Region", 120],
  ["traditions", "Art traditions (one per line)", 2500],
  ["publicLinks", "Approved public links (one per line, optional)", 20500],
  ["profileImageUrl", "Approved profile image URL (optional)", 2048],
  ["creatorWallet", "Creator wallet (optional)", 44],
  ["payoutWallet", "Payout wallet (optional)", 44],
] as const;
function OnboardingForms({ onboarding }: { onboarding: ArtistOnboarding | null }) {
  const state = useSyncExternalStore(
    onboarding?.subscribe ?? emptySubscribe,
    onboarding?.getSnapshot ?? serverState,
    serverState,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  useEffect(() => {
    setConfirmed(false);
  }, [state.artist]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = parseArtistForm(new FormData(form));
    if (!parsed.data) {
      setErrors(parsed.errors);
      form
        .querySelector<HTMLElement>(`[name="${Object.keys(parsed.errors)[0]}"]`)
        ?.focus();
      return;
    }
    setErrors({});
    await onboarding?.create(parsed.data);
  }
  function read(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = artistIdParamsSchema.safeParse({
      artistId: new FormData(event.currentTarget).get("artistId"),
    });
    if (!parsed.success) {
      setIdError("Enter the artist UUID returned when the profile was created.");
      event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setIdError(null);
    setConfirmed(false);
    void onboarding?.read(parsed.data.artistId);
  }
  if (state.status !== "ready")
    return (
      <section className="mt-10" aria-labelledby="admin-access">
        <h2 id="admin-access" className="text-2xl">
          Administration access
        </h2>
        <p role="status" className="mt-4">
          {state.status === "checking"
            ? "Checking wallet permissions…"
            : state.status === "denied"
              ? "This wallet has no applicable administration permission."
              : "Administration access has not been confirmed."}
        </p>
        {state.error && (
          <p role="alert" className="mt-4">
            {state.error}
          </p>
        )}
        {state.status !== "checking" && (
          <button
            type="button"
            className="text-link mt-4"
            onClick={() => void onboarding?.check()}
          >
            Check access again
          </button>
        )}
      </section>
    );
  return (
    <div className="admin-workspace mt-10">
      <p className="text-sm text-muted">
        {state.permissions?.admin ? "Administrator" : ""}
        {state.permissions?.admin && state.permissions?.verifier ? " · " : ""}
        {state.permissions?.verifier ? "Verifier" : ""} ·{" "}
        {state.permissions?.session.cluster === "devnet" ? "Devnet" : "Localnet"} test
        environment
      </p>
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      {state.permissions?.admin && (
        <section className="mt-8" aria-labelledby="artist-create">
          <h2 id="artist-create" className="text-3xl">
            Create an artist profile
          </h2>
          <p className="mt-4 text-muted">
            Use approved public attribution only. Keep private evidence, contacts and
            access tokens outside these fields. A creator wallet is optional; a payout
            wallet is required before a future sale.
          </p>
          <form
            className="admin-form mt-6"
            noValidate
            onSubmit={(event) => void create(event)}
            aria-busy={state.busy === "create"}
          >
            <fieldset disabled={state.busy !== null}>
              <legend className="sr-only">Artist profile details</legend>
              {fields.map(([name, label, max]) => (
                <div className="admin-field" key={name}>
                  <label htmlFor={`artist-${name}`}>{label}</label>
                  {["biography", "traditions", "publicLinks"].includes(name) ? (
                    <textarea
                      id={`artist-${name}`}
                      name={name}
                      rows={name === "biography" ? 5 : 3}
                      maxLength={max}
                      required={
                        ![
                          "publicLinks",
                          "profileImageUrl",
                          "creatorWallet",
                          "payoutWallet",
                        ].includes(name)
                      }
                      aria-invalid={!!errors[name]}
                      aria-describedby={errors[name] ? `error-${name}` : undefined}
                      autoComplete="off"
                    />
                  ) : (
                    <input
                      id={`artist-${name}`}
                      name={name}
                      type={name === "profileImageUrl" ? "url" : "text"}
                      autoComplete={name === "displayName" ? "name" : "off"}
                      maxLength={max}
                      required={
                        ![
                          "publicLinks",
                          "profileImageUrl",
                          "creatorWallet",
                          "payoutWallet",
                        ].includes(name)
                      }
                      spellCheck={
                        ![
                          "slug",
                          "creatorWallet",
                          "payoutWallet",
                          "profileImageUrl",
                        ].includes(name)
                      }
                      aria-invalid={!!errors[name]}
                      aria-describedby={errors[name] ? `error-${name}` : undefined}
                    />
                  )}
                  {errors[name] && (
                    <p id={`error-${name}`} className="mt-2 text-sm">
                      {errors[name]}
                    </p>
                  )}
                </div>
              ))}
              <button className="button-primary mt-4" type="submit">
                {state.busy === "create" ? "Creating artist…" : "Create artist profile"}
              </button>
            </fieldset>
          </form>
        </section>
      )}
      {state.permissions?.verifier && (
        <section className="mt-10" aria-labelledby="artist-review">
          <h2 id="artist-review" className="text-3xl">
            Review an artist
          </h2>
          <p className="mt-4 text-muted">
            Load the artist UUID from onboarding to review the saved profile before
            recording your manual verification.
          </p>
          <form className="admin-form mt-6" onSubmit={read} noValidate>
            <label htmlFor="artist-review-id">Artist UUID</label>
            <input
              id="artist-review-id"
              name="artistId"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={36}
              aria-invalid={!!idError}
              aria-describedby={idError ? "artist-id-error" : undefined}
              disabled={!!state.busy}
            />
            {idError && (
              <p id="artist-id-error" className="mt-2">
                {idError}
              </p>
            )}
            <button className="text-link mt-4" type="submit" disabled={!!state.busy}>
              {state.busy === "read" ? "Loading artist…" : "Load artist profile"}
            </button>
          </form>
        </section>
      )}
      {state.artist && (
        <section
          className="mt-10 border-t border-line pt-6"
          aria-labelledby="saved-artist"
        >
          <h2 id="saved-artist" className="text-3xl">
            {state.artist.displayName}
          </h2>
          <p role="status" className="mt-4">
            {state.artist.verificationStatus === "VERIFIED"
              ? "Artist profile verified"
              : "Artist profile saved · Awaiting manual verification"}
          </p>
          <dl className="artwork-facts mt-6">
            <div>
              <dt>Artist UUID</dt>
              <dd className="break-all font-mono text-sm">{state.artist.id}</dd>
            </div>
            <div>
              <dt>Public slug</dt>
              <dd>{state.artist.slug}</dd>
            </div>
            <div>
              <dt>Biography</dt>
              <dd className="whitespace-pre-wrap">{state.artist.biography}</dd>
            </div>
            <div>
              <dt>Region and traditions</dt>
              <dd>
                {state.artist.region} · {state.artist.traditions.join(", ")}
              </dd>
            </div>
            <div>
              <dt>Creator wallet</dt>
              <dd className="break-all">
                {state.artist.creatorWallet ?? "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Payout wallet</dt>
              <dd className="break-all">
                {state.artist.payoutWallet ?? "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Approved image URL</dt>
              <dd className="break-all">
                {state.artist.profileImageUrl ?? "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Public links</dt>
              <dd>
                {state.artist.publicLinks.length
                  ? state.artist.publicLinks.map((url) => (
                      <p key={url} className="break-all">
                        {url}
                      </p>
                    ))
                  : "None provided"}
              </dd>
            </div>
            {state.artist.verifiedAt && (
              <div>
                <dt>Verification recorded</dt>
                <dd>
                  {state.artist.verifiedAt}
                  <br />
                  <span className="break-all">{state.artist.verifiedByWallet}</span>
                </dd>
              </div>
            )}
          </dl>
          {state.artist.verificationStatus === "VERIFIED" ? (
            <a
              className="text-link mt-5 inline-block"
              href={`/artists/${state.artist.slug}`}
            >
              View public artist profile
            </a>
          ) : state.permissions?.verifier ? (
            <form
              className="mt-6"
              onSubmit={(event) => {
                event.preventDefault();
                void onboarding?.verify(confirmed);
              }}
            >
              <label className="admin-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={!!state.busy}
                />
                I completed manual artist verification and approve this saved profile.
              </label>
              <p className="mt-3 text-sm text-muted">
                This records an off-chain profile claim under your verifier wallet. It
                does not verify an artwork or send a Solana transaction.
              </p>
              <button
                className="button-primary mt-4"
                type="submit"
                disabled={!confirmed || !!state.busy}
              >
                {state.busy === "verify"
                  ? "Recording verification…"
                  : "Record artist verification"}
              </button>
            </form>
          ) : (
            <p className="mt-4">
              Give this artist UUID to an authorized verifier. Admin permission does not
              grant verification permission.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
