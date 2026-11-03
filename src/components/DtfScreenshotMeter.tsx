import React, { useEffect, useRef, useState } from 'react';

type MeterRow = { filename: string; length: string; copies: string };
type OcrWindow = Window & { Tesseract?: any };
const parseFilename = (text: string): MeterRow | null => {
  // User-editable names: read the leading decimal length, and optional x multiplier.
  // OCR must still start with a decimal length, never a lone artwork digit.
  const match = text.trim().replace(/,/g, '.').match(/^(\d+\.\d{1,4})(?!\d)\s*(?:[x×*]\s*(\d+)(?!\d))?/i);
  if (!match) return null;
  const length = Number(match[1]);
  const copies = Number(match[2] || '1');
  if (!Number.isFinite(length) || length <= 0 || length > 100 || !Number.isInteger(copies) || copies < 1 || copies > 10000) return null;
  // Reject a dangling x without a valid number.
  const remainder = text.trim().replace(/,/g, '.').slice(match[0].length);
  if (/^\s*[x×*]/i.test(remainder)) return null;
  return { filename: text.trim(), length: match[1], copies: String(copies) };
};
const loadOcr = async (): Promise<any> => {
  const win = window as OcrWindow;
  if (win.Tesseract) return win.Tesseract;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dtf-ocr]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Không tải được OCR')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.dtfOcr = 'true';
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Không tải được OCR. Kiểm tra kết nối mạng.'));
    document.head.appendChild(script);
  });
  if (!win.Tesseract) throw new Error('OCR chưa sẵn sàng');
  return win.Tesseract;
};

export default function DtfScreenshotMeter({ sourceFiles }: { sourceFiles: File[] }) {
  const [enabled, setEnabled] = useState(false);
  const scanRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const lastScanned = useRef<string>('');
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const scanId = useRef(0);
  const [expectedCount, setExpectedCount] = useState('');
  const [columns, setColumns] = useState('5');
  const [sourceMode, setSourceMode] = useState<'ocr' | 'files'>('ocr');
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const readDirectFilenames = (files: File[]) => {
    scanId.current += 1;
    lastScanned.current = '';
    setBusy(false);
    setReviewed(false);
    setCopied(false);
    const pngs = files.filter(file => /\.png$/i.test(file.name));
    const accepted: MeterRow[] = [];
    const rejected: string[] = [];
    for (const file of pngs) {
      const parsed = parseFilename(file.name);
      if (parsed) accepted.push(parsed);
      else rejected.push(file.webkitRelativePath || file.name);
    }
    setRows(accepted);
    setRejectedNames(rejected);
    setExpectedCount(String(pngs.length));
    setError(rejected.length
      ? 'Có ' + rejected.length + ' file PNG không đọc được số M. Hãy đổi tên file hoặc kiểm tra trước khi xác nhận.'
      : pngs.length ? '' : 'Không tìm thấy file PNG trong lựa chọn.');
  };
  // Integer units of 0.0001m prevent floating point drift across many files.
  const totalUnits = rows.reduce((sum, row) => sum + Math.round((Number(row.length) || 0) * 10000) * (Number(row.copies) || 0), 0);
  const total = totalUnits / 10000;
  const valid = rejectedNames.length === 0 && rows.length > 0 && (expectedCount.trim() === '' || (Number.isInteger(Number(expectedCount)) && Number(expectedCount) > 0 && rows.length === Number(expectedCount))) && rows.every(row =>
      Number.isFinite(Number(row.length)) && Number(row.length) > 0 && Number(row.length) <= 100 &&
      Number.isInteger(Number(row.copies)) && Number(row.copies) > 0 && Number(row.copies) <= 10000
    );
  const edit = (index: number, field: keyof MeterRow, value: string) => {
    setReviewed(false);
    setCopied(false);
    setRows(old => old.map((row, i) => {
      if (i !== index) return row;
      if (field === 'filename') {
        const parsed = parseFilename(value);
        return parsed || { ...row, filename: value };
      }
      return { ...row, [field]: value };
    }));
  };
  const scan = async (files: File[]) => {
    if (!files.length) return;
    const currentScan = ++scanId.current;
    setBusy(true); setRows([]); setRejectedNames([]); setReviewed(false); setCopied(false); setError('');
    let worker: any;
    let bitmap: ImageBitmap | undefined;
    try {
      const Tesseract = await loadOcr();
      worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      const collected: MeterRow[] = [];
      for (const file of files) {
      bitmap = await createImageBitmap(file);
      const colCount = Math.max(1, Math.min(10, Number(columns) || 5));
      const found: { row: MeterRow; column: number; y: number }[] = [];
      // Scan the ENTIRE height of each column: works with 2, 3 or more thumbnail rows.
      // OCR accepts decimal-leading names with optional x multiplier; reject artwork-only integers.
      for (let col = 0; col < colCount; col++) {
        const sx = Math.floor(bitmap.width * col / colCount);
        const sw = Math.max(1, Math.floor(bitmap.width * (col + 1) / colCount) - sx);
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = sw * scale;
        canvas.height = bitmap.height * scale;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) continue;
        ctx.drawImage(bitmap, sx, 0, sw, bitmap.height, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Finder dark theme: convert light filename text to dark-on-white for Tesseract.
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
          const bright = (r * 299 + g * 587 + b * 114) / 1000;
          const v = bright > 145 ? 0 : 255;
          pixels.data[i] = v; pixels.data[i + 1] = v; pixels.data[i + 2] = v;
        }
        ctx.putImageData(pixels, 0, 0);
        const result = await worker.recognize(canvas);
        const lines: { text: string; bbox?: { y0: number } }[] = result.data.lines || [];
        const candidates = lines.length
          ? lines.map(line => ({ text: line.text, y: line.bbox?.y0 ?? -1 }))
          : String(result.data.text || '').split(/\r?\n/).map((text, i) => ({ text, y: i * 100 }));
        for (const candidate of candidates) {
          const text = candidate.text.trim().replace(/\s+/g, ' ');
          // Require the line to START with decimal metres, but do not require .png.
          const match = text.match(/^\d+\s*[.,]\s*\d{1,4}(?:\s*[x×*]\s*\d+)?(?:\s*\.\s*(?:png|jpe?g|webp|tiff?))?/i);
          if (!match) continue;
          const normalized = match[0].replace(/\s*([.,])\s*/g, '$1');
          const parsed = parseFilename(normalized);
          if (!parsed) continue;
          // Keep legitimate repeated filenames in DIFFERENT screenshot rows.
          if (found.some(item => item.column === col && Math.abs(item.y - candidate.y) < 35)) continue;
          found.push({ row: parsed, column: col, y: candidate.y });
        }
      }
      found.sort((a, b) => Math.floor(a.y / 120) - Math.floor(b.y / 120) || a.column - b.column);
      collected.push(...found.map(item => item.row));
      bitmap.close(); bitmap = undefined;
      }
      if (currentScan !== scanId.current) return;
      setRows(collected);
      if (!collected.length) setError('Chưa nhận diện được tên file. Có thể thêm dòng và nhập số M thủ công.');
      else setError('OCR nhận diện ' + collected.length + ' file từ ' + files.length + ' ảnh. Kiểm tra và bổ sung file thiếu trước khi xác nhận.');
    } catch (e) {
      if (currentScan === scanId.current) setError(e instanceof Error ? e.message : 'Không thể đọc ảnh');
    } finally {
      bitmap?.close();
      if (worker) await worker.terminate().catch(() => {});
      if (currentScan === scanId.current) setBusy(false);
    }
  };
  scanRef.current = scan;
  const fileSignature = sourceFiles.map(f => f.name + ':' + f.size + ':' + f.lastModified).join('|');
  useEffect(() => {
    if (!enabled || sourceMode !== 'ocr' || !sourceFiles.length || lastScanned.current === fileSignature) return;
    lastScanned.current = fileSignature;
    void scanRef.current(sourceFiles);
  }, [enabled, sourceMode, fileSignature]);
  useEffect(() => {
    if (!sourceFiles.length && sourceMode === 'ocr') {
      scanId.current += 1;
      lastScanned.current = '';
      setRows([]); setReviewed(false); setCopied(false); setBusy(false);
    }
  }, [fileSignature, sourceFiles.length, sourceMode]);
  return (
    <div className="sm:col-span-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
      <button type="button" onClick={() => { setEnabled(value => !value); setReviewed(false); setCopied(false); }} className="w-full text-left text-xs font-bold text-indigo-900 disabled:opacity-50 flex items-center gap-2" aria-expanded={enabled}>
        <span aria-hidden="true" className="text-lg">∑</span>
        <span>Cộng số M từ hình ảnh đơn hàng</span>
        <span className="ml-auto">{enabled ? 'Thu gọn ▲' : 'Mở công cụ ▼'}</span>
      </button>

      {enabled && <>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setSourceMode('ocr'); setRows([]); setRejectedNames([]); setExpectedCount(''); setReviewed(false); lastScanned.current = ''; }}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${sourceMode === 'ocr' ? 'bg-indigo-700 text-white' : 'bg-white border text-slate-700'}`}>Đọc ảnh chụp (OCR)</button>
          <button type="button" onClick={() => { setSourceMode('files'); setRows([]); setRejectedNames([]); setExpectedCount(''); setError(''); setReviewed(false); scanId.current += 1; }}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${sourceMode === 'files' ? 'bg-indigo-700 text-white' : 'bg-white border text-slate-700'}`}>Đọc tên file PNG trực tiếp</button>
        </div>
        {sourceMode === 'files' && <div className="space-y-2 rounded border border-indigo-200 bg-white p-2">
          <p className="text-xs text-slate-700">Chọn thư mục PNG hoặc chọn nhiều file PNG. Chỉ đọc tên file trên thiết bị, không tải nội dung file lên máy chủ.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => folderInputRef.current?.click()}>Chọn thư mục PNG</button>
            <button type="button" className="rounded border border-blue-700 px-3 py-1.5 text-xs font-semibold text-blue-700" onClick={() => filesInputRef.current?.click()}>Chọn nhiều file PNG</button>
          </div>
          <input ref={folderInputRef} type="file" multiple accept=".png,image/png" className="hidden"
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={e => { readDirectFilenames(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <input ref={filesInputRef} type="file" multiple accept=".png,image/png" className="hidden"
            onChange={e => { readDirectFilenames(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <p className="text-[10px] text-amber-700">Chọn đúng thư mục của đơn hàng. Nếu thư mục có thư mục con, các file PNG bên trong cũng có thể được tính.</p>
          {rejectedNames.length > 0 && <div role="alert" className="rounded border border-rose-200 p-2 text-xs text-rose-700">
            <p className="font-bold">File không đọc được số M ({rejectedNames.length}) — chưa thể xác nhận:</p>
            <ul className="list-disc pl-4">{rejectedNames.map((name, i) => <li key={i}>{name}</li>)}</ul>
          </div>}
        </div>}
        {sourceMode === 'ocr' && <>
        <p className="text-[10px] text-slate-600">Đang tính gộp {sourceFiles.length} ảnh đã tải lên trong đơn hàng. Không cần tải lại.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Tổng số file thực tế (tất cả ảnh, không bắt buộc)
            <input type="number" min="1" step="1" value={expectedCount} onChange={e => { setExpectedCount(e.target.value); setReviewed(false); setCopied(false); }} placeholder="Để trống nếu chưa đếm" className="block w-full border rounded p-1" />
          </label>
          <label className="text-xs">Số cột ảnh
            <select value={columns} onChange={e => { setColumns(e.target.value); lastScanned.current = ''; setRows([]); setReviewed(false); setCopied(false); }} className="block w-full border rounded p-1">
              {[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} cột</option>)}
            </select>
          </label>
        </div>
        <p className="text-[10px] font-semibold text-amber-800">OCR chỉ hỗ trợ đọc nhanh, không đảm bảo nhận đủ hoặc đúng mọi file. Đối chiếu tên, số lần và tổng số file với ảnh gốc trước khi xác nhận.</p>
        {busy && <p role="status" className="text-xs text-blue-700">Đang đọc tên file bằng OCR trên trình duyệt...</p>}
        {error && <p role="alert" className="text-xs text-amber-700">{error}</p>}
        </>}
        {(rows.length > 0 || error) && <>
          <div className="max-h-52 overflow-y-auto space-y-1">
            {rows.map((row, i) => <div key={i} className="grid grid-cols-[1fr_70px_55px_60px_18px] gap-1 items-center">
              <input aria-label={'Tên file ' + (i + 1)} className="min-w-0 rounded border p-1 text-[10px]" value={row.filename} onChange={e => edit(i, 'filename', e.target.value)} />
              <input aria-label={'Mét ' + (i + 1)} type="number" min="0.0001" step="any" className="min-w-0 rounded border p-1 text-[10px]" value={row.length} onChange={e => edit(i, 'length', e.target.value)} />
              <input aria-label={'Số lần ' + (i + 1)} type="number" min="1" step="1" className="min-w-0 rounded border p-1 text-[10px]" value={row.copies} onChange={e => edit(i, 'copies', e.target.value)} />
              <span className="text-[10px] text-right">{((Number(row.length) || 0) * (Number(row.copies) || 0)).toFixed(3)}m</span>
              <button type="button" aria-label="Xóa dòng" onClick={() => { setRows(old => old.filter((_, j) => j !== i)); setReviewed(false); setCopied(false); }} className="text-rose-600">×</button>
            </div>)}
          </div>
          <button type="button" className="text-xs font-bold text-blue-700" onClick={() => { setRows(old => [...old, { filename: '', length: '', copies: '1' }]); setReviewed(false); setCopied(false); }}>+ Thêm file bị bỏ sót</button>
          <div className="flex justify-between text-xs font-bold"><span>Tổng ({rows.length}{expectedCount.trim() ? '/' + expectedCount : ''} file)</span><span>{total.toFixed(4)} mét</span></div>
          {!valid && <p role="alert" className="text-xs text-red-700">Chưa thể xác nhận: kiểm tra các ô Mét / Số lần, và số file thực tế nếu đã nhập. Có thể sửa tên file tự do; kiểm tra kỹ các dòng OCR nhận sai.</p>}
          <label className="flex items-center gap-2 text-xs font-bold text-emerald-800">
            <input type="checkbox" disabled={!valid || busy} checked={reviewed} onChange={e => {
              if (e.target.checked && valid) {
                setReviewed(true);
              } else setReviewed(false);
            }} />
            Đã kiểm tra đủ file — xác nhận kết quả (không tự nhập đơn)
          </label>
          {reviewed && <div className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 p-2">
            <span className="text-sm font-bold text-emerald-800">Tổng đơn: {total.toFixed(4)} mét</span>
            <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white" onClick={() => {
              void navigator.clipboard.writeText(String(Math.round(total * 10000) / 10000)).then(() => setCopied(true)).catch(() => setError('Không thể sao chép tự động. Hãy nhập số mét hiển thị vào ô thủ công.'));
            }}>{copied ? 'Đã sao chép' : 'Sao chép số M'}</button>
          </div>}
        </>}
      </>}
    </div>
  );
}
