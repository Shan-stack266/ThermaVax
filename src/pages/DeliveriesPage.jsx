import useApiData from '../hooks/useApiData';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import DeliveryCompleteModal from '../components/DeliveryCompleteModal';
import { EmptyState, ErrorState, LoadingState, PanelHeader, SectionHeading, Stat, StatusBadge } from '../components/Common';
import { formatDate } from '../utils/format';
import { api } from '../services/api';
import { useState } from 'react';

export default function DeliveriesPage({ user, refreshKey, openShipment, notify, onChanged }) {
  const { data, error, loading } = useApiData('/api/deliveries', refreshKey, { refreshIntervalMs: 5000 });
  const [completing, setCompleting] = useState(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const staff = user.role === 'staff';
  const canComplete = user.role === 'rider';
  const active = data.active || data.in_transit || [];
  const ready = data.ready || [];
  const updateShipmentStatus = status => api(`/api/shipments/${encodeURIComponent(completing.id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  const moveToArrived = async status => {
    if (status === 'Preparing') {
      await updateShipmentStatus('Dispatched');
      await updateShipmentStatus('In Transit');
      await updateShipmentStatus('Arrived');
      return;
    }
    if (status === 'Dispatched') {
      await updateShipmentStatus('In Transit');
      await updateShipmentStatus('Arrived');
      return;
    }
    if (status === 'In Transit') {
      await updateShipmentStatus('Arrived');
    }
  };
  const submitDeliveryRecord = values => api(`/api/shipments/${encodeURIComponent(completing.id)}/delivery`, {
    method: 'POST',
    body: JSON.stringify(values)
  });
  const markDelivered = async values => {
    let delivered;
    try {
      delivered = await api(`/api/shipments/${encodeURIComponent(completing.id)}/complete-delivery`, {
        method: 'POST',
        body: JSON.stringify(values)
      });
    } catch (requestError) {
      if (!/404/.test(requestError.message)) throw requestError;
      await moveToArrived(completing.status);
      delivered = await submitDeliveryRecord(values);
    }
    notify?.('Delivery marked as delivered');
    onChanged?.();
    return delivered;
  };
  const queueColumns = [
    { key: 'tracking_code', label: 'Tracking', render: item => <strong>{item.tracking_code}</strong> },
    { key: 'route', label: 'Route', sortValue: item => `${item.origin} ${item.destination}`, render: item => <>{item.origin}<span className="mono">to {item.destination}</span></> },
    { key: 'assigned_personnel', label: 'Personnel' },
    { key: 'esp32_device_id', label: 'ESP32', render: item => item.esp32_device_id ? <><strong>{item.esp32_device_id}</strong><span className="mono">{item.device_connection}</span></> : 'Not assigned' },
    { key: 'expected_delivery_date', label: 'Expected', render: item => formatDate(item.expected_delivery_date) },
    { key: 'total_quantity', label: 'Quantity', render: item => `${item.total_quantity} doses` },
    { key: 'current_temperature', label: 'Temperature', render: item => item.current_temperature === null ? 'No reading' : `${item.current_temperature} C` },
    { key: 'status', label: 'Status', render: item => <><StatusBadge>Accepted</StatusBadge><span className="mono">{item.status}</span></> },
    { key: 'action', label: '', sortable: false, render: item => !canComplete
      ? <button className="text-button" onClick={() => openShipment(item.id)}>View</button>
      : <div className="row-actions"><button className="text-button" onClick={() => openShipment(item.id)}>View</button><button className="primary button-with-icon" onClick={() => setCompleting(item)}><Icon name="package-check" /><span>Delivered</span></button></div> }
  ];
  const historyColumns = [
    { key: 'batches', label: 'Vaccines / batches', sortValue: item => (item.batches || []).map(batch => batch.vaccine_name).join(' '), render: item => (item.batches || []).length ? item.batches.map(batch => <div key={batch.id}><strong>{batch.vaccine_name}</strong><span className="mono">Batch {batch.batch_number} / {batch.assigned_quantity} assigned doses</span></div>) : 'Batch details unavailable' },
    { key: 'tracking_code', label: 'Tracking', render: item => <strong>{item.tracking_code}</strong> },
    { key: 'route', label: 'Route', sortValue: item => `${item.origin} ${item.destination}`, render: item => <>{item.origin}<span className="mono">to {item.destination}</span></> },
    { key: 'receiver', label: 'Receiver' },
    { key: 'delivered_at', label: 'Delivered', render: item => formatDate(item.delivered_at) },
    { key: 'quantity_received', label: 'Quantity', render: item => `${item.quantity_received} doses` },
    { key: 'condition', label: 'Condition' },
    { key: 'temperature_status', label: 'Temperature', render: item => <StatusBadge>{item.temperature_status}</StatusBadge> },
    { key: 'action', label: '', sortable: false, render: item => <button className="text-button" onClick={() => openShipment(item.shipment_id)}>View</button> }
  ];
  return <><SectionHeading title="Delivery workspace" description={staff ? 'Monitor accepted deliveries and delivered vaccine records.' : 'Track accepted deliveries and review delivered vaccines.'} /><div className="stats five"><Stat label="Accepted deliveries" value={active.length} tone={active.length ? 'warning' : ''} /><Stat label="In transit" value={(data.in_transit || []).length} /><Stat label="Ready to complete" value={ready.length} tone={ready.length ? 'warning' : ''} /><Stat label="Completed deliveries" value={data.completed.length} /><Stat label="Received doses" value={data.completed.reduce((total, item) => total + Number(item.quantity_received || 0), 0)} /></div><div className="delivery-workspace-grid">{active.length ? <section className="panel table-panel"><PanelHeader title={canComplete ? 'My active deliveries' : 'Accepted and in-transit deliveries'} description={`${active.length} accepted deliver${active.length === 1 ? 'y' : 'ies'} currently in progress`} /><DataTable columns={queueColumns} rows={active} getSearchText={item => `${item.tracking_code} ${item.origin} ${item.destination} ${item.assigned_personnel} ${item.status}`} getStatuses={item => ['Accepted', item.status]} /></section> : <EmptyState title="Accepted and in-transit deliveries">Accepted rider deliveries will appear here automatically.</EmptyState>}{data.completed.length ? <section className="panel table-panel"><PanelHeader title="Delivered vaccines" description={`${data.completed.length} confirmed delivery record${data.completed.length === 1 ? '' : 's'}`} /><DataTable columns={historyColumns} rows={data.completed} getSearchText={item => `${item.tracking_code} ${item.origin} ${item.destination} ${item.receiver} ${item.condition} ${item.temperature_status} ${(item.batches || []).map(batch => `${batch.vaccine_name} ${batch.batch_number}`).join(' ')}`} getStatuses={item => [item.temperature_status]} /></section> : <EmptyState title="Delivered vaccines">No vaccines have been confirmed as delivered yet.</EmptyState>}</div>{completing && <DeliveryCompleteModal shipment={completing} onClose={() => setCompleting(null)} onSubmit={markDelivered} />}</>;
}
