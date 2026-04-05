export interface Artifact {
    id: string;
    invocationId: string;
    content: unknown;
    mimeType: string;
    createdAt: Date;
}
export declare function createArtifact(invocationId: string, content: unknown, mimeType?: string): Artifact;
//# sourceMappingURL=artifact.d.ts.map