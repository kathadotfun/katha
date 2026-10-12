"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWalletSession } from "./wallet-provider";
import { createNfcTags, emptyNfcSnapshot, type NfcTags } from "../lib/nfc-tags";
import { localDateTime } from "../lib/format";
import { Badge, FieldTag, Notice } from "./ui/status";

const noop = () => () => {};

// Lists every tag bound to this artwork. A tag points to the record; it never
// proves authenticity, ownership or custody.
export function NfcTagPanel({
  kathaId,
  title,
  apiOrigin,
}: {
  kathaId: string;
  title: string;
  apiOrigin: string;
}) {
  const session = useWalletSession();
  const [nfc, setNfc] = useState<NfcTags | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createNfcTags(session, kathaId);
    setNfc(current);
    return () => current.dispose();
  }, [session, kathaId]);
  useEffect(() => {
    void nfc?.load();
  }, [nfc]);
  const state = useSyncExternalStore(
    nfc?.subscribe ?? noop,
    nfc?.getSnapshot ?? (() => emptyNfcSnapshot),
    () => emptyNfcSnapshot,
  );
  const [assignValue, setAssignValue] = useState("");
  const [lookupValue, setLookupValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const result = state.tag;
  // The current binding comes from the artwork's list, never from a lookup of
  // a tag that belongs to another work.
  const tag = state.tags?.find((item) => item.state === "ACTIVE") ?? null;
  const active = tag !== null;
  const retired = state.tags?.filter((item) => item.state === "RETIRED") ?? [];
  const badge =
    state.tags === null
      ? ["neu", state.busy === "load" ? "Checking" : "Not loaded"]
      : tag
        ? ["ok", "Active"]
        : retired.length
          ? ["warn", "No active tag"]
          : ["neu", "No tag yet"];
  return (
    <section
      className="panel cut flex flex-col gap-4"
      aria-labelledby="nfc-title"
      aria-busy={state.busy !== null}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="nfc-title" className="h2 h2-ops">
          NFC tag
        </h2>
        <Badge tone={badge[0] as "ok" | "warn" | "err" | "neu"}>{badge[1]}</Badge>
      </div>
      <p className="p sm">
        A tag on the painting opens this artwork&apos;s public record when tapped. It
        points to the record; it doesn&apos;t prove the painting is authentic.
      </p>
      <dl className="m-0">
        <div className="kv kv-ops">
          <dt>Bound to</dt>
          <dd>
            <span className="id">{kathaId}</span>, {title}
          </dd>
        </div>
        {tag && (
          <>
            <div className="kv kv-ops">
              <dt>Tag reference</dt>
              <dd className="id">{tag.tagId}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>State</dt>
              <dd>Active since {localDateTime(tag.assignedAt)}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Tag link</dt>
              <dd className="id">
                {apiOrigin}/nfc/{tag.tagId}
              </dd>
            </div>
          </>
        )}
      </dl>
      {retired.length > 0 && (
        <details className="more">
          <summary>Retired tags ({retired.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {retired.map((item) => (
              <li key={item.tagId} className="sm">
                <span className="id">{item.tagId}</span>, retired{" "}
                {localDateTime(item.retiredAt!)}. Scans say the tag is retired.
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.tags === null && !state.busy && (
        <button
          type="button"
          className="lnk self-start"
          onClick={() => void nfc?.load()}
        >
          Load tags
        </button>
      )}
      {state.error && (
        <p role="alert" className="ferr">
          {state.error}
        </p>
      )}
      {state.result === "assigned" && result && (
        <Notice tone="ok">
          <p>
            <strong>Tag {result.tagId} assigned.</strong> Tap it with a phone to check
            it opens this record.
          </p>
        </Notice>
      )}
      {state.result === "lookup" && result && (
        <Notice tone="info">
          <p>
            <strong>Lookup result:</strong> <span className="id">{result.tagId}</span>{" "}
            is bound to <span className="id">{result.kathaId}</span>
            {result.kathaId === kathaId
              ? " (this artwork)"
              : ", not this artwork"},{" "}
            {result.state === "ACTIVE"
              ? `active since ${localDateTime(result.assignedAt)}`
              : `retired ${localDateTime(result.retiredAt!)}`}
            .
          </p>
        </Notice>
      )}
      {state.result === "retired" && result && (
        <Notice tone="neu" icon="info">
          <p>
            <strong>Tag retired.</strong> Scans now report that the tag has been
            retired. A retired tag can&apos;t be reactivated; assign a new one if
            needed.
          </p>
        </Notice>
      )}

      {confirming && active ? (
        <div
          className="confirm"
          role="alertdialog"
          aria-labelledby="retire-title"
          aria-describedby="retire-body"
        >
          <p id="retire-title" className="confirm-title">
            Retire tag {tag!.tagId}?
          </p>
          <p id="retire-body" className="p sm">
            Scans will no longer open this record. A retired tag can&apos;t be
            reactivated; you can assign a new one afterwards.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              type="button"
              className="btn btn-d cut-s"
              disabled={state.busy !== null}
              onClick={() => {
                setConfirming(false);
                void nfc?.retire(tag!.tagId);
              }}
            >
              Retire tag
            </button>
            <button type="button" className="lnk" onClick={() => setConfirming(false)}>
              Keep tag
            </button>
          </div>
        </div>
      ) : (
        active && (
          <button
            type="button"
            className="btn btn-od btn-sm self-start"
            disabled={state.busy !== null}
            onClick={() => setConfirming(true)}
          >
            Retire tag
          </button>
        )
      )}

      {!active && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void nfc?.assign(assignValue);
          }}
        >
          <div className="fld" style={{ flex: "1 1 260px" }}>
            <label className="lbl" htmlFor="nfc-assign">
              {retired.length ? "New tag reference" : "Tag reference"}{" "}
              <FieldTag kind="req" />
            </label>
            <input
              id="nfc-assign"
              className="inp id font-medium"
              value={assignValue}
              onChange={(event) => setAssignValue(event.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
              autoComplete="off"
              spellCheck={false}
              maxLength={36}
              aria-describedby="nfc-assign-help"
            />
            <p id="nfc-assign-help" className="help">
              The reference encoded in the tag&apos;s link. It&apos;s not a hardware ID.
            </p>
          </div>
          <button
            className="btn btn-p cut-s mb-[26px]"
            type="submit"
            disabled={state.busy !== null}
          >
            {state.busy === "assign" ? "Assigning…" : "Assign tag"}
          </button>
        </form>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void nfc?.lookup(lookupValue);
        }}
      >
        <div className="fld" style={{ flex: "1 1 260px" }}>
          <label className="lbl" htmlFor="nfc-lookup">
            Look up a tag
          </label>
          <input
            id="nfc-lookup"
            className="inp id font-medium"
            value={lookupValue}
            onChange={(event) => setLookupValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={36}
          />
        </div>
        <button
          className="btn btn-o btn-sm mb-0.5"
          type="submit"
          disabled={state.busy !== null}
        >
          {state.busy === "lookup" ? "Looking up…" : "Look up binding"}
        </button>
      </form>
    </section>
  );
}
