import "server-only";
import type { PublicArtworkDetail } from "@katha/shared";
import { loadPublicArtwork } from "./artwork-page";
import { serverApi } from "./server-api";

// Header context only. A missing or unpublished record leaves the private panel to
// report access; failures never block the owner's page.
export async function collectorArtwork(
  kathaId: string,
): Promise<PublicArtworkDetail | null> {
  return loadPublicArtwork(kathaId, (id) => serverApi().artwork(id)).catch(() => null);
}
