export default function Loading() {
  return (
    <div className="app-main" aria-busy="true">
      <div className="wrap flex flex-col gap-4">
        <p role="status" className="sr-only">
          Loading Katha
        </p>
        <div aria-hidden="true" className="skel h-14 w-2/3 max-w-xl" />
        <div aria-hidden="true" className="skel h-6 w-full max-w-2xl" />
        <div aria-hidden="true" className="skel cut mt-6 h-80 w-full" />
      </div>
    </div>
  );
}
