import { z } from "zod";

export const titleSchema = z.string().trim()
  .min(1, "Enter a document title.")
  .max(200, "Use 200 characters or fewer.");
