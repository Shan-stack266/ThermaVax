import useApiData from '../hooks/useApiData';
import { ErrorState, LoadingState, PanelHeader, SectionHeading, Stat, StatusBadge } from '../components/Common';
import DashboardCharts from '../components/DashboardCharts';
import { AlertPanel, ShipmentTable, WarningPanel } from './shared';
import { formatDate } from '../utils/format';

function HardwareStatusPanel({ shipments, onShipment }) {
  const active = shipments.filter(shipment => shipment.status !== 'Delivered');
  const reporting = active.filter(shipment => shipment.device_connection === 'Reporting');
  const stale = active.filter(shipment => shipment.device_connection === 'Stale');
  const latest = active.filter(shipment => shipment.temperature_recorded_at)
    .sort((a, b) => String(b.temperature_recorded_at).localeCompare(String(a.temperature_recorded_at)))[0];
  return <section className="panel hardware-panel">
    <PanelHeader title="Hardware status" description="Latest ESP32 temperature reporting across active shipments" />
    <div className="hardware-metrics">
      <div><span>Reporting</span><strong>{reporting.length}</strong></div>
      <div><span>Stale</span><strong>{stale.length}</strong></div>
      <div><span>No reading</span><strong>{active.filter(shipment => shipment.device_connection === 'No readings').length}</strong></div>
    </div>
    {latest ? <button className="hardware-latest" type="button" onClick={() => onShipment(latest.id)}>
      <span><strong>{latest.tracking_code}</strong><small>{latest.current_temperature ?? 'No reading'} C / {formatDate(latest.temperature_recorded_at)}</small></span>
      <StatusBadge>{latest.device_connection}</StatusBadge>
    </button> : <div className="compact-empty">No ESP32 temperature reading has been saved yet.</div>}
  </section>;
}

export default function OverviewPage({ user, refreshKey, openBatch, openShipment, navigate }) {
  const { data, error, loading } = useApiData('/api/dashboard', refreshKey, { refreshIntervalMs: 5000 });
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const staff = user.role === 'staff';
  const rider = user.role === 'rider';
  return <>
    <SectionHeading title={staff ? 'Operations workspace' : rider ? 'Rider workspace' : 'Network overview'} description={staff ? 'Active shipment conditions, delivery progress, and exception queues.' : rider ? 'Assigned deliveries, temperature status, and exception queues.' : 'Live inventory, shipment, expiration, and temperature status.'} />
    <div className={`stats ${staff || rider ? '' : 'five'}`}>
      {!staff && !rider && <Stat label="Vaccine batches" value={data.counts.batches} />}
      {!rider && <Stat label="Available doses" value={data.counts.available_doses} />}
      <Stat label="Active shipments" value={data.counts.active_shipments} />
      {!rider && <Stat label="Expiration warnings" value={data.counts.expiring} tone={data.counts.expiring ? 'warning' : ''} />}
      <Stat label="Active alerts" value={data.counts.active_alerts} tone={data.counts.active_alerts ? 'danger' : ''} />
    </div>
    {!rider && <DashboardCharts charts={data.charts} />}
    <HardwareStatusPanel shipments={data.active_shipments} onShipment={openShipment} />
    <div className="overview-grid">{rider ? <AlertPanel alerts={data.alerts} onShipment={openShipment} /> : staff ? <><AlertPanel alerts={data.alerts} onShipment={openShipment} /><WarningPanel warnings={data.warnings} onBatch={openBatch} /></> : <><WarningPanel warnings={data.warnings} onBatch={openBatch} /><AlertPanel alerts={data.alerts} onShipment={openShipment} /></>}</div>
    <ShipmentTable shipments={staff || rider ? data.active_shipments : data.recent_shipments} title={staff || rider ? 'Active shipment queue' : 'Recent shipments'} compact onShipment={openShipment} onViewAll={() => navigate('shipments')} riderMode={rider} showAssignmentStatus={!staff} />
  </>;
}
