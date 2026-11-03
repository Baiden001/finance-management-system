import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import type { Col } from './reports';
import { safeCell } from './format';

export interface ExportMeta {
  legalName: string; title: string; period: string; currency: string; generatedAt: string; generatedBy?: string;
  brandColor: string; accentColor: string; logoFile: string; restricted?: boolean; notes?: string;
}
type Row = Record<string, unknown>;

/** Drops the comparative column when no comparative period was requested. */
export function activeCols(cols: Col[], rows: Row[]): Col[] {
  return cols.filter((c) => c.key !== 'compare_amount' || rows.some((r) => r[c.key] !== null && r[c.key] !== undefined));
}
const isBold = (r: Row) => ['total', 'group_total', 'header', 'check'].includes(String(r.line_type ?? ''));
const fmt = (c: Col, v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (c.type === 'money' || c.type === 'number' || c.type === 'pct') {
    const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: c.type === 'number' ? 4 : 2 }) : String(v);
  }
  return String(v);
};

export function toCsv(cols0: Col[], rows: Row[]): Buffer {
  const cols = activeCols(cols0, rows);
  const esc = (x: unknown) => { const s = x === null || x === undefined ? '' : String(safeCell(x)); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))];
  return Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from(lines.join('\r\n'), 'utf8')]);
}

export async function toXlsx(meta: ExportMeta, cols0: Col[], rows: Row[]): Promise<Buffer> {
  const cols = activeCols(cols0, rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.legalName; wb.created = new Date(meta.generatedAt);
  const ws = wb.addWorksheet(meta.title.slice(0, 30), { views: [{ state: 'frozen', ySplit: 5 }] });
  const brandArgb = 'FF' + meta.brandColor.replace('#', '').toUpperCase();
  ws.addRow([meta.legalName]).font = { bold: true, size: 14, color: { argb: brandArgb } };
  ws.addRow([meta.title]).font = { bold: true, size: 12 };
  ws.addRow([`${meta.period} | Currency: ${meta.currency} | Generated ${meta.generatedAt}${meta.restricted ? ' | RESTRICTED - contains payroll data' : ''}`]).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  ws.addRow([]);
  const head = ws.addRow(cols.map((c) => c.label));
  head.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandArgb } }; });
  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => {
      const v = r[c.key];
      if ((c.type === 'money' || c.type === 'number' || c.type === 'pct') && v !== null && v !== undefined && Number.isFinite(Number(v))) return Number(v);
      return safeCell(v);
    }));
    cols.forEach((c, i) => { if (c.type === 'money') row.getCell(i + 1).numFmt = '#,##0.00;[Red]-#,##0.00'; });
    if (r.line_type !== undefined) {
      row.getCell(1).alignment = { indent: Number(r.depth ?? 0) };
      if (isBold(r)) row.font = { bold: true };
      if (r.line_type === 'total') row.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; });
    }
  }
  if (meta.notes) { ws.addRow([]); ws.addRow(['Notes']).font = { bold: true }; ws.addRow([meta.notes]).alignment = { wrapText: true }; }
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(40, c.label.length + 6)); });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(meta: ExportMeta, cols0: Col[], rows: Row[], landscape = false): Promise<Buffer> {
  const cols = activeCols(cols0, rows);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: meta.title, Author: meta.legalName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const logo = path.join(process.cwd(), 'public', meta.logoFile.replace(/^\//, ''));
    const W = doc.page.width - 72;
    if (fs.existsSync(logo)) doc.image(logo, 36, 30, { fit: [90, 56] });
    doc.fillColor(meta.brandColor).font('Helvetica-Bold').fontSize(15).text(meta.legalName, 140, 34, { width: W - 104 });
    doc.fillColor('#222').fontSize(12).text(meta.title, 140, 54, { width: W - 104 });
    doc.fillColor('#666').font('Helvetica').fontSize(8).text(`${meta.period}  |  Currency: ${meta.currency}  |  Generated ${meta.generatedAt}${meta.restricted ? '  |  RESTRICTED: payroll data' : ''}`, 140, 72, { width: W - 104 });
    doc.moveTo(36, 92).lineTo(36 + W, 92).lineWidth(1.5).strokeColor(meta.accentColor).stroke();
    const weights = cols.map((c) => (c.key === 'label' ? 5.5 : c.key === 'code' ? 1.1 : c.type === 'text' ? 2.2 : 1.4)); const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sum) * W);
    const fs_ = cols.length > 9 ? 6.5 : 8;
    let y = 102;
    const header = () => {
      doc.rect(36, y, W, 16).fill(meta.brandColor);
      let x = 36; doc.fillColor('#fff').font('Helvetica-Bold').fontSize(fs_);
      cols.forEach((c, i) => { doc.text(c.label, x + 3, y + 4, { width: widths[i] - 6, align: c.type === 'text' || c.type === 'date' ? 'left' : 'right', lineBreak: false }); x += widths[i]; });
      y += 18;
    };
    header();
    rows.forEach((r, idx) => {
      if (y > doc.page.height - 60) { doc.addPage(); y = 40; header(); }
      const bold = isBold(r); const ind = r.line_type !== undefined ? Number(r.depth ?? 0) * 10 : 0;
      if (r.line_type === 'total') doc.moveTo(36, y - 1).lineTo(36 + W, y - 1).lineWidth(0.6).strokeColor('#555').stroke();
      else if (idx % 2 === 0 && r.line_type === undefined) doc.rect(36, y - 1, W, 14).fill('#f4f4f1');
      let x = 36; doc.fillColor('#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs_);
      cols.forEach((c, i) => { doc.text(fmt(c, r[c.key]), x + 3 + (i === 0 ? ind : 0), y + 2, { width: widths[i] - 6 - (i === 0 ? ind : 0), align: c.type === 'text' || c.type === 'date' ? 'left' : 'right', lineBreak: false, ellipsis: true }); x += widths[i]; });
      y += 14;
    });
    if (rows.length === 0) { doc.fillColor('#666').fontSize(9).text('No data for the selected parameters.', 40, y + 6); }
    if (meta.notes) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(9).text('Notes', 36, y + 14, { width: W });
      doc.font('Helvetica').fontSize(8).fillColor('#333').text(meta.notes, 36, doc.y + 2, { width: W });
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); doc.fillColor('#888').font('Helvetica').fontSize(7)
        .text(`${meta.legalName}  -  Page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

export interface Payslip {
  company: { name: string; legal_name: string; currency: string };
  period: string; compliance_applied: boolean | null; net_pay: number; employer_pension: number;
  employee: { emp_no: string; name: string; type: string; tin?: string | null; ssnit_no?: string | null; payment_method: string };
  earnings: Record<string, number>; deductions: Record<string, number>;
}

export function payslipPdf(meta: ExportMeta, s: Payslip): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Payslip ${s.employee.emp_no} ${s.period}`, Author: meta.legalName } });
    const chunks: Buffer[] = []; doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const logo = path.join(process.cwd(), 'public', meta.logoFile.replace(/^\//, ''));
    if (fs.existsSync(logo)) doc.image(logo, 48, 40, { fit: [100, 60] });
    doc.fillColor(meta.brandColor).font('Helvetica-Bold').fontSize(16).text(meta.legalName, 170, 46);
    doc.fillColor('#222').fontSize(12).text(`Payslip - ${s.period}`, 170, 68);
    doc.moveTo(48, 112).lineTo(547, 112).lineWidth(1.5).strokeColor(meta.accentColor).stroke();
    doc.fillColor('#111').font('Helvetica').fontSize(10);
    doc.text(`Employee: ${s.employee.name} (${s.employee.emp_no})`, 48, 124).text(`Employment type: ${s.employee.type}`).text(`Payment method: ${s.employee.payment_method}`);
    if (s.compliance_applied) doc.text(`TIN: ${s.employee.tin ?? '-'}   SSNIT: ${s.employee.ssnit_no ?? '-'}`);
    const cur = s.company.currency; const m = (n: number) => `${cur} ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    let y = 200;
    const section = (title: string, items: [string, number][], bold = false) => {
      doc.rect(48, y, 499, 18).fill(meta.brandColor); doc.fillColor('#fff').font('Helvetica-Bold').text(title, 54, y + 5); y += 22;
      doc.fillColor('#111').font(bold ? 'Helvetica-Bold' : 'Helvetica');
      for (const [k, v] of items) { doc.text(k, 54, y, { width: 300 }).text(m(v), 350, y, { width: 190, align: 'right' }); y += 16; }
      y += 8;
    };
    const e = s.earnings; const d = s.deductions;
    section('Earnings', [['Basic pay', e.basic], ['Allowances', e.allowances], ['Overtime', e.overtime], ['Bonus', e.bonus], ['Commission', e.commission], ['Other earnings', e.other], ['Gross pay', e.gross]]);
    section('Deductions', [['PAYE', d.paye], ['Employee pension', d.employee_pension], ['Other deductions', d.other], ['Advances / loan repayments', d.advances], ['Total deductions', d.total]]);
    doc.rect(48, y, 499, 26).fill(meta.accentColor); doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('NET PAY', 54, y + 8).text(m(s.net_pay), 350, y + 8, { width: 190, align: 'right' });
    doc.fillColor('#666').font('Helvetica').fontSize(8).text(s.compliance_applied ? 'Statutory deductions calculated under the company\'s Ghana payroll compliance setting.' : 'Ghana PAYE / SSNIT were not applied automatically for this payroll.', 48, y + 46);
    doc.text(`Generated ${meta.generatedAt}. Confidential.`, 48, y + 58);
    doc.end();
  });
}
