import "server-only";
import { createPublicApi } from "./public-api";

// Read only the explicitly public origin; never forward the server environment.
export function serverApi() {
  return createPublicApi(
    process.env.KATHA_PUBLIC_API_ORIGIN ?? "http://localhost:3001",
  );
}
