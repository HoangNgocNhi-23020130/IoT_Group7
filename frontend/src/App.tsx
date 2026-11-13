import { useState } from 'react';
import Layout from '@/components/Layout';
import type { Page } from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import HistoryPage from '@/pages/History';
import Analysis from '@/pages/Analysis';
import Admin from '@/pages/Admin';

function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <Layout page={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard />}
      {page === 'history' && <HistoryPage />}
      {page === 'analysis' && <Analysis />}
      {page === 'admin' && <Admin />}
    </Layout>
  );
}

export default App;
