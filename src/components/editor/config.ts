import { getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { contentSchema } from "@/lib/documents/validation";

// Preserve the API's existing StarterKit nodes. Links are not supported by it.
export const editorExtensions = [StarterKit.configure({ link: false, trailingNode: false })];

export function prepareContent(value: unknown): JSONContent {
  const parsed = contentSchema.safeParse(value);
  if (!parsed.success) throw new Error("This document contains unsupported content.");
  const node = getSchema(editorExtensions).nodeFromJSON(parsed.data);
  node.check();
  // Canonical defaults match getJSON(), avoiding false dirty state on opening.
  return node.toJSON() as JSONContent;
}
