import { useMemo, useState } from 'react';
import useApiData from '../hooks/useApiData';
import { api } from '../services/api';
import Icon from '../components/Icon';
import NoteModal from '../components/NoteModal';
import { ErrorState, LoadingState, SectionHeading } from '../components/Common';
import { ShipmentTable } from './shared';

export default function ShipmentsPage({ user, refreshKey, openShipment, openCreate, notify, onChanged }) {
  const { data: shipments, error, loading } = useApiData('/api/shipments', refreshKey, { refreshIntervalMs: 5000 });
  const admin = user.role === 'admin';
  const rider = user.role === 'rider';
  const [deletingId, setDeletingId] = useState(null);
  const [assignmentFilter, setAssignmentFilter] = useState('assigned');
  const [rejecting, setRejecting] = useState(null);
  const [assignmentOverrides, setAssignmentOverrides] = useState({});
  const visibleShipments = useMemo(() => {
    const withOverrides = (shipments || []).map(shipment => assignmentOverrides[shipment.id]
      ? { ...shipment, ...assignmentOverrides[shipment.id] }
      : shipment);
    const isActiveDelivery = shipment => shipment.status === 'Delivered'
      || shipment.rider_assignment_status === 'Accepted'
      || ['Dispatched', 'In Transit', 'Arrived'].includes(shipment.status);
    const shipmentQueue = withOverrides.filter(shipment => !isActiveDelivery(shipment));
    if (!rider || assignmentFilter === 'all') return shipmentQueue;
    const emailName = user.email.split('@')[0].replace(/[._-]+/g, ' ').toLowerCase();
    return shipmentQueue.filter(shipment => String(shipment.assigned_personnel || '').toLowerCase().includes(emailName)
      && (shipment.rider_assignment_status || 'Assigned') === 'Assigned'
      && shipment.status === 'Preparing');
  }, [assignmentFilter, assignmentOverrides, rider, shipments, user.email]);
  const deleteShipment = async shipment => {
    if (deletingId || shipment.status === 'Delivered' || !window.confirm(`Delete shipment ${shipment.tracking_code}? Its readings, alerts, and QR link will be removed, and assigned doses will return to available inventory.`)) return;
    setDeletingId(shipment.id);
    try {
      await api(`/api/shipments/${encodeURIComponent(shipment.id)}`, { method: 'DELETE' });
      notify('Shipment deleted');
      onChanged();
    } catch (requestError) {
      notify(requestError.message);
    } finally { setDeletingId(null); }
  };
  const acceptShipment = async shipment => {
    try {
      const accepted = await api(`/api/shipments/${encodeURIComponent(shipment.id)}/accept`, { method: 'POST', body: '{}' });
      setAssignmentOverrides(current => ({ ...current, [shipment.id]: { ...accepted, status: accepted.status || 'In Transit', rider_assignment_status: 'Accepted', rider_assignment_responded_at: accepted.rider_assignment_responded_at || new Date().toISOString(), rider_assignment_rejection_reason: null } }));
      notify('Shipment accepted');
      onChanged();
    } catch (requestError) { notify(requestError.message); }
  };
  const rejectShipment = async reason => {
    await api(`/api/shipments/${encodeURIComponent(rejecting.id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
    setAssignmentOverrides(current => ({ ...current, [rejecting.id]: { rider_assignment_status: 'Rejected', rider_assignment_responded_at: new Date().toISOString(), rider_assignment_rejection_reason: reason } }));
    notify('Shipment rejected');
    onChanged();
  };
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  return <><SectionHeading title={admin ? 'Shipment management' : rider ? 'Rider deliveries' : 'Shipment operations'} description={admin ? 'Create shipments and monitor routes awaiting rider confirmation.' : rider ? 'Review assigned routes awaiting confirmation.' : 'Monitor shipment records awaiting rider confirmation.'} action={admin && <button className="secondary accent button-with-icon" onClick={openCreate}><Icon name="plus" /><span>Add shipment</span></button>} />{rider && <div className="toolbar"><label className="field"><span>Shipment scope</span><select value={assignmentFilter} onChange={event => setAssignmentFilter(event.target.value)}><option value="assigned">My assigned shipments</option><option value="all">All pending shipments</option></select></label></div>}<ShipmentTable shipments={visibleShipments} title={admin ? 'Pending shipments' : rider && assignmentFilter === 'assigned' ? 'My assigned shipments' : 'Pending shipments'} onShipment={openShipment} onDelete={admin ? deleteShipment : undefined} onAccept={rider ? acceptShipment : undefined} onReject={rider ? setRejecting : undefined} deletingId={deletingId} riderMode={rider} showAssignmentStatus={admin || rider} />{rejecting && <NoteModal title="Reject shipment" subtitle={rejecting.tracking_code} label="Rejection reason" actionLabel="Reject shipment" onClose={() => setRejecting(null)} onSubmit={rejectShipment} />}</>;
}
