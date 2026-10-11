import Link from "next/link";
import { kathaMarkPoints } from "./ui/katha-mark";

// Full-bleed red page for not-found, outage and loading states.
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
  const { outer, inner, gem } = kathaMarkPoints;
  return (
    <section className="nf dk" aria-labelledby="status-title">
      <div className="wrap relative z-[1] flex flex-1 flex-col justify-center pt-12 pb-24">
        <div className="flex max-w-[600px] flex-col gap-[22px]">
          <p className="sm m-0 text-on-red-muted">{code}</p>
          <h1
            id="status-title"
            className="serif m-0 font-semibold"
            style={{
              fontSize: "clamp(44px, 6vw, 84px)",
              lineHeight: 1,
              letterSpacing: "-0.015em",
            }}
          >
            {title}
          </h1>
          <div className="max-w-[32rem] text-[19px] leading-[1.6] text-on-red">
            {children}
          </div>
          {action !== null && (
            <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-3.5">
              {action}
              <Link className="lnk-d py-2.5" href="/">
                Go to the home page
              </Link>
            </div>
          )}
        </div>
      </div>
      <div className="nf-art" aria-hidden="true">
        <svg
          viewBox="-760 -760 1520 1520"
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          <polygon className="nf-r" transform="scale(2.2)" points={outer} />
          <g transform="scale(1.5)">
            <polygon points={outer} fill="#652D28" />
            <polygon points={inner} fill="#5E2A25" />
            <polygon className="nf-r" points={gem} />
          </g>
        </svg>
      </div>
    </section>
  );
}
