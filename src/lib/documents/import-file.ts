import "server-only";
import MarkdownIt from "markdown-it";
import type { NextRequest } from "next/server";
import { ApiError } from "../api/http";
import { MAX_BODY_BYTES } from "../api/limits";
import { MAX_UPLOAD_BYTES, uploadValidationError } from "./import-options";
import { titleSchema } from "./title";
import { contentSchema } from "./validation";

const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true, maxNesting: 20 }).disable(["table"]);
type Mark = { type: "bold" | "italic" | "strike" | "code" };
type Node = { type: string; text?: string; attrs?: { level?: number; start?: number }; marks?: Mark[]; content?: Node[] };
const invalidFile = (message: string) => new ApiError(400, "INVALID_FILE", message);
const tooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "The file or converted document is too large.");

export async function readImportFile(request: NextRequest): Promise<File> {
  const type = request.headers.get("content-type") ?? "";
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) throw invalidFile("Invalid content length.");
  if (declared !== null && Number(declared) > MAX_MULTIPART_BYTES) throw tooLarge();
  if (!/^multipart\/form-data\s*;/i.test(type) || !request.body) throw invalidFile("Expected one file in multipart/form-data.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MULTIPART_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
    // Native multipart parsing only sees an already size-bounded body.
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": type } }).formData();
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) {
      throw invalidFile("Upload exactly one file, with no additional fields.");
    }
    const file = entries[0][1];
    const problem = uploadValidationError(file);
    if (problem) throw file.size > MAX_UPLOAD_BYTES ? tooLarge() : invalidFile(problem);
    return file;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidFile("Malformed multipart upload.");
  } finally { reader.releaseLock(); }
}

export async function convertImport(file: File) {
  const basename = file.name.replaceAll("\\", "/").split("/").pop()!;
  const parsedTitle = titleSchema.safeParse(basename.replace(/\.(txt|md)$/i, "").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, "").trim());
  if (!parsedTitle.success) throw invalidFile("Use a filename with a nonempty title of at most 200 characters.");
  const title = parsedTitle.data;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw invalidFile("The file must contain valid UTF-8 text."); }
  text = text.replace(/\r\n?/g, "\n");
  if (!text.trim() || text.includes("\0")) throw invalidFile("The file must contain nonempty text without null bytes.");
  const root: Node = { type: "doc", content: [] };
  let count = 0;
  function append(parent: Node, node: Node) {
    if (++count > 2000) throw tooLarge();
    (parent.content ??= []).push(node);
  }
  function appendText(parent: Node, value: string, marks: Mark[] = []) {
    if (!value) return;
    const uniqueMarks = [...new Set(marks.map((mark) => mark.type))].sort().map((type) => ({ type }));
    const previous = parent.content?.at(-1);
    // ProseMirror merges adjacent identical text marks. Enforce its resulting
    // text-node length here so an imported document remains editable/saveable.
    if (previous?.type === "text" && JSON.stringify(previous.marks ?? []) === JSON.stringify(uniqueMarks)) {
      if ((previous.text?.length ?? 0) + value.length > 100_000) throw tooLarge();
      previous.text = (previous.text ?? "") + value;
    } else {
      if (value.length > 100_000) throw tooLarge();
      append(parent, { type: "text", text: value, ...(uniqueMarks.length ? { marks: uniqueMarks } : {}) });
    }
  }
  if (/\.txt$/i.test(basename)) {
    for (const paragraph of text.split(/\n[\t ]*\n+/)) {
      const node: Node = { type: "paragraph", content: [] };
      append(root, node);
      paragraph.split("\n").forEach((line, index) => {
        if (index) append(node, { type: "hardBreak" });
        appendText(node, line);
      });
    }
  } else {
    const tokens = markdown.parse(text, {});
    if (tokens.length > 6000) throw tooLarge();
    const stack = [root];
    const blocks: Record<string, string> = { paragraph: "paragraph", heading: "heading", bullet_list: "bulletList", ordered_list: "orderedList", list_item: "listItem", blockquote: "blockquote" };
    for (const token of tokens) {
      const parent = stack[stack.length - 1];
      if (token.nesting === 1) {
        const type = blocks[token.type.replace(/_open$/, "")];
        if (!type) throw invalidFile("Unsupported Markdown structure.");
        const node: Node = { type, content: [], ...(type === "heading" ? { attrs: { level: Number(token.tag.slice(1)) } }
          : type === "orderedList" ? { attrs: { start: Number(token.attrGet("start") ?? 1) } } : {}) };
        append(parent, node);
        stack.push(node);
      } else if (token.nesting === -1) stack.pop();
      else if (token.type === "inline") {
        const marks: Mark[] = [];
        for (const inline of token.children ?? []) {
          const mark = ({ strong: "bold", em: "italic", s: "strike" } as const)[inline.type.replace(/_(open|close)$/, "") as "strong" | "em" | "s"];
          if (mark && inline.nesting === 1) marks.push({ type: mark });
          else if (mark && inline.nesting === -1) { const index = marks.findLastIndex((item) => item.type === mark); if (index >= 0) marks.splice(index, 1); }
          else if (inline.type === "code_inline") appendText(parent, inline.content, [{ type: "code" }]);
          else if (inline.type === "softbreak" || inline.type === "hardbreak") append(parent, { type: "hardBreak" });
          else if (inline.type === "text" || inline.type === "image") appendText(parent, inline.content, marks);
          // Link wrapper tokens are omitted: their label remains plain text.
        }
      } else if (token.type === "fence" || token.type === "code_block") {
        const code: Node = { type: "codeBlock", content: [] };
        append(parent, code);
        appendText(code, token.content);
      } else if (token.type === "hr") append(parent, { type: "horizontalRule" });
    }
  }
  if (!root.content?.length) throw invalidFile("The file contains no importable text.");
  if (Buffer.byteLength(JSON.stringify({ title, content: root }), "utf8") > MAX_BODY_BYTES) throw tooLarge();
  const parsed = contentSchema.safeParse(root);
  if (!parsed.success) throw invalidFile("The converted document exceeds supported formatting or nesting limits.");
  return { title, content: parsed.data };
}
