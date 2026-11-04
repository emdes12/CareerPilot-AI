import fs from 'node:fs';
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import type { CvContent } from './generate.js';

/** ATS-friendly rendering: single column, real text (no images/tables), standard headings. */

const FONT_CANDIDATES = [
  ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  ['C:/Windows/Fonts/calibri.ttf', 'C:/Windows/Fonts/calibrib.ttf'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
];
const FONTS = FONT_CANDIDATES.find(([r, b]) => fs.existsSync(r) && fs.existsSync(b)) ?? null;
// Without a Unicode TTF, PDFKit's built-in Helvetica only supports WinAnsi; transliterate to stay readable.
const safe = (s: string) => (FONTS ? s : s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\xff–—’“”•·]/g, ''));

function pdfToBuffer(build: (d: PDFKit.PDFDocument, reg: string, bold: string) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 46, left: 54, right: 54 }, info: { Title: 'Curriculum Vitae' } });
    let reg = 'Helvetica'; let bold = 'Helvetica-Bold';
    if (FONTS) { d.registerFont('R', FONTS[0]); d.registerFont('B', FONTS[1]); reg = 'R'; bold = 'B'; }
    const chunks: Buffer[] = [];
    d.on('data', (c) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject);
    build(d, reg, bold);
    d.end();
  });
}

export function cvPdf(c: CvContent): Promise<Buffer> {
  return pdfToBuffer((d, R, B) => {
    const W = d.page.width - d.page.margins.left - d.page.margins.right;
    const heading = (t: string) => {
      d.moveDown(0.6).font(B).fontSize(10.5).fillColor('#111').text(t.toUpperCase(), { characterSpacing: 0.6 });
      const y = d.y + 2; d.moveTo(d.page.margins.left, y).lineTo(d.page.margins.left + W, y).lineWidth(0.6).strokeColor('#999').stroke(); d.moveDown(0.35);
    };
    d.font(B).fontSize(19).fillColor('#000').text(safe(c.header.name));
    d.font(R).fontSize(10.5).fillColor('#333').text(safe(c.header.headline));
    const links = Object.values(c.header.links ?? {}).filter(Boolean).map((l) => String(l).replace(/^https?:\/\//, ''));
    d.fontSize(9).fillColor('#333').text(safe([c.header.location, c.header.email, c.header.phone, ...links].filter(Boolean).join('  ·  ')));
    heading('Professional Summary');
    d.font(R).fontSize(9.8).fillColor('#111').text(safe(c.summary), { align: 'left', lineGap: 1.5 });
    heading('Technical Skills');
    for (const g of c.skills) d.font(B).fontSize(9.6).text(`${g.group}: `, { continued: true }).font(R).text(safe(g.items.join(', ')), { lineGap: 1.2 });
    heading('Professional Experience');
    for (const e of c.experience) {
      d.font(B).fontSize(10).fillColor('#000').text(safe(`${e.title} — ${e.company}`), { continued: true }).font(R).fillColor('#444').text(`   ${safe(e.period)}`);
      d.fillColor('#111').fontSize(9.6);
      for (const b of e.bullets) d.font(R).text(`•  ${safe(b)}`, { indent: 8, lineGap: 1.2 });
      d.moveDown(0.35);
    }
    if (c.projects.length) {
      heading('Selected Projects');
      for (const p of c.projects) {
        d.font(B).fontSize(10).fillColor('#000').text(safe(p.name), { continued: !!p.url }).font(R).fillColor('#444');
        if (p.url) d.text(`   ${p.url.replace(/^https?:\/\//, '')}`);
        d.fillColor('#111').fontSize(9.6).text(safe(p.description), { lineGap: 1.2 });
        if (p.technologies.length) d.fillColor('#444').fontSize(9).text(safe(`Tech: ${p.technologies.join(', ')}`));
        d.moveDown(0.3);
      }
    }
    if (c.education.length) {
      heading('Education & Certifications');
      for (const e of c.education) d.font(R).fontSize(9.6).fillColor('#111').text(safe([e.credential, e.institution, e.period].filter(Boolean).join(' — ')));
    }
  });
}

export function letterPdf(name: string, contact: string, l: { recipient: string; subject: string; paragraphs: string[]; signoff: string }): Promise<Buffer> {
  return pdfToBuffer((d, R, B) => {
    d.font(B).fontSize(15).text(safe(name));
    d.font(R).fontSize(9.5).fillColor('#444').text(safe(contact)).moveDown(1.2);
    d.fillColor('#111').fontSize(10.5).text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })).moveDown(0.8);
    d.text(safe(l.recipient)).moveDown(0.6);
    d.font(B).text(safe(`Re: ${l.subject}`)).moveDown(0.8).font(R);
    d.text('Dear Hiring Team,').moveDown(0.6);
    for (const p of l.paragraphs) d.text(safe(p), { lineGap: 2, align: 'left' }).moveDown(0.7);
    d.text(safe(l.signoff), { lineGap: 2 });
  });
}

const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, bold: o.bold, size: o.size ?? 20, color: o.color, font: 'Calibri' });
const h = (t: string) => new Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } }, children: [run(t.toUpperCase(), { bold: true, size: 21 })] });

export async function cvDocx(c: CvContent): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ children: [run(c.header.name, { bold: true, size: 36 })] }),
    new Paragraph({ children: [run(c.header.headline, { size: 21, color: '333333' })] }),
    new Paragraph({ children: [run([c.header.location, c.header.email, c.header.phone].filter(Boolean).join('  ·  '), { size: 18 }),
      ...Object.values(c.header.links ?? {}).filter(Boolean).flatMap((l) => [run('  ·  ', { size: 18 }), new ExternalHyperlink({ link: String(l), children: [new TextRun({ text: String(l).replace(/^https?:\/\//, ''), style: 'Hyperlink', size: 18, font: 'Calibri' })] }) as any])] }),
    h('Professional Summary'), new Paragraph({ children: [run(c.summary)] }),
    h('Technical Skills'), ...c.skills.map((g) => new Paragraph({ children: [run(`${g.group}: `, { bold: true }), run(g.items.join(', '))] })),
    h('Professional Experience'),
    ...c.experience.flatMap((e) => [
      new Paragraph({ spacing: { before: 120 }, children: [run(`${e.title} — ${e.company}`, { bold: true }), run(`\t${e.period}`, { color: '555555' })], tabStops: [{ type: 'right' as any, position: 9600 }] }),
      ...e.bullets.map((b) => new Paragraph({ bullet: { level: 0 }, children: [run(b)] })),
    ]),
  ];
  if (c.projects.length) {
    children.push(h('Selected Projects'));
    for (const p of c.projects) {
      children.push(new Paragraph({ spacing: { before: 100 }, children: [run(p.name, { bold: true }), ...(p.url ? [run(`  ${p.url}`, { color: '555555', size: 18 })] : [])] }));
      children.push(new Paragraph({ children: [run(p.description)] }));
      if (p.technologies.length) children.push(new Paragraph({ children: [run(`Tech: ${p.technologies.join(', ')}`, { size: 18, color: '555555' })] }));
    }
  }
  if (c.education.length) { children.push(h('Education & Certifications')); for (const e of c.education) children.push(new Paragraph({ children: [run([e.credential, e.institution, e.period].filter(Boolean).join(' — '))] })); }
  const doc = new Document({ creator: c.header.name, title: `CV — ${c.meta.targetTitle}`, sections: [{ properties: { page: { margin: { top: 800, bottom: 800, left: 900, right: 900 } } }, children }] });
  return Packer.toBuffer(doc);
}

export async function letterDocx(name: string, contact: string, l: { recipient: string; subject: string; paragraphs: string[]; signoff: string }): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ children: [run(name, { bold: true, size: 30 })] }),
    new Paragraph({ children: [run(contact, { size: 18, color: '555555' })] }),
    new Paragraph({ spacing: { before: 300 }, children: [run(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))] }),
    new Paragraph({ spacing: { before: 200 }, children: [run(l.recipient)] }),
    new Paragraph({ spacing: { before: 200 }, children: [run(`Re: ${l.subject}`, { bold: true })] }),
    new Paragraph({ spacing: { before: 200, after: 120 }, children: [run('Dear Hiring Team,')] }),
    ...l.paragraphs.map((p) => new Paragraph({ spacing: { after: 160 }, alignment: AlignmentType.LEFT, children: [run(p)] })),
    ...l.signoff.split('\n').map((s) => new Paragraph({ children: [run(s)] })),
  ] }] });
  return Packer.toBuffer(doc);
}
export const hasUnicodeFont = () => !!FONTS;
