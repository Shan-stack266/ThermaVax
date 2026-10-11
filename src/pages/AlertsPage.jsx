import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import useSensorReadings from '../hooks/useSensorReadings';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import NoteModal from '../components/NoteModal';
import { EmptyState, ErrorState, LoadingState, PanelHeader, SectionHeading, StatusBadge } from '../components/Common';
import { api } from '../services/api';
import { formatDate } from '../utils/format';

function latestUnsafeDeviceReadings(readings) {
  const latestByDevice = new Map();
  readings.forEach(reading => {
    if (!latestByDevice.has(reading.device_id)) latestByDevice.set(reading.device_id, reading);
  });
  return [...latestByDevice.values()].filter(reading => reading.status !== 'SAFE');
}

export default function AlertsPage({ refreshKey, onChanged, openShipment, notify }) {
  const { data: alerts, error, loading } = useApiData('/api/alerts', refreshKey, { refreshIntervalMs: 5000 });
  const sensorReadings = useSensorReadings(refreshKey);
  const [acknowledging, setAcknowledging] = useState(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const deviceAlerts = latestUnsafeDeviceReadings(sensorReadings.readings);
  const resolve = async id => {
    try {
      await api(`/api/alerts/${id}/resolve`, { method: 'PATCH', body: '{}' });
      notify('Alert resolved'); onChanged();
    } catch (requestError) { notify(requestError.message); }
  };
  const acknowledge = async note => {
    await api(`/api/alerts/${encodeURIComponent(acknowledging.id)}/acknowledge`, { method: 'POST', body: JSON.stringify({ note }) });
    notify('Alert acknowledged'); onChanged();
  };
  const columns = [
    { key: 'tracking_code', label: 'Shipment', render: alert => <><button className="text-button flush" onClick={() => openShipment(alert.shipment_id)}>{alert.tracking_code}</button><span className="mono">{alert.origin} to {alert.destination}</span></> },
    { key: 'temperature', label: 'Reading', render: alert => <span className="temperature-unsafe">{alert.temperature} C</span> },
    { key: 'min_temperature', label: 'Allowed range', render: alert => `${alert.min_temperature} to ${alert.max_temperature} C` },
    { key: 'recorded_at', label: 'Recorded', render: alert => formatDate(alert.recorded_at) },
    { key: 'status', label: 'Status', render: alert => <>{<StatusBadge>{alert.status}</StatusBadge>}{alert.acknowledgement && <span className="mono">Acknowledged</span>}</> },
    { key: 'action', label: '', sortable: false, render: alert => alert.status === 'Active' && <div className="row-actions">{!alert.acknowledgement && <button className="secondary button-with-icon" onClick={() => setAcknowledging(alert)}><Icon name="badge-check" /><span>Acknowledge</span></button>}<button className="secondary button-with-icon" onClick={() => resolve(alert.id)}><Icon name="circle-check" /><span>Resolve</span></button></div> }
  ];
  const deviceColumns = [
    { key: 'device_id', label: 'Device', render: reading => <strong>{reading.device_id}</strong> },
    { key: 'temperature', label: 'Reading', render: reading => <span className="temperature-unsafe">{Number(reading.temperature).toFixed(2)} C</span> },
    { key: 'status', label: 'Device status', render: reading => <StatusBadge>{reading.status}</StatusBadge> },
    { key: 'created_at', label: 'Recorded', render: reading => formatDate(reading.created_at) }
  ];
  return <>
    <SectionHeading title="Temperature alerts" description="Shipment excursions and live ESP32 device warnings." />
    {deviceAlerts.length > 0 && <section className="panel table-panel">
      <PanelHeader title="ESP32 device alerts" description="Latest standalone device readings that are not SAFE" action={<StatusBadge>{sensorReadings.realtimeStatus}</StatusBadge>} />
      <DataTable columns={deviceColumns} rows={deviceAlerts} getSearchText={reading => `${reading.device_id} ${reading.status} ${reading.temperature}`} getStatuses={reading => [reading.status]} />
    </section>}
    {sensorReadings.error && <section className="panel"><PanelHeader title="ESP32 device alerts" description="Standalone sensor readings could not be loaded" /><div className="inline-error">{sensorReadings.error}</div></section>}
    {alerts.length ? <section className="panel table-panel"><PanelHeader title="Shipment range alerts" description="Readings outside assigned vaccine batch ranges" /><DataTable columns={columns} rows={alerts} getSearchText={alert => `${alert.tracking_code} ${alert.origin} ${alert.destination} ${alert.status}`} getStatuses={alert => [alert.status]} /></section> : <EmptyState title="No shipment temperature alerts">Shipment alerts will appear automatically when a shipment-linked reading leaves its assigned batch range.</EmptyState>}
    {!deviceAlerts.length && !sensorReadings.error && <section className="panel"><PanelHeader title="ESP32 device alerts" description="Latest standalone device readings that are not SAFE" /><div className="compact-empty">{sensorReadings.loading ? 'Loading ESP32 readings...' : 'No active standalone device alerts'}</div></section>}
    {acknowledging && <NoteModal title="Acknowledge alert" subtitle={`${acknowledging.tracking_code} / ${acknowledging.temperature} C`} label="Response note" actionLabel="Save acknowledgement" onClose={() => setAcknowledging(null)} onSubmit={acknowledge} />}
  </>;
}
