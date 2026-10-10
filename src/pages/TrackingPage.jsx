import useApiData from '../hooks/useApiData';
import { Brand, DetailItem, ErrorState, LoadingState, PanelHeader, StatusBadge } from '../components/Common';
import ThemeToggle from '../components/ThemeToggle';
import { formatDate } from '../utils/format';

function BatchTracking({ data }) {
  const batch = data.batch;
  return <><div className="detail-grid public-details"><DetailItem label="Vaccine">{batch.vaccine_name}</DetailItem><DetailItem label="Batch number">{batch.batch_number}</DetailItem><DetailItem label="Available quantity">{batch.available_quantity} of {batch.quantity}</DetailItem><DetailItem label="Expiration"><StatusBadge>{batch.expiration_status}</StatusBadge></DetailItem><DetailItem label="Required temperature">{batch.min_temperature} to {batch.max_temperature} C</DetailItem><DetailItem label="Batch status"><StatusBadge>{batch.status}</StatusBadge></DetailItem></div><section className="panel tracking-section"><PanelHeader title="Shipment history" description="Movements associated with this vaccine batch" />{data.shipments.length ? <div className="table-scroll"><table><thead><tr><th>Shipment</th><th>Route</th><th>Quantity</th><th>Temperature</th><th>Status</th></tr></thead><tbody>{data.shipments.map(item => <tr key={item.tracking_code}><td>{item.tracking_code}</td><td>{item.origin} to {item.destination}</td><td>{item.quantity}</td><td>{item.current_temperature ?? 'No reading'} C</td><td><StatusBadge>{item.status}</StatusBadge></td></tr>)}</tbody></table></div> : <div className="compact-empty large">No shipment history</div>}</section></>;
}

function ShipmentTracking({ shipment }) {
  return <>
    <section className="shipment-summary public-shipment-summary">
      <div className="shipment-summary-main">
        <span>Shipment status</span>
        <StatusBadge>{shipment.status}</StatusBadge>
      </div>
      <div className="shipment-summary-grid">
        <DetailItem label="Route">{shipment.origin} to {shipment.destination}</DetailItem>
        <DetailItem label="Expected delivery">{formatDate(shipment.expected_delivery_date)}</DetailItem>
        <DetailItem label="Assigned quantity">{shipment.total_quantity} doses</DetailItem>
        <DetailItem label="Device connection"><StatusBadge>{shipment.device_connection}</StatusBadge></DetailItem>
      </div>
    </section>
    <section className="panel tracking-section public-live-panel">
      <PanelHeader title="Temperature monitoring" description="Latest reading from the shipment record" />
      <div className="shipment-live-card">
        <div><span>Current temperature</span><strong>{shipment.current_temperature === null ? 'No reading' : `${shipment.current_temperature} C`}</strong></div>
        <div><span>Temperature status</span><StatusBadge>{shipment.temperature_status}</StatusBadge></div>
        <div><span>Temperature updated</span><strong>{formatDate(shipment.temperature_recorded_at)}</strong></div>
      </div>
      {shipment.reading_stale && <div className="compact-empty stale-reading">Latest hardware reading is stale. Check device power, Wi-Fi, and API access.</div>}
    </section>
    <section className="panel tracking-section"><PanelHeader title="Vaccine batches" description={`${shipment.total_quantity} doses assigned`} /><div className="list">{shipment.batches.map(batch => <div className="list-row static" key={batch.batch_number}><span><strong>{batch.vaccine_name}</strong><small>Batch {batch.batch_number}</small></span><span><strong>{batch.assigned_quantity} doses</strong><small>{batch.min_temperature} to {batch.max_temperature} C</small></span></div>)}</div></section>
    {shipment.delivery && <section className="panel tracking-section"><PanelHeader title="Delivery confirmation" /><div className="detail-grid"><DetailItem label="Delivered">{formatDate(shipment.delivery.delivered_at)}</DetailItem><DetailItem label="Condition">{shipment.delivery.condition}</DetailItem><DetailItem label="Temperature status"><StatusBadge>{shipment.delivery.temperature_status}</StatusBadge></DetailItem></div></section>}
  </>;
}

export default function TrackingPage({ token, theme, onToggleTheme }) {
  const { data, error, loading } = useApiData(`/api/tracking/${encodeURIComponent(token)}`, 0, { refreshIntervalMs: 5000 });
  const title = data?.type === 'batch' ? `${data.batch.vaccine_name} / ${data.batch.batch_number}` : data?.shipment?.tracking_code;
  return <main className="tracking-page"><header className="tracking-header"><Brand /><div className="tracking-header-actions"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><a href="/" className="secondary">Workspace sign in</a></div></header><section className="tracking-content">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : <><span className="eyebrow">Verified tracking record</span><h1>{title}</h1>{data.type === 'batch' ? <BatchTracking data={data} /> : <ShipmentTracking shipment={data.shipment} />}</>}</section></main>;
}
