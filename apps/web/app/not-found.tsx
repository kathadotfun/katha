import Link from "next/link";
import { StatusPage } from "../components/status-page";

export default function NotFound() {
  return (
    <StatusPage
      code="Error 404"
      title="Nothing is recorded here"
      action={
        <Link className="btn btn-lg btn-l cut-s" href="/explore">
          Explore artworks
        </Link>
      }
    >
      <p className="m-0">
        This address doesn&apos;t match any page or artwork. If you followed a link to a
        work, it may not be published yet.
      </p>
      <p className="sr-only">Page not found.</p>
    </StatusPage>
  );
}
