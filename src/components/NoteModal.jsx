import { useState } from 'react';
import Modal from './Modal';
import FormMessage from './FormMessage';

export default function NoteModal({ title, subtitle, label, actionLabel, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    const value = note.trim();
    if (!value) {
      setError(`${label} is required`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(value);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };
  return <Modal title={title} subtitle={subtitle} onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <FormMessage>{error}</FormMessage>
      <div className="field"><label htmlFor="note-modal-text">{label}</label><textarea id="note-modal-text" value={note} onChange={event => setNote(event.target.value)} maxLength="1000" rows="5" required /></div>
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : actionLabel}</button></div>
    </form>
  </Modal>;
}
