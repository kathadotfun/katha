"use client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type { ArtworkDraftResponse } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtworkDraftEditor,
  lockedDraftEditorSnapshot,
  type ArtworkDraftEditor,
} from "../lib/artwork-draft-editor";
import { parseArtworkDraftForm } from "../lib/artwork-draft-form";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { localDateTime, localTime } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { PublicationPath } from "./artwork-workflow-nav";
import { EvidenceFingerprint } from "./evidence-fingerprint";
import { NfcTagPanel } from "./nfc-tag-panel";
import { Badge, FieldTag, Notice } from "./ui/status";

const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverEditor = () => lockedDraftEditorSnapshot;

const labels: Record<string, string> = {
  title: "Title",
  widthMm: "Width",
  heightMm: "Height",
  depthMm: "Depth",
  countryCode: "Origin country",
  region: "Origin region",
  locality: "Origin locality",
  technique: "Technique",
  materials: "Materials",
  story: "Story",
  meaning: "Meaning",
  culturalContext: "Cultural context",
  creationProcess: "Creation process",
  authorshipEvidenceHash: "Authorship evidence fingerprint",
  artistId: "Artist record ID",
  category: "Tradition",
  creationYear: "Creation year",
  creationRequestId: "Creation request ID",
};
const editable = [
  "title",
  "widthMm",
  "heightMm",
  "depthMm",
  "countryCode",
  "region",
  "locality",
  "technique",
  "materials",
  "story",
  "meaning",
  "culturalContext",
  "creationProcess",
  "authorshipEvidenceHash",
] as const;

function savedValue(artwork: ArtworkDraftResponse | undefined, name: string): string {
  if (!artwork) return name === "countryCode" ? "NP" : "";
  if (name === "materials") return artwork.materials.join("\n");
  if (name === "heightMm" || name === "widthMm" || name === "depthMm")
    return String(artwork.dimensions?.[name] ?? "");
  if (name === "countryCode" || name === "region" || name === "locality")
    return artwork.origin?.[name] ?? "";
  const value = artwork[name as keyof ArtworkDraftResponse];
  return value === null || value === undefined ? "" : String(value);
}

function useEditor(kathaId?: string) {
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
  const state = useSyncExternalStore(
    editor?.subscribe ?? emptySubscribe,
    editor?.getSnapshot ?? serverEditor,
    serverEditor,
  );
  return { auth, editor, state };
}

function Field({
  name,
  tag,
  errors,
  value,
  help,
  multiline = false,
  disabled,
  unit,
  wide = false,
  changed = false,
  readOnly = false,
  max,
}: {
  name: string;
  tag?: "req" | "opt" | "priv" | "lock" | undefined;
  errors: Record<string, string>;
  value: string;
  help?: string;
  multiline?: boolean;
  disabled?: boolean;
  unit?: string;
  wide?: boolean;
  changed?: boolean;
  readOnly?: boolean;
  max: number;
}) {
  const id = `draft-${name}`;
  const described = [errors[name] ? `${id}-error` : null, help ? `${id}-help` : null]
    .filter(Boolean)
    .join(" ");
  const props = {
    id,
    name,
    maxLength: max,
    defaultValue: value,
    autoComplete: "off",
    className: `inp${changed ? " changed" : ""}`,
    disabled,
    readOnly,
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": described || undefined,
  };
  const numeric = name.endsWith("Mm") || name === "creationYear";
  const control = multiline ? (
    <textarea {...props} rows={name === "story" ? 6 : 4} />
  ) : (
    <input
      {...props}
      type="text"
      inputMode={numeric ? "numeric" : "text"}
      spellCheck={!numeric && !name.endsWith("Id") && name !== "authorshipEvidenceHash"}
    />
  );
  return (
    <div className={`fld${wide || multiline ? " span-all" : ""}`}>
      <label className="lbl" htmlFor={id}>
        {labels[name]} {tag && <FieldTag kind={tag} />}
        {changed && <FieldTag kind="changed" />}
      </label>
      {unit ? (
        <div className="unit">
          {control}
          <span>{unit}</span>
        </div>
      ) : (
        control
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

function PhysicalFields({
  errors,
  value,
  disabled,
  changed,
  createMode,
}: {
  errors: Record<string, string>;
  value: (name: string) => string;
  disabled: boolean;
  changed: (name: string) => boolean;
  createMode: boolean;
}) {
  const common = (name: string) => ({
    name,
    errors,
    value: value(name),
    disabled,
    changed: changed(name),
  });
  return (
    <>
      <div className="g3">
        <Field
          {...common("widthMm")}
          tag={createMode ? "opt" : undefined}
          unit="mm"
          max={10}
        />
        <Field
          {...common("heightMm")}
          tag={createMode ? "opt" : undefined}
          unit="mm"
          max={10}
        />
        <Field {...common("depthMm")} tag="opt" unit="mm" max={10} />
      </div>
      <p className="help -mt-1.5">
        Measure in whole millimetres; width and height go together. Include the mount
        only if it&apos;s part of the work.
      </p>
      <div className="g2">
        <Field
          {...common("countryCode")}
          tag="req"
          max={2}
          help="Two uppercase letters, like NP."
        />
        <Field {...common("region")} tag="opt" max={120} />
        <Field {...common("locality")} tag="opt" max={120} />
        <Field {...common("technique")} tag="opt" max={500} />
        <Field
          {...common("materials")}
          tag="opt"
          max={2420}
          multiline
          help="One material per line, up to 20, without commas."
        />
      </div>
    </>
  );
}

function StoryFields({
  errors,
  value,
  disabled,
  changed,
}: {
  errors: Record<string, string>;
  value: (name: string) => string;
  disabled: boolean;
  changed: (name: string) => boolean;
}) {
  return (
    <>
      {(["story", "meaning", "culturalContext", "creationProcess"] as const).map(
        (name) => (
          <Field
            key={name}
            name={name}
            tag="opt"
            errors={errors}
            value={value(name)}
            disabled={disabled}
            changed={changed(name)}
            multiline
            max={name === "story" ? 10000 : 5000}
          />
        ),
      )}
    </>
  );
}

function SignedOut({ path }: { path: string }) {
  return (
    <div className="panel cut panel-empty">
      <p className="empty-title">Sign in to document artworks</p>
      <p className="p max-w-[38rem]">
        Artwork documentation needs a signed-in administrator wallet.
      </p>
      <Link className="btn btn-p cut-s mt-2" href={signInHref(path)}>
        Sign in
      </Link>
    </div>
  );
}

function AccessState({
  state,
  retry,
}: {
  state: ReturnType<typeof useEditor>["state"];
  retry: () => void;
}) {
  if (state.busy)
    return (
      <p role="status" className="p">
        Checking access and loading documentation…
      </p>
    );
  return (
    <div
      className="panel cut panel-empty"
      role={state.status === "unavailable" ? "alert" : undefined}
    >
      {state.status === "denied" ? (
        <Badge tone="err" icon="lock">
          Permission denied
        </Badge>
      ) : (
        <Badge tone="err" marker={false}>
          Service unavailable
        </Badge>
      )}
      <p className="empty-title">
        {state.status === "denied"
          ? "Documentation needs an administrator role"
          : "Documentation couldn't load"}
      </p>
      <p className="p max-w-[38rem]">
        {state.error ?? "Artwork documentation access hasn't been confirmed."}
      </p>
      <button type="button" className="btn btn-p cut-s mt-2" onClick={retry}>
        Check access again
      </button>
    </div>
  );
}

/* ---------- Create artwork ---------- */

export function ArtworkCreatePanel() {
  const [round, setRound] = useState(0);
  return <CreateRound key={round} onAnother={() => setRound(round + 1)} />;
}

function CreateRound({ onAnother }: { onAnother: () => void }) {
  const { auth, editor, state } = useEditor();
  const [requestId] = useState(() => crypto.randomUUID());
  const [evidenceHash, setEvidenceHash] = useState("");
  const [checks, setChecks] = useState({ identity: false, title: false });
  const walletKey = auth.session?.walletId;
  useEffect(() => {
    setEvidenceHash("");
    setChecks({ identity: false, title: false });
  }, [walletKey]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!auth.session) return <SignedOut path="/admin/artworks/new" />;
  if (state.status !== "ready" && !state.record)
    return <AccessState state={state} retry={() => void editor?.check()} />;
  const created = state.record?.artwork;
  if (created)
    return (
      <section
        className="ok-panel cut weave dk"
        role="status"
        aria-labelledby="created-title"
      >
        <h2 id="created-title" className="serif m-0 text-[28px] font-semibold">
          Artwork created
        </h2>
        <p className="m-0">
          Permanent Katha ID <span className="id text-xl">{created.kathaId}</span>.
          Artist, tradition and creation year are now locked. This doesn&apos;t
          register, verify, mint or publish the work.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link
            className="btn btn-ok cut-s"
            href={`/admin/artworks/${created.kathaId}`}
          >
            Open documentation
          </Link>
          <button type="button" className="lnk-d" onClick={onAnother}>
            Create another
          </button>
        </div>
      </section>
    );
  const uncertain =
    Boolean(state.error) && /could not be confirmed/i.test(state.error ?? "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = parseArtworkDraftForm(new FormData(form), requestId);
    if (!parsed.data) {
      setErrors(parsed.errors);
      form
        .querySelector<HTMLElement>(`[name="${Object.keys(parsed.errors)[0]}"]`)
        ?.focus();
      return;
    }
    setErrors({});
    await editor?.create(parsed.data);
  }
  const errorNames = Object.keys(errors);
  const disabled = state.busy;
  const value = (name: string) => savedValue(undefined, name);
  const unchanged = () => false;
  return (
    <>
      <p className="p max-w-[44rem] text-lg">
        Start the record for a physical work. Katha issues its permanent ID when you
        create it; registration, verification and minting come later.
      </p>
      {uncertain && (
        <Notice tone="warn" icon="warning" role="alert" className="mt-8">
          <p>
            <strong>We couldn&apos;t confirm the artwork was created.</strong> Check the{" "}
            <Link className="lnk" href="/admin/artworks">
              artwork list
            </Link>{" "}
            first. If you retry, Katha recognises this same request (
            <span className="id">{requestId}</span>) and won&apos;t create a duplicate.
          </p>
        </Notice>
      )}
      {state.error && !uncertain && (
        <Notice tone="err" className="mt-8">
          <p>{state.error}</p>
        </Notice>
      )}
      {errorNames.length > 0 && (
        <Notice tone="err" className="mt-8">
          <p>
            <strong>
              {errorNames.length === 1
                ? "1 field needs"
                : `${errorNames.length} fields need`}{" "}
              attention:
            </strong>{" "}
            {errorNames.map((name, index) => (
              <span key={name}>
                {index > 0 && (index === errorNames.length - 1 ? " and " : ", ")}
                <a className="lnk" href={`#draft-${name}`}>
                  {(labels[name] ?? name).toLowerCase()}
                </a>
              </span>
            ))}
            . Everything else you entered is kept.
          </p>
        </Notice>
      )}
      <div className="workflow-layout mt-8">
        <form
          className="flex min-w-0 flex-col gap-5"

          id="new-artwork-form"
          noValidate
          onInput={(event) => {
            const data = new FormData(event.currentTarget);
            setChecks({
              identity: Boolean(
                String(data.get("artistId") ?? "").trim() && data.get("category"),
              ),
              title: Boolean(String(data.get("title") ?? "").trim()),
            });
          }}
          onSubmit={(event) => void submit(event)}
          aria-busy={state.busy}
        >
          <fieldset className="panel cut sect" disabled={disabled}>
            <legend className="h2 h2-ops p-0">Identity</legend>
            <p className="p sm -mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <FieldTag kind="lock">Locked once created</FieldTag>
              <span>
                Artist, tradition and creation year can&apos;t be changed after the
                record exists. Check them carefully.
              </span>
            </p>
            <Field
              name="artistId"
              tag="req"
              errors={errors}
              value=""
              max={36}
              wide
              help="The ID returned when the artist's profile was created in Administration."
            />
            <fieldset className="fld">
              <legend className="lbl mb-1.5">
                Tradition <FieldTag kind="req" />
              </legend>
              <div className="choice">
                {(Object.entries(artworkCategoryLabels) as [string, string][]).map(
                  ([key, label]) => (
                    <label key={key} className="cut-s">
                      <input
                        type="radio"
                        name="category"
                        value={key}
                        aria-invalid={errors.category ? true : undefined}
                      />
                      {label}
                    </label>
                  ),
                )}
              </div>
              {errors.category && <p className="ferr">Choose a tradition.</p>}
            </fieldset>
            <div className="g2">
              <Field name="title" tag="req" errors={errors} value="" max={200} wide />
              <Field
                name="creationYear"
                tag="req"
                errors={errors}
                value=""
                max={4}
                help="The year the artist finished the work."
              />
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="draft-authorshipEvidenceHash">
                {labels.authorshipEvidenceHash}{" "}
                <FieldTag kind="opt">Needed before registration</FieldTag>
                <FieldTag kind="priv">Evidence stays private</FieldTag>
              </label>
              <EvidenceFingerprint
                key={walletKey}
                disabled={disabled}
                onFingerprint={setEvidenceHash}
              />
              <input
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.currentTarget.value)}
                id="draft-authorshipEvidenceHash"
                name="authorshipEvidenceHash"
                className="inp id font-medium"
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.authorshipEvidenceHash ? true : undefined}
                aria-describedby="draft-authorshipEvidenceHash-help"
              />
              {errors.authorshipEvidenceHash && (
                <p className="ferr">{errors.authorshipEvidenceHash}</p>
              )}
              <p id="draft-authorshipEvidenceHash-help" className="help">
                The SHA-256 fingerprint (64 hex characters) of the authorship evidence
                file. Only the fingerprint is recorded; the file itself is never
                published.
              </p>
            </div>
          </fieldset>
          <fieldset className="panel cut sect" disabled={disabled}>
            <legend className="h2 h2-ops p-0">Physical details</legend>
            <PhysicalFields
              errors={errors}
              value={value}
              disabled={disabled}
              changed={unchanged}
              createMode
            />
          </fieldset>
          <fieldset className="panel cut sect" disabled={disabled}>
            <legend className="h2 h2-ops p-0">Story and context</legend>
            <p className="p sm -mt-2">
              Shown on the public record once published. After minting, changes go
              through metadata revisions.
            </p>
            <StoryFields
              errors={errors}
              value={value}
              disabled={disabled}
              changed={unchanged}
            />
          </fieldset>
          <details className="more">
            <summary>Creation request ID</summary>
            <div className="fld mt-2">
              <label className="lbl" htmlFor="draft-creationRequestId">
                {labels.creationRequestId}
              </label>
              <input
                id="draft-creationRequestId"
                name="creationRequestId"
                className="inp id font-medium"
                defaultValue={requestId}
                maxLength={36}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="draft-creationRequestId-help"
              />
              <p id="draft-creationRequestId-help" className="help">
                Keep this if creation is uncertain. After a reload, paste the retained
                ID here before retrying so the same request isn&apos;t created twice.
              </p>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link className="lnk" href="/admin/artworks">
              Cancel
            </Link>
            {state.busy && (
              <p className="sm mut m-0" role="status">
                Creating the record. Don&apos;t close this page.
              </p>
            )}
          </div>
        </form>
        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 280px" }}>
          <div className="panel flex flex-col gap-4">
            <p className="lbl">Permanent Katha ID</p>
            <p className="mono sm m-0">Assigned when you create it</p>
            <ul className="chk-list">
              {[
                [checks.identity, "Tradition and artist"],
                [checks.title, "Title"],
                [
                  /^[0-9a-f]{64}$/.test(evidenceHash),
                  "Authorship evidence fingerprint",
                ],
              ].map(([ok, label]) => (
                <li key={String(label)}>
                  <span className={`mk${ok ? " mk-ok" : ""}`} aria-hidden="true">
                    {ok ? "✓" : ""}
                  </span>
                  <span className="sm">
                    {label}
                    <span className="sr-only">{ok ? ", ready" : ", not entered"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button
              className="btn btn-p btn-w"
              type="submit"
              form="new-artwork-form"
              disabled={state.busy}
            >
              {state.busy ? "Creating…" : "Create artwork"}
            </button>
            <p className="xs m-0">Saves a draft. Nothing goes on chain yet.</p>
          </div>
          <div className="panel cut-s flex flex-col gap-2.5">
            <h2 className="h3">Before you create</h2>
            <ul className="p sm m-0 flex flex-col gap-1.5 pl-5">
              <li>The artist&apos;s profile exists in Katha.</li>
              <li>You have the authorship evidence and its fingerprint.</li>
              <li>The work has been measured in millimetres.</li>
            </ul>
          </div>
          <div className="panel cut-s flex flex-col gap-2.5">
            <h2 className="h3">Field markers</h2>
            <p className="sm m-0 flex flex-col gap-2">
              <span>
                <FieldTag kind="req" /> needed to create
              </span>
              <span>
                <FieldTag kind="opt" /> can be added later
              </span>
              <span>
                <FieldTag kind="lock">Locked once created</FieldTag> permanent
              </span>
              <span>
                <FieldTag kind="priv">Evidence stays private</FieldTag> never published
              </span>
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

/* ---------- Documentation (edit) ---------- */

export function ArtworkDraftEditorPanel({
  kathaId,
  apiOrigin,
}: {
  kathaId: string;
  apiOrigin: string;
}) {
  const { auth, editor, state } = useEditor(kathaId);
  if (!auth.session) return <SignedOut path={`/admin/artworks/${kathaId}`} />;
  return (
    <EditorWorkspace
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}`}
      editor={editor}
      state={state}
      kathaId={kathaId}
      apiOrigin={apiOrigin}
    />
  );
}

function EditorWorkspace({
  editor,
  state,
  kathaId,
  apiOrigin,
}: {
  editor: ArtworkDraftEditor | null;
  state: ReturnType<typeof useEditor>["state"];
  kathaId: string;
  apiOrigin: string;
}) {
  const artwork = state.record?.artwork;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discards, setDiscards] = useState(0);
  const [dirtyKey, setDirtyKey] = useState<string | null>(null);
  // Unsaved values survive a conflicting save so they can be compared field by field.
  const pending = useRef<Record<string, string> | null>(null);
  const [mine, setMine] = useState<Record<string, string> | null>(null);
  const [compared, setCompared] = useState(false);
  const [choices, setChoices] = useState<Record<string, "mine" | "theirs">>({});
  useEffect(() => {
    if (state.reloadRequired && pending.current) {
      setMine(pending.current);
      setCompared(false);
      setChoices({});
    }
  }, [state.reloadRequired]);
  if (!artwork)
    return <AccessState state={state} retry={() => void editor?.read(kathaId)} />;
  const locked = !state.record!.editable;
  const conflict = state.reloadRequired;
  const diffs =
    mine && compared
      ? editable.filter((name) => (mine[name] ?? "") !== savedValue(artwork, name))
      : [];
  const value = (name: string) =>
    mine &&
    compared &&
    diffs.includes(name as (typeof editable)[number]) &&
    choices[name] !== "theirs"
      ? (mine[name] ?? "")
      : savedValue(artwork, name);
  const formKey = `${artwork.updatedAt}:${discards}:${compared ? JSON.stringify(choices) : "saved"}`;
  const dirty =
    dirtyKey === formKey ||
    (compared && diffs.some((name) => choices[name] !== "theirs"));
  const disabled = state.busy || locked || conflict;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = parseArtworkDraftForm(data, crypto.randomUUID(), artwork);
    if (!parsed.data) {
      setErrors(parsed.errors);
      form
        .querySelector<HTMLElement>(`[name="${Object.keys(parsed.errors)[0]}"]`)
        ?.focus();
      return;
    }
    setErrors({});
    pending.current = Object.fromEntries(
      editable.map((name) => [name, String(data.get(name) ?? "").trim()]),
    );
    await editor?.save(parsed.data);
    if (!editor?.getSnapshot().reloadRequired) {
      pending.current = null;
      setMine(null);
      setCompared(false);
    }
  }
  const bar = locked
    ? {
        tone: "neu",
        text: "Locked after lifecycle records exist",
        bg: "var(--color-neutral-soft)",
        fg: "var(--color-text-2)",
      }
    : conflict
      ? {
          tone: "err",
          text: "Not saved: a newer version may exist",
          bg: "var(--color-err-soft)",
          fg: "var(--color-err)",
        }
      : dirty
        ? {
            tone: "warn",
            text: "You have unsaved changes",
            bg: "var(--color-warn-soft)",
            fg: "var(--color-warn)",
          }
        : {
            tone: "ok",
            text: `${state.saved ? "All changes saved" : "Saved"} at ${localTime(artwork.updatedAt)}`,
            bg: "var(--color-ok-soft)",
            fg: "var(--color-ok)",
          };
  return (
    <div className="workflow-layout">
      <div className="flex min-w-0 flex-col gap-6">
        <div
          className="status-bar cut-s"
          role="status"
          style={{ background: bar.bg, color: bar.fg }}
        >
          <p className="m-0 flex items-center gap-2.5 font-semibold">
            <span
              className="dm"
              style={{ background: "currentColor", boxShadow: "none" }}
              aria-hidden="true"
            />
            {state.busy ? "Saving…" : bar.text}
          </p>
          {dirty && !locked && !conflict && (
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn btn-p btn-sm cut-s"
                type="submit"
                form="documentation-form"
                disabled={state.busy}
              >
                Save changes
              </button>
              <button
                className="btn btn-o btn-sm"
                type="button"
                onClick={() => {
                  setDirtyKey(null);
                  setMine(null);
                  setCompared(false);
                  setDiscards(discards + 1);
                }}
              >
                Discard
              </button>
            </div>
          )}
        </div>

        {state.error && !conflict && (
          <Notice tone="err">
            <p>{state.error}</p>
          </Notice>
        )}

        {conflict && (
          <section
            className="panel cut flex flex-col gap-3.5"
            role="alert"
            aria-labelledby="conflict-title"
            style={{ boxShadow: "inset 0 0 0 2px var(--color-err)" }}
          >
            <h2 id="conflict-title" className="h3 text-err">
              Someone may have saved a newer version
            </h2>
            <p className="p">
              {state.error} Your changes are kept. Load the saved version to compare,
              then choose which value to keep for each field that differs.
            </p>
            <button
              type="button"
              className="btn btn-p btn-sm cut-s self-start"
              disabled={state.busy}
              onClick={() => {
                setCompared(true);
                void editor?.read(kathaId);
              }}
            >
              Load the saved version to compare
            </button>
          </section>
        )}

        {compared && mine && !conflict && diffs.length > 0 && (
          <section
            className="panel cut flex flex-col gap-3.5"
            aria-labelledby="compare-title"
          >
            <h2 id="compare-title" className="h3">
              Choose what to keep
            </h2>
            <p className="p sm">
              The saved version, last changed {localDateTime(artwork.updatedAt)},
              differs in {diffs.length === 1 ? "one field" : `${diffs.length} fields`}.
              Save when you&apos;ve chosen.
            </p>
            {diffs.map((name) => (
              <fieldset key={name} className="flex flex-col gap-2">
                <legend className="lbl mb-1.5">{labels[name]}</legend>
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
                  }}
                >
                  {(["mine", "theirs"] as const).map((side) => (
                    <label
                      key={side}
                      className="chk flex-col items-stretch gap-2 p-3.5"
                      style={{
                        background: side === "mine" ? "var(--acc-soft)" : "var(--well)",
                      }}
                    >
                      <span className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name={`choice-${name}`}
                          checked={(choices[name] ?? "mine") === side}
                          onChange={() => setChoices({ ...choices, [name]: side })}
                        />
                        <span className="xs mut">
                          {side === "mine" ? "Yours" : "Saved version"}
                        </span>
                      </span>
                      <span className="wrap-anywhere whitespace-pre-wrap">
                        {(side === "mine" ? mine[name] : savedValue(artwork, name)) ||
                          "Empty"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </section>
        )}

        {locked && (
          <Notice tone="neu" icon="lock">
            <p>
              <strong>Documentation is locked.</strong> Lifecycle or publication records
              exist, so the public story can only change through a metadata revision,
              which updates the registry and the asset together.{" "}
              <Link className="lnk" href={`/admin/artworks/${kathaId}/metadata`}>
                Start a metadata revision
              </Link>
            </p>
          </Notice>
        )}

        <section className="panel cut" aria-labelledby="protected-title">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <h2 id="protected-title" className="h3">
              Protected identity
            </h2>
            <FieldTag kind="lock" />
          </div>
          <dl className="mt-3 mb-0">
            <div className="kv kv-ops">
              <dt>Katha ID</dt>
              <dd className="id">{artwork.kathaId}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Title</dt>
              <dd>{artwork.title}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Artist record</dt>
              <dd className="id">{artwork.artistId}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Creator wallet</dt>
              <dd className="id">{artwork.creatorWallet ?? "Not supplied"}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Tradition</dt>
              <dd>{artworkCategoryLabels[artwork.category]}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Creation year</dt>
              <dd>{artwork.creationYear}</dd>
            </div>
          </dl>
          <p className="help mt-2.5">
            These were fixed when the record was created and can&apos;t be edited.
          </p>
        </section>

        <form
          id="documentation-form"
          key={formKey}
          className="panel cut flex flex-col gap-[18px]"
          aria-labelledby="documentation-title"
          noValidate
          onSubmit={(event) => void submit(event)}
          onInput={() => setDirtyKey(formKey)}
          aria-busy={state.busy}
        >
          <h2 id="documentation-title" className="h3">
            Documentation
          </h2>
          <p className="help -mt-2">
            Use approved documentation only; keep private evidence, contacts and
            shipping details out. Blank optional fields clear saved values.
          </p>
          <fieldset className="flex flex-col gap-[18px]" disabled={disabled}>
            <legend className="sr-only">Edit saved artwork documentation</legend>
            <div className="g2">
              <Field
                name="title"
                tag="req"
                errors={errors}
                value={value("title")}
                max={200}
                wide
                changed={compared && diffs.includes("title")}
              />
            </div>
            <PhysicalFields
              errors={errors}
              value={value}
              disabled={disabled}
              changed={(name) =>
                compared && diffs.includes(name as (typeof editable)[number])
              }
              createMode={false}
            />
            <StoryFields
              errors={errors}
              value={value}
              disabled={disabled}
              changed={(name) =>
                compared && diffs.includes(name as (typeof editable)[number])
              }
            />
            <Field
              name="authorshipEvidenceHash"
              tag={artwork.authorshipEvidenceHash ? "lock" : "priv"}
              errors={errors}
              value={value("authorshipEvidenceHash")}
              max={64}
              wide
              readOnly={Boolean(artwork.authorshipEvidenceHash)}
              help={
                artwork.authorshipEvidenceHash
                  ? "Locked once supplied. Only the fingerprint is recorded."
                  : "SHA-256 of the private evidence file; needed before registration."
              }
            />
            <p className="help">
              After minting, changes to the story, meaning, context and process go
              through{" "}
              <Link className="lnk" href={`/admin/artworks/${kathaId}/metadata`}>
                metadata revisions
              </Link>
              .
            </p>
          </fieldset>
          {!locked && !conflict && (
            <button
              className="btn btn-p cut-s self-start"
              type="submit"
              disabled={state.busy}
            >
              {state.busy ? "Saving…" : "Save changes"}
            </button>
          )}
        </form>

        <NfcTagPanel kathaId={kathaId} title={artwork.title} apiOrigin={apiOrigin} />
      </div>
      <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
        <PublicationPath kathaId={kathaId} />
      </aside>
    </div>
  );
}
