"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtworkDraftEditor,
  lockedDraftEditorSnapshot,
  type ArtworkDraftEditor,
} from "../lib/artwork-draft-editor";
import { parseArtworkDraftForm } from "../lib/artwork-draft-form";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverEditor = () => lockedDraftEditorSnapshot;
export function ArtworkDraftEditorPanel({ kathaId }: { kathaId?: string }) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const [editor, setEditor] = useState<ArtworkDraftEditor | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createArtworkDraftEditor(session);
    setEditor(current);
    return () => current.dispose();
  }, [session, kathaId]);
  useEffect(() => {
    if (auth.status === "signed-in") {
      if (kathaId) void editor?.read(kathaId);
      else void editor?.check();
    }
  }, [editor, kathaId, auth.status, auth.session]);
  if (!auth.session)
    return (
      <p role="status" className="mt-10">
        Connect your wallet and sign in to Katha in the header to document artwork.
      </p>
    );
  return (
    <EditorWorkspace
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}:${kathaId ?? "new"}`}
      editor={editor}
      kathaId={kathaId}
    />
  );
}
const fields = [
  ["title", "Artwork title (required)", 200],
  ["countryCode", "Origin country code (required, two uppercase letters)", 2],
  ["region", "Origin region (optional)", 120],
  ["locality", "Origin locality (optional)", 120],
  ["heightMm", "Height in millimetres (optional, with width)", 10],
  ["widthMm", "Width in millimetres (optional, with height)", 10],
  ["depthMm", "Depth in millimetres (optional)", 10],
  ["materials", "Materials (optional, one per line, up to 20)", 2420],
  ["technique", "Technique (optional)", 500],
  ["story", "Artwork story (optional)", 10000],
  ["meaning", "Meaning (optional)", 5000],
  ["culturalContext", "Cultural context (optional)", 5000],
  ["creationProcess", "Creation process (optional)", 5000],
  ["authorshipEvidenceHash", "Authorship evidence SHA-256 digest (optional)", 64],
] as const;
function EditorWorkspace({
  editor,
  kathaId,
}: {
  editor: ArtworkDraftEditor | null;
  kathaId?: string | undefined;
}) {
  const state = useSyncExternalStore(
    editor?.subscribe ?? emptySubscribe,
    editor?.getSnapshot ?? serverEditor,
    serverEditor,
  );
  const [requestId] = useState(() => crypto.randomUUID());
  const record = state.record;
  const artwork = record?.artwork;
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="draft-editor-title"
      aria-busy={state.busy}
    >
      <h2 id="draft-editor-title" className="text-2xl">
        Artwork documentation
      </h2>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking access and processing documentation…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="mt-4">
          Artwork documentation saved. This does not register, verify, mint or publish
          the artwork.
        </p>
      )}
      {state.status !== "ready" && !state.busy && (
        <>
          <p className="mt-4">
            {state.status === "denied"
              ? "An administrator wallet is required."
              : "Artwork documentation access has not been confirmed."}
          </p>
          <button
            type="button"
            className="text-link mt-4"
            onClick={() =>
              kathaId ? void editor?.read(kathaId) : void editor?.check()
            }
          >
            Check documentation access again
          </button>
        </>
      )}
      {artwork && (
        <>
          <p className="font-mono break-all mt-6">{artwork.kathaId}</p>
          <dl className="artwork-facts mt-4">
            <div>
              <dt>Artist UUID (permanent attribution)</dt>
              <dd>{artwork.artistId}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{artwork.category}</dd>
            </div>
            <div>
              <dt>Creation year</dt>
              <dd>{artwork.creationYear}</dd>
            </div>
            <div>
              <dt>Creator wallet snapshot</dt>
              <dd>{artwork.creatorWallet ?? "Not supplied"}</dd>
            </div>
            <div>
              <dt>Last saved</dt>
              <dd>{artwork.updatedAt}</dd>
            </div>
          </dl>
          <Link
            className="text-link mt-4 inline-block"
            href={`/admin/artworks/${artwork.kathaId}`}
          >
            Open saved documentation
          </Link>
          <Link
            className="text-link mt-4 inline-block ml-6"
            href={`/admin/artworks/${artwork.kathaId}/media`}
          >
            Manage artwork media
          </Link>
          <Link
            href={`/admin/artworks/${artwork.kathaId}/registration`}
            className="text-link mt-4 inline-block"
          >
            Register artwork on chain
          </Link>
          <Link
            href={`/admin/artworks/${artwork.kathaId}/verification`}
            className="text-link mt-4 inline-block ml-6"
          >
            Review artwork authenticity
          </Link>
          <p className="mt-4 text-sm text-muted">
            Permanent identity, artist, category and creation year cannot be edited.
            Lifecycle records can close the editing window independently.
          </p>
          <button
            type="button"
            className="text-link mt-4"
            disabled={state.busy}
            onClick={() => void editor?.read(artwork.kathaId)}
          >
            Reload saved draft (discard unsaved changes)
          </button>
        </>
      )}
      {state.status === "ready" && (record || !kathaId) && (
        <>
          {record && !record.editable && (
            <p role="status" className="mt-6">
              Editing is closed because publication or lifecycle records exist. Review
              documentation here; use the lifecycle revision workflow for changes.
            </p>
          )}
          <DocumentationForm
            key={artwork ? `${artwork.id}:${artwork.updatedAt}` : requestId}
            editor={editor}
            requestId={requestId}
          />
        </>
      )}
    </section>
  );
}
function DocumentationForm({
  editor,
  requestId,
}: {
  editor: ArtworkDraftEditor | null;
  requestId: string;
}) {
  const state = useSyncExternalStore(
    editor?.subscribe ?? emptySubscribe,
    editor?.getSnapshot ?? serverEditor,
    serverEditor,
  );
  const artwork = state.record?.artwork;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const disabled =
    state.busy ||
    state.reloadRequired ||
    (state.record !== null && !state.record.editable);
  function initial(name: string) {
    if (!artwork) return name === "countryCode" ? "NP" : "";
    if (name === "materials") return artwork.materials.join("\n");
    if (["heightMm", "widthMm", "depthMm"].includes(name))
      return artwork.dimensions?.[name as "heightMm" | "widthMm" | "depthMm"] ?? "";
    if (name === "countryCode" || name === "region" || name === "locality")
      return artwork.origin?.[name] ?? "";
    return artwork[name as keyof typeof artwork]?.toString() ?? "";
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = parseArtworkDraftForm(new FormData(form), requestId, artwork);
    if (!parsed.data) {
      setErrors(parsed.errors);
      form
        .querySelector<HTMLElement>(`[name="${Object.keys(parsed.errors)[0]}"]`)
        ?.focus();
      return;
    }
    setErrors({});
    if (artwork) await editor?.save(parsed.data);
    else await editor?.create(parsed.data);
  }
  function field(
    name: string,
    label: string,
    maxLength: number,
    value: string | number = initial(name),
  ) {
    const id = `draft-${name}`;
    const props = {
      id,
      name,
      maxLength,
      defaultValue: value,
      autoComplete: "off",
      "aria-invalid": errors[name] ? (true as const) : undefined,
      "aria-describedby": errors[name] ? `${id}-error` : undefined,
    };
    const long = [
      "materials",
      "story",
      "meaning",
      "culturalContext",
      "creationProcess",
      "technique",
    ].includes(name);
    return (
      <div className="admin-field" key={name}>
        <label htmlFor={id}>{label}</label>
        {long ? (
          <textarea {...props} rows={name === "story" ? 6 : 4} />
        ) : (
          <input
            {...props}
            type="text"
            inputMode={
              name.endsWith("Mm") || name === "creationYear" ? "numeric" : "text"
            }
            readOnly={
              name === "authorshipEvidenceHash" &&
              artwork?.authorshipEvidenceHash !== null &&
              artwork?.authorshipEvidenceHash !== undefined
            }
          />
        )}
        {errors[name] && (
          <p id={`${id}-error`} className="mt-2 text-sm">
            {errors[name]}
          </p>
        )}
      </div>
    );
  }
  return (
    <form className="admin-form mt-8" noValidate onSubmit={submit}>
      <p className="mb-6 text-sm text-muted">
        Use approved artwork documentation. Keep private evidence, contact details and
        shipping information out of these fields. Blank optional descriptions clear
        saved values. Blank dimensions clear the measurement group. Materials are
        individual names, without commas.
      </p>
      {!artwork && (
        <p className="mb-6 text-sm break-all">
          Keep the creation request UUID below if creation is uncertain; check the draft
          list before retrying. If you reload this page, paste the retained ID into the
          creation request field before retrying.
        </p>
      )}
      <fieldset disabled={disabled}>
        <legend className="sr-only">
          {artwork
            ? "Edit saved artwork documentation"
            : "Create artwork documentation"}
        </legend>
        {!artwork && (
          <>
            {field(
              "creationRequestId",
              "Creation request UUID (required, keep on retry)",
              36,
              requestId,
            )}
            {field("artistId", "Artist UUID (required, from artist onboarding)", 36)}
            {field("category", "Category (required: MANDALA, PAUBHA or THANGKA)", 7)}
            {field("creationYear", "Creation year (required, 1–9999)", 4)}
          </>
        )}
        {fields.map(([name, label, max]) => field(name, label, max))}
        <button type="submit" className="text-link">
          {state.busy
            ? "Saving documentation…"
            : artwork
              ? "Save artwork documentation"
              : "Create artwork draft"}
        </button>
      </fieldset>
      {state.reloadRequired && (
        <p className="mt-4">
          Saving is paused. Reload the saved draft and review it before submitting
          further edits.
        </p>
      )}
    </form>
  );
}
