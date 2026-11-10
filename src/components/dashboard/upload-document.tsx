"use client";

import { useId, useRef } from "react";

export function UploadDocument({ disabled, uploading, onUpload }: { disabled: boolean; uploading: boolean; onUpload: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  return (
    <div className="upload-document">
      <button type="button" className="button button-secondary" disabled={disabled} aria-describedby={hint} onClick={() => input.current?.click()}>
        {uploading ? "Uploading…" : "Upload Document"}
      </button>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Upload document file" aria-describedby={hint}
        accept=".txt,.md" disabled={disabled} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onUpload(file);
        }} />
      <span id={hint} className="field-hint">.txt or .md · up to 1 MB</span>
    </div>
  );
}
