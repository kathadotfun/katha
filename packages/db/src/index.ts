export { createDatabase, validateDatabaseUrl, type Database } from "./connection.js";
export {
  artists,
  artistVerificationStatus,
  type ArtistRecord,
  type NewArtistRecord,
} from "./schema/artists.js";
export {
  artworks,
  artworkCategory,
  type ArtworkRecord,
  type NewArtworkRecord,
} from "./schema/artworks.js";
export {
  artworkMedia,
  artworkMediaKind,
  artworkMediaRole,
  mediaVisibility,
  type ArtworkMediaRecord,
  type NewArtworkMediaRecord,
} from "./schema/artwork-media.js";
export {
  artworkMaterials,
  type ArtworkMaterialRecord,
  type NewArtworkMaterialRecord,
} from "./schema/artwork-materials.js";
