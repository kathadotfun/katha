"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  fulfillmentCreateRequestSchema,
  type FulfillmentResponse,
} from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createCollectorDelivery,
  emptyDeliverySnapshot,
  type CollectorDelivery,
} from "../lib/collector-delivery";
const noop = () => () => {};
const custodyLabels = {
  UNKNOWN: "Unconfirmed",
  KATHA_HELD: "In Katha custody",
  COLLECTOR_HELD: "Collector-held",
  IN_TRANSIT: "In transit",
};
export function CollectorDeliveryPanel({
  kathaId,
  apiOrigin,
}: {
  kathaId: string;
  apiOrigin: string;
}) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? (() => signedOutSnapshot),
    () => signedOutSnapshot,
  );
  const [controller, setController] = useState<CollectorDelivery | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createCollectorDelivery(session, kathaId);
    setController(current);
    return () => current.dispose();
  }, [session, kathaId, apiOrigin]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? (() => emptyDeliverySnapshot),
    () => emptyDeliverySnapshot,
  );
  if (!auth.session)
    return (
      <p className="mt-8" role="status">
        Connect and{" "}
        <Link href="/account" className="text-link">
          sign in with the current owner wallet
        </Link>{" "}
        to coordinate delivery.
      </p>
    );
  const page = state.page;
  return (
    <section
      className="mt-10 max-w-reading"
      aria-labelledby="delivery-title"
      aria-busy={state.busy}
    >
      <h2 id="delivery-title" className="text-2xl">
        Delivery and receipt
      </h2>
      <p className="mt-3 text-sm text-muted">
        Private coordination ·{" "}
        {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"} test environment
      </p>
      <button
        type="button"
        className="button-primary mt-5"
        disabled={!controller || state.busy}
        onClick={() => void controller?.read()}
      >
        Refresh delivery requests
      </button>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking private delivery coordination…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      {!page && !state.busy && !state.error && (
        <p className="mt-4">
          Load current custody and your private requests before continuing.
        </p>
      )}
      {page && controller && (
        <>
          <p className="mt-6 text-lead">{page.title}</p>
          <p className="mt-3">
            Finalized custody: {custodyLabels[page.custodyState]} · Revision{" "}
            {page.custodyRevision}
          </p>
          <p className="mt-3 text-sm text-muted">
            Shipping details are shared privately with Katha operators. A delivery
            request or receipt report does not change ownership, verify physical custody
            or record a condition inspection. Transport and any charges are arranged
            manually.
          </p>
          {page.canRequest ? (
            <DeliveryForm
              key={state.requestId}
              requestId={state.requestId!}
              controller={controller}
              disabled={state.busy || state.reloadRequired}
            />
          ) : (
            <p className="mt-5" role="status">
              A new delivery request requires Katha-held custody and no active delivery
              request for this owner. Review existing requests below.
            </p>
          )}
          <h3 className="mt-10 text-xl">Your private requests</h3>
          {!page.requests.length && (
            <p className="mt-4">No delivery requests on this page.</p>
          )}
          <ul className="mt-5 space-y-6">
            {page.requests.map((row) => (
              <li
                key={`${row.id}:${row.updatedAt}:${row.ownerReportedReceivedAt}`}
                className="border-t border-line pt-5"
              >
                <RequestReceipt
                  row={row}
                  controller={controller}
                  disabled={state.busy || state.reloadRequired}
                />
              </li>
            ))}
          </ul>
          <nav className="mt-6 flex gap-6" aria-label="Delivery request pages">
            <button
              className="text-link"
              type="button"
              disabled={state.busy || page.pagination.offset === 0}
              onClick={() =>
                void controller.read(
                  Math.max(0, page.pagination.offset - page.pagination.limit),
                )
              }
            >
              Previous requests
            </button>
            <button
              className="text-link"
              type="button"
              disabled={state.busy || !page.pagination.hasMore}
              onClick={() =>
                void controller.read(page.pagination.offset + page.pagination.limit)
              }
            >
              Next requests
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
function DeliveryForm({
  requestId,
  controller,
  disabled,
}: {
  requestId: string;
  controller: CollectorDelivery;
  disabled: boolean;
}) {
  const [error, setError] = useState(false);
  const field = "mt-2 block min-h-11 w-full border border-line bg-surface px-3 py-2";
  return (
    <form
      className="mt-8 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(false);
        const values = new FormData(event.currentTarget);
        const text = (key: string) => String(values.get(key) ?? "").trim();
        const parsed = fulfillmentCreateRequestSchema.safeParse({
          requestId,
          kind: "DELIVERY",
          recipientName: text("recipientName"),
          contactEmail: text("contactEmail") || null,
          contactPhone: text("contactPhone") || null,
          addressLines: text("addressLines").split(/\r?\n/),
          city: text("city"),
          region: text("region") || null,
          postalCode: text("postalCode") || null,
          countryCode: text("countryCode"),
          deliveryInstructions: text("deliveryInstructions") || null,
        });
        if (!parsed.success) {
          setError(true);
          return;
        }
        void controller.create(parsed.data);
      }}
    >
      <h3 className="text-xl">Request physical delivery</h3>
      <p className="text-sm text-muted break-all">
        Request ID: {requestId}. Identical retries use this ID; refresh saved state
        after an uncertain response.
      </p>
      <label className="block">
        Recipient name
        <input
          className={field}
          name="recipientName"
          autoComplete="name"
          maxLength={200}
          required
          disabled={disabled}
        />
      </label>
      <label className="block">
        Contact email
        <input
          className={field}
          name="contactEmail"
          type="email"
          autoComplete="email"
          maxLength={254}
          disabled={disabled}
        />
      </label>
      <label className="block">
        Contact phone
        <input
          className={field}
          name="contactPhone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          disabled={disabled}
        />
      </label>
      <p className="text-sm text-muted">Provide at least one contact method.</p>
      <label className="block">
        Address lines
        <textarea
          className={field}
          name="addressLines"
          autoComplete="street-address"
          rows={3}
          maxLength={1004}
          required
          disabled={disabled}
        />
      </label>
      <p className="text-sm text-muted">
        One line per entry, up to five lines of 200 characters.
      </p>
      <label className="block">
        City
        <input
          className={field}
          name="city"
          autoComplete="address-level2"
          maxLength={120}
          required
          disabled={disabled}
        />
      </label>
      <label className="block">
        Region (optional)
        <input
          className={field}
          name="region"
          autoComplete="address-level1"
          maxLength={120}
          disabled={disabled}
        />
      </label>
      <label className="block">
        Postal code (optional)
        <input
          className={field}
          name="postalCode"
          autoComplete="postal-code"
          maxLength={32}
          disabled={disabled}
        />
      </label>
      <label className="block">
        Country code
        <input
          className={field}
          name="countryCode"
          autoComplete="country"
          defaultValue="NP"
          pattern="[A-Z]{2}"
          maxLength={2}
          required
          disabled={disabled}
        />
      </label>
      <p className="text-sm text-muted">Use two uppercase letters, for example NP.</p>
      <label className="block">
        Delivery instructions (optional)
        <textarea
          className={field}
          name="deliveryInstructions"
          rows={3}
          maxLength={2000}
          disabled={disabled}
        />
      </label>
      {error && (
        <p role="alert">
          Check the delivery details and provide an email or phone number.
        </p>
      )}
      <button className="button-primary" type="submit" disabled={disabled}>
        Send private delivery request
      </button>
    </form>
  );
}
function RequestReceipt({
  row,
  controller,
  disabled,
}: {
  row: FulfillmentResponse;
  controller: CollectorDelivery;
  disabled: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <article aria-labelledby={`request-${row.id}`}>
      <h4 id={`request-${row.id}`} className="text-lg">
        {row.kind === "DELIVERY" ? "Delivery" : "Return to Katha"} ·{" "}
        {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
      </h4>
      <p className="mt-2 break-all text-sm">Request: {row.id}</p>
      <p className="mt-2">Recipient: {row.recipientName}</p>
      <p className="mt-2 break-words">
        {[...row.addressLines, row.city, row.region, row.postalCode, row.countryCode]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-2 break-words">
        Contact: {[row.contactEmail, row.contactPhone].filter(Boolean).join(" · ")}
      </p>
      {row.deliveryInstructions && (
        <p className="mt-2 break-words">Instructions: {row.deliveryInstructions}</p>
      )}
      {row.courier && <p className="mt-2">Courier: {row.courier}</p>}
      {row.trackingReference && (
        <p className="mt-2 break-all">Tracking reference: {row.trackingReference}</p>
      )}
      {row.ownerReportedReceivedAt && (
        <p className="mt-3" role="status">
          You reported receipt at {row.ownerReportedReceivedAt}. Katha must confirm
          receipt manually; verified custody and a post-delivery condition inspection
          are separate records.
        </p>
      )}
      {row.status === "RECEIVED" && (
        <p className="mt-3">
          The operator marked this request received. Check the separate artwork custody
          and condition records.
        </p>
      )}
      {row.kind === "DELIVERY" &&
        row.status === "DISPATCHED" &&
        !row.ownerReportedReceivedAt && (
          <div className="mt-4">
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={disabled}
              />
              I physically received this artwork.
            </label>
            <button
              className="button-primary mt-4"
              type="button"
              disabled={disabled || !confirmed}
              onClick={() => void controller.report(row.id, confirmed)}
            >
              Report physical receipt
            </button>
          </div>
        )}
    </article>
  );
}
