"use client";

import { useState } from "react";
import { ArtworkPhoto, PhotoPlaceholder } from "./artwork-photo";

export type GalleryPhoto = Readonly<{
  key: string;
  src: string;
  alt: string;
  label: string;
}>;

// Approved photographs only. Each thumbnail switches the full, uncropped view.
export function ArtworkGallery({
  photos,
  title,
}: {
  photos: GalleryPhoto[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const current = photos[index];
  if (!current)
    return (
      <div className="flex flex-col gap-3">
        <div className="ph cut ratio-art">
          <PhotoPlaceholder
            label="Artwork photography is not available yet."
            size={72}
          />
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <figure className="m-0 flex flex-col gap-3">
        <div className="ph cut ratio-art max-h-[80svh]">
          <ArtworkPhoto
            key={current.key}
            src={current.src}
            alt={current.alt}
            primary={index === 0}
            fallbackSize={72}
          />
        </div>
        <figcaption className="xs mut">
          {current.label}
          {photos.length > 1 ? `, photo ${index + 1} of ${photos.length}` : ""}. Photos
          approved by Katha.
        </figcaption>
      </figure>
      {photos.length > 1 && (
        <div
          role="group"
          aria-label={`Choose a photo of ${title}`}
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
        >
          {photos.map((photo, position) => (
            <button
              key={photo.key}
              type="button"
              className="thumb cut-s"
              aria-pressed={position === index}
              aria-label={`Show photo ${position + 1}: ${photo.label}`}
              onClick={() => setIndex(position)}
            >
              <img src={photo.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
