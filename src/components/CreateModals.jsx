import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import { api } from '../services/api';
import { formValues } from '../utils/format';
import Modal from './Modal';
import FormMessage from './FormMessage';
import { ErrorState, LoadingState } from './Common';

export function BatchFormModal({ onClose, onCreated, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/api/batches', { method: 'POST', body: JSON.stringify(formValues(event.currentTarget)) });
      notify('Vaccine batch created'); onClose(); onCreated();
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  return <Modal title="Add vaccine batch" subtitle="Create an inventory batch with its storage requirements." onClose={onClose}>
    <form className="form-grid" onSubmit={submit}><FormMessage>{error}</FormMessage>
      <div className="field"><label htmlFor="batch-number">Batch number</label><input id="batch-number" name="batch_number" required /></div>
      <div className="field"><label htmlFor="vaccine-name">Vaccine name</label><input id="vaccine-name" name="vaccine_name" required /></div>
      <div className="field"><label htmlFor="batch-quantity">Quantity</label><input id="batch-quantity" name="quantity" type="number" min="1" step="1" required /></div>
      <div className="field"><label htmlFor="manufacturing-date">Manufacturing date</label><input id="manufacturing-date" name="manufacturing_date" type="date" required /></div>
      <div className="field"><label htmlFor="expiration-date">Expiration date</label><input id="expiration-date" name="expiration_date" type="date" required /></div>
      <div className="field"><label htmlFor="minimum-temperature">Minimum temperature C</label><input id="minimum-temperature" name="min_temperature" type="number" step="0.1" required /></div>
      <div className="field"><label htmlFor="maximum-temperature">Maximum temperature C</label><input id="maximum-temperature" name="max_temperature" type="number" step="0.1" required /></div>
      <div className="form-actions full-width"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create batch'}</button></div>
    </form>
  </Modal>;
}

export function ShipmentFormModal({ onClose, onCreated, notify }) {
  const { data, error: loadError, loading } = useApiData('/api/batches');
  const { data: riders, error: ridersError, loading: ridersLoading } = useApiData('/api/riders');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const batches = (data || []).filter(batch => batch.status === 'Available' && batch.available_quantity > 0 && batch.expiration_status !== 'Expired');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const values = formValues(event.currentTarget);
    values.batches = batches.map(batch => ({ batch_id: batch.id, quantity: Number(values[`batch_${batch.id}`] || 0) })).filter(item => item.quantity > 0);
    Object.keys(values).filter(key => key.startsWith('batch_')).forEach(key => delete values[key]);
    try {
      await api('/api/shipments', { method: 'POST', body: JSON.stringify(values) });
      notify('Shipment created'); onClose(); onCreated();
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  return <Modal title="Add shipment" subtitle="Assign vaccine batches and create a monitored route." wide onClose={onClose}>
    {loading || ridersLoading ? <LoadingState /> : loadError || ridersError ? <ErrorState message={[loadError && `Batch lookup: ${loadError}`, ridersError && `Rider lookup: ${ridersError}`].filter(Boolean).join(' | ')} /> : !batches.length ? <div className="compact-empty large">No available non-expired batches can be assigned.</div> : !riders.length ? <div className="compact-empty large">No verified active riders are available. Create and confirm a rider account first.</div> : <form className="form-grid" onSubmit={submit}><FormMessage>{error}</FormMessage>
      <div className="field"><label htmlFor="origin">Origin</label><input id="origin" name="origin" required /></div>
      <div className="field"><label htmlFor="destination">Destination</label><input id="destination" name="destination" required /></div>
      <div className="field"><label htmlFor="dispatch-date">Dispatch date</label><input id="dispatch-date" name="dispatch_date" type="datetime-local" /></div>
      <div className="field"><label htmlFor="delivery-date">Expected delivery</label><input id="delivery-date" name="expected_delivery_date" type="datetime-local" required /></div>
      <div className="field full-width"><label htmlFor="personnel">Verified rider</label><select id="personnel" name="assigned_personnel" required defaultValue=""><option value="" disabled>Select a rider</option>{riders.map(rider => <option key={rider.id} value={rider.name}>{rider.name}{rider.active_deliveries ? ` - On ${rider.active_deliveries} active deliver${rider.active_deliveries === 1 ? 'y' : 'ies'}` : ' - Available'}</option>)}</select><small className="field-hint">Active delivery counts include unfinished shipments assigned to this rider.</small></div>
      <div className="field full-width"><label>Batch allocation</label><div className="allocation-list">{batches.map(batch => <div className="allocation-row" key={batch.id}><span><strong>{batch.vaccine_name}</strong><small>Batch {batch.batch_number} / {batch.available_quantity} available / {batch.min_temperature} to {batch.max_temperature} C</small></span><input type="number" min="0" max={batch.available_quantity} step="1" defaultValue="0" aria-label={`Quantity from batch ${batch.batch_number}`} name={`batch_${batch.id}`} /></div>)}</div></div>
      <div className="form-actions full-width"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create shipment'}</button></div>
    </form>}
  </Modal>;
}

export function StaffFormModal({ onClose, onCreated, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const values = formValues(event.currentTarget);
    if (values.password !== values.confirm_password) { setError('Passwords do not match'); setBusy(false); return; }
    try {
      const role = values.role || 'staff';
      const created = await api('/api/users', { method: 'POST', body: JSON.stringify({ email: values.email, password: values.password, role }) });
      notify(created.confirmation_required ? `${role === 'rider' ? 'Rider' : 'Staff'} created. Confirmation email sent.` : `${role === 'rider' ? 'Rider' : 'Staff'} account created`); onClose(); onCreated();
    } catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  return <Modal title="Add staff or rider account" subtitle="Create login access for an operational team member." onClose={onClose}>
    <form className="stack-form" onSubmit={submit}><FormMessage>{error}</FormMessage>
      <div className="field"><label htmlFor="staff-email">Email address</label><input id="staff-email" name="email" type="email" autoComplete="off" required /></div>
      <div className="field"><label htmlFor="staff-role">Account type</label><select id="staff-role" name="role" defaultValue="staff"><option value="staff">Operations staff</option><option value="rider">Rider</option></select></div>
      <div className="field"><label htmlFor="staff-password">Temporary password</label><input id="staff-password" name="password" type="password" minLength="8" autoComplete="new-password" required /></div>
      <div className="field"><label htmlFor="staff-confirm-password">Confirm password</label><input id="staff-confirm-password" name="confirm_password" type="password" minLength="8" autoComplete="new-password" required /></div>
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create staff'}</button></div>
    </form>
  </Modal>;
}
