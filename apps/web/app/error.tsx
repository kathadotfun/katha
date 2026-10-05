"use client";

import Link from "next/link";
import { PageState } from "../components/page-state";

export default function ErrorPage() {
  return (
    <PageState title="We couldn’t load this page">
      <p role="alert">
        Artwork information is unavailable right now. Please try again.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-6">
        <button
          type="button"
          className="button-primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
        <Link className="text-link inline-flex min-h-11 items-center" href="/">
          Return home
        </Link>
      </div>
    </PageState>
  );
}
