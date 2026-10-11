import { z } from "zod";
import { getAddress, ZeroAddress } from "ethers";
export const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase());
export const certificateId = hex32.refine((v) => v !== "0x" + "0".repeat(64));
export const address = z
  .string()
  .refine((v) => {
    try {
      return getAddress(v) !== ZeroAddress;
    } catch {
      return false;
    }
  })
  .transform((v) => getAddress(v).toLowerCase());
export const pagination = z
  .object({
    cursor: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const metadataPatch = z
  .object({ displayLabel: z.string().trim().max(120) })
  .strict();
export const draftList = z
  .object({
    draftIds: z
      .array(hex32)
      .min(1)
      .max(50)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
