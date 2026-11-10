import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { titleSchema } from "./title";

export const documentIdSchema = z.cuid();
const children = z.array(z.unknown()).max(2000);
const mark = z.strictObject({ type: z.enum(["bold", "italic", "strike", "code", "underline"]) });
const text = z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(100_000), marks: z.array(mark).max(5).optional() });
const nodeSchema = z.discriminatedUnion("type", [
  text,
  z.strictObject({ type: z.literal("hardBreak") }),
  z.strictObject({ type: z.literal("horizontalRule") }),
  z.strictObject({ type: z.literal("paragraph"), content: children.optional() }),
  z.strictObject({ type: z.literal("heading"), attrs: z.strictObject({ level: z.number().int().min(1).max(6) }), content: children.optional() }),
  z.strictObject({ type: z.literal("codeBlock"), attrs: z.strictObject({ language: z.string().max(50).nullable().optional() }).optional(), content: children.optional() }),
  z.strictObject({ type: z.literal("blockquote"), content: children.min(1) }),
  z.strictObject({ type: z.literal("bulletList"), content: children.min(1) }),
  z.strictObject({ type: z.literal("orderedList"), attrs: z.strictObject({
    start: z.number().int().min(1).max(1_000_000),
    // Tiptap 3 emits this attribute even for default decimal numbering.
    type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
  }).optional(), content: children.min(1) }),
  z.strictObject({ type: z.literal("listItem"), content: children.min(1) }),
]);
const rootSchema = z.strictObject({ type: z.literal("doc"), content: children.min(1) });
const blocks = ["paragraph", "heading", "codeBlock", "blockquote", "bulletList", "orderedList", "horizontalRule"];

// Validate iteratively: untrusted deep JSON must not overflow a recursive parser.
function isRichText(value: unknown): value is Prisma.InputJsonObject {
  const root = rootSchema.safeParse(value);
  if (!root.success) return false;
  const pending = root.data.content.map((node) => ({ node, allowed: blocks, depth: 1 }));
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++count > 2000 || current.depth > 20) return false;
    const parsed = nodeSchema.safeParse(current.node);
    if (!parsed.success || !current.allowed.includes(parsed.data.type)) return false;
    const node = parsed.data;
    if (!("content" in node) || !node.content) continue;
    let allowed: string[];
    switch (node.type) {
      case "paragraph":
      case "heading": allowed = ["text", "hardBreak"]; break;
      case "codeBlock": allowed = ["text"]; break;
      case "bulletList":
      case "orderedList": allowed = ["listItem"]; break;
      case "listItem": {
        const first = nodeSchema.safeParse(node.content[0]);
        if (!first.success || first.data.type !== "paragraph") return false;
        allowed = blocks;
        break;
      }
      default: allowed = blocks;
    }
    for (const child of node.content) {
      if (node.type === "codeBlock") {
        const childText = text.safeParse(child);
        if (!childText.success || childText.data.marks?.length) return false;
      }
      pending.push({ node: child, allowed, depth: current.depth + 1 });
    }
  }
  return true;
}

export const contentSchema = z.custom<Prisma.InputJsonObject>(isRichText, "Unsupported rich-text document.");
export const createDocumentSchema = z.strictObject({ title: titleSchema.optional() });
export const updateDocumentSchema = z.strictObject({ title: titleSchema.optional(), content: contentSchema.optional() })
  .refine((data) => data.title !== undefined || data.content !== undefined, "An update is required.");
export const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] } satisfies Prisma.InputJsonObject;
