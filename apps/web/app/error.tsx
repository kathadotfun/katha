"use client";

import { StatusPage } from "../components/status-page";

export default function ErrorPage() {
  return (
    <StatusPage
      code="Service unavailable"
      title="Katha is temporarily unavailable"
      action={
        <button
          type="button"
          className="btn btn-lg btn-l cut-s"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      }
    >
      <p role="alert" className="m-0">
        Our servers aren&apos;t responding. Artwork records on Solana are unaffected.
        Try again in a few minutes.
      </p>
    </StatusPage>
  );
}
