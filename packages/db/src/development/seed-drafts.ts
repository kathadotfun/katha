import { createDatabase } from "../connection.js";
import { seedDraftFixtures, validateFixtureDatabaseUrl } from "./draft-fixtures.js";

async function main() {
  const connection = createDatabase(
    validateFixtureDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    const result = await seedDraftFixtures(connection.db);
    console.log(
      `Synthetic drafts: ${result.createdArtists} artist and ${result.createdArtworks} artworks created.`,
    );
    for (const draft of result.drafts) console.log(draft.kathaId);
  } finally {
    await connection.close();
  }
}
main().catch(() => {
  // Driver errors may embed connection credentials or private existing row contents.
  console.error(
    "Draft seed failed. Check the local database target, migrations and reserved fixture identities; existing data was not overwritten.",
  );
  process.exitCode = 1;
});
