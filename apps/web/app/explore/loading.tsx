export default function LoadingArtworks() {
  return (
    <div className="app-main">
      <div className="wrap">
        <div className="flex flex-col gap-3.5">
          <h1 className="h1">Artworks</h1>
          <p className="lead">
            Every work published on Katha, each with a permanent ID and a public record.
          </p>
        </div>
        <div aria-busy="true" className="grid-cards mt-10">
          <p role="status" className="sr-only">
            Loading artworks
          </p>
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <div key={key} aria-hidden="true" className="flex flex-col gap-3.5">
              <div className="skel cut ratio-art" />
              <div className="skel h-6 w-[30%]" />
              <div className="skel h-7 w-[80%]" />
              <div className="skel h-[18px] w-[55%]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
