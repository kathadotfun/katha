export default function LoadingArtist() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading the artist
      </p>
      <div
        className="weave bg-madder-deep"
        style={{ padding: "clamp(40px, 6vw, 88px) 0" }}
      >
        <div className="wrap flex flex-wrap items-end gap-8" aria-hidden="true">
          <div
            className="cut bg-madder-dark"
            style={{ width: 300, maxWidth: "100%", aspectRatio: "4 / 5" }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="h-5 w-24 bg-madder" />
            <div className="h-16 w-3/4 bg-madder" />
          </div>
        </div>
      </div>
    </div>
  );
}
