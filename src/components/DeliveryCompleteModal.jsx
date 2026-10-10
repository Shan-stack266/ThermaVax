import { useState } from 'react';
import Modal from './Modal';
import FormMessage from './FormMessage';

export default function DeliveryCompleteModal({ shipment, onClose, onSubmit }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        receiver: form.receiver.value,
        quantity_received: Number(form.quantity_received.value),
        condition: form.condition.value,
        temperature_status: form.temperature_status.value
      });
      onClose();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };
  return <Modal title="Mark delivered" subtitle={shipment.tracking_code} onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <FormMessage>{error}</FormMessage>
      <div className="field"><label htmlFor="delivered-receiver">Receiver</label><input id="delivered-receiver" name="receiver" required /></div>
      <div className="field"><label htmlFor="delivered-quantity">Quantity received</label><input id="delivered-quantity" name="quantity_received" type="number" min="0" max={shipment.total_quantity} defaultValue={shipment.total_quantity} required /></div>
      <div className="field"><label htmlFor="delivered-condition">Shipment condition</label><input id="delivered-condition" name="condition" defaultValue="Delivered in good condition" required /></div>
      <div className="field"><label htmlFor="delivered-temperature">Temperature status</label><select id="delivered-temperature" name="temperature_status" defaultValue="Not verified"><option>Within range</option><option>Excursion detected</option><option>Not verified</option></select></div>
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Mark delivered'}</button></div>
    </form>
  </Modal>;
}
