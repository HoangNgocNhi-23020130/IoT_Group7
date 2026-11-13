import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { AlertTriangle, SearchCheck, Plus, X } from 'lucide-react';
import type { Device, Parameter } from '@/lib/data';
import { PARAMETERS, PARAM_META, PARAM_THRESHOLDS, supabase } from '@/lib/data';

const STATION_COLORS = ['#0d9488', '#0369a1', '#f97316', '#a16207', '#7c3aed', '#dc2626'];

function timeTick(v: string) {
  const d = new Date(v);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours()}h`;
}

interface Row {
  device_id: string;
  value: number;
  measured_at: string;
}

export default function Analysis() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [param, setParam] = useState<Parameter>('ph');
  const [hours, setHours] = useState(24 * 7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from('devices').select('*').order('code');
      if (err) { setError('Không tải được danh sách trạm.'); setLoading(false); return; }
      const list = (data ?? []) as Device[];
      setDevices(list);
      setSelected(list.slice(0, 3).map((d) => d.id));
    })();
  }, []);

  useEffect(() => {
    if (devices.length === 0 || selected.length === 0) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - hours * 3600 * 1000);

        const { data: qData, error: qErr } = await supabase
          .from('measurements')
          .select('device_id, parameter, value, measured_at')
          .eq('parameter', param)
          .in('device_id', selected)
          .gte('measured_at', from.toISOString())
          .lte('measured_at', to.toISOString())
          .order('measured_at', { ascending: true });
        if (qErr) throw qErr;
        if (!cancelled) setRows((qData ?? []) as Row[]);
      } catch {
        if (!cancelled) setError('Không tải được dữ liệu phân tích. Vui lòng thử lại.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [devices, selected, param, hours]);

  const meta = PARAM_META[param];
  const threshold = PARAM_THRESHOLDS[param];

  // Aggregate per selected station: stats + per-bucket series for the chart
  const { series, stationStats } = useMemo(() => {
    const bucketMs = hours > 24 * 3 ? 3 * 3600 * 1000 : 3600 * 1000;
    const buckets = new Map<string, Record<string, number | string>>();
    const byDevice = new Map<string, { vals: number[]; latest: number | null }>();
    for (const id of selected) byDevice.set(id, { vals: [], latest: null });

    for (const r of rows) {
      const entry = byDevice.get(r.device_id);
      if (!entry) continue;
      entry.vals.push(r.value);
      entry.latest = r.value;

      const bucketTs = Math.floor(new Date(r.measured_at).getTime() / bucketMs) * bucketMs;
      const key = new Date(bucketTs).toISOString();
      let row = buckets.get(key);
      if (!row) { row = { time: key }; buckets.set(key, row); }
      const dev = devices.find((d) => d.id === r.device_id);
      if (dev) row[dev.code] = r.value;
    }

    const stats = selected.map((id) => {
      const dev = devices.find((d) => d.id === id);
      const entry = byDevice.get(id);
      const vals = entry?.vals ?? [];
      const anomalyCount = vals.filter((v) => v < threshold.min || v > threshold.max).length;
      return {
        device: dev,
        count: vals.length,
        avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        latest: entry?.latest ?? null,
        anomalyRatio: vals.length ? anomalyCount / vals.length : 0,
      };
    }).filter((s) => s.device);

    return {
      series: Array.from(buckets.values()).sort((a, b) => String(a.time).localeCompare(String(b.time))),
      stationStats: stats,
    };
  }, [rows, selected, devices, hours, threshold]);

  const unselected = devices.filter((d) => !selected.includes(d.id));
  const suspicious = [...stationStats].sort((a, b) => b.anomalyRatio - a.anomalyRatio).slice(0, 2);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Phân tích nguyên nhân ô nhiễm</h1>
        <p className="text-sm text-slate-500">So sánh biến động thông số giữa các trạm và theo thời gian để nhận diện trạm bất thường</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Thông số phân tích</label>
          <select
            value={param}
            onChange={(e) => setParam(e.target.value as Parameter)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {PARAMETERS.map((p) => (
              <option key={p} value={p}>{PARAM_META[p].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Khoảng thời gian</label>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            {[
              { h: 24, label: '24 giờ' },
              { h: 24 * 3, label: '3 ngày' },
              { h: 24 * 7, label: '7 ngày' },
            ].map((r) => (
              <button
                key={r.h}
                onClick={() => setHours(r.h)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  hours === r.h ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-slate-500">
          Ngưỡng cho phép: <span className="font-medium text-slate-700">{threshold.min}–{threshold.max}{meta.unit ? ` ${meta.unit}` : ''}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-slate-900">Diễn biến {meta.label} theo từng trạm</h2>
          {unselected.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) setSelected((cur) => [...cur, e.target.value]);
                e.target.value = '';
              }}
              defaultValue=""
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">+ Thêm trạm</option>
              {unselected.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
          )}
        </div>
        {selected.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm text-slate-400">
            Chọn ít nhất một trạm để xem biểu đồ
          </div>
        ) : loading ? (
          <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
        ) : series.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-sm text-slate-400">Không có dữ liệu</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={50} />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  labelFormatter={(l) => `Thời điểm: ${new Date(String(l)).toLocaleString('vi-VN')}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend />
                {stationStats.map((s, i) => (
                  <Line
                    key={s.device!.id}
                    type="monotone"
                    dataKey={s.device!.code}
                    stroke={STATION_COLORS[i % STATION_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {stationStats.map((s, i) => (
            <span
              key={s.device!.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATION_COLORS[i % STATION_COLORS.length] }} />
              {s.device!.name}
              <button
                onClick={() => setSelected((cur) => cur.filter((id) => id !== s.device!.id))}
                className="text-slate-400 hover:text-red-500"
                title="Bớt trạm"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-slate-900">Mức độ bất thường theo trạm</h2>
            <p className="text-xs text-slate-500">
              Tỷ lệ số đo nằm ngoài ngưỡng cho phép trong khoảng thời gian đã chọn — trạm có tỷ lệ cao là dấu hiệu cần ưu tiên kiểm tra.
            </p>
          </div>
          {unselected.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) setSelected((cur) => [...cur, e.target.value]);
                e.target.value = '';
              }}
              defaultValue=""
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">+ Thêm trạm</option>
              {unselected.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
          )}
        </div>
        {stationStats.length === 0 ? (
          <div className="text-sm text-slate-400 py-4">Chọn trạm để xem mức độ bất thường</div>
        ) : (
          <div className="space-y-3">
            {stationStats.map((s) => {
              const pct = Math.round(s.anomalyRatio * 100);
              const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(meta.decimals));
              return (
                <div key={s.device!.id} className="flex items-center gap-3">
                  <div className="w-44 shrink-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{s.device!.name}</div>
                    <div className="text-[11px] text-slate-500">{s.device!.code}</div>
                  </div>
                  <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct > 30 ? 'bg-red-500' : pct > 5 ? 'bg-amber-500' : 'bg-teal-500'}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <div className="w-28 text-right text-sm tabular-nums">
                    <span className={`font-semibold ${pct > 30 ? 'text-red-600' : pct > 5 ? 'text-amber-600' : 'text-teal-600'}`}>{pct}%</span>
                    <span className="text-xs text-slate-400 ml-1">lệch</span>
                  </div>
                  <div className="hidden md:block w-44 text-right text-xs text-slate-500 tabular-nums">
                    {s.count > 0 ? `TB ${fmt(s.avg)} · ${fmt(s.min)}–${fmt(s.max)}` : 'Chưa có số đo'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {suspicious.length > 0 && suspicious[0].anomalyRatio > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <SearchCheck size={18} />
            Nhận định sơ bộ
          </div>
          <p className="mt-2 text-sm text-amber-800 leading-relaxed">
            Trạm <span className="font-semibold">{suspicious[0].device!.name}</span> ({suspicious[0].device!.code})
            có tỷ lệ số đo {meta.label.toLowerCase()} lệch ngưỡng cao nhất ({Math.round(suspicious[0].anomalyRatio * 100)}%)
            {suspicious[1] && suspicious[1].anomalyRatio > 0 && (
              <>, tiếp theo là {suspicious[1].device!.name} ({Math.round(suspicious[1].anomalyRatio * 100)}%)</>
            )}
            . So sánh diễn biến theo thời gian ở biểu đồ trên giữa trạm này và các trạm lân cận giúp suy đoán
            nguồn gây ô nhiễm: biến động đột biến cục bộ thường liên quan xả thải tại chỗ,
            còn biến động đồng loạt nhiều trạm nghiêng về nguyên nhân tự nhiên (thủy triều, thời tiết).
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <AlertTriangle size={13} />
            Chỉ mang tính gợi ý phân tích, cần kiểm chứng bằng khảo sát thực địa.
          </div>
        </div>
      )}
    </div>
  );
}
