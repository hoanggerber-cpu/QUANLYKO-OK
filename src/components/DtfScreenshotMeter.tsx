import React, { useEffect, useRef, useState } from 'react';

type MeterRow = { filename: string; length: string; copies: string };
type OcrWindow = Window & { Tesseract?: any };
const parseFilename = (text: string): MeterRow | null => {
  // Require decimal metres AND a complete image extension: never accept "7" as 7 metres.
  const match = text.trim().replace(/,/g, '.').match(/^(\d+\.\d{1,4})\s*(?:[x×*]\s*(\d+))?\s*\.\s*(png|jpe?g|webp|tiff?)$/i);
  if (!match) return null;
  const length = Number(match[1]);
  const copies = Number(match[2] || '1');
  if (!Number.isFinite(length) || length <= 0 || length > 100 || !Number.isInteger(copies) || copies < 1 || copies > 10000) return null;
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

export default function DtfScreenshotMeter({ onConfirm, sourceFile }: { onConfirm: (meters: number) => void; sourceFile?: File }) {
  const [enabled, setEnabled] = useState(false);
  const scanRef = useRef<(file?: File) => Promise<void>>(async () => {});
  const lastScanned = useRef<File | undefined>(undefined);
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [expectedCount, setExpectedCount] = useState('');
  const [columns, setColumns] = useState('5');
  const total = rows.reduce((sum, row) => sum + (Number(row.length) || 0) * (Number(row.copies) || 0), 0);
  const valid = Number.isInteger(Number(expectedCount)) && Number(expectedCount) > 0 &&
    rows.length === Number(expectedCount) && rows.every(row => {
      const parsed = parseFilename(row.filename);
      return !!parsed && Number(row.length) > 0 && Number.isInteger(Number(row.copies)) &&
        Number(row.copies) > 0 && Number(row.length) <= 100;
    });
  const edit = (index: number, field: keyof MeterRow, value: string) => {
    setReviewed(false);
    setRows(old => old.map((row, i) => {
      if (i !== index) return row;
      if (field === 'filename') {
        const parsed = parseFilename(value);
        return parsed || { ...row, filename: value };
      }
      return { ...row, [field]: value };
    }));
  };
  const scan = async (file?: File) => {
    if (!file) return;
    setBusy(true); setRows([]); setReviewed(false); setError('');
    let worker: any;
    let bitmap: ImageBitmap | undefined;
    try {
      const Tesseract = await loadOcr();
      worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      bitmap = await createImageBitmap(file);
      const colCount = Math.max(1, Math.min(10, Number(columns) || 5));
      const found: { row: MeterRow; column: number; y: number }[] = [];
      // Scan the ENTIRE height of each column: works with 2, 3 or more thumbnail rows.
      // OCR only accepts complete decimal filename + extension, never artwork numerals.
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
          // Reject any line without a full filename extension.
          const match = text.match(/\d+\s*[.,]\s*\d{1,4}\s*(?:[x×*]\s*\d+)?\s*\.\s*(?:png|jpe?g|webp|tiff?)/i);
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
      setRows(found.map(item => item.row));
      if (!found.length) setError('OCR chưa đọc được tên file hợp lệ. Hãy kiểm tra số cột hoặc nhập tên file thủ công.');
      else setError('OCR nhận diện ' + found.length + ' file. Đối chiếu với số file thực tế và bổ sung file thiếu trước khi xác nhận.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể đọc ảnh');
    } finally {
      bitmap?.close();
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  };
  scanRef.current = scan;
  useEffect(() => {
    if (!enabled || !sourceFile || lastScanned.current === sourceFile) return;
    lastScanned.current = sourceFile;
    void scanRef.current(sourceFile);
  }, [enabled, sourceFile]);
  return (
    <div className="sm:col-span-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-indigo-900">
        <input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setReviewed(false); if (!e.target.checked) lastScanned.current = undefined; }} />
        Tự tính toán bằng AI (OCR miễn phí)
      </label>
      {enabled && <>
        <p className="text-[10px] text-slate-600">{sourceFile ? 'Đang dùng ảnh đã nhập ở phía trên: ' + sourceFile.name : 'Hãy tải hoặc Ctrl+V ảnh chụp vào ô Upload Hình Ảnh phía trên. Chỉ cần nhập ảnh một lần.'}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Số file thực tế trong ảnh
            <input type="number" min="1" step="1" value={expectedCount} onChange={e => { setExpectedCount(e.target.value); setReviewed(false); }} placeholder="Ví dụ: 14" className="block w-full border rounded p-1" />
          </label>
          <label className="text-xs">Số cột ảnh
            <select value={columns} onChange={e => { setColumns(e.target.value); lastScanned.current = undefined; setRows([]); setReviewed(false); }} className="block w-full border rounded p-1">
              {[3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} cột</option>)}
            </select>
          </label>
        </div>
        {busy && <p role="status" className="text-xs text-blue-700">Đang đọc tên file bằng OCR trên trình duyệt...</p>}
        {error && <p role="alert" className="text-xs text-amber-700">{error}</p>}
        {(rows.length > 0 || error) && <>
          <div className="max-h-52 overflow-y-auto space-y-1">
            {rows.map((row, i) => <div key={i} className="grid grid-cols-[1fr_70px_55px_60px_18px] gap-1 items-center">
              <input aria-label={'Tên file ' + (i + 1)} className="min-w-0 rounded border p-1 text-[10px]" value={row.filename} onChange={e => edit(i, 'filename', e.target.value)} />
              <input aria-label={'Mét ' + (i + 1)} type="number" min="0.0001" step="any" className="min-w-0 rounded border p-1 text-[10px]" value={row.length} onChange={e => edit(i, 'length', e.target.value)} />
              <input aria-label={'Số lần ' + (i + 1)} type="number" min="1" step="1" className="min-w-0 rounded border p-1 text-[10px]" value={row.copies} onChange={e => edit(i, 'copies', e.target.value)} />
              <span className="text-[10px] text-right">{((Number(row.length) || 0) * (Number(row.copies) || 0)).toFixed(3)}m</span>
              <button type="button" aria-label="Xóa dòng" onClick={() => { setRows(old => old.filter((_, j) => j !== i)); setReviewed(false); }} className="text-rose-600">×</button>
            </div>)}
          </div>
          <button type="button" className="text-xs font-bold text-blue-700" onClick={() => { setRows(old => [...old, { filename: '', length: '', copies: '1' }]); setReviewed(false); }}>+ Thêm file bị bỏ sót</button>
          <div className="flex justify-between text-xs font-bold"><span>Tổng ({rows.length}/{expectedCount || '?'} file)</span><span>{total.toFixed(4)} mét</span></div>
          {!valid && <p role="alert" className="text-xs text-red-700">Chưa thể xác nhận: cần đủ số file thực tế và tên file hợp lệ (ví dụ 0.31 x 28.png). Không chấp nhận các dòng chỉ có số 7 hoặc 8.</p>
          <label className="flex items-center gap-2 text-xs font-bold text-emerald-800">
            <input type="checkbox" disabled={!valid || busy} checked={reviewed} onChange={e => {
              if (e.target.checked && valid) {
                // Each row already includes its repetition count; parent quantity becomes 1.
                onConfirm(Math.round(total * 10000) / 10000);
                setReviewed(true);
              } else setReviewed(false);
            }} />
            Đã kiểm tra đủ file — điền tổng vào Chiều dài
          </label>
        </>}
      </>}
    </div>
  );
}
