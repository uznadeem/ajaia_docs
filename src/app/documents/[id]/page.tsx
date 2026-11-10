import { Suspense } from "react";
import { DocumentPlaceholder } from "@/components/dashboard/document-placeholder";

export const metadata = { title: "Document" };

async function DocumentRoute({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params;
  return <DocumentPlaceholder key={id} id={id} />;
}

export default function DocumentPage(props: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<main id="main-content" className="workspace" tabIndex={-1}><p role="status">Loading document…</p></main>}>
      <DocumentRoute {...props} />
    </Suspense>
  );
}
