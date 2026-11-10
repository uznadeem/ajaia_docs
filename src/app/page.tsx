import { DocumentIcon } from "@/components/ui/document-icon";

export default function WorkspacePage() {
  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <p className="eyebrow">Your workspace</p>
        <h1>Documents</h1>
        <p>A little space for your next big idea.</p>
      </div>
      <section className="document-panel" aria-labelledby="documents-heading">
        <div className="panel-heading">
          <h2 id="documents-heading">All documents</h2>
          <span className="document-count">0 documents</span>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon"><DocumentIcon /></div>
          <h3>A fresh page awaits</h3>
          <p>Your documents will have a home here.</p>
          <p className="availability-note">Document creation and editing are coming soon.</p>
        </div>
      </section>
      <p className="workspace-note">Room to think. Space to write.</p>
    </main>
  );
}
