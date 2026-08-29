import { z } from "zod";

export const storageIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]{1,64}$/,
    "Storage ids may only contain letters, numbers, underscores, and hyphens.",
  );

export class InvalidStorageIdError extends Error {
  constructor(
    readonly field: string,
    readonly value: string,
  ) {
    super(`${field} is not a valid storage id.`);
    this.name = "InvalidStorageIdError";
  }
}

export function assertStorageId(value: string, field: string) {
  if (!storageIdSchema.safeParse(value).success) {
    throw new InvalidStorageIdError(field, value);
  }

  return value;
}
