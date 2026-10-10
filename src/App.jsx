import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from './components/Layout';
import { LoadingState } from './components/Common';
import { BatchFormModal, ShipmentFormModal, StaffFormModal } from './components/CreateModals';
import { BatchDetailModal, ShipmentDetailModal } from './components/DetailModals';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import OverviewPage from './pages/OverviewPage';
import BatchesPage from './pages/BatchesPage';
import ShipmentsPage from './pages/ShipmentsPage';
import DeliveriesPage from './pages/DeliveriesPage';
import AlertsPage from './pages/AlertsPage';
import MapPage from './pages/MapPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import TrackingPage from './pages/TrackingPage';
import { api, clearSession, discoverApiOrigin, hasSession, logout } from './services/api';

export default function App() {
  const trackingToken = new URLSearchParams(location.search).get('track');
  const [resetMode, setResetMode] = useState(() => new URLSearchParams(location.search).get('reset') === 'password'
    || new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'recovery');
  const [theme, setTheme] = useState(() => localStorage.getItem('thermavax-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(!trackingToken);
  const [view, setView] = useState('overview');
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const closeModal = useCallback(() => setModal(null), []);
  const notify = useCallback(message => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  const changed = useCallback(() => setRefreshKey(value => value + 1), []);
  const toggleTheme = useCallback(() => setTheme(current => current === 'dark' ? 'light' : 'dark'), []);
  const navigate = key => {
    if (user?.role !== 'admin' && ['reports', 'users'].includes(key)) setView('overview');
    else if (user?.role === 'rider' && key === 'batches') setView('overview');
    else setView(key);
  };

  useEffect(() => {
    if (trackingToken) return undefined;
    let active = true;
    const initialize = async () => {
      await discoverApiOrigin();
      if (!hasSession()) { if (active) setInitializing(false); return; }
      try { const profile = await api('/api/auth/me'); if (active) setUser(profile); }
      catch { clearSession(); }
      finally { if (active) setInitializing(false); }
    };
    const unauthorized = () => { setUser(null); setModal(null); setView('overview'); };
    window.addEventListener('thermavax:unauthorized', unauthorized);
    initialize();
    return () => { active = false; window.removeEventListener('thermavax:unauthorized', unauthorized); clearTimeout(toastTimer.current); };
  }, [trackingToken]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('thermavax-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1822' : '#062d55');
  }, [theme]);

  if (trackingToken) return <TrackingPage token={trackingToken} theme={theme} onToggleTheme={toggleTheme} />;
  if (initializing) return <main className="login-panel"><LoadingState /></main>;
  if (resetMode) return <ResetPasswordPage theme={theme} onToggleTheme={toggleTheme} onDone={() => { clearSession(); setUser(null); setResetMode(false); history.replaceState(null, '', location.pathname); }} />;
  if (!user) return <><LoginPage onLogin={setUser} notify={notify} theme={theme} onToggleTheme={toggleTheme} /><div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div></>;

  const pageProps = { user, refreshKey, openBatch: id => setModal({ type: 'batch-detail', id }), openShipment: id => setModal({ type: 'shipment-detail', id }), navigate, notify, onChanged: changed };
  const pages = {
    overview: <OverviewPage {...pageProps} />,
    batches: <BatchesPage {...pageProps} openCreate={() => setModal({ type: 'batch-form' })} />,
    shipments: <ShipmentsPage {...pageProps} openCreate={() => setModal({ type: 'shipment-form' })} />,
    deliveries: <DeliveriesPage {...pageProps} />,
    alerts: <AlertsPage {...pageProps} />,
    map: <MapPage {...pageProps} />,
    reports: user.role === 'admin' ? <ReportsPage {...pageProps} /> : null,
    users: user.role === 'admin' ? <UsersPage {...pageProps} openCreate={() => setModal({ type: 'staff-form' })} /> : null
  };
  const signOut = async () => { await logout(); setUser(null); setView('overview'); setModal(null); };
  return <>
    <Layout user={user} view={view} theme={theme} onToggleTheme={toggleTheme} onNavigate={navigate} onSignOut={signOut}>{pages[view] || pages.overview}</Layout>
    {modal?.type === 'batch-form' && <BatchFormModal onClose={closeModal} onCreated={changed} notify={notify} />}
    {modal?.type === 'shipment-form' && <ShipmentFormModal onClose={closeModal} onCreated={changed} notify={notify} />}
    {modal?.type === 'staff-form' && <StaffFormModal onClose={closeModal} onCreated={changed} notify={notify} />}
    {modal?.type === 'batch-detail' && <BatchDetailModal id={modal.id} onClose={closeModal} openShipment={id => setModal({ type: 'shipment-detail', id })} notify={notify} />}
    {modal?.type === 'shipment-detail' && <ShipmentDetailModal id={modal.id} userRole={user.role} onClose={closeModal} onChanged={changed} notify={notify} />}
    <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
  </>;
}
