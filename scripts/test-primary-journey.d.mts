export type CollectorJourneyStage =
  | "IN_TRANSIT_A"
  | "RECEIPT_A"
  | "HELD_A"
  | "POST_DELIVERY_A"
  | "APPROVED_A"
  | "SOLD_HELD_A"
  | "IN_TRANSIT_B"
  | "HELD_B"
  | "POST_DELIVERY_B";
export type SyntheticActor = {
  address: string;
  publicKey: number[];
  sign: (message: Uint8Array) => Uint8Array;
};
export function runPrimaryJourney(context: {
  origin: string;
  apiOrigin: string;
  actors: SyntheticActor[];
  index: () => Promise<void>;
  initializeSaleTerms: (kathaId: string) => Promise<void>;
  assertPurchase: (kathaId: string, artistId: string) => Promise<void>;
  trust?: {
    assertRejected: (kathaId: string) => Promise<void>;
    verify: (kathaId: string, adminToken: string, ownerToken: string) => Promise<void>;
    verifyExpiredPurchase: (kathaId: string, buyerToken: string) => Promise<void>;
  };
  collectorDelivery?: {
    waitForClock: () => Promise<void>;
    assertState: (kathaId: string, stage: CollectorJourneyStage) => Promise<void>;
  };
  custodyResale?: {
    assertListed: (kathaId: string) => Promise<void>;
    assertResale: (kathaId: string) => Promise<void>;
  };
  signTransaction: (actor: number, bytes: number[]) => number[];
}): Promise<void>;
