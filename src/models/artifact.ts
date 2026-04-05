import crypto from "crypto";

export interface Artifact {
  id: string;
  invocationId: string;
  content: unknown;
  mimeType: string;
  createdAt: Date;
}

export function createArtifact(
  invocationId: string,
  content: unknown,
  mimeType = "text/plain"
): Artifact {
  return { id: crypto.randomUUID(), invocationId, content, mimeType, createdAt: new Date() };
}
