import { useState } from 'react';
import { Brand } from './Common';
import Icon from './Icon';
import ThemeToggle from './ThemeToggle';
import { todayLabel } from '../utils/format';

const baseItems = [
  ['overview', 'layout-dashboard'], ['batches', 'package'], ['shipments', 'truck'],
  ['deliveries', 'package-check'], ['alerts', 'triangle-alert'], ['map', 'map-pinned']
];

export default function Layout({ user, view, theme, onToggleTheme, onNavigate, onSignOut, children }) {
  const [navOpen, setNavOpen] = useState(false);
  const admin = user.role === 'admin';
  const rider = user.role === 'rider';
  const labels = {
    overview: admin ? 'Overview' : user.role === 'rider' ? 'Rider workspace' : 'Operations', batches: admin ? 'Batches' : 'Inventory',
    shipments: 'Shipments', deliveries: 'Deliveries', alerts: 'Alerts', map: 'Live map',
    reports: 'Reports', users: 'Users'
  };
  const titles = { ...labels, batches: 'Vaccine batches', alerts: 'Temperature alerts', users: 'User management' };
  const items = admin
    ? [...baseItems, ['reports', 'file-chart-column'], ['users', 'users']]
    : rider ? baseItems.filter(([key]) => key !== 'batches') : baseItems;
  return <div className="shell">
    <aside className={`sidebar ${navOpen ? 'nav-open' : ''}`}>
      <div className="sidebar-brand-row"><Brand /><button type="button" className="icon-button mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen(value => !value)}><Icon name="menu" /></button></div>
      <div className="nav-label">{admin ? 'Administration' : 'Operations workspace'}</div>
      <nav className="nav" aria-label="Primary navigation">{items.map(([key, icon]) => <button type="button" className={view === key ? 'active' : ''} key={key} onClick={() => { setNavOpen(false); onNavigate(key); }}><Icon name={icon} /><span>{labels[key]}</span></button>)}</nav>
      <div className="sidebar-bottom">Signed in as<br /><strong>{user.email}</strong><br /><span>{user.role}</span></div>
    </aside>
    <main className="main"><header className="topbar"><div><h1>{titles[view]}</h1><p>{todayLabel()}</p></div><div className="topbar-actions"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><button type="button" className="text-button button-with-icon" onClick={onSignOut}><Icon name="log-out" /><span>Sign out</span></button></div></header><section aria-live="polite">{children}</section></main>
  </div>;
}
