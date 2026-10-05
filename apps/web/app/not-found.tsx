import Link from "next/link";
import { PageState } from "../components/page-state";

export default function NotFound() {
  return (
    <PageState title="Page not found">
      <p>This address doesn’t resolve to a Katha page.</p>
      <Link className="text-link mt-6 inline-flex min-h-11 items-center" href="/">
        Return home
      </Link>
    </PageState>
  );
}
