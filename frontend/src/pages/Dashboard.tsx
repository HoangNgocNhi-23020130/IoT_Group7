import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, Legend,
} from 'recharts';
import { Activity, AlertTriangle, TrendingDown, TrendingUp, Minus, Table2, LineChart as LineChartIcon, Plus, X, Check } from 'lucide-react';
import type { Device, LatestMeasurement, Measurement, Parameter } from '@/lib/data';
import {
  PARAMETERS, PARAM_META, PARAM_THRESHOLDS, formatValue,
  isAnomalous, isDeviceOnline, supabase,
} from '@/lib/data';
import StationMap from '@/components/StationMap';
import StatCard from '@/components/StatCard';

type LatestMap = Record<string, LatestMeasurement>;

const TREND_COLORS = ['#0d9488', '#0369a1', '#f97316', '#a16207', '#7c3aed', '#dc2626'];

interface StationStatus {
  device: Device;
  online: boolean;
  latest: Partial<Record<Parameter, LatestMeasurement>>;
  anomalies: Parameter[];
}

function TimeAgo({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-slate-400">Chưa có</span>;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return <span>{mins < 1 ? 'Vừa xong' : mins < 60 ? `${mins} phút trước` : `${Math.round(mins / 60)} giờ trước`}</span>;
}

function timeTick(v: string) {
  const d = new Date(v);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function MiniChart({ rows, param }: { rows: Measurement[]; param: Parameter }) {
  const meta = PARAM_META[param];
  const t = PARAM_THRESHOLDS[param];
  const data = rows.map((r) => ({ time: r.measured_at, value: r.value }));
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500">{meta.label}</span>
        <span className="text-xs font-semibold tabular-nums" style={{ color: meta.color }}>
          {data.length > 0 ? formatValue(param, data[data.length - 1].value) : '—'}
        </span>
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 10 }} stroke="#94a3b8" minTickGap={40} />
            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" domain={['auto', 'auto']} />
            <Tooltip
              formatter={(v) => [formatValue(param, v as number), meta.label]}
              labelFormatter={(l) => `Thời điểm: ${l}`}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <ReferenceArea y1={t.min} y2={t.max} fill="#14b8a6" fillOpacity={0.06} />
            <Line type="monotone" dataKey="value" stroke={meta.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [latest, setLatest] = useState<LatestMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [recent, setRecent] = useState<Measurement[]>([]);
  const [trend24, setTrend24] = useState<Measurement[]>([]);
  const [trendView, setTrendView] = useState<'table' | 'chart'>('table');
  const [pinned, setPinned] = useState<string[]>([]);
  const [pinnedLatest, setPinnedLatest] = useState<string[]>([]);
  const [showAddStation, setShowAddStation] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [{ data: devData, error: devError }, { data: latData, error: latError }] = await Promise.all([
          supabase.from('devices').select('*').order('code'),
          supabase.from('latest_measurements').select('*'),
        ]);
        if (devError || latError) throw devError ?? latError;
        if (!mounted) return;
        const devList = (devData ?? []) as Device[];
        setDevices(devList);
        const map: LatestMap = {};
        for (const row of (latData ?? []) as LatestMeasurement[]) {
          map[`${row.device_id}:${row.parameter}`] = row;
        }
        setLatest(map);
        setError(null);
        setSelected((cur) => cur ?? devList[0]?.id ?? null);
        const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: trendRows, error: trendError } = await supabase
          .from('measurements')
          .select('id, device_id, parameter, value, measured_at, source')
          .gte('measured_at', dayAgo)
          .order('measured_at', { ascending: true });
        if (!mounted) return;
        if (!trendError) setTrend24((trendRows ?? []) as Measurement[]);
        setPinned((cur) => (cur.length > 0 ? cur : devList.slice(0, 3).map((d) => d.id)));
        setPinnedLatest((cur) => (cur.length > 0 ? cur : devList.slice(0, 3).map((d) => d.id)));
      } catch {
        if (mounted) setError('Không tải được dữ liệu. Vui lòng thử lại.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let mounted = true;
    async function loadRecent() {
      const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error: err } = await supabase
        .from('measurements')
        .select('id, device_id, parameter, value, measured_at, source')
        .eq('device_id', selected!)
        .gte('measured_at', from)
        .order('measured_at', { ascending: true });
      if (!mounted) return;
      if (err) { setRecent([]); return; }
      setRecent((data ?? []) as Measurement[]);
    }
    loadRecent();
    const interval = setInterval(loadRecent, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, [selected]);

  const statuses: StationStatus[] = useMemo(
    () =>
      devices.map((device) => {
        const latestByParam: Partial<Record<Parameter, LatestMeasurement>> = {};
        for (const p of PARAMETERS) {
          const row = latest[`${device.id}:${p}`];
          if (row) latestByParam[p] = row;
        }
        const anomalies = PARAMETERS.filter(
          (p) => latestByParam[p] && isAnomalous(p, latestByParam[p]!.value),
        );
        return { device, online: isDeviceOnline(device), latest: latestByParam, anomalies };
      }),
    [devices, latest],
  );

  const onlineCount = statuses.filter((s) => s.online).length;
  const anomalyCount = statuses.reduce((n, s) => n + s.anomalies.length, 0);
  const selectedStatus = statuses.find((s) => s.device.id === selected) ?? null;
  const stationCount = devices.length;

  async function quickAddStation() {
    if (!newName.trim() || !newCode.trim()) return;
    setAddBusy(true);
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let token = 'dvc_';
    for (let i = 0; i < 16; i++) token += chars[Math.floor(Math.random() * chars.length)];
    const { error: err } = await supabase.from('devices').insert({
      name: newName.trim(),
      code: newCode.trim().toUpperCase(),
      lat: 0,
      lng: 0,
      token,
    });
    setAddBusy(false);
    if (err) {
      setError(err.code === '23505' ? 'Mã trạm đã tồn tại, vui lòng chọn mã khác.' : 'Không thể thêm trạm mới.');
      return;
    }
    setNewName('');
    setNewCode('');
    setShowAddStation(false);
  }

  const trendChartRows = useMemo(() => {
    const buckets = new Map<string, Record<string, number | string>>();
    for (const m of trend24) {
      if (!pinned.includes(m.device_id)) continue;
      const bucketMs = 3600 * 1000;
      const bucketTs = Math.floor(new Date(m.measured_at).getTime() / bucketMs) * bucketMs;
      const key = new Date(bucketTs).toISOString();
      let row = buckets.get(key);
      if (!row) { row = { time: key }; buckets.set(key, row); }
      const dev = devices.find((d) => d.id === m.device_id);
      if (dev) row[dev.code] = m.value;
    }
    return Array.from(buckets.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [trend24, pinned, devices]);

  const trendChartSeries = pinned.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => Boolean(d));

  const trendByStation = useMemo(() => {
    const map: Record<string, Partial<Record<Parameter, { first: number; last: number; min: number; max: number; avg: number; count: number }>>> = {};
    for (const m of trend24) {
      const station = (map[m.device_id] ??= {});
      const stat = station[m.parameter];
      if (!stat) {
        station[m.parameter] = { first: m.value, last: m.value, min: m.value, max: m.value, avg: m.value, count: 1 };
      } else {
        stat.last = m.value;
        stat.min = Math.min(stat.min, m.value);
        stat.max = Math.max(stat.max, m.value);
        stat.avg = (stat.avg * stat.count + m.value) / (stat.count + 1);
        stat.count += 1;
      }
    }
    return map;
  }, [trend24]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tổng quan giám sát</h1>
          <p className="text-sm text-slate-500">Trạng thái trạm đo và số liệu mới nhất theo thời gian thực</p>
        </div>
        <button
          onClick={() => setLatest((m) => ({ ...m }))}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <Activity size={15} /> Làm mới
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Trạm quan trắc" value={stationCount} sub={`${onlineCount}/${stationCount} đang hoạt động`} />
            <StatCard
              label="Trạm hoạt động"
              value={onlineCount}
              sub={`${stationCount - onlineCount} mất kết nối`}
              accent="text-teal-600"
            />
            <StatCard
              label="Cảnh báo bất thường"
              value={anomalyCount}
              sub={anomalyCount > 0 ? 'Ngoài ngưỡng cho phép' : 'Trong ngưỡng an toàn'}
              accent={anomalyCount > 0 ? 'text-amber-600' : 'text-slate-900'}
            />
            <StatCard label="Thông số giám sát" value={4} sub="Nhiệt độ, pH, TDS, độ đục" />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm h-[420px]">
              <StationMap devices={devices} />
            </div>
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-[420px]">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">
                Danh sách trạm
              </div>
              <div className="overflow-y-auto divide-y divide-slate-100">
                {statuses.map(({ device, online, anomalies }) => (
                  <button
                    key={device.id}
                    onClick={() => setSelected(device.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedStatus?.device.id === device.id ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 text-sm truncate">{device.name}</span>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${online ? 'text-teal-600' : 'text-red-600'}`}>
                        <span className={`w-2 h-2 rounded-full ${online ? 'bg-teal-500' : 'bg-red-500'}`} />
                        {online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{device.code}</span>
                      {anomalies.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <AlertTriangle size={12} /> {anomalies.length} bất thường
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {selectedStatus && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 lg:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">{selectedStatus.device.name}</h2>
                  <p className="text-xs text-slate-500">
                    {selectedStatus.device.code} · Cập nhật <TimeAgo iso={selectedStatus.device.last_seen_at} /> · Biểu đồ 24 giờ gần nhất
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${selectedStatus.online ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                  {selectedStatus.online ? 'Đang hoạt động' : 'Mất kết nối'}
                </span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {PARAMETERS.map((p) => (
                  <MiniChart
                    key={p}
                    param={p}
                    rows={recent.filter((r) => r.parameter === p)}
                  />
                ))}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {PARAMETERS.map((p) => {
                  const row = selectedStatus.latest[p];
                  const value = row?.value;
                  const anomaly = value !== undefined && isAnomalous(p, value);
                  return (
                    <div key={p} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <div className="text-[11px] text-slate-500">Mới nhất · {PARAM_META[p].label}</div>
                      <div className={`text-sm font-semibold tabular-nums ${anomaly ? 'text-amber-600' : 'text-slate-900'}`}>
                        {value !== undefined ? formatValue(p, value) : '—'}
                        {anomaly && <AlertTriangle size={12} className="inline ml-1.5 text-amber-500" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Ngưỡng cho phép: {PARAMETERS.map((p) => {
                  const t = PARAM_THRESHOLDS[p];
                  return `${PARAM_META[p].shortLabel} ${t.min}–${t.max}${PARAM_META[p].unit ? ' ' + PARAM_META[p].unit : ''}`;
                }).join(' · ')}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">Xu hướng 24 giờ theo trạm</h2>
                <p className="text-xs text-slate-500">Giá trị mới nhất và mức thay đổi so với đầu kỳ 24 giờ của từng thông số</p>
              </div>
              <div className="flex items-center gap-2">
                {pinned.length > 0 && (
                  <span className="text-xs text-slate-400">{pinned.length} trạm</span>
                )}
                <button
                  onClick={() => setShowAddStation((v) => !v)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={13} /> Thêm trạm
                </button>
                <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                  <button
                    onClick={() => setTrendView('table')}
                    className={`px-2.5 py-1.5 transition-colors ${trendView === 'table' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    title="Xem dạng bảng"
                  >
                    <Table2 size={14} />
                  </button>
                  <button
                    onClick={() => setTrendView('chart')}
                    className={`px-2.5 py-1.5 transition-colors ${trendView === 'chart' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    title="Xem dạng biểu đồ"
                  >
                    <LineChartIcon size={14} />
                  </button>
                </div>
              </div>
            </div>

            {showAddStation && (
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tên trạm</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VD: Trạm Cửa Sốt"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Mã trạm</label>
                  <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="VD: SM-CS-01"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <button onClick={quickAddStation} disabled={addBusy || !newName.trim() || !newCode.trim()}
                  className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {addBusy ? 'Đang lưu…' : 'Lưu trạm'}
                </button>
                <p className="text-xs text-slate-400 w-full">Trạm mới dùng để ghi nhận số đo; có thể cập nhật vị trí chi tiết ở trang Quản trị.</p>
              </div>
            )}

            {trendView === 'table' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-medium sticky left-0 bg-slate-50">Trạm</th>
                      {PARAMETERS.map((p) => (
                        <th key={p} className="px-4 py-2.5 font-medium text-right">
                          {PARAM_META[p].shortLabel}
                          {PARAM_META[p].unit ? <span className="text-slate-400"> ({PARAM_META[p].unit})</span> : null}
                        </th>
                      ))}
                      <th className="px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statuses.map(({ device }) => {
                      const stationTrend = trendByStation[device.id] ?? {};
                      return (
                        <tr
                          key={device.id}
                          onClick={() => setSelected(device.id)}
                          className={`cursor-pointer transition-colors ${selectedStatus?.device.id === device.id ? 'bg-teal-50/50' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-4 py-2.5 sticky left-0 bg-inherit">
                            <div className="font-medium text-slate-800 truncate max-w-[160px]">{device.name}</div>
                            <div className="text-[11px] text-slate-500">{device.code}</div>
                          </td>
                          {PARAMETERS.map((p) => {
                            const stat = stationTrend[p];
                            if (!stat) {
                              return <td key={p} className="px-4 py-2.5 text-right text-slate-300">—</td>;
                            }
                            const delta = stat.last - stat.first;
                            const meta = PARAM_META[p];
                            const flat = Math.abs(delta) < (meta.decimals === 0 ? 1 : 0.01);
                            const deltaColor = flat ? 'text-slate-400' : delta > 0 ? 'text-red-600' : 'text-sky-600';
                            const DeltaIcon = flat ? Minus : delta > 0 ? TrendingUp : TrendingDown;
                            const anomaly = isAnomalous(p, stat.last);
                            return (
                              <td key={p} className="px-4 py-2.5 text-right">
                                <div className={`font-semibold tabular-nums ${anomaly ? 'text-amber-600' : 'text-slate-900'}`}>
                                  {stat.last.toFixed(meta.decimals)}
                                </div>
                                <div className={`text-[11px] tabular-nums inline-flex items-center gap-0.5 justify-end ${deltaColor}`}>
                                  <DeltaIcon size={11} />
                                  {flat ? 'ổn định' : `${delta > 0 ? '+' : ''}${delta.toFixed(meta.decimals)}`}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-2 py-2.5 text-right">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPinned((cur) => cur.filter((id) => id !== device.id)); }}
                              className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Bớt trạm khỏi bảng"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 pt-3">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {statuses.filter(({ device }) => !pinned.includes(device.id)).length > 0 && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) setPinned((cur) => [...cur, e.target.value]);
                        e.target.value = '';
                      }}
                      defaultValue=""
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">+ Thêm trạm vào biểu đồ</option>
                      {statuses.filter(({ device }) => !pinned.includes(device.id)).map(({ device }) => (
                        <option key={device.id} value={device.id}>{device.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartRows} margin={{ top: 5, right: 16, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="time" tickFormatter={timeTick} tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={40} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip
                        labelFormatter={(l) => `Thời điểm: ${new Date(String(l)).toLocaleString('vi-VN')}`}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Legend />
                      {trendChartSeries.map((d, i) => (
                        <Line
                          key={d.id}
                          type="monotone"
                          dataKey={d.code}
                          stroke={TREND_COLORS[i % TREND_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 pb-4">
                  {trendChartSeries.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {d.name}
                      <button
                        onClick={() => setPinned((cur) => cur.filter((id) => id !== d.id))}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">Giá trị mới nhất theo trạm</h2>
                <p className="text-xs text-slate-500">Chỉ hiển thị thông số của các trạm được chọn — thêm hoặc bớt trạm bằng các nút bên dưới</p>
              </div>
            </div>
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
              {statuses.map(({ device }) => {
                const active = pinnedLatest.includes(device.id);
                return (
                  <button
                    key={device.id}
                    onClick={() =>
                      setPinnedLatest((cur) =>
                        cur.includes(device.id) ? cur.filter((id) => id !== device.id) : [...cur, device.id],
                      )
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {active ? <Check size={12} /> : <Plus size={12} />}
                    {device.name}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
              {statuses
                .filter(({ device }) => pinnedLatest.includes(device.id))
                .map(({ device, latest: latestByParam }) => (
                  <div key={device.id} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{device.name}</div>
                        <div className="text-[11px] text-slate-500">{device.code}</div>
                      </div>
                      <button
                        onClick={() => setPinnedLatest((cur) => cur.filter((id) => id !== device.id))}
                        className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Bớt trạm"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {PARAMETERS.map((p) => {
                        const row = latestByParam[p];
                        const anomaly = row && isAnomalous(p, row.value);
                        return (
                          <div key={p} className="px-3 py-2 flex items-center justify-between">
                            <span className="text-xs text-slate-500">{PARAM_META[p].label}</span>
                            <span className={`text-sm font-semibold tabular-nums ${anomaly ? 'text-amber-600' : 'text-slate-900'}`}>
                              {row ? formatValue(p, row.value) : '—'}
                              {anomaly && <AlertTriangle size={12} className="inline ml-1.5 text-amber-500" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
