import Link from "next/link";
import { signInHref } from "../lib/return-path";
import { Badge, Icon, type Tone } from "./ui/status";

export function OpsSignedOut({ path, role }: { path: string; role: string }) {
  return (
    <div className="panel cut panel-empty">
      <Badge tone="neu" icon="lock">
        Signed out
      </Badge>
      <p className="empty-title">Sign in to continue</p>
      <p className="p max-w-[38rem]">
        This workflow needs a signed-in {role} wallet. Actions here are recorded with
        your wallet address.
      </p>
      <Link className="btn btn-p cut-s mt-2" href={signInHref(path)}>
        Sign in
      </Link>
    </div>
  );
}

// The page's own status, stated from its own API response.
export function WorkflowIntro({
  tone,
  status,
  children,
}: {
  tone: Tone;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="p max-w-[46rem]">{children}</div>
      <Badge tone={tone} role="status">
        {status}
      </Badge>
    </div>
  );
}

export function Check({
  ok,
  pending = false,
  title,
  detail,
  fix,
}: {
  ok: boolean;
  pending?: boolean;
  title: string;
  detail: React.ReactNode;
  fix?: { href: string; label?: string } | null;
}) {
  return (
    <li>
      <span
        className={`mk cut-s ${ok ? "mk-ok" : pending ? "mk-wait" : "mk-no"}`}
        aria-hidden="true"
      >
        {ok ? (
          <Icon name="check" size={14} />
        ) : pending ? (
          "…"
        ) : (
          <Icon name="close" size={14} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold">
          {title}
          <span className="sr-only">
            {ok ? ", done" : pending ? ", pending" : ", missing"}
          </span>
        </p>
        <p className="xs mut m-0">{detail}</p>
      </div>
      {!ok && fix && (
        <Link className="lnk sm" href={fix.href}>
          {fix.label ?? "Fix"}
        </Link>
      )}
    </li>
  );
}

export type Receipt = Readonly<{
  status: "UNKNOWN" | "FAILED" | "FINALIZED";
  signature: string;
  slot: string | null;
  indexed: boolean;
}>;

// A saved signature alone never establishes success; its status is stated plainly.
export function ReceiptLine({
  receipt,
  cluster,
  label = "Saved transaction",
}: {
  receipt: Receipt;
  cluster: "localnet" | "devnet";
  label?: string;
}) {
  const [tone, text] =
    receipt.status === "FINALIZED"
      ? receipt.indexed
        ? (["ok", "Finalized and indexed"] as const)
        : (["warn", "Finalized, indexing pending"] as const)
      : receipt.status === "FAILED"
        ? (["err", "Failed on Solana"] as const)
        : (["warn", "Outcome unknown"] as const);
  return (
    <div className="inset flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 font-semibold">{label}</p>
        <Badge tone={tone}>{text}</Badge>
      </div>
      <p className="sm m-0">
        Reference <span className="id">{receipt.signature}</span>
        {receipt.slot ? ` · slot ${receipt.slot}` : ""}
        {cluster === "devnet" && (
          <>
            {" "}
            <a
              className="lnk"
              href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on a Solana explorer
              <span className="sr-only">, opens in a new tab</span>
            </a>
          </>
        )}
      </p>
      {receipt.status !== "FINALIZED" && (
        <p className="xs mut m-0">
          A saved signature alone doesn&apos;t establish success. Check its status
          before preparing a replacement, so nothing is recorded twice.
        </p>
      )}
    </div>
  );
}
