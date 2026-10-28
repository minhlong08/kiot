import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

export type XlsxColumn = { header: string; key: string; width?: number; money?: boolean };

export async function buildXlsx(columns: XlsxColumn[], rows: object[], sheetName = 'Data'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width ?? 18, style: c.money ? { numFmt: '#,##0' } : {} }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function sendXlsx(reply: FastifyReply, filename: string, columns: XlsxColumn[], rows: object[]) {
  const buf = await buildXlsx(columns, rows);
  return reply
    .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    .send(buf);
}

/** Reads the first sheet into objects keyed by header text. */
export async function readXlsx(buf: Buffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value ?? '').trim(); });
  const out: Record<string, unknown>[] = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const v = cell.value as unknown;
      obj[headers[col]] = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
    });
    if (Object.keys(obj).length) out.push(obj);
  });
  return out;
}
