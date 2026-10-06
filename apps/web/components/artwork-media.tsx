"use client";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  ARTWORK_MEDIA_MAX_BYTES,
  artworkMediaMimeSchema,
  artworkMediaRoleSchema,
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  type ArtworkMediaResponse,
} from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtworkMediaManager,
  lockedMediaSnapshot,
  type ArtworkMediaManager,
} from "../lib/artwork-media";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverState = () => lockedMediaSnapshot;
export function ArtworkMediaPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const [manager, setManager] = useState<ArtworkMediaManager | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createArtworkMediaManager(session, kathaId);
    setManager(current);
    return () => current.dispose();
  }, [session, kathaId]);
  useEffect(() => {
    if (auth.status === "signed-in") void manager?.read();
  }, [manager, auth.status, auth.session]);
  if (!auth.session)
    return (
      <p role="status" className="mt-10">
        Connect your wallet and sign in to Katha in the header to manage artwork media.
      </p>
    );
  return (
    <MediaWorkspace
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}:${kathaId}`}
      manager={manager}
    />
  );
}
function MediaWorkspace({ manager }: { manager: ArtworkMediaManager | null }) {
  const state = useSyncExternalStore(
    manager?.subscribe ?? emptySubscribe,
    manager?.getSnapshot ?? serverState,
    serverState,
  );
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="media-controls"
      aria-busy={state.busy}
    >
      <h2 id="media-controls" className="text-2xl">
        Files and publication choices
      </h2>
      <p className="mt-4 text-sm text-muted">
        Private files have no public download URL. Public approval makes exact bytes
        available to anyone who knows their URL, even before the artwork is published.
        Do not approve private evidence or personal information. Hiding a previously
        public file cannot recall downloaded copies; another approved copy of the same
        bytes may remain public.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking access and processing media…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="mt-4">
          Artwork media saved. Review its order and visibility below.
        </p>
      )}
      <button
        type="button"
        className="text-link mt-4"
        disabled={!manager || state.busy}
        onClick={() => void manager?.read()}
      >
        Reload media (discard unsaved changes)
      </button>
      {!state.page && !state.busy && (
        <p role="status" className="mt-4">
          {state.status === "denied"
            ? "An administrator wallet is required."
            : "Media access has not been confirmed."}
        </p>
      )}
      {state.page && (
        <>
          <p className="font-mono break-all mt-6">{state.page.kathaId}</p>
          <p className="mt-3 text-sm">Last saved: {state.page.updatedAt}</p>
          {!state.page.editable && (
            <p role="status" className="mt-4">
              Media editing is closed because publication or lifecycle records exist.
              Preserve committed files; use the metadata revision workflow for later
              changes.
            </p>
          )}
          {state.reloadRequired && (
            <p className="mt-4">
              Further writes are paused. Reload and review current media before
              retrying. An uncertain upload may already exist.
            </p>
          )}
          <MediaForms
            key={state.page.updatedAt}
            manager={manager}
            page={state.page}
            disabled={state.busy || state.reloadRequired || !state.page.editable}
          />
        </>
      )}
    </section>
  );
}
function MediaForms({
  manager,
  page,
  disabled,
}: {
  manager: ArtworkMediaManager | null;
  page: ArtworkMediaResponse;
  disabled: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState(() => page.items.map((item) => item.id));
  const [announcement, setAnnouncement] = useState("");
  const nullable = (data: FormData, name: string) =>
    String(data.get(name) ?? "").trim() || null;
  function reject(form: HTMLFormElement, values: Record<string, string>) {
    setErrors(values);
    form.querySelector<HTMLElement>(`[name="${Object.keys(values)[0]}"]`)?.focus();
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > ARTWORK_MEDIA_MAX_BYTES ||
      !artworkMediaMimeSchema.safeParse(file.type).success
    ) {
      reject(form, {
        file: "Choose one JPEG, PNG, WebP, AVIF, MP4, WebM or PDF file, up to 8 MiB.",
      });
      return;
    }
    const parsed = artworkMediaUploadSchema.safeParse({
      expectedUpdatedAt: page.updatedAt,
      mimeType: file.type,
      role: values.get("role"),
      visibility: values.get("visibility"),
      altText: nullable(values, "altText"),
      caption: nullable(values, "caption"),
      approvedPublic: values.get("approvedPublic") === "on",
    });
    if (!parsed.success) {
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        issues[String(issue.path[0] ?? "approvedPublic")] ??= issue.message;
      reject(form, issues);
      return;
    }
    setErrors({});
    await manager?.upload(parsed.data, file);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = artworkMediaUpdateSchema.safeParse({
      expectedUpdatedAt: page.updatedAt,
      items: order.map((id) => ({
        id,
        role: values.get(`role:${id}`),
        visibility: values.get(`visibility:${id}`),
        altText: nullable(values, `altText:${id}`),
        caption: nullable(values, `caption:${id}`),
        approvedPublic: values.get(`approvedPublic:${id}`) === "on",
      })),
    });
    const issues: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const id = order[Number(issue.path[1])];
        const name = `${String(issue.path[2] ?? "approvedPublic")}:${id ?? order[0]}`;
        issues[name] ??= issue.message;
      }
    for (const id of order) {
      const item = page.items.find((value) => value.id === id)!;
      if (values.get(`role:${id}`) === "HERO" && item.kind !== "IMAGE")
        issues[`role:${id}`] = "Hero must be an image.";
      if (
        values.get(`visibility:${id}`) === "PUBLIC" &&
        item.kind === "IMAGE" &&
        !nullable(values, `altText:${id}`)
      )
        issues[`altText:${id}`] = "Public photographs require an image description.";
    }
    if (!parsed.success || Object.keys(issues).length) {
      reject(form, issues);
      return;
    }
    setErrors({});
    await manager?.update(parsed.data);
  }
  function move(index: number, amount: number) {
    const next = [...order];
    const target = index + amount;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
    setAnnouncement(
      `File moved to position ${target + 1}. Save media choices to apply the order.`,
    );
  }
  function controls(suffix = "", item?: ArtworkMediaResponse["items"][number]) {
    const name = (field: string) => (suffix ? `${field}:${suffix}` : field);
    const input = (
      field: string,
      label: string,
      maximum: number,
      value: string | null = null,
    ) => (
      <div className="admin-field">
        <label htmlFor={`media-${name(field)}`}>{label}</label>
        <textarea
          id={`media-${name(field)}`}
          name={name(field)}
          maxLength={maximum}
          defaultValue={value ?? ""}
          rows={2}
          autoComplete="off"
          aria-invalid={errors[name(field)] ? true : undefined}
          aria-describedby={errors[name(field)] ? `error-${name(field)}` : undefined}
        />
        {errors[name(field)] && (
          <p id={`error-${name(field)}`} className="mt-2 text-sm">
            {errors[name(field)]}
          </p>
        )}
      </div>
    );
    return (
      <>
        <div className="admin-field">
          <label htmlFor={`media-${name("role")}`}>File role</label>
          <select
            id={`media-${name("role")}`}
            name={name("role")}
            defaultValue={item?.role ?? "OTHER"}
            aria-describedby={
              errors[name("role")] ? `error-${name("role")}` : undefined
            }
            aria-invalid={errors[name("role")] ? true : undefined}
          >
            {artworkMediaRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {errors[name("role")] && (
            <p id={`error-${name("role")}`} className="mt-2 text-sm">
              {errors[name("role")]}
            </p>
          )}
        </div>
        <div className="admin-field">
          <label htmlFor={`media-${name("visibility")}`}>Visibility</label>
          <select
            id={`media-${name("visibility")}`}
            name={name("visibility")}
            defaultValue={item?.visibility ?? "PRIVATE"}
          >
            <option value="PRIVATE">Private evidence / unapproved file</option>
            <option value="PUBLIC">Approved public media</option>
          </select>
        </div>
        {input(
          "altText",
          "Image description (required for public photographs)",
          500,
          item?.altText,
        )}
        {input(
          "caption",
          "Caption (optional, approved content only)",
          1000,
          item?.caption,
        )}
        <label className="admin-confirm">
          <input
            type="checkbox"
            name={name("approvedPublic")}
            aria-invalid={errors[name("approvedPublic")] ? true : undefined}
            aria-describedby={
              errors[name("approvedPublic")]
                ? `error-${name("approvedPublic")}`
                : undefined
            }
          />
          I approve these exact bytes and descriptions for public access.
        </label>
        {errors[name("approvedPublic")] && (
          <p id={`error-${name("approvedPublic")}`} className="mt-2 text-sm">
            {errors[name("approvedPublic")]}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <form className="admin-form mt-8" noValidate onSubmit={upload}>
        <h3 className="text-2xl">Upload one artwork file</h3>
        <p className="mt-4 mb-6 text-sm text-muted">
          Up to 20 files. Files stay outside Git. Upload defaults to private; condition
          evidence must remain private. File signatures are checked, without sanitizing
          embedded metadata. Review the original file locally before approving it.
        </p>
        <fieldset disabled={disabled || page.items.length >= 20}>
          <legend className="sr-only">Upload media</legend>
          <div className="admin-field">
            <label htmlFor="media-file">Artwork file (required, up to 8 MiB)</label>
            <input
              id="media-file"
              name="file"
              type="file"
              accept={artworkMediaMimeSchema.options.join(",")}
              aria-invalid={errors.file ? true : undefined}
              aria-describedby={errors.file ? "error-file" : undefined}
            />
            {errors.file && (
              <p id="error-file" className="mt-2 text-sm">
                {errors.file}
              </p>
            )}
          </div>
          {controls()}
          <button className="text-link mt-6" type="submit">
            Upload artwork file
          </button>
        </fieldset>
      </form>
      <form className="admin-form mt-10" noValidate onSubmit={save}>
        <h3 className="text-2xl">Stored artwork files</h3>
        <p className="mt-4 text-sm text-muted">
          Move files with the buttons, adjust roles and visibility, then save. Reconfirm
          approval for every public file. Hero can be assigned to one image. Original
          file bytes and IDs stay unchanged.
        </p>
        {!page.items.length && (
          <p role="status" className="mt-4">
            No artwork files yet. Upload a reviewed file to begin.
          </p>
        )}
        <p role="status" className="mt-4">
          {announcement}
        </p>
        <fieldset disabled={disabled}>
          <legend className="sr-only">Order and visibility</legend>
          {order.map((id, index) => {
            const item = page.items.find((value) => value.id === id)!;
            return (
              <section
                key={id}
                className="border-t border-line mt-8 pt-6"
                aria-labelledby={`file-${id}`}
              >
                <h4 id={`file-${id}`} className="text-xl">
                  File {index + 1} ·{" "}
                  {item.kind === "IMAGE"
                    ? "Photograph"
                    : item.kind === "VIDEO"
                      ? "Video"
                      : "Document"}
                </h4>
                <p className="mt-3 text-sm break-all">
                  {item.id} · {item.mimeType} · {item.byteSize} bytes
                </p>
                <p className="mt-2 text-sm">
                  Stored visibility:{" "}
                  {item.visibility === "PRIVATE" ? "Private" : "Public"}
                </p>
                <div className="flex flex-wrap gap-6 mt-4 mb-6">
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Move file ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move earlier
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Move file ${index + 1} later`}
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move later
                  </button>
                </div>
                {controls(id, item)}
              </section>
            );
          })}
          {page.items.length > 0 && (
            <button className="text-link mt-6" type="submit">
              Save media choices
            </button>
          )}
        </fieldset>
      </form>
    </>
  );
}
