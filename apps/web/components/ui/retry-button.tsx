"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Re-runs the server render in place; client state such as the wallet session survives.
export function RetryButton({
  className = "btn btn-p cut-s",
  children = "Try again",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "Trying again…" : children}
    </button>
  );
}
