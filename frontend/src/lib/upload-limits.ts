/**
 * Vercel rejects a serverless request body over ~4.5 MB before Express or
 * multer sees it. That limit cannot be raised by the backend's multer config,
 * so catch an oversized upload in the browser and explain it instead.
 *
 * Leave headroom for multipart boundaries and form fields.
 */
export const MAX_UPLOAD_REQUEST_BYTES = 4 * 1024 * 1024;

export function totalUploadBytes(files: ArrayLike<File>): number {
  let total = 0;
  for (let i = 0; i < files.length; i++) total += files[i]?.size || 0;
  return total;
}

export function formatUploadSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Returns a user-facing message when the files cannot fit in one request,
 * otherwise null.
 */
export function uploadSizeError(files: File[], label: string, extra = ""): string | null {
  const total = totalUploadBytes(files);
  if (total <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return `This ${label} is ${formatUploadSize(total)}. The server accepts at most about 4.5 MB per upload — compress the files or upload fewer at once.${extra ? ` ${extra}` : ""}`;
}
