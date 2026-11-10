import Link from "next/link";
import type { DocumentSummary } from "@/lib/api/contracts";
import { DocumentIcon } from "@/components/ui/document-icon";
import type { DocumentAction } from "./use-workspace";

const permissionLabels = { OWNER: "Owner", EDITOR: "Can edit", VIEWER: "View only" } as const;
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type Props = {
  heading: string;
  id: string;
  documents: DocumentSummary[];
  disabled: boolean;
  onAction: (action: DocumentAction) => void;
  shared?: boolean;
};

export function DocumentList({ heading, id, documents, disabled, onAction, shared = false }: Props) {
  return (
    <section className="document-panel dashboard-panel" aria-labelledby={id}>
      <div className="panel-heading">
        <h2 id={id}>{heading} <span className="section-count">{documents.length}</span></h2>
        <span className="document-count">Last modified</span>
      </div>
      {documents.length === 0 ? (
        <div className="list-empty-state">
          <DocumentIcon />
          <h3>{shared ? "Nothing shared with you yet" : "Your first document starts here"}</h3>
          <p>{shared ? "Documents shared with you will appear here." : "Select New Document to start a fresh page."}</p>
        </div>
      ) : (
        <ul className="document-list">
          {documents.map((document) => (
            <li className="document-row" key={document.id}>
              <Link className="document-link" href={`/documents/${document.id}`} aria-label={`Open ${document.title}`}>
                <span className="row-document-icon"><DocumentIcon /></span>
                <span className="document-name">
                  <span className="document-title" title={document.title}>{document.title}</span>
                  <span className="document-owner">{shared ? `Owned by ${document.owner.name}` : "Owned by you"}</span>
                </span>
              </Link>
              <div className="document-metadata">
                <span className={`permission-badge permission-${document.permission.toLowerCase()}`}>{permissionLabels[document.permission]}</span>
                <time dateTime={document.updatedAt}>{dateFormat.format(new Date(document.updatedAt))}</time>
              </div>
              <div className="document-actions">
                {document.permission !== "VIEWER" && (
                  <button className="button button-quiet" disabled={disabled} aria-label={`Rename ${document.title}`}
                    onClick={() => onAction({ kind: "rename", document })}>Rename</button>
                )}
                {document.relationship === "owned" && document.permission === "OWNER" && (
                  <button className="button button-quiet danger-text" disabled={disabled} aria-label={`Delete ${document.title}`}
                    onClick={() => onAction({ kind: "delete", document })}>Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
