import zlib from 'node:zlib';

function decodePdfHex(hex: string): string {
  let text = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return text;
}

function decodePdfLiteral(literal: string): string {
  return literal.replace(/\\([nrt\\()])/g, (_, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

/** Extract readable text from a PDFKit buffer (handles FlateDecode + TJ kerning runs). */
export function extractPdfText(pdf: Buffer): string {
  const source = pdf.toString('latin1');
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  const parts: string[] = [];

  for (const match of streams) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    let decoded = '';
    try {
      decoded = zlib.inflateSync(raw).toString('latin1');
    } catch {
      decoded = raw.toString('latin1');
    }

    for (const tj of decoded.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      const body = tj[1] ?? '';
      let run = '';
      for (const token of body.matchAll(/<([0-9a-fA-F]+)>|\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        if (token[1]) run += decodePdfHex(token[1]);
        else if (token[2] !== undefined) run += decodePdfLiteral(token[2]);
      }
      if (run) parts.push(run);
    }
  }

  return parts.join(' ');
}
