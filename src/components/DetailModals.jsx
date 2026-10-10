import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import { api, apiUrl } from '../services/api';
import { formValues, formatDate } from '../utils/format';
import Modal from './Modal';
import Icon from './Icon';
import FormMessage from './FormMessage';
import { DetailItem, ErrorState, LoadingState, StatusBadge } from './Common';

export function BatchDetailModal({ id, onClose, openShipment, notify }) {
  const { data: batch, error, loading } = useApiData(`/api/batches/${id}`);
  if (loading) return <Modal title="Vaccine batch" subtitle="Loading tracking details." onClose={onClose}><LoadingState /></Modal>;
  if (error) return <Modal title="Vaccine batch" subtitle="Tracking details unavailable." onClose={onClose}><ErrorState message={error} /></Modal>;
  return <Modal title={`${batch.vaccine_name} / ${batch.batch_number}`} subtitle="Batch tracking and inventory details" wide onClose={onClose}>
    <div className="detail-grid"><DetailItem label="Batch ID">{batch.id}</DetailItem><DetailItem label="Available quantity">{batch.available_quantity} of {batch.quantity}</DetailItem><DetailItem label="Manufactured">{formatDate(batch.manufacturing_date, false)}</DetailItem><DetailItem label="Expires">{formatDate(batch.expiration_date, false)}</DetailItem><DetailItem label="Required range">{batch.min_temperature} to {batch.max_temperature} C</DetailItem><DetailItem label="Expiration"><StatusBadge>{batch.expiration_status}</StatusBadge></DetailItem></div>
    <div className="qr-section"><img src={apiUrl(`/api/qr/${encodeURIComponent(batch.public_token)}`)} alt={`QR code for batch ${batch.batch_number}`} /><div><h3>Batch QR tracking</h3><p>Scan to open this batch&apos;s vaccine, shipment, temperature, and delivery information.</p></div></div>
    <div className="modal-section"><h3>Assigned shipments</h3>{batch.shipments.length ? batch.shipments.map(item => <button className="list-row" key={item.id} onClick={() => openShipment(item.id)}><span><strong>{item.tracking_code}</strong><small>{item.origin} to {item.destination}</small></span><span><StatusBadge>{item.status}</StatusBadge><small>{item.quantity} doses</small></span></button>) : <div className="compact-empty">This batch has not been assigned to a shipment.</div>}</div>
  </Modal>;
}

function ShipmentTimeline({ status }) {
  const steps = ['Preparing', 'Dispatched', 'In Transit', 'Arrived', 'Delivered'];
  const currentIndex = steps.indexOf(status);
  return <ol className="shipment-timeline" aria-label="Shipment progress">{steps.map((step, index) => <li key={step} className={index < currentIndex ? 'complete' : index === currentIndex ? 'current' : ''}><span><Icon name={index < currentIndex ? 'check' : index === currentIndex ? 'circle-dot' : 'circle'} /></span><strong>{step}</strong></li>)}</ol>;
}

function TemperatureGraph({ readings, range }) {
  if (!readings.length) return <div className="graph-empty">No temperature readings</div>;
  const values = readings.map(item => Number(item.temperature));
  const min = Math.min(...values, range.min_temperature) - 1;
  const max = Math.max(...values, range.max_temperature) + 1;
  const point = (value, index) => ({ x: readings.length === 1 ? 50 : 4 + (index / (readings.length - 1)) * 92, y: 92 - ((value - min) / (max - min || 1)) * 84 });
  const points = values.map((value, index) => { const item = point(value, index); return `${item.x},${item.y}`; }).join(' ');
  const safeTop = 92 - ((range.max_temperature - min) / (max - min || 1)) * 84;
  const safeBottom = 92 - ((range.min_temperature - min) / (max - min || 1)) * 84;
  return <div className="temperature-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Temperature history graph"><rect x="0" y={safeTop} width="100" height={safeBottom - safeTop} className="safe-zone" /><polyline points={points} />{readings.map((reading, index) => { const value = Number(reading.temperature); const position = point(value, index); const unsafe = value < range.min_temperature || value > range.max_temperature; return <circle key={reading.id || index} cx={position.x} cy={position.y} r="1.7" className={unsafe ? 'violation-point' : ''}><title>{value.toFixed(1)} C / {formatDate(reading.recorded_at)}</title></circle>; })}</svg><div className="chart-labels"><span>{formatDate(readings[0].recorded_at)}</span><span>{formatDate(readings.at(-1).recorded_at)}</span></div><div className="chart-range">{min.toFixed(1)} to {max.toFixed(1)} C display range</div></div>;
}

function TemperatureSummary({ shipment }) {
  const latest = shipment.temperature_history.at(-1);
  return <div className="shipment-live-card">
    <div>
      <span>Current temperature</span>
      <strong>{shipment.current_temperature === null ? 'No reading' : `${shipment.current_temperature} C`}</strong>
    </div>
    <div>
      <span>Temperature status</span>
      <StatusBadge>{shipment.temperature_status}</StatusBadge>
    </div>
    <div>
      <span>Device connection</span>
      <StatusBadge>{shipment.device_connection}</StatusBadge>
    </div>
    <div>
      <span>Last reading</span>
      <strong>{formatDate(shipment.temperature_recorded_at || latest?.recorded_at)}</strong>
    </div>
  </div>;
}

function ShipmentOverview({ shipment, showRiderConfirmation = true }) {
  const riderConfirmation = shipment.rider_assignment_status === 'Accepted'
    ? <><StatusBadge>Accepted</StatusBadge><span className="mono">Accepted and in transit</span></>
    : shipment.rider_assignment_status === 'Rejected' ? <StatusBadge>Rejected</StatusBadge> : <StatusBadge>Pending</StatusBadge>;
  return <section className="shipment-summary">
    <div className="shipment-summary-main">
      <span>Shipment status</span>
      <StatusBadge>{shipment.status}</StatusBadge>
    </div>
    <div className="shipment-summary-grid">
      <DetailItem label="Assigned personnel">{shipment.assigned_personnel}</DetailItem>
      <DetailItem label="Expected delivery">{formatDate(shipment.expected_delivery_date)}</DetailItem>
      <DetailItem label="Assigned quantity">{shipment.total_quantity} doses</DetailItem>
      <DetailItem label="Allowed temperature">{shipment.temperature_range.min_temperature} to {shipment.temperature_range.max_temperature} C</DetailItem>
      {showRiderConfirmation && <DetailItem label="Rider confirmation">{riderConfirmation}</DetailItem>}
      {shipment.dispatch_date && <DetailItem label="Dispatch">{formatDate(shipment.dispatch_date)}</DetailItem>}
    </div>
  </section>;
}

function DeliveryPanel({ shipment, submit, error, userRole }) {
  if (shipment.delivery) {
    return <section className="modal-section"><h3>Delivery</h3><div className="detail-grid compact">
      <DetailItem label="Receiver">{shipment.delivery.receiver}</DetailItem>
      <DetailItem label="Delivered">{formatDate(shipment.delivery.delivered_at)}</DetailItem>
      <DetailItem label="Quantity received">{shipment.delivery.quantity_received}</DetailItem>
      <DetailItem label="Condition">{shipment.delivery.condition}</DetailItem>
      <DetailItem label="Temperature status"><StatusBadge>{shipment.delivery.temperature_status}</StatusBadge></DetailItem>
    </div></section>;
  }
  if (shipment.status !== 'Arrived') {
    return <section className="modal-section"><h3>Delivery</h3><div className="compact-empty">Delivery confirmation is available once this shipment has arrived.</div></section>;
  }
  if (userRole === 'staff') {
    return <section className="modal-section"><h3>Delivery</h3><div className="compact-empty">Delivery confirmation is restricted to authorized delivery users. Staff can monitor this shipment only.</div></section>;
  }
  return <section className="modal-section"><h3>Delivery</h3><form className="stack-form" onSubmit={submit('delivery', `/api/shipments/${shipment.id}/delivery`)}>
    <FormMessage>{error}</FormMessage>
    <div className="field"><label htmlFor="delivery-receiver">Receiver</label><input id="delivery-receiver" name="receiver" required /></div>
    <div className="field"><label htmlFor="delivery-quantity">Quantity received</label><input id="delivery-quantity" name="quantity_received" type="number" min="0" max={shipment.total_quantity} required /></div>
    <div className="field"><label htmlFor="delivery-condition">Shipment condition</label><input id="delivery-condition" name="condition" required /></div>
    <div className="field"><label htmlFor="delivery-temperature">Temperature status</label><select id="delivery-temperature" name="temperature_status"><option>Within range</option><option>Excursion detected</option><option>Not verified</option></select></div>
    <button className="primary button-with-icon" type="submit"><Icon name="package-check" /><span>Confirm delivery</span></button>
  </form></section>;
}

function ShipmentDetailContent({ shipment, mutate, userRole }) {
  const [errors, setErrors] = useState({});
  const submit = (kind, path, method = 'POST') => async event => {
    event.preventDefault(); setErrors(current => ({ ...current, [kind]: '' }));
    const form = event.currentTarget;
    [...form.elements].forEach(element => { if ('disabled' in element) element.disabled = true; });
    try { await mutate(path, { method, body: JSON.stringify(formValues(form)) }); }
    catch (error) { setErrors(current => ({ ...current, [kind]: error.message })); [...form.elements].forEach(element => { if ('disabled' in element) element.disabled = false; }); }
  };
  const activeAlerts = shipment.alerts.filter(alert => alert.status === 'Active');
  return <div className="shipment-detail-layout">
    <section className="modal-section shipment-temperature-panel">
      <div className="section-minihead"><h3>Temperature monitoring</h3>{shipment.current_temperature !== null && <StatusBadge>{shipment.current_temperature} C</StatusBadge>}</div>
      <TemperatureSummary shipment={shipment} />
      {shipment.reading_stale && <div className="compact-empty stale-reading">Latest hardware reading is stale. Check device power, Wi-Fi, and API access.</div>}
      <TemperatureGraph readings={shipment.temperature_history} range={shipment.temperature_range} />
    </section>
    <div className="shipment-side-panel">
      {activeAlerts.length > 0 && <section className="modal-section alert-section"><h3>Active alerts</h3>{activeAlerts.slice(0, 3).map(alert => <div className="list-row static" key={alert.id}><span><strong>{alert.temperature} C</strong><small>{formatDate(alert.recorded_at)}</small></span><span><StatusBadge>{alert.status}</StatusBadge><small>{alert.min_temperature} to {alert.max_temperature} C</small></span></div>)}</section>}
      <section className="modal-section"><h3>Vaccine batches</h3>{shipment.batches.map(batch => <div className="list-row static" key={batch.id}><span><strong>{batch.vaccine_name}</strong><small>Batch {batch.batch_number}</small></span><span><strong>{batch.assigned_quantity} doses</strong><small>{batch.min_temperature} to {batch.max_temperature} C</small></span></div>)}</section>
      {shipment.location_history.length > 0 && <section className="modal-section"><h3>Recent GPS</h3>{shipment.location_history.slice(-3).reverse().map(point => <div className="list-row static" key={point.id}><span><strong>{point.latitude}, {point.longitude}</strong><small>{formatDate(point.recorded_at)}</small></span></div>)}</section>}
      <DeliveryPanel shipment={shipment} submit={submit} error={errors.delivery} userRole={userRole} />
    </div>
  </div>;
}

export function ShipmentDetailModal({ id, userRole, onClose, onChanged, notify }) {
  const [version, setVersion] = useState(0);
  const { data: shipment, error, loading } = useApiData(`/api/shipments/${id}`, version, { refreshIntervalMs: 5000 });
  const mutate = async (path, options, success = 'Shipment updated') => {
    await api(path, options); notify(success); setVersion(value => value + 1); onChanged();
  };
  if (loading && !shipment) return <Modal title="Shipment" subtitle="Loading tracking details." wide onClose={onClose}><LoadingState /></Modal>;
  if (error) return <Modal title="Shipment" subtitle="Tracking details unavailable." wide onClose={onClose}><ErrorState message={error} /></Modal>;
  return <Modal title={shipment.tracking_code} subtitle={`${shipment.origin} to ${shipment.destination}`} wide onClose={onClose}>
    <ShipmentOverview shipment={shipment} showRiderConfirmation={userRole !== 'staff'} />
    <ShipmentTimeline status={shipment.status} />
    <ShipmentDetailContent shipment={shipment} mutate={mutate} userRole={userRole} />
  </Modal>;
}
