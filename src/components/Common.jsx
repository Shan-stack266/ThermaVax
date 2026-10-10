import Icon from './Icon';
import { statusClass } from '../utils/format';
import logoUrl from '../../assets/thermavax-logo.png';

export function Brand() {
  return <div className="brand"><img className="brand-logo" src={logoUrl} alt="" /><span>ThermaVax</span></div>;
}

export function StatusBadge({ children }) {
  return <span className={`status ${statusClass(children)}`}>{children}</span>;
}

export function LoadingState() {
  return <div className="loading-skeleton" aria-label="Loading"><span /><span /><span /></div>;
}

export function EmptyState({ title, children, action }) {
  return <section className="panel empty-state"><h3>{title}</h3><p>{children}</p>{action}</section>;
}

export function ErrorState({ message }) {
  return <EmptyState title="Unable to load this view">{message}</EmptyState>;
}

export function SectionHeading({ title, description, action }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

export function Stat({ label, value, tone = '' }) {
  const iconName = tone === 'danger' ? 'triangle-alert' : tone === 'warning' ? 'clock-alert'
    : label.toLowerCase().includes('shipment') || label.toLowerCase().includes('transit') ? 'truck'
      : label.toLowerCase().includes('dose') ? 'syringe' : 'package';
  return <article className={`stat ${tone}`}><div className="stat-label"><Icon name={iconName} /><span>{label}</span></div><strong>{value}</strong></article>;
}

export function DetailItem({ label, children }) {
  return <div className="detail-item"><span>{label}</span><strong>{children}</strong></div>;
}

export function PanelHeader({ title, description, action }) {
  return <div className="panel-header"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{action}</div>;
}
