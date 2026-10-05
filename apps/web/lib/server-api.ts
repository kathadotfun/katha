import "server-only";
import { createPublicApi, publicApiOrigin } from "./public-api";

// Read only the explicitly public origin; never forward the server environment.
export function serverApiOrigin() {
  return publicApiOrigin(
    process.env.KATHA_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
  );
}

export function serverApi() {
  return createPublicApi(serverApiOrigin());
}
