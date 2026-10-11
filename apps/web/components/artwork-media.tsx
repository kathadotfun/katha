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
import { artworkPhotoUrl } from "../lib/artwork-page";
import { localTime } from "../lib/format";
import { OpsSignedOut } from "./ops-ui";
import { Badge, FieldTag, Icon, Notice, type Tone } from "./ui/status";

const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverState = () => lockedMediaSnapshot;
const roleLabels: Record<string, string> = {
  HERO: "Hero",
  FRONT: "Front",
  BACK: "Reverse",
  DETAIL: "Detail",
  ARTIST: "Artist with work",
  PROCESS: "Process",
  CERTIFICATE: "Certificate",
  CONDITION: "Condition evidence",
  DOCUMENTARY: "Documentary",
  OTHER: "Other",
};
const kindLabels = { IMAGE: "Image", VIDEO: "Video", DOCUMENT: "PDF" };
type Item = ArtworkMediaResponse["items"][number];

function mib(bytes: string) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MiB`;
}

export function ArtworkMediaPanel({
  kathaId,
  apiOrigin,
}: {
  kathaId: string;
  apiOrigin: string;
}) {
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
      <OpsSignedOut path={`/admin/artworks/${kathaId}/media`} role="administrator" />
    );
  return (
    <MediaWorkspace
      key={`${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.expiresAt}:${kathaId}`}
      manager={manager}
      apiOrigin={apiOrigin}
    />
  );
}

function MediaWorkspace({
  manager,
  apiOrigin,
}: {
  manager: ArtworkMediaManager | null;
  apiOrigin: string;
}) {
  const state = useSyncExternalStore(
    manager?.subscribe ?? emptySubscribe,
    manager?.getSnapshot ?? serverState,
    serverState,
  );
  const page = state.page;
  // Reloading discards unsaved order and visibility edits, even if nothing changed.
  const [reloads, setReloads] = useState(0);
  const [tone, status]: [Tone, string] = !page
    ? ["neu", state.busy ? "Checking" : "Not loaded"]
    : !page.editable
      ? ["neu", "Locked"]
      : page.items.some((item) => item.role === "HERO" && item.visibility === "PUBLIC")
        ? ["ok", "Public hero approved"]
        : ["warn", "No approved public hero"];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="p max-w-[46rem]">
          Upload, order and approve artwork media. Public approval makes the exact bytes
          available to anyone with their link, even before the artwork is published.
          Hiding a file later can&apos;t recall copies already downloaded.
        </p>
        <Badge tone={tone} role="status">
          {status}
        </Badge>
      </div>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking access and loading media…
        </p>
      )}
      {state.error && (
        <Notice tone="err">
          <p>{state.error}</p>
        </Notice>
      )}
      {state.saved && (
        <Notice tone="ok">
          <p>
            <strong>Media saved.</strong> Review the order and visibility below.
          </p>
        </Notice>
      )}
      {!page && !state.busy && (
        <div className="panel cut panel-empty">
          <p className="empty-title">
            {state.status === "denied"
              ? "Media needs an administrator role"
              : "Media couldn't load"}
          </p>
          <button
            type="button"
            className="btn btn-p cut-s mt-2"
            onClick={() => void manager?.read()}
          >
            Try again
          </button>
        </div>
      )}
      {page && !page.editable && (
        <Notice tone="neu" icon="lock">
          <p>
            <strong>Media is locked.</strong> Publication or lifecycle records exist, so
            committed files are preserved. Later public changes go through metadata
            revisions.
          </p>
        </Notice>
      )}
      {page && state.reloadRequired && (
        <Notice tone="warn" icon="warning">
          <p>
            <strong>Further changes are paused.</strong> An upload or save couldn&apos;t
            be confirmed and may already exist. Reload and review the current media
            before retrying.
          </p>
          <button
            type="button"
            className="btn btn-o btn-sm self-start"
            onClick={() => {
              setReloads(reloads + 1);
              void manager?.read();
            }}
          >
            Reload media
          </button>
        </Notice>
      )}
      {page && (
        <MediaForms
          key={`${page.updatedAt}:${reloads}`}
          manager={manager}
          page={page}
          apiOrigin={apiOrigin}
          disabled={state.busy || state.reloadRequired || !page.editable}
        />
      )}
    </div>
  );
}

function MediaForms({
  manager,
  page,
  apiOrigin,
  disabled,
}: {
  manager: ArtworkMediaManager | null;
  page: ArtworkMediaResponse;
  apiOrigin: string;
  disabled: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [order, setOrder] = useState(() => page.items.map((item) => item.id));
  const [dirty, setDirty] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [visibility, setVisibility] = useState<Record<string, string>>(() =>
    Object.fromEntries(page.items.map((item) => [item.id, item.visibility])),
  );
  const [uploadVisibility, setUploadVisibility] = useState("PRIVATE");
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
        file:
          file instanceof File && file.size > ARTWORK_MEDIA_MAX_BYTES
            ? "This file is over the 8 MiB limit. Trim or compress it and try again."
            : "Choose one JPEG, PNG, WebP or AVIF image, MP4 or WebM video, or PDF, up to 8 MiB.",
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
    const issues: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        issues[String(issue.path[0] ?? "approvedPublic")] ??= issue.message;
    if (
      values.get("visibility") === "PUBLIC" &&
      file.type.startsWith("image/") &&
      !nullable(values, "altText")
    )
      issues.altText = "Describe what the image shows before it can be public.";
    if (values.get("visibility") === "PUBLIC" && values.get("approvedPublic") !== "on")
      issues.approvedPublic = "Approve the file for public view, or keep it private.";
    if (!parsed.success || Object.keys(issues).length) {
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
        issues[`${String(issue.path[2] ?? "approvedPublic")}:${id ?? order[0]}`] ??=
          issue.message;
      }
    for (const id of order) {
      const item = page.items.find((value) => value.id === id)!;
      if (values.get(`role:${id}`) === "HERO" && item.kind !== "IMAGE")
        issues[`role:${id}`] = "The hero must be an image.";
      if (
        values.get(`visibility:${id}`) === "PUBLIC" &&
        item.kind === "IMAGE" &&
        !nullable(values, `altText:${id}`)
      )
        issues[`altText:${id}`] =
          "Describe what the image shows before it can be public.";
      if (
        values.get(`visibility:${id}`) === "PUBLIC" &&
        values.get(`approvedPublic:${id}`) !== "on"
      )
        issues[`approvedPublic:${id}`] =
          "Approve this file for public view, or set it to private.";
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
    setDirty(true);
    setAnnouncement(
      `Moved to position ${target + 1}. Save changes to apply the order.`,
    );
  }
  const error = (name: string) =>
    errors[name] ? (
      <p id={`error-${name}`} className="ferr">
        {errors[name]}
      </p>
    ) : null;
  const described = (name: string) => (errors[name] ? `error-${name}` : undefined);
  return (
    <>
      <div className="flex flex-wrap items-stretch gap-5">
        <form
          className="drop cut flex min-w-0 flex-col items-stretch text-left"
          style={{ flex: "2 1 420px", alignItems: "stretch" }}
          noValidate
          onSubmit={(event) => void upload(event)}
          aria-labelledby="media-upload-title"
        >
          <fieldset
            className="flex flex-col gap-4"
            disabled={disabled || page.items.length >= 20}
          >
            <legend className="sr-only">Upload media</legend>
            <div className="flex flex-col items-center gap-2 text-center">
              <Icon name="upload" size={36} className="text-madder" />
              <p id="media-upload-title" className="m-0 font-semibold">
                Upload a file
              </p>
              <p className="help">
                JPEG, PNG, WebP or AVIF images, MP4 or WebM video, or PDF documents. Up
                to 8 MiB per file, 20 files per artwork.
              </p>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="media-file">
                File <FieldTag kind="req" />
              </label>
              <input
                id="media-file"
                className="inp"
                name="file"
                type="file"
                accept={artworkMediaMimeSchema.options.join(",")}
                aria-invalid={errors.file ? true : undefined}
                aria-describedby={described("file")}
              />
              {error("file")}
            </div>
            <div className="g2">
              <div className="fld">
                <label className="lbl" htmlFor="media-role">
                  Role
                </label>
                <select
                  id="media-role"
                  className="inp"
                  name="role"
                  defaultValue="OTHER"
                  aria-describedby={described("role")}
                >
                  {artworkMediaRoleSchema.options.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
                {error("role")}
              </div>
              <fieldset className="fld">
                <legend className="lbl mb-1.5">Visibility</legend>
                <div className="seg2 flex">
                  {["PRIVATE", "PUBLIC"].map((value) => (
                    <label
                      key={value}
                      className="chk cut-s min-h-11 items-center bg-paper-2 px-3.5"
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={value}
                        checked={uploadVisibility === value}
                        onChange={() => setUploadVisibility(value)}
                      />
                      {value === "PUBLIC" ? "Public" : "Private"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="fld span-all">
                <label className="lbl" htmlFor="media-altText">
                  Alt text{" "}
                  {uploadVisibility === "PUBLIC" && (
                    <FieldTag kind="req">Required for public images</FieldTag>
                  )}
                </label>
                <input
                  id="media-altText"
                  className="inp"
                  name="altText"
                  maxLength={500}
                  aria-invalid={errors.altText ? true : undefined}
                  aria-describedby={described("altText")}
                />
                {error("altText")}
              </div>
              <div className="fld span-all">
                <label className="lbl" htmlFor="media-caption">
                  Caption <FieldTag kind="opt" />
                </label>
                <input
                  id="media-caption"
                  className="inp"
                  name="caption"
                  maxLength={1000}
                />
              </div>
            </div>
            {uploadVisibility === "PUBLIC" && (
              <label className="chk">
                <input
                  type="checkbox"
                  name="approvedPublic"
                  aria-invalid={errors.approvedPublic ? true : undefined}
                  aria-describedby={described("approvedPublic")}
                />
                I approve these exact bytes and descriptions for public view.
              </label>
            )}
            {error("approvedPublic")}
            <button className="btn btn-p btn-sm cut-s self-start" type="submit">
              Upload file
            </button>
          </fieldset>
        </form>
        <div
          className="panel cut flex min-w-0 flex-col gap-2.5"
          style={{ flex: "1 1 280px" }}
        >
          <p className="serif m-0 text-[19px] font-semibold">Rules</p>
          <ul className="p sm m-0 flex flex-col gap-1.5 pl-5">
            <li>Uploads start private.</li>
            <li>Public images need alt text and your explicit approval.</li>
            <li>One hero image per artwork.</li>
            <li>Condition evidence and authorship evidence always stay private.</li>
            <li>
              File signatures are checked, but embedded metadata isn&apos;t removed.
              Review originals before approving.
            </li>
          </ul>
        </div>
      </div>

      <form
        noValidate
        onSubmit={(event) => void save(event)}
        onInput={() => setDirty(true)}
        aria-labelledby="media-list-title"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 id="media-list-title" className="h2 h2-ops">
            Media, in display order
          </h2>
          {dirty && !disabled ? (
            <button className="btn btn-p btn-sm cut-s" type="submit">
              Save changes
            </button>
          ) : (
            <span className="sm mut">Saved {localTime(page.updatedAt)}</span>
          )}
        </div>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {!page.items.length && (
          <p className="p">No files yet. Upload a reviewed file to begin.</p>
        )}
        <fieldset disabled={disabled}>
          <legend className="sr-only">Order and visibility</legend>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {order.map((id, index) => {
              const item = page.items.find((value) => value.id === id)!;
              return (
                <MediaRow
                  key={id}
                  item={item}
                  index={index}
                  count={order.length}
                  apiOrigin={apiOrigin}
                  move={move}
                  visibility={visibility[id] ?? item.visibility}
                  setVisibility={(value) =>
                    setVisibility({ ...visibility, [id]: value })
                  }
                  error={error}
                  described={described}
                  errors={errors}
                />
              );
            })}
          </ol>
          {page.items.length > 0 && (
            <button className="btn btn-p cut-s mt-4" type="submit">
              Save changes
            </button>
          )}
        </fieldset>
      </form>
    </>
  );
}

function MediaRow({
  item,
  index,
  count,
  apiOrigin,
  move,
  visibility,
  setVisibility,
  error,
  described,
  errors,
}: {
  item: Item;
  index: number;
  count: number;
  apiOrigin: string;
  move: (index: number, amount: number) => void;
  visibility: string;
  setVisibility: (value: string) => void;
  error: (name: string) => React.ReactNode;
  described: (name: string) => string | undefined;
  errors: Record<string, string>;
}) {
  const id = item.id;
  const forced = item.role === "CONDITION";
  const label = `${kindLabels[item.kind]} ${index + 1}`;
  let preview: string | null = null;
  if (item.kind === "IMAGE" && item.visibility === "PUBLIC")
    try {
      preview = artworkPhotoUrl(apiOrigin, item);
    } catch {
      preview = null;
    }
  const [tone, status]: [Tone, string] =
    item.visibility === "PUBLIC" ? ["ok", "Public, approved"] : ["neu", "Private"];
  return (
    <li
      className="panel cut flex flex-wrap items-start gap-x-5 gap-y-4"
      style={{ padding: 18 }}
      aria-labelledby={`file-${id}`}
    >
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          className="mv cut-s"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => move(index, -1)}
        >
          <Icon name="up" />
        </button>
        <span className="sm font-bold">{index + 1}</span>
        <button
          type="button"
          className="mv cut-s"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => move(index, 1)}
        >
          <Icon name="down" />
        </button>
      </div>
      <div
        className="ph ph-sm cut-s ratio-art w-24 flex-none"
        role="img"
        aria-label={`${label} preview${preview ? "" : " unavailable (private file)"}`}
      >
        {preview ? <img src={preview} alt="" /> : <span>{kindLabels[item.kind]}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-3" style={{ flex: "1 1 520px" }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 id={`file-${id}`} className="m-0 text-base font-semibold">
            {label}
          </h3>
          <span className="xs mut">
            {item.mimeType}, {mib(item.byteSize)}
          </span>
          <Badge tone={tone}>{status}</Badge>
          {forced && <FieldTag kind="lock">Always private</FieldTag>}
        </div>
        <p className="xs id mut m-0 font-medium">sha256 {item.contentHash}</p>
        <div
          className="grid gap-x-4 gap-y-3"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
          }}
        >
          <div className="fld">
            <label className="lbl" htmlFor={`media-role:${id}`}>
              Role
            </label>
            <select
              id={`media-role:${id}`}
              className="inp"
              name={`role:${id}`}
              defaultValue={item.role}
              aria-invalid={errors[`role:${id}`] ? true : undefined}
              aria-describedby={described(`role:${id}`)}
            >
              {artworkMediaRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
            {error(`role:${id}`)}
          </div>
          <div className="fld">
            <label className="lbl" htmlFor={`media-caption:${id}`}>
              Caption
            </label>
            <input
              id={`media-caption:${id}`}
              className="inp"
              name={`caption:${id}`}
              defaultValue={item.caption ?? ""}
              maxLength={1000}
            />
          </div>
          <div className="fld span-all">
            <label className="lbl" htmlFor={`media-altText:${id}`}>
              Alt text{" "}
              {visibility === "PUBLIC" && item.kind === "IMAGE" && (
                <FieldTag kind="req">Required for public</FieldTag>
              )}
            </label>
            <input
              id={`media-altText:${id}`}
              className="inp"
              name={`altText:${id}`}
              defaultValue={item.altText ?? ""}
              maxLength={500}
              aria-invalid={errors[`altText:${id}`] ? true : undefined}
              aria-describedby={described(`altText:${id}`)}
            />
            {error(`altText:${id}`)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <fieldset className="flex" aria-label={`Visibility of ${label}`}>
            {["PUBLIC", "PRIVATE"].map((value) => (
              <label
                key={value}
                className="chk cut-s min-h-11 items-center bg-paper-2 px-3.5"
              >
                <input
                  type="radio"
                  name={`visibility:${id}`}
                  value={value}
                  checked={visibility === value}
                  disabled={forced && value === "PUBLIC"}
                  onChange={() => setVisibility(value)}
                />
                {value === "PUBLIC" ? "Public" : "Private"}
              </label>
            ))}
          </fieldset>
          {visibility === "PUBLIC" && (
            <label className="chk items-center">
              <input
                type="checkbox"
                name={`approvedPublic:${id}`}
                aria-invalid={errors[`approvedPublic:${id}`] ? true : undefined}
                aria-describedby={described(`approvedPublic:${id}`)}
              />
              Approved for public view
            </label>
          )}
        </div>
        {error(`approvedPublic:${id}`)}
      </div>
    </li>
  );
}
