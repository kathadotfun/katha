"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  fulfillmentCreateRequestSchema,
  type CollectorDeliveryReview,
  type FulfillmentResponse,
} from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  canCancel,
  canReturn,
  createCollectorDelivery,
  emptyDeliverySnapshot,
  type CollectorDelivery,
} from "../lib/collector-delivery";
import { localDateTime, shortAddress } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

const noop = () => () => {};
const custody: Record<
  CollectorDeliveryReview["custodyState"],
  { tone: Tone; text: string }
> = {
  UNKNOWN: { tone: "neu", text: "Not recorded" },
  KATHA_HELD: { tone: "neu", text: "Held by Katha" },
  COLLECTOR_HELD: { tone: "warn", text: "With you" },
  IN_TRANSIT: { tone: "info", text: "In transit" },
};
const flow = ["REQUESTED", "APPROVED", "DISPATCHED", "RECEIVED"] as const;
const flowLabels = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  RECEIVED: "Received",
};
const countries = [
  ["NP", "Nepal"],
  ["IN", "India"],
  ["BT", "Bhutan"],
  ["CN", "China"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
  ["CA", "Canada"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["JP", "Japan"],
] as const;

export function CollectorDeliveryPanel({ kathaId }: { kathaId: string }) {
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
  }, [session, kathaId]);
  useEffect(() => {
    if (auth.status === "signed-in") void controller?.read();
  }, [controller, auth.status, auth.session]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? (() => emptyDeliverySnapshot),
    () => emptyDeliverySnapshot,
  );
  if (!auth.session)
    return (
      <div className="panel cut panel-empty mt-8">
        <p className="empty-title">Sign in to manage delivery</p>
        <p className="p max-w-xl">
          Delivery requests include addresses and contact details, so they&apos;re only
          shown to the signed-in owner.
        </p>
        <Link
          className="btn btn-p cut-s mt-2"
          href={signInHref(`/collection/${kathaId}/delivery`)}
        >
          Sign in
        </Link>
      </div>
    );
  const page = state.page;
  const returnable = page ? canReturn(page) : false;
  const formKind = page?.canRequest
    ? "DELIVERY"
    : returnable
      ? "RETURN_TO_KATHA"
      : null;
  const open = page?.requests.filter((row) => row.status !== "CANCELLED") ?? [];
  const cancelled = page?.requests.filter((row) => row.status === "CANCELLED") ?? [];
  const held = page ? custody[page.custodyState] : null;
  return (
    <div className="mt-8 flex flex-wrap items-start gap-8">
      <div className="flex min-w-0 flex-col gap-6" style={{ flex: "999 1 600px" }}>
        {state.error && (
          <Notice tone="err">
            <p>{state.error}</p>
            <button
              type="button"
              className="btn btn-o btn-sm self-start"
              disabled={state.busy}
              onClick={() => void controller?.read()}
            >
              Refresh saved state
            </button>
          </Notice>
        )}
        {state.busy && !page && (
          <p role="status" className="p">
            Checking private delivery coordination…
          </p>
        )}
        {page && held && (
          <section
            className="panel cut panel-lg"
            aria-labelledby="delivery-custody-title"
            aria-busy={state.busy}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <h2 id="delivery-custody-title" className="h3">
                Where the painting is
              </h2>
              <Badge tone={held.tone}>{held.text}</Badge>
            </div>
            <dl className="mt-4 mb-0">
              <div className="kv">
                <dt>Recorded custody</dt>
                <dd>
                  {page.custodyState === "COLLECTOR_HELD"
                    ? `With the owner, ${shortAddress(page.ownerWallet)}`
                    : page.custodyState === "IN_TRANSIT"
                      ? "In transit"
                      : held.text}
                </dd>
              </div>
              <div className="kv">
                <dt>Custody revision</dt>
                <dd>{page.custodyRevision}</dd>
              </div>
              <div className="kv">
                <dt>Delivery eligibility</dt>
                <dd>
                  {page.canRequest
                    ? "You can request delivery"
                    : returnable
                      ? "You can request a return to Katha"
                      : open.length
                        ? "A request is already open"
                        : page.custodyState === "IN_TRANSIT"
                          ? "Not available while the painting is in transit"
                          : "Not available for the recorded custody"}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {page && formKind && controller && (
          <DeliveryForm
            key={`${state.requestId}:${formKind}`}
            kind={formKind}
            requestId={state.requestId!}
            controller={controller}
            disabled={state.busy || state.reloadRequired}
          />
        )}

        {page && (
          <section
            aria-labelledby="delivery-requests-title"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="delivery-requests-title" className="h3">
                Requests
              </h2>
              <button
                type="button"
                className="lnk"
                disabled={state.busy}
                onClick={() => void controller?.read()}
              >
                Refresh requests
              </button>
            </div>
            {!page.requests.length && (
              <p className="p sm">No delivery or return requests yet.</p>
            )}
            {open.map((row) => (
              <RequestReceipt
                key={`${row.id}:${row.updatedAt}:${row.ownerReportedReceivedAt}`}
                row={row}
                controller={controller!}
                disabled={state.busy || state.reloadRequired}
              />
            ))}
            {cancelled.map((row) => (
              <article
                key={row.id}
                className="panel cut flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-[#F7F0E5]"
              >
                <div>
                  <p className="m-0 font-semibold">
                    {row.kind === "DELIVERY" ? "Delivery to you" : "Return to Katha"}
                  </p>
                  <p className="xs mut m-0">Requested {localDateTime(row.createdAt)}</p>
                </div>
                <Badge tone="err">Cancelled</Badge>
              </article>
            ))}
            {(page.pagination.offset > 0 || page.pagination.hasMore) && (
              <nav className="flex flex-wrap gap-2" aria-label="Delivery request pages">
                <button
                  className="btn btn-o btn-sm"
                  type="button"
                  disabled={state.busy || page.pagination.offset === 0}
                  onClick={() =>
                    void controller?.read(
                      Math.max(0, page.pagination.offset - page.pagination.limit),
                    )
                  }
                >
                  Previous requests
                </button>
                <button
                  className="btn btn-o btn-sm"
                  type="button"
                  disabled={state.busy || !page.pagination.hasMore}
                  onClick={() =>
                    void controller?.read(
                      page.pagination.offset + page.pagination.limit,
                    )
                  }
                >
                  Next requests
                </button>
              </nav>
            )}
          </section>
        )}
      </div>
      <aside className="flex min-w-0 flex-col gap-5 pt-2" style={{ flex: "1 1 300px" }}>
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">Ownership doesn&apos;t move</h2>
          <p className="p sm">
            Delivering the painting changes who holds it, not who owns it. The digital
            asset stays in your wallet throughout.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">How a request moves</h2>
          <p className="p sm">
            Requested, then approved by Katha, dispatched with a courier, and received.
            Katha coordinates each step by hand.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">Two separate confirmations</h2>
          <p className="p sm">
            You report that the painting arrived. Katha then records the custody change
            on the artwork&apos;s record as a separate step.
          </p>
        </div>
      </aside>
    </div>
  );
}

type FieldErrors = Partial<
  Record<"name" | "contact" | "address" | "city" | "country", string>
>;

function DeliveryForm({
  kind,
  requestId,
  controller,
  disabled,
}: {
  kind: "DELIVERY" | "RETURN_TO_KATHA";
  requestId: string;
  controller: CollectorDelivery;
  disabled: boolean;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [country, setCountry] = useState("NP");
  const delivery = kind === "DELIVERY";
  const count = Object.keys(errors).length;
  return (
    <form
      className="panel cut panel-lg flex flex-col gap-6"
      aria-labelledby="delivery-form-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const text = (key: string) => String(values.get(key) ?? "").trim();
        const countryCode = (
          country === "OTHER" ? text("countryOther") : country
        ).toUpperCase();
        const parsed = fulfillmentCreateRequestSchema.safeParse({
          requestId,
          kind,
          recipientName: text("recipientName"),
          contactEmail: text("contactEmail") || null,
          contactPhone: text("contactPhone") || null,
          addressLines: [text("addressLine1"), text("addressLine2")].filter(Boolean),
          city: text("city"),
          region: text("region") || null,
          postalCode: text("postalCode") || null,
          countryCode,
          deliveryInstructions: text("deliveryInstructions") || null,
        });
        if (parsed.success) {
          setErrors({});
          void controller.create(parsed.data);
          return;
        }
        // Field messages; all entered values stay in the form.
        const next: FieldErrors = {};
        if (!text("recipientName")) next.name = "Enter the recipient's full name.";
        const email = text("contactEmail"),
          phone = text("contactPhone");
        const emailValid =
          !email ||
          fulfillmentCreateRequestSchema.shape.contactEmail.safeParse(email).success;
        const phoneValid =
          !phone ||
          fulfillmentCreateRequestSchema.shape.contactPhone.safeParse(phone).success;
        if ((!email && !phone) || !emailValid || !phoneValid)
          next.contact =
            !email && !phone
              ? "Add an email address or a phone number so the courier can reach you."
              : "Check the email address or phone number format.";
        if (!text("addressLine1"))
          next.address = "Enter the first line of the address.";
        if (!text("city")) next.city = "Enter the city.";
        if (!/^[A-Z]{2}$/.test(countryCode))
          next.country = "Use a two-letter country code, like NP.";
        setErrors(
          Object.keys(next).length
            ? next
            : {
                address:
                  "Check the address details; each line can be up to 200 characters.",
              },
        );
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="flex max-w-[34rem] flex-col gap-1">
          <h2 id="delivery-form-title" className="h3">
            {delivery ? "Request delivery" : "Return to Katha"}
          </h2>
          <p className="p sm">
            {delivery
              ? "Ask Katha to ship the painting to you. Katha approves the request, then dispatches it with a courier."
              : "Ask Katha to collect the painting and keep it safe. Katha will contact you to arrange pickup."}
          </p>
        </div>
        <FieldTag kind="priv">Private to you and Katha</FieldTag>
      </div>
      {count > 0 && (
        <Notice tone="err">
          <p>
            <strong>
              {count === 1 ? "One field needs" : `${count} fields need`} attention.
            </strong>{" "}
            Everything else you entered is kept.
          </p>
        </Notice>
      )}
      <fieldset disabled={disabled}>
        <legend className="legend">
          {delivery ? "Recipient" : "Your contact details"}
        </legend>
        <div className="g2" style={{ gap: "18px 24px" }}>
          <div className="fld span-all">
            <label className="lbl" htmlFor="delivery-name">
              Full name <FieldTag kind="req" />
            </label>
            <input
              id="delivery-name"
              className="inp"
              name="recipientName"
              autoComplete="name"
              maxLength={200}
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && <p className="ferr">{errors.name}</p>}
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-email">
              Email <FieldTag kind="opt">Email or phone</FieldTag>
            </label>
            <input
              id="delivery-email"
              className="inp"
              name="contactEmail"
              type="email"
              autoComplete="email"
              maxLength={254}
              aria-invalid={errors.contact ? true : undefined}
              aria-describedby="delivery-contact-help"
            />
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-phone">
              Phone <FieldTag kind="opt">Email or phone</FieldTag>
            </label>
            <input
              id="delivery-phone"
              className="inp"
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              aria-invalid={errors.contact ? true : undefined}
              aria-describedby="delivery-contact-help"
            />
          </div>
        </div>
        {errors.contact && <p className="ferr mt-2">{errors.contact}</p>}
        <p id="delivery-contact-help" className="help mt-2">
          Give at least one. Katha and the courier use it only for this request.
        </p>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend className="legend">
          {delivery ? "Delivery address" : "Pickup address"}
        </legend>
        <div className="g2" style={{ gap: "18px 24px" }}>
          <div className="fld span-all">
            <label className="lbl" htmlFor="delivery-line1">
              Address line 1 <FieldTag kind="req" />
            </label>
            <input
              id="delivery-line1"
              className="inp"
              name="addressLine1"
              autoComplete="address-line1"
              maxLength={200}
              aria-invalid={errors.address ? true : undefined}
            />
            {errors.address && <p className="ferr">{errors.address}</p>}
          </div>
          <div className="fld span-all">
            <label className="lbl" htmlFor="delivery-line2">
              Address line 2 <FieldTag kind="opt" />
            </label>
            <input
              id="delivery-line2"
              className="inp"
              name="addressLine2"
              autoComplete="address-line2"
              maxLength={200}
            />
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-city">
              City <FieldTag kind="req" />
            </label>
            <input
              id="delivery-city"
              className="inp"
              name="city"
              autoComplete="address-level2"
              maxLength={120}
              aria-invalid={errors.city ? true : undefined}
            />
            {errors.city && <p className="ferr">{errors.city}</p>}
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-region">
              Province or region <FieldTag kind="opt" />
            </label>
            <input
              id="delivery-region"
              className="inp"
              name="region"
              autoComplete="address-level1"
              maxLength={120}
            />
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-postal">
              Postal code <FieldTag kind="opt" />
            </label>
            <input
              id="delivery-postal"
              className="inp"
              name="postalCode"
              autoComplete="postal-code"
              maxLength={32}
            />
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="delivery-country">
              Country <FieldTag kind="req" />
            </label>
            <select
              id="delivery-country"
              className="inp"
              autoComplete="country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              aria-invalid={errors.country && country !== "OTHER" ? true : undefined}
            >
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
              <option value="OTHER">Another country</option>
            </select>
            {country === "OTHER" && (
              <>
                <label className="lbl mt-2" htmlFor="delivery-country-other">
                  Two-letter country code <FieldTag kind="req" />
                </label>
                <input
                  id="delivery-country-other"
                  className="inp"
                  name="countryOther"
                  maxLength={2}
                  autoComplete="country"
                  aria-invalid={errors.country ? true : undefined}
                />
              </>
            )}
            {errors.country && <p className="ferr">{errors.country}</p>}
          </div>
          <div className="fld span-all">
            <label className="lbl" htmlFor="delivery-instructions">
              Instructions <FieldTag kind="opt" />
            </label>
            <textarea
              id="delivery-instructions"
              className="inp"
              name="deliveryInstructions"
              maxLength={2000}
              aria-describedby="delivery-instructions-help"
            />
            <p id="delivery-instructions-help" className="help">
              Access details, best times to reach you, or anything the courier should
              know.
            </p>
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button className="btn btn-p cut-s" type="submit" disabled={disabled}>
          {delivery ? "Request delivery" : "Request return"}
        </button>
        <p className="xs mut m-0 max-w-[30rem]">
          Katha reviews each request and arranges the courier by hand. Dates and
          insurance aren&apos;t guaranteed. Retrying sends the same request reference,
          so a duplicate isn&apos;t created.
        </p>
      </div>
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
  const [cancelling, setCancelling] = useState(false);
  const position = flow.indexOf(row.status as (typeof flow)[number]);
  const note =
    row.status === "REQUESTED"
      ? "Katha is reviewing your request. You'll see courier and tracking details here once it's dispatched."
      : row.status === "APPROVED"
        ? "Approved. Katha is arranging the courier."
        : row.status === "DISPATCHED"
          ? row.ownerReportedReceivedAt
            ? "Delivered, according to you. Katha is confirming before recording custody."
            : "Dispatched. Let Katha know when the painting arrives."
          : "Katha marked this request received. Check the artwork record for the separate custody change.";
  return (
    <article
      className="panel cut flex flex-col gap-3.5"
      aria-labelledby={`request-${row.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <h3 id={`request-${row.id}`} className="serif m-0 text-xl font-semibold">
          {row.kind === "DELIVERY" ? "Delivery to you" : "Return to Katha"}
        </h3>
        <p className="xs mut m-0">Requested {localDateTime(row.createdAt)}</p>
      </div>
      <ol className="flow" aria-label="Request status">
        {flow.map((status, index) => (
          <li
            key={status}
            className={`cut-s${index < position ? " done" : index === position ? " now" : ""}`}
          >
            {flowLabels[status]}
            <span className="sr-only">
              {index < position ? ", done" : index === position ? ", current" : ""}
            </span>
          </li>
        ))}
      </ol>
      <dl className="m-0">
        <div className="kv">
          <dt>Recipient</dt>
          <dd>{row.recipientName}</dd>
        </div>
        <div className="kv">
          <dt>Address</dt>
          <dd>
            {[
              ...row.addressLines,
              row.city,
              row.region,
              row.postalCode,
              row.countryCode,
            ]
              .filter(Boolean)
              .join(", ")}
          </dd>
        </div>
        <div className="kv">
          <dt>Contact</dt>
          <dd>{[row.contactEmail, row.contactPhone].filter(Boolean).join(", ")}</dd>
        </div>
        {row.deliveryInstructions && (
          <div className="kv">
            <dt>Instructions</dt>
            <dd>{row.deliveryInstructions}</dd>
          </div>
        )}
        {row.courier && (
          <div className="kv">
            <dt>Courier</dt>
            <dd>{row.courier}</dd>
          </div>
        )}
        {row.trackingReference && (
          <div className="kv">
            <dt>Tracking</dt>
            <dd className="id">{row.trackingReference}</dd>
          </div>
        )}
        <div className="kv">
          <dt>Request reference</dt>
          <dd className="id">{row.id}</dd>
        </div>
      </dl>
      <p className="p sm">{note}</p>
      {row.ownerReportedReceivedAt && (
        <Notice tone="info">
          <p>
            <strong>
              Receipt reported {localDateTime(row.ownerReportedReceivedAt)}.
            </strong>{" "}
            Katha will record the custody change separately once it&apos;s confirmed.
            Until then, the record may still show the painting in transit.
          </p>
        </Notice>
      )}
      {row.kind === "DELIVERY" &&
        row.status === "DISPATCHED" &&
        !row.ownerReportedReceivedAt && (
          <div className="flex flex-col gap-3">
            <label className="chk chk-box">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={disabled}
              />
              <span>I physically received this artwork.</span>
            </label>
            <button
              className="btn btn-p cut-s self-start"
              type="button"
              disabled={disabled || !confirmed}
              onClick={() => void controller.report(row.id, confirmed)}
            >
              I&apos;ve received the painting
            </button>
          </div>
        )}
      {canCancel(row.status) &&
        (cancelling ? (
          <div
            className="confirm"
            role="alertdialog"
            aria-labelledby={`cancel-${row.id}-title`}
            aria-describedby={`cancel-${row.id}-body`}
          >
            <p id={`cancel-${row.id}-title`} className="confirm-title">
              Cancel this request?
            </p>
            <p id={`cancel-${row.id}-body`} className="p sm">
              Katha stops arranging this{" "}
              {row.kind === "DELIVERY" ? "delivery" : "return"}. Nothing changes on the
              artwork&apos;s record, and you can make a new request afterwards.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <button
                type="button"
                className="btn btn-d cut-s"
                disabled={disabled}
                onClick={() => {
                  setCancelling(false);
                  void controller.cancel(row.id, true);
                }}
              >
                Cancel request
              </button>
              <button
                type="button"
                className="lnk"
                onClick={() => setCancelling(false)}
              >
                Keep request
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="lnk lnk-err self-start"
            disabled={disabled}
            onClick={() => setCancelling(true)}
          >
            Cancel request
          </button>
        ))}
    </article>
  );
}
