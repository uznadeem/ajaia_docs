"use client";

import { memo } from "react";
import { EditorContent, useEditorState, type Editor } from "@tiptap/react";

export const WritingCanvas = memo(function WritingCanvas({ editor, editable }: { editor: Editor; editable: boolean }) {
  const empty = useEditorState({ editor, selector: ({ editor }) => editor.isEmpty });
  return (
    <div className="writing-canvas">
      <EditorContent editor={editor} />
      {empty && <p className="empty-writing-hint" aria-hidden="true">{editable ? "Start writing…" : "This document is empty."}</p>}
    </div>
  );
});
