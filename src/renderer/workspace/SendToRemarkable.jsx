import React from 'react';
import { api, errorMessage } from '../api.js';

// Send to reMarkable (2026-10-31, src/main/remarkable/send.cjs): the PDF open in the Stage handed to the reMarkable app,
// which imports it and syncs it to the tablet. From the Stage's ⋮ menu; the card says what came of it: in the
// reMarkable app; handed over (its library could not be read to tell); or, when the app did not take it by itself, the
// file to drag into the app's window (reMarkable's own way), then in the app once it shows in its library. `rowId`: the
// library row the PDF is, so what is written on it on the tablet comes back onto that item (null: not in the library).

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const say = { font: '13px/1.5 var(--font-sans)', color: '#171717', margin: 0, overflowWrap: 'anywhere' };
const quiet = { ...say, fontSize: 12, color: '#8f8f8f', marginTop: 6 };

export default function SendToRemarkable({ name, bytes, rowId = null, onClose }) {
  const [step, setStep] = React.useState({ state: 'sending' });
  React.useEffect(() => {
    let live = true;
    let waiting = null; // the name main waits for while the card offers the drag: the wait ends when the card closes
    (async () => {
      try {
        const result = await api.remarkableSend(name, bytes, rowId || null);
        if (!live) return;
        if (result.error) { setStep({ state: 'error', error: result.error }); return; }
        setStep(result);
        if (result.state === 'drop') {
          waiting = result.name;
          const after = await api.remarkableAwaitDrop({ name: result.name, since: result.since, file: result.file });
          waiting = null;
          if (live) setStep((now) => (now.state === 'drop' ? { ...now, state: after.state === 'sent' ? 'sent' : 'waited' } : now));
        }
      } catch (error) {
        if (live) setStep({ state: 'error', error: errorMessage(error) });
      }
    })();
    return () => { live = false; if (waiting) void api.remarkableCancelDrop(waiting).catch(() => {}); };
  }, [name, bytes, rowId]);
  const title = `“${step.name || name}”`;
  const chip = step.file && (
    <div
      draggable
      data-remarkable-drag="1"
      onDragStart={(event) => { event.preventDefault(); api.remarkableDrag(step.file); }}
      title="Drag into the reMarkable app's window"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10, padding: '6px 10px', border: '1px solid #eaeaea', borderRadius: 6, background: '#fafafa', cursor: 'grab', font: '500 12.5px/1 var(--font-sans)', color: '#171717', userSelect: 'none' }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1.5h5l3 3v10H4z" /><path d="M9 1.5v3h3" /></svg>
      {`${step.name}.pdf`}
    </div>
  );
  return (
    <div data-overlay="1" data-send-remarkable={step.state} role="status" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
      style={{ position: 'absolute', right: 10, top: 44, zIndex: 40, width: 360, maxWidth: 'calc(100% - 20px)', boxSizing: 'border-box', padding: '14px 36px 14px 16px', background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.06)', textAlign: 'left', animation: `rise 160ms ${EASE}` }}>
      <button type="button" className="hov-wash" onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 8, top: 8, width: 22, height: 22, border: 0, borderRadius: 5, background: 'transparent', cursor: 'pointer', font: '15px/1 var(--font-sans)', color: '#8f8f8f' }}>×</button>
      {step.state === 'sending' && <p style={say}>Sending {title} to your reMarkable…</p>}
      {step.state === 'sent' && <><p style={say}>{title} is in the reMarkable app.</p><p style={quiet}>It will be on your tablet once the app has synced.</p></>}
      {step.state === 'given' && <><p style={say}>{title} went to the reMarkable app.</p><p style={quiet}>Look for it there; it syncs to your tablet from the app.</p></>}
      {step.state === 'drop' && <><p style={say}>The reMarkable app didn’t take {title} by itself. Drag it into the app’s window:</p>{chip}<p style={quiet}>Waiting for it to arrive…</p></>}
      {step.state === 'waited' && <><p style={say}>{title} hasn’t shown up in the reMarkable app yet. Is the app open? You can drag it in again:</p>{chip}</>}
      {step.state === 'error' && <p role="alert" style={{ ...say, color: 'var(--red-600)' }}>{step.error}</p>}
    </div>
  );
}
