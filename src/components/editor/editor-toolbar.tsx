"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useState } from "react";

export function EditorToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [focused, setFocused] = useState(0);
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      paragraph: editor.isActive("paragraph"), bold: editor.isActive("bold"), italic: editor.isActive("italic"),
      underline: editor.isActive("underline"), h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }), h3: editor.isActive("heading", { level: 3 }),
      bullet: editor.isActive("bulletList"), ordered: editor.isActive("orderedList"),
    }),
  });
  const controls = [
    { label: "Paragraph", text: "¶", active: active.paragraph, run: () => editor.chain().focus().setParagraph().run() },
    { label: "Bold", text: <strong>B</strong>, active: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", text: <em>I</em>, active: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Underline", text: <span className="underline-label">U</span>, active: active.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: "Heading 1", text: "H1", active: active.h1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "Heading 2", text: "H2", active: active.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", text: "H3", active: active.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Bullet list", text: "• List", active: active.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", text: "1. List", active: active.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
  ];
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Document formatting" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || disabled) return;
      event.preventDefault();
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
      const current = Array.from(buttons).findIndex((button) => button === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      setFocused(next);
      buttons[next].focus();
    }}>
      {controls.map((control, index) => (
        <button key={control.label} type="button" className="format-button" aria-label={control.label} title={control.label}
          aria-pressed={control.active} tabIndex={focused === index ? 0 : -1} disabled={disabled} onMouseDown={(event) => event.preventDefault()}
          onClick={() => control.run()}>{control.text}</button>
      ))}
    </div>
  );
}
