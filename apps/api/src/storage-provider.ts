import type { ServerConfiguration } from "./config.js";
import { createCloudinaryStorageProvider } from "./cloudinary-storage.js";
import { createLocalStorageProvider } from "./local-storage.js";
import type { StorageProvider } from "./storage.js";

export function createStorageProvider(config: ServerConfiguration): StorageProvider {
  if (config.KATHA_STORAGE_PROVIDER === "cloudinary") {
    return createCloudinaryStorageProvider({
      cloudName: config.CLOUDINARY_CLOUD_NAME ?? "",
      apiKey: config.CLOUDINARY_API_KEY ?? "",
      apiSecret: config.CLOUDINARY_API_SECRET ?? "",
      maxBytes: config.KATHA_STORAGE_MAX_BYTES,
    });
  }
  return createLocalStorageProvider({
    root: config.KATHA_STORAGE_ROOT,
    maxBytes: config.KATHA_STORAGE_MAX_BYTES,
  });
}
