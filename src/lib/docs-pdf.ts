import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import type { ExportMeta } from './export';

export interface DocSpec {
  title: string; number: string; date: string;
  company: { legal_name: string; tin?: string | null; address?: string | null; phone?: string | null; email?: string | null };
  parties: { label: string; lines: string[] }[];
  info?: [string, string][];
  columns?: { label: string; w: number; right?: boolean }[];
  rows?: string[][];
  totals?: [string, string, boolean?][];
  words?: string;
  notes?: string[];
  signatures?: string[];
  watermark?: string;
}

export function docPdf(meta: Pick<ExportMeta, 'brandColor' | 'accentColor' | 'logoFile' | 'generatedAt'>, d: DocSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: `${d.title} ${d.number}`, Author: d.company.legal_name } });
    const chunks: Buffer[] = []; doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 88; const L = 44;
    const logo = path.join(process.cwd(), 'public', meta.logoFile.replace(/^\//, ''));
    if (fs.existsSync(logo)) doc.image(logo, L, 36, { fit: [92, 58] });
    doc.fillColor(meta.brandColor).font('Helvetica-Bold').fontSize(15).text(d.company.legal_name, L + 106, 38, { width: 250 });
    doc.fillColor('#555').font('Helvetica').fontSize(8).text([d.company.address, d.company.phone, d.company.email, d.company.tin ? `TIN: ${d.company.tin}` : null].filter(Boolean).join('  |  '), L + 106, doc.y + 2, { width: 250 });
    doc.fillColor(meta.accentColor).font('Helvetica-Bold').fontSize(18).text(d.title.toUpperCase(), L + W - 190, 38, { width: 190, align: 'right' });
    doc.fillColor('#111').font('Helvetica').fontSize(9).text(`No. ${d.number}`, L + W - 190, 62, { width: 190, align: 'right' }).text(`Date: ${d.date}`, { width: 190, align: 'right' });
    doc.moveTo(L, 104).lineTo(L + W, 104).lineWidth(1.5).strokeColor(meta.accentColor).stroke();
    let y = 116;
    const blocks = [...d.parties]; const bw = W / Math.max(blocks.length + (d.info?.length ? 1 : 0), 1);
    blocks.forEach((b, i) => { doc.fillColor(meta.brandColor).font('Helvetica-Bold').fontSize(8).text(b.label.toUpperCase(), L + i * bw, y, { width: bw - 10 }); doc.fillColor('#111').font('Helvetica').fontSize(10).text(b.lines.filter(Boolean).join('\n'), L + i * bw, doc.y + 1, { width: bw - 10 }); });
    if (d.info?.length) { const x = L + blocks.length * bw; let iy = y; d.info.forEach(([k, v]) => { doc.fillColor('#666').font('Helvetica').fontSize(8).text(k, x, iy, { width: bw - 10 }); doc.fillColor('#111').fontSize(10).text(v, x, doc.y, { width: bw - 10 }); iy = doc.y + 3; }); }
    y = Math.max(doc.y, y + 60) + 14;
    if (d.columns && d.rows) {
      const tot = d.columns.reduce((s, c) => s + c.w, 0); const ws = d.columns.map((c) => (c.w / tot) * W);
      const head = () => { doc.rect(L, y, W, 18).fill(meta.brandColor); let x = L; doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5); d.columns!.forEach((c, i) => { doc.text(c.label, x + 4, y + 5, { width: ws[i] - 8, align: c.right ? 'right' : 'left', lineBreak: false }); x += ws[i]; }); y += 20; };
      head();
      d.rows.forEach((r, ri) => {
        if (y > doc.page.height - 150) { doc.addPage(); y = 44; head(); }
        if (ri % 2 === 0) doc.rect(L, y - 2, W, 16).fill('#f5f5f2');
        let x = L; doc.fillColor('#111').font('Helvetica').fontSize(9);
        r.forEach((cell, i) => { doc.text(cell, x + 4, y + 1, { width: ws[i] - 8, align: d.columns![i].right ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += ws[i]; });
        y += 16;
      });
      y += 6;
    }
    if (d.totals?.length) {
      if (y > doc.page.height - 190) { doc.addPage(); y = 44; }
      d.totals.forEach(([k, v, bold]) => {
        if (bold) doc.rect(L + W - 250, y - 3, 250, 20).fill(meta.accentColor);
        doc.fillColor(bold ? '#fff' : '#111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).text(k, L + W - 244, y + (bold ? 2 : 0), { width: 130, lineBreak: false }).text(v, L + W - 116, y + (bold ? 2 : 0), { width: 110, align: 'right', lineBreak: false });
        y += bold ? 24 : 16;
      });
    }
    if (d.words) { y += 6; doc.fillColor('#111').font('Helvetica-Bold').fontSize(9).text('Amount in words: ', L, y, { continued: true }).font('Helvetica').text(d.words, { width: W }); y = doc.y + 8; }
    (d.notes ?? []).forEach((n) => { doc.fillColor('#555').font('Helvetica').fontSize(8.5).text(n, L, y, { width: W }); y = doc.y + 4; });
    if (d.signatures?.length) {
      const sy = Math.max(y + 34, doc.page.height - 130); const sw = W / d.signatures.length;
      d.signatures.forEach((s, i) => { doc.moveTo(L + i * sw + 4, sy).lineTo(L + (i + 1) * sw - 24, sy).lineWidth(0.7).strokeColor('#333').stroke(); doc.fillColor('#555').font('Helvetica').fontSize(8).text(s, L + i * sw + 4, sy + 3, { width: sw - 28 }); });
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      if (d.watermark) doc.save().rotate(-30, { origin: [300, 420] }).fillColor('#e8e8e8').opacity(0.5).font('Helvetica-Bold').fontSize(72).text(d.watermark, 90, 380, { lineBreak: false }).restore().opacity(1);
      doc.fillColor('#888').font('Helvetica').fontSize(7).text(`${d.company.legal_name}  -  generated ${meta.generatedAt}  -  page ${i + 1} of ${range.count}`, L, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
