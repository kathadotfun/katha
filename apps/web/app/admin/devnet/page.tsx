import type { Metadata } from "next";
import { DevnetBootstrapControls } from "../../../components/devnet-bootstrap";
import { publicTransactionRpcUrl } from "../../../lib/transaction-rpc";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Devnet operator setup | Katha",
  robots: { index: false, follow: false },
};
export default function DevnetOperatorPage() {
  const enabled = process.env.KATHA_CLUSTER === "devnet";
  return (
    <div>
      <p className="sm mut m-0">Operator utility, Devnet test environment</p>
      <h1 className="h1 h1-ops mt-2">Initialize the demonstration network</h1>
      <p className="p mt-4 max-w-reading">
        Upload program binaries with the CLI, then use this tool to approve an existing
        program upgrade or initialize the collection, Registry, Marketplace and artwork
        payouts. Each action is simulated and reviewed before wallet approval.
        Multisig-owned actions require Squads execution.
      </p>
      {enabled ? (
        <DevnetBootstrapControls
          rpcUrl={publicTransactionRpcUrl(
            "devnet",
            process.env.KATHA_PUBLIC_SOLANA_RPC_URL,
          )}
        />
      ) : (
        <p className="p mt-8" role="status">
          Operator controls are disabled. Start the web process with
          KATHA_CLUSTER=devnet and matching public origins to use this utility.
        </p>
      )}
    </div>
  );
}
