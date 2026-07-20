import type { ReviewSheet } from "./review";

// ReviewSheet → xlsx Blob (write-excel-file は動的 import でメインバンドル外に)

export async function sheetsToXlsxBlob(sheets: ReviewSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const result = writeXlsxFile(
    sheets.map((s) => ({
      sheet: s.name,
      columns: s.header.map(() => ({ width: 20 })),
      data: [
        s.header.map((h) => ({ value: h, fontWeight: "bold" as const })),
        ...s.rows.map((row) =>
          row.map((c) => (c === null ? null : { value: c })),
        ),
      ],
    })),
  );
  return result.toBlob();
}
