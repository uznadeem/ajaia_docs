import { Suspense } from "react";
import { DocumentEditor } from "@/components/editor/document-editor";

export const metadata = { title: "Document" };

async function DocumentRoute({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params;
  return <DocumentEditor key={id} id={id} />;
}

export default function DocumentPage(props: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<main id="main-content" className="workspace" tabIndex={-1}><p role="status">Loading document…</p></main>}>
      <DocumentRoute {...props} />
    </Suspense>
  );
}
