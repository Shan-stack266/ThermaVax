import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import { api } from '../services/api';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import { EmptyState, ErrorState, LoadingState, SectionHeading, Stat, StatusBadge } from '../components/Common';
import { formatDate } from '../utils/format';

export default function BatchesPage({ user, refreshKey, openBatch, openCreate, notify, onChanged }) {
  const { data: batches, error, loading } = useApiData('/api/batches', refreshKey);
  const [deletingId, setDeletingId] = useState(null);
  const deleteBatch = async batch => {
    if (deletingId || !window.confirm(`Delete batch ${batch.batch_number} (${batch.vaccine_name})? This permanently removes its inventory record and QR tracking link.`)) return;
    setDeletingId(batch.id);
    try {
      await api(`/api/batches/${encodeURIComponent(batch.id)}`, { method: 'DELETE' });
      notify('Batch deleted');
      onChanged();
    } catch (requestError) {
      notify(requestError.message);
    } finally {
      setDeletingId(null);
    }
  };
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const admin = user.role === 'admin';
  const totalDoses = batches.reduce((sum, batch) => sum + Number(batch.available_quantity || 0), 0);
  const expiring = batches.filter(batch => batch.expiration_status === 'Expiring Soon').length;
  const unavailable = batches.filter(batch => ['Expired', 'Quarantined', 'Depleted'].includes(batch.expiration_status) || ['Quarantined', 'Depleted'].includes(batch.status)).length;
  const columns = [
    { key: 'vaccine_name', label: 'Vaccine / Batch Number', render: batch => <><strong>{batch.vaccine_name}</strong><span className="mono">{batch.batch_number}</span></> },
    { key: 'available_quantity', label: 'Stock', render: batch => `${batch.available_quantity} / ${batch.quantity}` },
    { key: 'manufacturing_date', label: 'Manufactured', render: batch => formatDate(batch.manufacturing_date, false) },
    { key: 'expiration_date', label: 'Expires', render: batch => formatDate(batch.expiration_date, false) },
    { key: 'min_temperature', label: 'Required range', render: batch => <span className="mono">{batch.min_temperature} to {batch.max_temperature} C</span> },
    { key: 'status', label: 'Batch status', render: batch => <StatusBadge>{batch.status}</StatusBadge> },
    { key: 'expiration_status', label: 'Expiration', render: batch => <StatusBadge>{batch.expiration_status}</StatusBadge> },
    { key: 'action', label: '', sortable: false, render: batch => <div className="row-actions"><button className="text-button" onClick={() => openBatch(batch.id)}>View</button>{admin && <button type="button" className="icon-button delete-button" aria-label={`Delete batch ${batch.batch_number}`} title="Delete batch" disabled={deletingId !== null} onClick={() => deleteBatch(batch)}><Icon name="trash-2" /></button>}</div> }
  ];
  return <><SectionHeading title="Vaccine inventory" description="Batch quantities, shelf life, and required temperatures." action={admin && <button className="secondary accent button-with-icon" onClick={openCreate}><Icon name="plus" /><span>Add batch</span></button>} /><div className="stats"><Stat label="Total batches" value={batches.length} /><Stat label="Available doses" value={totalDoses} /><Stat label="Expiring soon" value={expiring} tone={expiring ? 'warning' : ''} /><Stat label="Unavailable" value={unavailable} tone={unavailable ? 'danger' : ''} /></div>{batches.length ? <section className="panel table-panel"><DataTable columns={columns} rows={batches} getSearchText={batch => `${batch.vaccine_name} ${batch.batch_number} ${batch.status} ${batch.expiration_status}`} getStatuses={batch => [batch.status, batch.expiration_status]} /></section> : <EmptyState title="No vaccine batches" action={admin && <button className="secondary accent" onClick={openCreate}>Add first batch</button>}>No inventory records are currently available.</EmptyState>}</>;
}
