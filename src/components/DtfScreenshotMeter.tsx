import React, { useState } from 'react';

type MeterRow = { filename: string; length: string; copies: string };
type OcrWindow = Window & { Tesseract?: any };
const parseFilename = (text: string): MeterRow | null => {
  const match = text.trim().replace(/,/g, '.').match(/^(\d+(?:\.\d{1,4})?)\s*(?:[x×*]\s*(\d+))?\s*(?:\.\s*(?:png|jpe?g|webp|tiff?))?$/i);
  if (!match || Number(match[1]) <= 0 || Number(match[2] || 1) <= 0) return null;
  return { filename: text.trim(), length: match[1], copies: match[2] || '1' };
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

export default function DtfScreenshotMeter({ onConfirm }: { onConfirm: (meters: number) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const total = rows.reduce((sum, row) => sum + (Number(row.length) || 0) * (Number(row.copies) || 0), 0);
  const valid = rows.length > 0 && rows.every(row => Number(row.length) > 0 && Number.isInteger(Number(row.copies)) && Number(row.copies) > 0);
  const edit = (index: number, field: keyof MeterRow, value: string) => {
    setReviewed(false);
    setRows(old => old.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };
  const scan = async (file?: File) => {
    if (!file) return;
    setBusy(true); setRows([]); setReviewed(false); setError('');
    let worker: any;
    let bitmap: ImageBitmap | undefined;
    try {
      const Tesseract = await loadOcr();
      worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.xXpngPNGjJeEgGbBpPtTiIfFwW× ' });
      bitmap = await createImageBitmap(file);
      const found: MeterRow[] = [];
      // Screenshot layout: 5 thumbnail columns, 2 rows. Crop only filename bands.
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 5; col++) {
          const canvas = document.createElement('canvas');
          const sx = Math.floor(bitmap.width * col / 5);
          const sw = Math.floor(bitmap.width / 5);
          const sy = Math.floor(bitmap.height * (row === 0 ? 0.35 : 0.87));
          const sh = Math.max(1, Math.floor(bitmap.height * (row === 0 ? 0.14 : 0.13)));
          canvas.width = sw * 3; canvas.height = sh * 3;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, sx, sy, Math.min(sw, bitmap.width - sx), Math.min(sh, bitmap.height - sy), 0, 0, canvas.width, canvas.height);
          const result = await worker.recognize(canvas);
          for (const line of String(result.data.text || '').split(/\r?\n/)) {
            const candidate = line.trim().match(/\d+(?:[.,]\d{1,4})?\s*(?:[x×*]\s*\d+)?\s*(?:\.\s*(?:png|jpe?g|webp|tiff?))?/i);
            const parsed = candidate ? parseFilename(candidate[0]) : null;
            if (parsed) { found.push(parsed); break; }
          }
        }
      }
      if (!found.length) throw new Error('Không đọc được tên file. Hãy thêm dòng và nhập thủ công.');
      setRows(found);
      if (found.length < 10) setError('Chỉ nhận diện được ' + found.length + ' file. Kiểm tra xem OCR có bỏ sót file nào không.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể đọc ảnh');
    } finally {
      bitmap?.close();
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  };
  return (
    <div className="sm:col-span-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-indigo-900">
        <input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setReviewed(false); }} />
        Tự tính toán bằng AI (OCR miễn phí)
      </label>
      {enabled && <>
        <p className="text-[10px] text-slate-600">Tải ảnh chụp danh sách file dạng 5 cột × 2 hàng. Không thay thế ảnh mẫu in.</p>
        <input type="file" accept="image/*" aria-label="Ảnh chụp tên file" disabled={busy} onChange={e => { void scan(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-xs" />
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
          <div className="flex justify-between text-xs font-bold"><span>Tổng ({rows.length} file)</span><span>{total.toFixed(4)} mét</span></div>
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
