"use client";
import Link from "next/link";
import { useState } from "react";
import { artworkDraftParamsSchema } from "@katha/shared";
export function ArtworkVerificationLookup() {
  const [id, setId] = useState("");
  const parsed = artworkDraftParamsSchema.safeParse({ kathaId: id });
  return (
    <section className="admin-workspace mt-8" aria-labelledby="authenticity-lookup">
      <h2 id="authenticity-lookup" className="text-2xl">
        Authenticate a registered artwork
      </h2>
      <p className="mt-3 text-sm">
        Verifiers can open the protected review using the permanent Katha ID supplied
        during onboarding.
      </p>
      <label className="mt-4 block">
        Permanent Katha ID
        <input
          className="mt-2 block w-full min-w-0 min-h-12 border border-muted bg-surface px-3 py-2"
          value={id}
          onChange={(e) => setId(e.target.value)}
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {parsed.success ? (
        <Link
          className="text-link mt-4 inline-block"
          href={`/admin/artworks/${parsed.data.kathaId}/verification`}
        >
          Open authenticity review
        </Link>
      ) : (
        <p className="mt-3 text-sm">Use a full ID such as KATHA-PAUBHA-000001.</p>
      )}
    </section>
  );
}
