import { z } from "zod";

export const recipientIdSchema = z.cuid();
export const shareInputSchema = z.strictObject({ userId: recipientIdSchema, permission: z.enum(["VIEWER", "EDITOR"]) });
