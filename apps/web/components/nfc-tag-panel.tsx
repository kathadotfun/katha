"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWalletSession } from "./wallet-provider";
import { createNfcTags, emptyNfcSnapshot, type NfcTags } from "../lib/nfc-tags";
import { localDateTime } from "../lib/format";
import { Badge, FieldTag, Notice } from "./ui/status";

const noop = () => () => {};

// TODO(nfc): the API has no "tags for this artwork" read, so the module shows the
// tag an operator assigns or looks up in this session rather than listing bindings.
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
  const state = useSyncExternalStore(
    nfc?.subscribe ?? noop,
    nfc?.getSnapshot ?? (() => emptyNfcSnapshot),
    () => emptyNfcSnapshot,
  );
  const [assignValue, setAssignValue] = useState("");
  const [lookupValue, setLookupValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const tag = state.tag;
  const ours = tag?.kathaId === kathaId;
  const active = ours && tag?.state === "ACTIVE";
  const badge = !tag
    ? ["neu", "No tag shown"]
    : !ours
      ? ["warn", "Bound elsewhere"]
      : tag.state === "ACTIVE"
        ? ["ok", "Active"]
        : ["err", "Retired"];
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
              <dd>
                {tag.state === "ACTIVE"
                  ? `Active since ${localDateTime(tag.assignedAt)}`
                  : `Retired ${localDateTime(tag.retiredAt!)}. Scans no longer open a record.`}
                {!ours && (
                  <>
                    {" "}
                    · bound to <span className="id">{tag.kathaId}</span>, not this
                    artwork
                  </>
                )}
              </dd>
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
      {state.error && (
        <p role="alert" className="ferr">
          {state.error}
        </p>
      )}
      {state.result === "assigned" && tag && (
        <Notice tone="ok">
          <p>
            <strong>Tag {tag.tagId} assigned.</strong> Tap it with a phone to check it
            opens this record.
          </p>
        </Notice>
      )}
      {state.result === "lookup" && tag && (
        <Notice tone="info">
          <p>
            <strong>Lookup result:</strong> <span className="id">{tag.tagId}</span> is
            bound to <span className="id">{tag.kathaId}</span>,{" "}
            {tag.state === "ACTIVE"
              ? `active since ${localDateTime(tag.assignedAt)}`
              : `retired ${localDateTime(tag.retiredAt!)}`}
            .
          </p>
        </Notice>
      )}
      {state.result === "retired" && tag && (
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
                void nfc?.retire();
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
              {tag && ours ? "New tag reference" : "Tag reference"}{" "}
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
