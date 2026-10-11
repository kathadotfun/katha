"use client";

import { useEffect, useRef, useState } from "react";
import { KathaMark } from "./ui/katha-mark";

// Placeholders stand in for missing approved media; they never imply a real photo.
export function PhotoPlaceholder({
  label,
  size = 56,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <>
      <KathaMark size={size} variant="outline" />
      {label && <span>{label}</span>}
    </>
  );
}

// Renders inside a `.ph` frame. The full work stays uncropped (object-fit: contain).
export function ArtworkPhoto({
  src,
  alt,
  primary = false,
  fallbackSize = 56,
}: {
  src: string;
  alt: string;
  primary?: boolean;
  fallbackSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Image errors can precede hydration, before React attaches onError.
    if (imageRef.current?.complete && imageRef.current.naturalWidth === 0)
      setFailed(true);
  }, [src]);
  return failed ? (
    <PhotoPlaceholder label="This photograph is unavailable." size={fallbackSize} />
  ) : (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      loading={primary ? "eager" : "lazy"}
      fetchPriority={primary ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
