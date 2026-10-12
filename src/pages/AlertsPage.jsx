import { useEffect, useMemo, useState } from 'react';
import useApiData from '../hooks/useApiData';
import useSensorReadings from '../hooks/useSensorReadings';
import DataTable from '../components/DataTable';
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
  const { data: alerts, error, loading, reload } = useApiData('/api/alerts', refreshKey, { refreshIntervalMs: 5000 });
  const sensorReadings = useSensorReadings(refreshKey);
  const [markedKey, setMarkedKey] = useState('');
  const visibleNewAlertIds = useMemo(() => (alerts || [])
    .filter(alert => alert.status === 'Active' && !alert.viewed_at)
    .map(alert => alert.id)
    .sort(), [alerts]);
  const visibleNewKey = visibleNewAlertIds.join(',');
  useEffect(() => {
    if (!visibleNewKey || visibleNewKey === markedKey) return;
    setMarkedKey(visibleNewKey);
    api('/api/alerts/viewed', {
      method: 'POST',
      body: JSON.stringify({ alert_ids: visibleNewAlertIds })
    }).then(() => {
      onChanged();
      reload({ silent: true });
    }).catch(requestError => notify(requestError.message));
  }, [markedKey, notify, onChanged, reload, visibleNewAlertIds, visibleNewKey]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const deviceAlerts = latestUnsafeDeviceReadings(sensorReadings.readings);
  const columns = [
    { key: 'tracking_code', label: 'Shipment', render: alert => <><button className="text-button flush" onClick={() => openShipment(alert.shipment_id)}>{alert.tracking_code}</button><span className="mono">{alert.origin} to {alert.destination}</span></> },
    { key: 'temperature', label: 'Reading', render: alert => <span className="temperature-unsafe">{alert.temperature} C</span> },
    { key: 'min_temperature', label: 'Allowed range', render: alert => `${alert.min_temperature} to ${alert.max_temperature} C` },
    { key: 'recorded_at', label: 'Recorded', render: alert => formatDate(alert.recorded_at) },
    { key: 'status', label: 'Status', render: alert => <>{<StatusBadge>{alert.status}</StatusBadge>}{alert.viewed_at && <span className="mono">Viewed</span>}</> }
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
    {alerts.length ? <section className="panel table-panel"><PanelHeader title="Shipment range alerts" description="Viewing this list clears the new-alert count for your account." /><DataTable columns={columns} rows={alerts} getSearchText={alert => `${alert.tracking_code} ${alert.origin} ${alert.destination} ${alert.status}`} getStatuses={alert => [alert.status]} /></section> : <EmptyState title="No shipment temperature alerts">Shipment alerts will appear automatically when a shipment-linked reading leaves its assigned batch range.</EmptyState>}
    {!deviceAlerts.length && !sensorReadings.error && <section className="panel"><PanelHeader title="ESP32 device alerts" description="Latest standalone device readings that are not SAFE" /><div className="compact-empty">{sensorReadings.loading ? 'Loading ESP32 readings...' : 'No active standalone device alerts'}</div></section>}
  </>;
}
