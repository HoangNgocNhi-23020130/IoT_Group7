import type { ReactNode } from 'react';
import {
  LayoutDashboard, History, LineChart, Settings, Waves,
} from 'lucide-react';

export type Page = 'dashboard' | 'history' | 'analysis' | 'admin';

const NAV: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'history', label: 'Lịch sử', icon: History },
  { id: 'analysis', label: 'Phân tích', icon: LineChart },
  { id: 'admin', label: 'Quản trị', icon: Settings },
];

export default function Layout({
  page, onNavigate, children,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-sky-600 flex items-center justify-center shrink-0">
              <Waves size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 leading-tight truncate">SeaMonitor</div>
              <div className="text-[11px] text-slate-500 leading-tight">Quan trắc nước biển</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  page === id
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
