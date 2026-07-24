/**
 * Render the Cart N Tip #107 data through the quantum-hire renderer and
 * compare against the original reference PDF at the same scale.
 *
 * Outputs side-by-side + absolute-difference overlay images.
 */
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = process.env.QH_COMPARE_OUT || '/opt/cursor/artifacts/quantum-hire-rebuild/compare';
const DPI = Number(process.env.QH_COMPARE_DPI || 150);
const REF_CANDIDATES = [
  join(ROOT, 'fixtures/reference-invoices/Cart_N_Tip_107.pdf'),
  join(ROOT, 'tests/fixtures/reference-invoices/Cart_N_Tip_107.pdf'),
];

mkdirSync(OUT, { recursive: true });

function findRef() {
  for (const p of REF_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('Reference Cart_N_Tip_107.pdf not found');
}

async function main() {
  // Build dist so we can import compiled JS, or use tsx via dynamic import from src through vitest path.
  // Prefer running against compiled output when present; otherwise use tsx register.
  const { generateInvoicePdfBuffer } = await import(join(ROOT, 'dist/src/services/pdf-service.js')).catch(
    async () => {
      execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'inherit' });
      return import(join(ROOT, 'dist/src/services/pdf-service.js'));
    },
  );
  const { createCartNTipReferenceDesign } = await import(
    join(ROOT, 'dist/src/domain/templates/cart-n-tip-reference.js')
  );

  const design = createCartNTipReferenceDesign();
  const lineItems = [
    { description: '29/06/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    { description: '30/06/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    { description: '01/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    { description: '02/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    { description: '03/07/2026 Labour Hire - Day Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
    { description: '03/07/2026 Labour Hire - Night Shift', quantity: 1, unitPrice: 350, gstApplicable: true },
  ];
  const subtotal = 2100;
  const gstTotal = 210;
  const total = 2310;

  const now = new Date().toISOString();
  const pdf = await generateInvoicePdfBuffer({
    invoice: {
      id: 'compare-cart-n-tip',
      customerId: 'cust',
      title: 'Cart N Tip recreation compare',
      invoiceNumber: '107',
      status: 'Finalised',
      paymentState: 'Unpaid',
      reminderState: 'None',
      issueDate: '2026-07-06',
      dueDate: '2026-07-13',
      paymentTerms: '7 Days',
      notes: 'Payment is required within 7 days from the invoice date.\nThank you for your business.',
      totals: { subtotal, gstTotal, total },
      createdAt: now,
      updatedAt: now,
    },
    lineItems,
    customer: {
      id: 'cust',
      displayName: 'Cart and Tip Pty Ltd',
      email: null,
      phone: null,
      billingAddress: null,
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    businessProfile: {
      companyName: 'Quantum Hire Services Pty Ltd',
      legalName: 'Quantum Hire Services Pty Ltd',
      abnTaxId: '26641770130',
      address: null,
      email: 'info@quantumhireservices.com.au',
      phone: '0410760760',
      website: null,
      primaryColor: '#00162b',
      logoReference: null,
    },
    bankDetails: {
      accountName: 'Quantum Hire Services Pty Ltd',
      bsb: '012347',
      accountNumber: '814027296',
    },
    templateDesign: design,
  });

  const refPath = findRef();
  const outPdf = join(OUT, 'recreated-cart-n-tip-107.pdf');
  writeFileSync(outPdf, pdf);
  copyFileSync(refPath, join(OUT, 'original-reference.pdf'));

  execFileSync('pdftoppm', ['-png', '-r', String(DPI), refPath, join(OUT, 'original')], {
    stdio: 'pipe',
  });
  execFileSync('pdftoppm', ['-png', '-r', String(DPI), outPdf, join(OUT, 'recreated')], {
    stdio: 'pipe',
  });

  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  // Use system python for PIL diff to avoid sharp dependency
  const py = `
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageOps
from pathlib import Path
import json
out=Path(${JSON.stringify(OUT)})
dpi=${DPI}
ref=Image.open(out/'original-1.png').convert('RGB')
rec=Image.open(out/'recreated-1.png').convert('RGB')
# same scale canvas
w=max(ref.width, rec.width); h=max(ref.height, rec.height)
def pad(im):
  c=Image.new('RGB',(w,h),'white'); c.paste(im,(0,0)); return c
ref,rec=pad(ref),pad(rec)
side=Image.new('RGB',(w*2+40,h+50),'#f3f4f6')
side.paste(ref,(0,50)); side.paste(rec,(w+40,50))
d=ImageDraw.Draw(side)
d.text((10,15),'ORIGINAL Cart N Tip #107', fill='#111')
d.text((w+50,15),'RECREATED quantum-hire renderer (same data)', fill='#111')
side.save(out/'side-by-side.png')
diff=ImageChops.difference(ref,rec)
# amplify for visibility
amp=ImageEnhance.Brightness(diff).enhance(4.0)
amp.save(out/'diff-amplified.png')
# red overlay where different
overlay=ref.copy()
px_ref=ref.load(); px_rec=rec.load(); px_over=overlay.load()
changed=0; total=w*h
for y in range(h):
  for x in range(w):
    a=px_ref[x,y]; b=px_rec[x,y]
    if abs(a[0]-b[0])+abs(a[1]-b[1])+abs(a[2]-b[2]) > 30:
      changed+=1
      px_over[x,y]=(255,40,40)
blend=Image.blend(ref, overlay, 0.45)
blend.save(out/'diff-overlay.png')
# checker blend
mix=Image.new('RGB',(w,h))
px_mix=mix.load()
for y in range(h):
  for x in range(w):
    px_mix[x,y]=px_ref[x,y] if ((x//8)+(y//8))%2==0 else px_rec[x,y]
mix.save(out/'checker-blend.png')
pct=100.0*changed/total
stats={'dpi':dpi,'width':w,'height':h,'changedPixels':changed,'changedPercent':round(pct,3)}
(out/'diff-stats.json').write_text(json.dumps(stats, indent=2))
print(json.dumps(stats))
`
  writeFileSync(join(OUT, '_diff.py'), py);
  const stats = execFileSync('python3', [join(OUT, '_diff.py')], { encoding: 'utf8' });
  console.log(stats.trim());

  // Geometry check vs reference for key anchors
  const geomPy = `
import fitz, json
from pathlib import Path
out=Path(${JSON.stringify(OUT)})
ref=fitz.open(out/'original-reference.pdf')[0]
rec=fitz.open(out/'recreated-cart-n-tip-107.pdf')[0]

def anchors(page):
  want=('TAX INVOICE','BILL TO:','FROM:','PAYMENT DETAILS:','DATE','SUBTOTAL (EX GST):','PLEASE NOTE:')
  found={}
  for b in page.get_text('dict')['blocks']:
    if b.get('type')==1:
      found.setdefault('images',[]).append([round(v,1) for v in b['bbox']])
    if b.get('type')!=0: continue
    for line in b.get('lines',[]):
      t=''.join(s['text'] for s in line['spans']).strip()
      if t in want or t.startswith('INVOICE NUMBER'):
        found[t]=[round(v,1) for v in line['bbox']]
  return found
report={'ref':anchors(ref),'rec':anchors(rec),'deltas':{}}
for k,v in report['ref'].items():
  if k=='images': continue
  if k in report['rec']:
    report['deltas'][k]=[round(report['rec'][k][i]-v[i],1) for i in range(4)]
(out/'geometry-deltas.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report['deltas'], indent=2))
`
  writeFileSync(join(OUT, '_geom.py'), geomPy);
  console.log(execFileSync('python3', [join(OUT, '_geom.py')], { encoding: 'utf8' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
