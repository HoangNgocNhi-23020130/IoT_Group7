import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Download, Search, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { Device, Measurement, Parameter } from '@/lib/data';
import {
  PARAMETERS, PARAM_META, formatValue, supabase,
} from '@/lib/data';

const RANGES: Array<{ id: string; label: string; hours: number }> = [
  { id: '6h', label: '6 giờ', hours: 6 },
  { id: '24h', label: '24 giờ', hours: 24 },
  { id: '7d', label: '7 ngày', hours: 24 * 7 },
  { id: '30d', label: '30 ngày', hours: 24 * 30 },
];

function timeTick(v: string, rangeHours: number) {
  const d = new Date(v);
  if (rangeHours <= 24) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours()}h`;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

interface HistoryRow {
  device_code: string;
  device_name: string;
  parameter: string;
  value: number;
  measured_at: string;
  source: string;
  deleted: boolean;
}

export default function HistoryPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [rangeId, setRangeId] = useState('24h');
  const [activeParams, setActiveParams] = useState<Parameter[]>([...PARAMETERS]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewWindow, setViewWindow] = useState<{ start: number; end: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const [lookupToken, setLookupToken] = useState('');
  const [lookupFrom, setLookupFrom] = useState(() => {
    const d = new Date(Date.now() - 24 * 3600 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [lookupTo, setLookupTo] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 16);
  });
  const [lookupRows, setLookupRows] = useState<HistoryRow[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState(100);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from('devices').select('*').order('code');
      if (err) { setError('Không tải được danh sách trạm.'); return; }
      const list = (data ?? []) as Device[];
      setDevices(list);
      setDeviceId((cur) => cur || list[0]?.id || '');
    })();
  }, []);

  const range = RANGES.find((r) => r.id === rangeId)!;

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    setViewWindow(null);
    setZoomPct(100);
    try {
      const { data, error: err } = await supabase.rpc('get_measurements_history', {
        p_device_id: deviceId,
        p_from: new Date(Date.now() - range.hours * 3600 * 1000).toISOString(),
        p_to: new Date().toISOString(),
      });
      if (err) throw err;
      setMeasurements((data ?? []) as Measurement[]);
    } catch {
      setError('Không tải được dữ liệu lịch sử. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [deviceId, range]);

  useEffect(() => { load(); }, [load]);

  const chartData = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const m of measurements) {
      if (!activeParams.includes(m.parameter)) continue;
      const key = m.measured_at;
      let row = byTime.get(key);
      if (!row) { row = { time: key }; byTime.set(key, row); }
      row[m.parameter] = m.value;
    }
    return Array.from(byTime.values()).sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
  }, [measurements, activeParams]);

  // Zoom: map viewWindow over chartData, tightened by zoomPct around the center
  const zoomedData = useMemo(() => {
    if (chartData.length === 0) return chartData;
    let start = 0;
    let end = chartData.length - 1;
    if (viewWindow) {
      const times = chartData.map((r) => new Date(String(r.time)).getTime());
      start = times.findIndex((t) => t >= viewWindow.start);
      end = times.findIndex((t) => t > viewWindow.end);
      if (start === -1) start = 0;
      if (end === -1) end = chartData.length - 1;
      end = Math.max(end, start);
    }
    const slice = chartData.slice(start, end + 1);
    if (zoomPct >= 100) return slice;
    const keep = Math.max(2, Math.round((slice.length * zoomPct) / 100));
    const drop = slice.length - keep;
    const head = Math.floor(drop / 2);
    return slice.slice(head, head + keep);
  }, [chartData, viewWindow, zoomPct]);

  const correlations = useMemo(() => {
    const byParam = new Map<Parameter, Map<string, number>>();
    for (const m of measurements) {
      if (!activeParams.includes(m.parameter)) continue;
      let inner = byParam.get(m.parameter);
      if (!inner) { inner = new Map(); byParam.set(m.parameter, inner); }
      inner.set(m.measured_at, m.value);
    }
    const out: Array<{ a: Parameter; b: Parameter; r: number }> = [];
    const shown = PARAMETERS.filter((p) => activeParams.includes(p));
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i], b = shown[j];
        const mapA = byParam.get(a) ?? new Map();
        const mapB = byParam.get(b) ?? new Map();
        const times = Array.from(mapA.keys()).filter((t) => mapB.has(t)).sort();
        const r = pearson(times.map((t) => mapA.get(t)!), times.map((t) => mapB.get(t)!));
        out.push({ a, b, r });
      }
    }
    return out;
  }, [measurements, activeParams]);

  const device = devices.find((d) => d.id === deviceId);
  const shownParams = PARAMETERS.filter((p) => activeParams.includes(p));

  function toggleParam(p: Parameter) {
    setActiveParams((cur) =>
      cur.includes(p) ? (cur.length > 1 ? cur.filter((x) => x !== p) : cur) : [...cur, p],
    );
  }

  function exportCsv() {
    const header = ['thoi_diem', ...shownParams.map((p) => PARAM_META[p].label)];
    const lines = [header.join(',')];
    for (const row of chartData) {
      lines.push([
        new Date(String(row.time)).toLocaleString('vi-VN'),
        ...shownParams.map((p) => (row[p] !== undefined ? String(row[p]) : '')),
      ].join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seamonitor_${device?.code ?? 'device'}_${rangeId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runLookup() {
    if (!lookupToken.trim()) {
      setLookupError('Vui lòng nhập token.');
      return;
    }
    const from = new Date(lookupFrom);
    const to = new Date(lookupTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      setLookupError('Khoảng thời gian không hợp lệ.');
      return;
    }
    setLookupBusy(true);
    setLookupError(null);
    setRowLimit(100);
    try {
      const { data, error: err } = await supabase.rpc('lookup_history_by_token', {
        p_token: lookupToken.trim(),
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (err) throw err;
      const rows = (data ?? []) as HistoryRow[];
      setLookupRows(rows);
      if (rows.length === 0) setLookupError('Không tìm thấy số đo nào trong khoảng thời gian này.');
    } catch (e) {
      setLookupRows(null);
      setLookupError(e instanceof Error && e.message ? e.message : 'Lỗi tra cứu. Vui lòng thử lại.');
    } finally {
      setLookupBusy(false);
    }
  }

  const lookupParamCols = useMemo(() => {
    if (!lookupRows) return [];
    return PARAMETERS.filter((p) => lookupRows.some((r) => r.parameter === p));
  }, [lookupRows]);

  const lookupPivot = useMemo(() => {
    if (!lookupRows) return [] as Array<Record<string, number | string | boolean>>;
    const byTime = new Map<string, Record<string, number | string | boolean>>();
    for (const r of lookupRows) {
      let row = byTime.get(r.measured_at);
      if (!row) { row = { time: r.measured_at, source: r.source, deleted: r.deleted }; byTime.set(r.measured_at, row); }
      row[r.parameter] = r.value;
    }
    return Array.from(byTime.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [lookupRows]);

  const lookupShown = lookupPivot.slice(0, rowLimit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Lịch sử dữ liệu</h1>
        <p className="text-sm text-slate-500">Tra cứu xu hướng từng thông số, tương quan thông số và tra cứu lịch sử theo token thiết bị</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Trạm đo</label>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Khoảng thời gian</label>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRangeId(r.id)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  rangeId === r.id ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={exportCsv}
          disabled={chartData.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          <Download size={15} /> Xuất CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PARAMETERS.map((p) => {
          const meta = PARAM_META[p];
          const active = activeParams.includes(p);
          return (
            <button
              key={p}
              onClick={() => toggleParam(p)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                active ? 'border-transparent text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              style={active ? { backgroundColor: meta.color } : undefined}
            >
              <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : ''}`} style={!active ? { backgroundColor: meta.color } : undefined} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold text-slate-900">
            Xu hướng thông số {device ? `· ${device.name}` : ''}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoomPct((v) => Math.max(10, Math.round(v / 1.4)))}
              disabled={zoomedData.length < 4}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              title="Thu nhỏ trục thời gian (thêm chi tiết)"
            >
              <ZoomIn size={13} /> Phóng to
            </button>
            <button
              onClick={() => setZoomPct((v) => Math.min(100, v * 1.4))}
              disabled={zoomPct >= 100}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              title="Giãn trục thời gian"
            >
              <ZoomOut size={13} /> Thu nhỏ
            </button>
            <button
              onClick={() => { setZoomPct(100); setViewWindow(null); }}
              disabled={zoomPct >= 100 && !viewWindow}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              <RotateCcw size={13} /> Đặt lại
            </button>
            <span className="text-xs text-slate-400 w-10 text-right">{Math.round(zoomPct)}%</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Dùng các nút phóng to/thu nhỏ để co giãn trục thời gian. {loading && <span className="ml-1 text-teal-600">Đang tải…</span>}
        </p>
        {chartData.length === 0 && !loading ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-400">
            Không có dữ liệu trong khoảng thời gian này
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={zoomedData} margin={{ top: 5, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="time"
                  domain={zoomedData.length > 0 ? ['dataMin', 'dataMax'] : undefined}
                  tickFormatter={(v: string) => timeTick(v, range.hours)}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  minTickGap={zoomPct < 60 ? 24 : 50}
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  formatter={(v, name) => [formatValue(name as Parameter, v as number), PARAM_META[name as Parameter].label]}
                  labelFormatter={(l) => `Thời điểm: ${new Date(String(l)).toLocaleString('vi-VN')}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend formatter={(v) => PARAM_META[v as Parameter].label} />
                {shownParams.map((p) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={PARAM_META[p].color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <h2 className="font-semibold text-slate-900">Tương quan giữa các thông số</h2>
        <p className="text-xs text-slate-500 mb-3">
          Hệ số tương quan Pearson (từ -1 đến 1): gần 1 đồng biến mạnh, gần -1 nghịch biến mạnh — hỗ trợ suy đoán nguyên nhân ô nhiễm.
        </p>
        {correlations.length === 0 ? (
          <div className="text-sm text-slate-400 py-4">Chọn ít nhất hai thông số để xem tương quan</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {correlations.map(({ a, b, r }) => {
              const strength = Math.abs(r);
              const label = strength > 0.7 ? 'Rất mạnh' : strength > 0.4 ? 'Trung bình' : strength > 0.2 ? 'Yếu' : 'Không đáng kể';
              const barColor = r >= 0 ? PARAM_META[b].color : '#dc2626';
              return (
                <div key={`${a}-${b}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {PARAM_META[a].shortLabel} ↔ {PARAM_META[b].shortLabel}
                    </span>
                    <span className="font-semibold tabular-nums">{r.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, strength * 100)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500">{label} · {r >= 0 ? 'đồng biến' : 'nghịch biến'}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <h2 className="font-semibold text-slate-900">Tra cứu lịch sử theo token</h2>
        <p className="text-xs text-slate-500 mb-3">
          Tra toàn bộ số đo của một thiết bị theo token — kể cả những trạm đã xóa hoặc ngắt kết nối.
        </p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Token thiết bị</label>
            <input
              value={lookupToken}
              onChange={(e) => setLookupToken(e.target.value)}
              placeholder="VD: dvc_k3p9wnc5vzf1"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Từ</label>
            <input
              type="datetime-local"
              value={lookupFrom}
              onChange={(e) => setLookupFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Đến</label>
            <input
              type="datetime-local"
              value={lookupTo}
              onChange={(e) => setLookupTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <button
            onClick={runLookup}
            disabled={lookupBusy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <Search size={14} /> {lookupBusy ? 'Đang tra…' : 'Tra cứu'}
          </button>
        </div>

        {lookupError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-3">{lookupError}</div>
        )}

        {lookupRows && lookupRows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs text-slate-500">
                Tìm thấy <span className="font-semibold text-slate-700">{lookupRows.length}</span> số đo
                {lookupRows[0].deleted && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[11px] font-medium">
                    Trạm đã xóa
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Số dòng hiển thị</label>
                <input
                  type="range"
                  min={20}
                  max={Math.max(lookupPivot.length, 20)}
                  value={rowLimit}
                  onChange={(e) => setRowLimit(Number(e.target.value))}
                  className="w-40 accent-teal-600"
                />
                <span className="text-xs tabular-nums text-slate-600 w-12 text-right">{Math.min(rowLimit, lookupPivot.length)}</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Thời điểm</th>
                    {lookupParamCols.map((p) => (
                      <th key={p} className="px-4 py-2.5 font-medium text-right">
                        {PARAM_META[p].shortLabel}
                        {PARAM_META[p].unit ? <span className="text-slate-400"> ({PARAM_META[p].unit})</span> : null}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 font-medium">Nguồn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lookupShown.map((row) => (
                    <tr key={String(row.time)} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 text-slate-700 tabular-nums whitespace-nowrap">
                        {new Date(String(row.time)).toLocaleString('vi-VN')}
                      </td>
                      {lookupParamCols.map((p) => (
                        <td key={p} className="px-4 py-2 text-right tabular-nums text-slate-800">
                          {row[p] !== undefined ? (row[p] as number).toFixed(PARAM_META[p].decimals) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-2">
                        <span className={`text-[11px] rounded-full px-2 py-0.5 ${row.source === 'auto' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                          {row.source === 'auto' ? 'Tự động' : 'Thủ công'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lookupPivot.length > lookupShown.length && (
              <p className="mt-2 text-xs text-slate-400">
                Hiển thị {lookupShown.length}/{lookupPivot.length} dòng — kéo thanh trượt để xem thêm.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
