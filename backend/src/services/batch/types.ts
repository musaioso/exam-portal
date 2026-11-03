export interface SourcePage {
  sourceFile: string;
  image: Buffer;
  mimeType: string;
  filenameNumber: number | null;
}

export type AuditStatus = "match" | "mismatch" | "unnumbered" | "confirmed";

export interface PageAudit {
  sourceFile: string;
  filenameNumber: number | null;
  printedNumber: number | null;
  auditStatus: AuditStatus;
  resolvedPageNumber: number | null;
  proposedNumber: number | null;
  reason: string;
}
