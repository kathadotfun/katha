import Link from "next/link";

export function StatusPage({
  code,
  title,
  children,
  action,
}: {
  code: string;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="app-main relative overflow-clip" aria-labelledby="status-title">
      <div className="haze" aria-hidden="true" />
      <div className="wrap py-6">
        <div className="card warm pad-l ctr mx-auto max-w-[560px] py-14">
          <p className="big text-madder" aria-hidden="true">
            {code}
          </p>
          <h1 id="status-title" className="h1 mt-[22px] text-[clamp(26px,2.6vw,34px)]">
            {title}
          </h1>
          <div className="p mt-3 max-w-[32rem]">{children}</div>
          {action !== null && (
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {action}
              <Link className="btn btn-g" href="/">
                Go to the home page
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
