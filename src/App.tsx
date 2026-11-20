import { useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { EcgAnalysisPage } from './features/ecg-analysis/EcgAnalysisPage';
import { HrvPage } from './features/hrv/HrvPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SessionDetailPage } from './features/sessions/SessionDetailPage';
import { SessionsPage } from './features/sessions/SessionsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { NotFoundPage } from './features/NotFoundPage';
import { useAppStore } from './state/store';

export default function App() {
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // Simulation is the default so the workstation is useful without hardware.
    void useAppStore.getState().setMode('simulation');
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="ecg" element={<EcgAnalysisPage />} />
          <Route path="hrv" element={<HrvPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
