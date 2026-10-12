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

function withinDateRange(value, from, to) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() : null;
  return (!Number.isFinite(fromTime) || time >= fromTime)
    && (!Number.isFinite(toTime) || time <= toTime);
}

function sortByTime(rows, key, order) {
  return [...rows].sort((a, b) => (
    new Date(b[key]).getTime() - new Date(a[key]).getTime()
  ) * (order === 'oldest' ? -1 : 1));
}

function AlertTimeControls({ prefix, sortOrder, setSortOrder, from, setFrom, to, setTo }) {
  return <div className="alert-time-toolbar">
    <label className="field compact-field" htmlFor={`${prefix}-sort`}><span>Order</span><select id={`${prefix}-sort`} value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="recent">Most recent first</option><option value="oldest">Oldest first</option></select></label>
    <label className="field compact-field" htmlFor={`${prefix}-from`}><span>From</span><input id={`${prefix}-from`} type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
    <label className="field compact-field" htmlFor={`${prefix}-to`}><span>To</span><input id={`${prefix}-to`} type="datetime-local" value={to} onChange={event => setTo(event.target.value)} /></label>
  </div>;
}

export default function AlertsPage({ refreshKey, onChanged, openShipment, notify }) {
  const { data: alerts, error, loading, reload } = useApiData('/api/alerts', refreshKey, { refreshIntervalMs: 5000 });
  const sensorReadings = useSensorReadings(refreshKey);
  const [markedKey, setMarkedKey] = useState('');
  const [alertSort, setAlertSort] = useState('recent');
  const [alertFrom, setAlertFrom] = useState('');
  const [alertTo, setAlertTo] = useState('');
  const [deviceSort, setDeviceSort] = useState('recent');
  const [deviceFrom, setDeviceFrom] = useState('');
  const [deviceTo, setDeviceTo] = useState('');
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
  const filteredAlerts = sortByTime((alerts || []).filter(alert => withinDateRange(alert.recorded_at, alertFrom, alertTo)), 'recorded_at', alertSort);
  const filteredDeviceAlerts = sortByTime(deviceAlerts.filter(reading => withinDateRange(reading.created_at, deviceFrom, deviceTo)), 'created_at', deviceSort);
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
      <AlertTimeControls prefix="device-alerts" sortOrder={deviceSort} setSortOrder={setDeviceSort} from={deviceFrom} setFrom={setDeviceFrom} to={deviceTo} setTo={setDeviceTo} />
      <DataTable columns={deviceColumns} rows={filteredDeviceAlerts} getSearchText={reading => `${reading.device_id} ${reading.status} ${reading.temperature}`} />
    </section>}
    {sensorReadings.error && <section className="panel"><PanelHeader title="ESP32 device alerts" description="Standalone sensor readings could not be loaded" /><div className="inline-error">{sensorReadings.error}</div></section>}
    {alerts.length ? <section className="panel table-panel"><PanelHeader title="Shipment range alerts" /><AlertTimeControls prefix="shipment-alerts" sortOrder={alertSort} setSortOrder={setAlertSort} from={alertFrom} setFrom={setAlertFrom} to={alertTo} setTo={setAlertTo} /><DataTable columns={columns} rows={filteredAlerts} getSearchText={alert => `${alert.tracking_code} ${alert.origin} ${alert.destination} ${alert.status}`} /></section> : <EmptyState title="No shipment temperature alerts">No shipment temperature alerts</EmptyState>}
    {!deviceAlerts.length && !sensorReadings.error && <section className="panel"><PanelHeader title="ESP32 device alerts" description="Latest standalone device readings that are not SAFE" /><div className="compact-empty">{sensorReadings.loading ? 'Loading ESP32 readings...' : 'No active standalone device alerts'}</div></section>}
  </>;
}
