import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-container site-header-inner">
        <Link href="/" aria-label="Katha home" className="site-brand">
          <Image src="/brand/katha-profile.svg" alt="" width={40} height={40} />
          <span className="flex flex-col">
            <span className="font-serif text-2xl leading-none">Katha</span>
            <span aria-hidden="true" className="mt-1 text-caption text-muted">
              Real World Assets
            </span>
          </span>
        </Link>
        <nav aria-label="Primary">
          <ul className="site-nav">
            <li>
              <Link href="/" className="site-nav-link">
                Home
              </Link>
            </li>
            <li>
              <Link href="/explore" className="site-nav-link">
                Explore
              </Link>
            </li>
            <li>
              <Link href="/#purpose" className="site-nav-link">
                Our purpose
              </Link>
            </li>
            <li>
              <Link href="/#traditions" className="site-nav-link">
                Traditions
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
