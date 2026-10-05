import { PageState } from "../../../components/page-state";
export default function LoadingArtist() {
  return (
    <PageState title="Loading the artist">
      <p role="status">Loading the public artist profile. Please wait.</p>
    </PageState>
  );
}
