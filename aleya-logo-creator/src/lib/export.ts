/** Download an SVG string as a file. */
export function downloadSvg(svgMarkup: string, filename: string): void {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Rasterize SVG to PNG via canvas and download. */
export async function downloadPngFromSvg(
  svgMarkup: string,
  filename: string,
  options?: { width?: number; height?: number },
): Promise<void> {
  const width = options?.width ?? 1280;
  const height = options?.height ?? 800;
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / img.width, height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
        'image/png',
      );
    });

    const pngUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    a.click();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load SVG for PNG export'));
    img.src = src;
  });
}
