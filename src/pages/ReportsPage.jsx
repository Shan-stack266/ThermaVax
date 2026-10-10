import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import DataTable from '../components/DataTable';
import Icon from '../components/Icon';
import { ErrorState, LoadingState, SectionHeading } from '../components/Common';
import { exportCsv } from '../utils/format';

const labels = { inventory: 'Vaccine inventory', expiration: 'Expiring / expired', shipments: 'Shipment history', temperatures: 'Temperature history', deliveries: 'Delivery history' };
const hidden = ['id', 'public_token', 'created_by', 'confirmed_by', 'resolved_by'];

export default function ReportsPage({ refreshKey, notify }) {
  const [type, setType] = useState('inventory');
  const { data: rows, error, loading } = useApiData(`/api/reports/${type}`, refreshKey);
  const columns = rows?.length ? Object.keys(rows[0]).filter(key => !hidden.includes(key)).map(key => ({ key, label: key.replaceAll('_', ' '), render: row => String(row[key] ?? '') })) : [];
  return <><SectionHeading title="Operational reports" description="Exportable inventory, shipment, sensor, and delivery records." action={<button className="secondary button-with-icon" disabled={!rows?.length} onClick={() => { if (!exportCsv(labels[type], rows || [])) notify('No report records to export'); }}><Icon name="download" /><span>Export CSV</span></button>} /><div className="report-tabs">{Object.entries(labels).map(([key, label]) => <button key={key} className={key === type ? 'active' : ''} onClick={() => setType(key)}>{label}</button>)}</div><div className="panel">{loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length ? <DataTable columns={columns} rows={rows} rowKey={row => row.id || JSON.stringify(row)} getSearchText={row => Object.values(row).join(' ')} /> : <div className="compact-empty large">No records are available for this report.</div>}</div></>;
}
