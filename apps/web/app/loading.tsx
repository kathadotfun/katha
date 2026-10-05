import { PageState } from "../components/page-state";

export default function Loading() {
  return (
    <PageState title="Loading Katha">
      <p role="status">Loading artwork information. Please wait.</p>
    </PageState>
  );
}
