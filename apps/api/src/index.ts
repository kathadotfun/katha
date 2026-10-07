import { createMetadataAdministration } from "./metadata-administration.js";
import {
  createMetadataAdministrationStore,
  createMetadataRevisionStatusStore,
} from "@katha/db";
import {
  createArtworkRegistrationStatusStore,
  createArtworkVerificationStatusStore,
  createConditionAttestationStatusStore,
  createCustodyOperationStatusStore,
} from "@katha/db";
import { createArtworkMediaStore } from "@katha/db";
import { createArtworkMedia } from "./artwork-media.js";
import { createNfcResolution } from "./nfc-resolution.js";
import { createNfcResolutionStore } from "@katha/db";
import { createNfcTags } from "./nfc-tags.js";
import { createNfcTagStore } from "@katha/db";
import { createArtworkProvenance } from "./artwork-provenance.js";
import { createPublicProvenanceStore } from "@katha/db";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { createOperationReceipts } from "./operation-receipts.js";
import { createOperationReceiptStore } from "@katha/db";
import { createOperationReceiptReader } from "@katha/solana";
import { createMetadataRevisions } from "./metadata-revisions.js";
import { createMetadataRevisionStore } from "@katha/db";
import { createMetadataRevisionReader } from "@katha/solana";
import { createArtworkMinting } from "./artwork-minting.js";
import {
  createArtworkPublicationStore,
  createArtworkMintStatusStore,
  createArtworkMintStore,
} from "@katha/db";
import { createArtworkMintReader } from "@katha/solana";
import { createCustodyOperations } from "./custody-operations.js";
import { createCustodyOperationStore } from "@katha/db";
import { createCustodyReader } from "@katha/solana";
import { createConditionAttestation } from "./condition-attestation.js";
import { createConditionAttestationStore } from "@katha/db";
import { createConditionAttestationReader } from "@katha/solana";
import { createArtworkVerification } from "./artwork-verification.js";
import { createArtworkVerificationStore } from "@katha/db";
import { createArtworkVerificationReader } from "@katha/solana";
import { createArtworkRegistration } from "./artwork-registration.js";
import { createArtworkRegistrationStore } from "@katha/db";
import { createOperationChain, createArtworkRegistrationReader } from "@katha/solana";
import { createPublicDocuments } from "./public-documents.js";
import { createPublicDocumentStore } from "@katha/db";
import { createDocumentPreparation } from "./document-preparation.js";
import { createDocumentPreparationStore } from "@katha/db";
import { createLocalStorageProvider } from "./local-storage.js";
import { createArtworkDetails } from "./artwork-details.js";
import { createPublicArtworkDetailStore } from "@katha/db";
import { createArtworkDiscovery } from "./artwork-discovery.js";
import { createPublicArtworkStore } from "@katha/db";
import { createArtworkDrafts } from "./artwork-drafts.js";
import { createArtworkDraftStore } from "@katha/db";
import { createWalletSessions } from "./wallet-session.js";
import { createPublicArtists } from "./public-artists.js";
import { createPublicArtistStore } from "@katha/db";
import { createArtists } from "./artists.js";
import { createAuthorization } from "./authorization.js";
import { createRegistryAuthorityReader } from "@katha/solana";
import { createDatabase, createWalletSessionStore, createArtistStore } from "@katha/db";
import { createReadiness } from "./readiness.js";
import { createShutdown } from "./shutdown.js";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApi } from "./app.js";
import { createLogger } from "./logger.js";
import { ConfigurationError, readServerConfiguration } from "./config.js";

function startApi() {
  const logger = createLogger();
  let config;
  try {
    config = readServerConfiguration(process.env);
  } catch (error) {
    logger.configurationInvalid(
      error instanceof ConfigurationError ? error.fields : [],
    );
    process.exitCode = 1;
    return;
  }
  const database = createDatabase(config.DATABASE_URL);
  const readiness = createReadiness(database.check);
  const sessions = createWalletSessions(createWalletSessionStore(database.db), {
    origin: config.KATHA_PUBLIC_APP_ORIGIN,
    cluster: config.KATHA_CLUSTER,
  });
  const storage = createLocalStorageProvider({
    root: config.KATHA_STORAGE_ROOT,
    maxBytes: config.KATHA_STORAGE_MAX_BYTES,
  });
  const rpcConfig = {
    cluster: config.KATHA_CLUSTER,
    ...(config.KATHA_RPC_URL === undefined ? {} : { rpcUrl: config.KATHA_RPC_URL }),
    ...(config.KATHA_RPC_SUBSCRIPTIONS_URL === undefined
      ? {}
      : { rpcSubscriptionsUrl: config.KATHA_RPC_SUBSCRIPTIONS_URL }),
  };
  const authorization = createAuthorization(
    sessions,
    {
      cluster: config.KATHA_CLUSTER,
      adminWallets: config.KATHA_ADMIN_WALLETS,
      verifierWallets: config.KATHA_VERIFIER_WALLETS,
    },
    createRegistryAuthorityReader(rpcConfig),
  );
  const documents = createDocumentPreparation(
    createDocumentPreparationStore(
      database.db,
      config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
    ),
    storage,
    config.KATHA_PUBLIC_API_ORIGIN,
  );
  const app = createApi(
    logger,
    readiness,
    [config.KATHA_PUBLIC_APP_ORIGIN, config.KATHA_PUBLIC_API_ORIGIN],
    sessions,
    authorization,
    createArtists(createArtistStore(database.db)),
    createPublicArtists(createPublicArtistStore(database.db)),
    createArtworkDrafts(
      createArtworkDraftStore(database.db),
      createArtworkMedia(createArtworkMediaStore(database.db), storage),
    ),
    createArtworkDiscovery(
      createPublicArtworkStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
    ),
    createArtworkDetails(
      createPublicArtworkDetailStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
    ),
    documents,
    createPublicDocuments(createPublicDocumentStore(database.db), storage),
    createArtworkRegistration(
      createArtworkRegistrationStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
      authorization,
      createArtworkRegistrationReader(rpcConfig),
      createOperationChain(rpcConfig),
      storage,
      config.KATHA_CLUSTER,
      createArtworkRegistrationStatusStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
    ),
    createArtworkVerification(
      createArtworkVerificationStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
      authorization,
      createArtworkVerificationReader(rpcConfig),
      createOperationChain(rpcConfig),
      storage,
      config.KATHA_CLUSTER,
      createArtworkRegistrationStatusStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
      createArtworkVerificationStatusStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
    ),
    createConditionAttestation(
      createConditionAttestationStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
      authorization,
      createConditionAttestationReader(rpcConfig),
      createOperationChain(rpcConfig),
      storage,
      config.KATHA_CLUSTER,
      {
        readStatus: createConditionAttestationStatusStore(
          database.db,
          config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
        ),
        documents,
        evidence: createArtworkMedia(
          createArtworkMediaStore(
            database.db,
            true,
            config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
          ),
          storage,
        ),
      },
    ),
    createCustodyOperations(
      createCustodyOperationStore(
        database.db,
        config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
      ),
      authorization,
      sessions,
      createCustodyReader(rpcConfig),
      createOperationChain(rpcConfig),
      config.KATHA_CLUSTER,
      createCustodyOperationStatusStore(
        database.db,
        config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
      ),
    ),
    createArtworkMinting(
      createArtworkMintStore(
        database.db,
        config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
      ),
      authorization,
      createArtworkMintReader(rpcConfig),
      createOperationChain(rpcConfig),
      storage,
      config.KATHA_CLUSTER,
      {
        store: createArtworkPublicationStore(
          database.db,
          config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
        ),
        readStatus: createArtworkMintStatusStore(
          database.db,
          config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
        ),
      },
    ),
    createMetadataRevisions(
      createMetadataRevisionStore(
        database.db,
        config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
      ),
      authorization,
      createMetadataRevisionReader(rpcConfig),
      createOperationChain(rpcConfig),
      storage,
      config.KATHA_CLUSTER,
      createMetadataAdministration(
        createMetadataRevisionStore(
          database.db,
          config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
        ),
        createMetadataAdministrationStore(
          database.db,
          config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
        ),
        authorization,
        createMetadataRevisionReader(rpcConfig),
        storage,
        config.KATHA_CLUSTER,
        config.KATHA_PUBLIC_API_ORIGIN,
        createMetadataRevisionStatusStore(
          database.db,
          config.KATHA_CLUSTER === "localnet" ? "LOCALNET" : "DEVNET",
        ),
      ),
    ),
    createOperationReceipts(
      createOperationReceiptStore(database.db),
      sessions,
      createOperationReceiptReader(rpcConfig),
      config.KATHA_CLUSTER,
    ),
    createArtworkProvenance(
      createPublicProvenanceStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
        { registry: KATHA_REGISTRY_PROGRAM_ADDRESS, core: CORE_PROGRAM_ADDRESS },
      ),
    ),
    createNfcTags(createNfcTagStore(database.db)),
    createNfcResolution(
      createNfcResolutionStore(
        database.db,
        config.KATHA_CLUSTER === "devnet" ? "DEVNET" : "LOCALNET",
      ),
      config.KATHA_PUBLIC_APP_ORIGIN,
    ),
  );
  const port = config.API_PORT;

  const server = createServer(
    getRequestListener(app.fetch, {
      errorHandler: () => {
        logger.serverFailed();
        return new Response("An unexpected error occurred.", { status: 500 });
      },
    }),
  );
  const close = createShutdown(server, readiness, database.close);
  let isShuttingDown = false;
  function shutdown(signal?: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (signal) logger.serverStopping(signal);
    void close()
      .then((clean) => {
        if (!clean) {
          logger.serverFailed();
          // Release lingering sockets after bounded drain/close failure.
          process.exit(1);
        }
      })
      .catch(() => {
        logger.serverFailed();
        process.exit(1);
      });
  }
  server.on("error", () => {
    logger.serverFailed();
    process.exitCode = 1;
    shutdown();
  });
  server.listen(port, config.API_HOST, () => logger.serverStarted(port));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
startApi();
