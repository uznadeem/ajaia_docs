import Link from "next/link";
import { DocumentIcon } from "@/components/ui/document-icon";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="header-content">
        <Link href="/" className="brand" aria-label="Ajaia Docs home">
          <span className="brand-icon"><DocumentIcon /></span>
          <span>Ajaia <span className="brand-secondary">Docs</span></span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/" className="nav-link">Workspace</Link>
        </nav>
      </div>
    </header>
  );
}
