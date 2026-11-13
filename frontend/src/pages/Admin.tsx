import { useEffect, useRef, useState } from 'react';
import {
  Copy, Check, Plus, Upload, FileSpreadsheet, Trash2, MapPin, X,
} from 'lucide-react';
import type { Device, Parameter } from '@/lib/data';
import { PARAMETERS, PARAM_META, formatValue, isDeviceOnline, supabase } from '@/lib/data';

function randomToken(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `dvc_${s}`;
}

function parseCsv(text: string): string[] {
  const rows: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      rows.push(cur);
      cur = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else cur += c;
  }
  rows.push(cur);
  return rows;
}

const HEADER_ALIASES: Record<string, Parameter> = {
  temperature: 'temperature', nhietdo: 'temperature', 'nhiệt độ': 'temperature',
  ph: 'ph',
  tds: 'tds', 'tds(ppm)': 'tds', do_dan: 'tds', 'độ dẫn': 'tds',
  turbidity: 'turbidity', doduc: 'turbidity', 'độ đục': 'turbidity',
};

export default function Admin() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [popup, setPopup] = useState<string | null>(null);
  const [stationLimit, setStationLimit] = useState(6);

  useEffect(() => {
    if (!popup) return;
    const t = setTimeout(() => setPopup(null), 3000);
    return () => clearTimeout(t);
  }, [popup]);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [newToken, setNewToken] = useState(randomToken());
  const [adding, setAdding] = useState(false);

  const [manualDevice, setManualDevice] = useState('');
  const [manualParam, setManualParam] = useState<Parameter>('temperature');
  const [manualValue, setManualValue] = useState('');
  const [manualTime, setManualTime] = useState(() => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [manualBusy, setManualBusy] = useState(false);

  const [csvDevice, setCsvDevice] = useState('');
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvParamRef = useRef<Parameter[]>([]);

  async function loadDevices() {
    const { data, error: err } = await supabase.from('devices').select('*').order('code');
    if (err) { setMessage({ kind: 'err', text: 'Không tải được danh sách trạm.' }); return; }
    setDevices((data ?? []) as Device[]);
    setLoading(false);
  }

  useEffect(() => { loadDevices(); }, []);

  async function addDevice() {
    if (!name.trim() || !code.trim()) {
      setMessage({ kind: 'err', text: 'Vui lòng nhập tên và mã trạm.' });
      return;
    }
    setAdding(true);
    const { error: err } = await supabase.from('devices').insert({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,
      token: newToken,
    });
    setAdding(false);
    if (err) {
      setMessage({ kind: 'err', text: err.code === '23505' ? 'Mã trạm đã tồn tại, vui lòng chọn mã khác.' : 'Không thể thêm trạm mới.' });
      return;
    }
    setMessage({ kind: 'ok', text: `Đã thêm trạm ${name.trim()} (${code.trim().toUpperCase()}).` });
    setPopup(`Đã thêm trạm mới ${name.trim()} thành công`);
    setShowAdd(false);
    setName(''); setCode(''); setLat(''); setLng('');
    setNewToken(randomToken());
    loadDevices();
  }

  async function removeDevice(device: Device) {
    if (!window.confirm(`Xóa trạm ${device.name}? Lịch sử số đo của trạm sẽ được giữ lại và vẫn tra cứu được bằng token.`)) return;
    const { error: err } = await supabase.from('devices').delete().eq('id', device.id);
    if (err) { setMessage({ kind: 'err', text: 'Không thể xóa trạm.' }); return; }
    setMessage({ kind: 'ok', text: `Đã xóa trạm ${device.name}. Dữ liệu đo được giữ lại.` });
    loadDevices();
  }

  async function addManual() {
    if (!manualDevice || manualValue === '') {
      setMessage({ kind: 'err', text: 'Vui lòng chọn trạm và nhập giá trị đo.' });
      return;
    }
    const value = Number(manualValue.replace(',', '.'));
    if (!Number.isFinite(value)) {
      setMessage({ kind: 'err', text: 'Giá trị đo không hợp lệ.' });
      return;
    }
    setManualBusy(true);
    const { error: err } = await supabase.from('measurements').insert({
      device_id: manualDevice,
      parameter: manualParam,
      value,
      measured_at: new Date(manualTime).toISOString(),
      source: 'manual',
    });
    setManualBusy(false);
    if (err) { setMessage({ kind: 'err', text: 'Không thể lưu số đo.' }); return; }
    setMessage({ kind: 'ok', text: `Đã lưu số đo ${formatValue(manualParam, value)}.` });
    setPopup(`Đã lưu số đo ${formatValue(manualParam, value)} thành công`);
    setManualValue('');
  }

  async function handleCsvFile(file: File) {
    if (!csvDevice) {
      setMessage({ kind: 'err', text: 'Vui lòng chọn trạm trước khi nhập file.' });
      return;
    }
    setCsvBusy(true);
    setCsvResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length < 2) throw new Error('File trống hoặc thiếu dữ liệu.');
      const header = parseCsv(lines[0]).map((h) => h.trim().toLowerCase());
      const timeIdx = header.findIndex((h) => ['thoi_diem', 'thời điểm', 'time', 'timestamp', 'measured_at'].includes(h));
      const paramCols: Array<{ idx: number; param: Parameter }> = [];
      header.forEach((h, idx) => {
        const p = HEADER_ALIASES[h];
        if (p) paramCols.push({ idx, param: p });
      });
      csvParamRef.current = paramCols.map((c) => c.param);
      if (timeIdx === -1 || paramCols.length === 0) {
        throw new Error('Cần có cột thời điểm (thoi_diem/time) và ít nhất một cột thông số (nhiệt độ, ph, tds, độ đục).');
      }
      const rows: Array<{ device_id: string; parameter: Parameter; value: number; measured_at: string; source: string }> = [];
      for (const line of lines.slice(1)) {
        const cells = parseCsv(line);
        const ts = Date.parse(cells[timeIdx]);
        if (Number.isNaN(ts)) continue;
        for (const { idx, param } of paramCols) {
          const raw = (cells[idx] ?? '').replace(',', '.').trim();
          if (raw === '') continue;
          const value = Number(raw);
          if (!Number.isFinite(value)) continue;
          rows.push({ device_id: csvDevice, parameter: param, value, measured_at: new Date(ts).toISOString(), source: 'manual' });
        }
      }
      if (rows.length === 0) throw new Error('Không tìm thấy dòng dữ liệu hợp lệ nào.');
      const { error: err } = await supabase.from('measurements').insert(rows);
      if (err) throw new Error('Không thể lưu dữ liệu vào hệ thống.');
      setCsvResult(`Đã nhập ${rows.length} số đo từ ${lines.length - 1} dòng file.`);
      setMessage({ kind: 'ok', text: 'Nhập file CSV thành công.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Lỗi đọc file.';
      setMessage({ kind: 'err', text: msg });
      setCsvResult(null);
    } finally {
      setCsvBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setMessage({ kind: 'ok', text: 'Đã sao chép token.' });
    } catch {
      setMessage({ kind: 'err', text: 'Không thể sao chép token.' });
    }
  }

  const selectedCsvDevice = devices.find((d) => d.id === csvDevice);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Quản trị hệ thống</h1>
        <p className="text-sm text-slate-500">Đăng ký trạm đo, quản lý token thiết bị và nhập dữ liệu thủ công</p>
      </div>

      {popup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setPopup(null)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-5 text-center">
            <div className="mx-auto w-11 h-11 rounded-full bg-teal-100 flex items-center justify-center mb-3">
              <Check size={22} className="text-teal-600" />
            </div>
            <p className="text-sm font-medium text-slate-800">{popup}</p>
            <button
              onClick={() => setPopup(null)}
              className="mt-4 w-full px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`rounded-lg border text-sm px-4 py-3 ${message.kind === 'ok' ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">Trạm quan trắc</h2>
            <p className="text-xs text-slate-500">Token dùng để thiết bị đẩy dữ liệu qua API</p>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <Plus size={15} /> Thêm trạm
          </button>
        </div>

        {showAdd && (
          <div className="px-4 py-4 bg-slate-50 border-b border-slate-100 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tên trạm *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Trạm Cửa Sốt"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Mã trạm *</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: SM-CS-01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Vĩ độ (lat)</label>
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="16.05"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Kinh độ (lng)</label>
              <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="108.2"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Token thiết bị</label>
              <div className="flex gap-1.5">
                <input readOnly value={newToken}
                  className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-600 font-mono" />
                <button onClick={() => setNewToken(randomToken())} title="Tạo token khác"
                  className="px-2.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-sm">↻</button>
              </div>
            </div>
            <div className="flex items-end">
              <button onClick={addDevice} disabled={adding}
                className="w-full px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors">
                {adding ? 'Đang lưu…' : 'Lưu trạm mới'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {devices.map((d) => {
                const online = isDeviceOnline(d);
                return (
                  <div key={d.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 text-sm truncate">{d.name}</span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${online ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        {d.code}
                        <MapPin size={11} />
                        {d.lat.toFixed(3)}, {d.lng.toFixed(3)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      <span className="font-mono text-xs text-slate-600 select-all">{d.token}</span>
                      <button onClick={() => copyToken(d.token)} className="text-slate-400 hover:text-teal-600" title="Sao chép token">
                        {<Copy size={13} />}
                      </button>
                    </div>
                    <button
                      onClick={() => removeDevice(d)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Xóa trạm"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
            {devices.length > stationLimit && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/60">
                <span className="text-xs text-slate-500">
                  Đang hiển thị {Math.min(stationLimit, devices.length)}/{devices.length} trạm
                </span>
                <input
                  type="range"
                  min={1}
                  max={devices.length}
                  value={stationLimit}
                  onChange={(e) => setStationLimit(Number(e.target.value))}
                  className="w-48 accent-teal-600"
                  title="Điều chỉnh số trạm hiển thị"
                />
                <button
                  onClick={() => setStationLimit(devices.length)}
                  className="text-xs font-medium text-teal-600 hover:text-teal-700"
                >
                  Hiện tất cả
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <h2 className="font-semibold text-slate-900">Nhập số đo thủ công</h2>
          <p className="text-xs text-slate-500 mb-3">Bổ sung dữ liệu cho trạm đo không tự động</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Trạm đo</label>
              <select value={manualDevice} onChange={(e) => setManualDevice(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">— Chọn trạm —</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Thông số</label>
              <select value={manualParam} onChange={(e) => setManualParam(e.target.value as Parameter)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                {PARAMETERS.map((p) => <option key={p} value={p}>{PARAM_META[p].label}{PARAM_META[p].unit ? ` (${PARAM_META[p].unit})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Thời điểm đo</label>
              <input type="datetime-local" value={manualTime} onChange={(e) => setManualTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Giá trị</label>
              <input value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="VD: 27.4"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div className="flex items-end">
              <button onClick={addManual} disabled={manualBusy}
                className="w-full px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors">
                {manualBusy ? 'Đang lưu…' : 'Lưu số đo'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <h2 className="font-semibold text-slate-900">Nhập từ file CSV</h2>
          <p className="text-xs text-slate-500 mb-3">
            Dòng đầu là tiêu đề cột: <span className="font-mono">thoi_diem, nhietdo, ph, tds, do_duc</span>.
            Ví dụ: <span className="font-mono">2026-11-12 08:00, 27.4, 8.1, 31200, 12.5</span>
          </p>
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-500 mb-1">Trạm áp dụng</label>
            <select value={csvDevice} onChange={(e) => setCsvDevice(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">— Chọn trạm —</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
          </div>
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 cursor-pointer hover:border-teal-400 hover:bg-teal-50/40 transition-colors">
            <FileSpreadsheet size={24} className="text-slate-400" />
            <span className="text-sm text-slate-600">
              {csvBusy ? 'Đang xử lý…' : 'Chọn hoặc kéo file CSV / Excel xuất ra CSV vào đây'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,.txt"
              className="hidden"
              disabled={csvBusy || !csvDevice}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFile(f);
              }}
            />
          </label>
          {csvResult && (
            <div className="mt-3 flex items-start gap-1.5 text-sm text-teal-700">
              <Check size={15} className="mt-0.5 shrink-0" /> {csvResult}
            </div>
          )}
          {selectedCsvDevice && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Upload size={12} /> Dữ liệu sẽ được ghi cho {selectedCsvDevice.name}, nguồn đánh dấu là thủ công.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
