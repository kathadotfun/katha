"use client";

import { useState } from "react";

export function ArtworkPhoto({
  src,
  alt,
  caption,
  primary = false,
}: {
  src: string;
  alt: string;
  caption: string;
  primary?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="min-w-0">
      <div
        className={primary ? "artwork-photo artwork-photo-primary" : "artwork-photo"}
      >
        {failed ? (
          <p role="status" className="p-6 text-center text-muted">
            This photograph is unavailable.
          </p>
        ) : (
          <img
            src={src}
            alt={alt}
            loading={primary ? "eager" : "lazy"}
            fetchPriority={primary ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className="mt-3 text-sm text-muted">{caption}</figcaption>
    </figure>
  );
}
