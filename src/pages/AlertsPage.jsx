import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import NoteModal from '../components/NoteModal';
import { EmptyState, ErrorState, LoadingState, SectionHeading, StatusBadge } from '../components/Common';
import { api } from '../services/api';
import { formatDate } from '../utils/format';

export default function AlertsPage({ refreshKey, onChanged, openShipment, notify }) {
  const { data: alerts, error, loading } = useApiData('/api/alerts', refreshKey, { refreshIntervalMs: 5000 });
  const [acknowledging, setAcknowledging] = useState(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
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
  return <><SectionHeading title="Temperature alerts" description="Automatic violations based on assigned vaccine temperature ranges." />{alerts.length ? <section className="panel table-panel"><DataTable columns={columns} rows={alerts} getSearchText={alert => `${alert.tracking_code} ${alert.origin} ${alert.destination} ${alert.status}`} getStatuses={alert => [alert.status]} /></section> : <EmptyState title="No temperature alerts">Alerts will appear automatically when a reading leaves its assigned batch range.</EmptyState>}{acknowledging && <NoteModal title="Acknowledge alert" subtitle={`${acknowledging.tracking_code} / ${acknowledging.temperature} C`} label="Response note" actionLabel="Save acknowledgement" onClose={() => setAcknowledging(null)} onSubmit={acknowledge} />}</>;
}
