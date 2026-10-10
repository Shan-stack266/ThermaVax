import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import { EmptyState, PanelHeader, StatusBadge } from '../components/Common';
import { formatDate } from '../utils/format';

export function ShipmentTable({ shipments, title, compact = false, onShipment, onViewAll, onDelete, deletingId, onAccept, onReject, riderMode = false, showAssignmentStatus = false }) {
  if (!shipments.length) return <EmptyState title={title}>No shipments have been created yet.</EmptyState>;
  const riderActions = Boolean(onAccept || onReject);
  const showRiderStatus = showAssignmentStatus || riderMode || riderActions;
  const temperatureCell = item => item.current_temperature === null
    ? 'No reading'
    : <><strong>{item.current_temperature} C</strong><span className="mono">{item.temperature_status} / {item.device_connection}</span></>;
  const riderStatusCell = item => {
    if (!showRiderStatus) return <StatusBadge>{item.status}</StatusBadge>;
    if (item.rider_assignment_status === 'Accepted') return <><StatusBadge>Accepted</StatusBadge><span className="mono">Accepted and in transit</span></>;
    if (item.rider_assignment_status === 'Rejected') return <><StatusBadge>Rejected</StatusBadge>{item.rider_assignment_rejection_reason && <span className="mono">{item.rider_assignment_rejection_reason}</span>}</>;
    return <><StatusBadge>Pending</StatusBadge><span className="mono">Awaiting confirmation</span></>;
  };
  const showRiderDecision = item => riderActions
    && (item.rider_assignment_status || 'Assigned') === 'Assigned'
    && item.status === 'Preparing';
  const columns = [
    { key: 'tracking_code', label: 'Tracking', render: item => <><strong>{item.tracking_code}</strong><span className="mono">{item.total_quantity} doses</span></> },
    { key: 'route', label: 'Route', sortValue: item => `${item.origin} ${item.destination}`, render: item => <>{item.origin}<span className="mono">to {item.destination}</span></> },
    { key: 'assigned_personnel', label: 'Personnel' },
    { key: 'expected_delivery_date', label: 'Expected', render: item => formatDate(item.expected_delivery_date) },
    { key: 'current_temperature', label: 'Temperature', render: temperatureCell },
    { key: 'active_alerts', label: 'Alerts', render: item => item.active_alerts ? <StatusBadge>{`${item.active_alerts} Active`}</StatusBadge> : 'None' },
    { key: 'status', label: 'Status', render: riderStatusCell },
    { key: 'action', label: '', sortable: false, render: item => <div className="row-actions"><button className="text-button" onClick={() => onShipment(item.id)}>View</button>{showRiderDecision(item) && onAccept && <button type="button" className="secondary" onClick={() => onAccept(item)}>Accept</button>}{showRiderDecision(item) && onReject && <button type="button" className="secondary" onClick={() => onReject(item)}>Reject</button>}{onDelete && <button type="button" className="icon-button delete-button" aria-label={`Delete shipment ${item.tracking_code}`} title={item.status === 'Delivered' ? 'Delivered shipments are retained for delivery records' : 'Delete shipment'} disabled={deletingId != null || item.status === 'Delivered'} onClick={() => onDelete(item)}><Icon name="trash-2" /></button>}</div> }
  ];
  return <section className="panel table-panel">
    <PanelHeader title={title} description={`${shipments.length} record${shipments.length === 1 ? '' : 's'}`} action={compact && <button className="text-button" onClick={onViewAll}>View all</button>} />
    {compact
      ? <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{shipments.map(item => <tr key={item.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(item) : item[column.key]}</td>)}</tr>)}</tbody></table></div>
      : <DataTable columns={columns} rows={shipments} getSearchText={item => `${item.tracking_code} ${item.origin} ${item.destination} ${item.assigned_personnel} ${item.status} ${item.rider_assignment_status || ''}`} getStatuses={item => [showRiderStatus ? (item.rider_assignment_status || 'Assigned') : item.status]} />}
  </section>;
}

export function WarningPanel({ warnings, onBatch }) {
  return <section className="panel"><PanelHeader title="Expiration monitoring" description="Expired or expiring within 30 days" /><div className="list">{warnings.length ? warnings.map(batch => <button className="list-row" key={batch.id} onClick={() => onBatch(batch.id)}><span><strong>{batch.vaccine_name}</strong><small>Batch {batch.batch_number}</small></span><span><StatusBadge>{batch.expiration_status}</StatusBadge><small>{formatDate(batch.expiration_date, false)}</small></span></button>) : <div className="compact-empty">No expiration warnings</div>}</div></section>;
}

export function AlertPanel({ alerts, onShipment }) {
  return <section className="panel"><PanelHeader title="Temperature alerts" description="Readings outside assigned batch ranges" /><div className="list">{alerts.length ? alerts.map(alert => <button className="list-row" key={alert.id} onClick={() => onShipment(alert.shipment_id)}><span><strong>{alert.tracking_code}</strong><small>{alert.origin} to {alert.destination}</small></span><span><StatusBadge>Active</StatusBadge><small>{alert.temperature} C</small></span></button>) : <div className="compact-empty">No active temperature alerts</div>}</div></section>;
}
