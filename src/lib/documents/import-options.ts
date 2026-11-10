export const MAX_UPLOAD_BYTES = 1024 * 1024;

export function uploadValidationError(file: { name: string; size: number }): string | null {
  if (!/\.(txt|md)$/i.test(file.name)) return "Choose a .txt or .md file.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "The file must be 1 MB or smaller.";
  return null;
}
