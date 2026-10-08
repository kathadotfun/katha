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
  custodyResale?: {
    assertListed: (kathaId: string) => Promise<void>;
    assertResale: (kathaId: string) => Promise<void>;
  };
  signTransaction: (actor: number, bytes: number[]) => number[];
}): Promise<void>;
