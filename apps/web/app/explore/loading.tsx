import { PageState } from "../../components/page-state";
export default function LoadingArtworks() {
  return (
    <PageState title="Loading the artworks">
      <p role="status">Loading the public catalogue. Please wait.</p>
    </PageState>
  );
}
