import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export default function Modal({ title, subtitle, wide = false, onClose, children }) {
  const modalRef = useRef(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    document.body.classList.add('modal-open');
    modalRef.current?.querySelector('input, select, button, [tabindex]:not([tabindex="-1"])')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') return onClose();
      if (event.key !== 'Tab') return;
      const focusable = [...modalRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', handleKey);
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={modalRef} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><h2 id="modal-title">{title}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="x" /></button></div>{children}</div></div>, document.body);
}
