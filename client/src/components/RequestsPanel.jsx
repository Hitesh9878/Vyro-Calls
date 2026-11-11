import { Ban, Check, X } from './Icons';
import './RequestsPanel.css';

function Row({ user, children, sub }) {
  return (
    <div className="req-row">
      <div className="avatar">{user.name.charAt(0)}</div>
      <div className="req-who">
        <div className="contact-name">{user.name}</div>
        <div className="contact-email">{sub || user.email}</div>
      </div>
      <div className="req-actions">{children}</div>
    </div>
  );
}

export default function RequestsPanel({ incoming, outgoing, blocked, onAccept, onDecline, onCancel, onBlock, onUnblock }) {
  const nothing = !incoming.length && !outgoing.length && !blocked.length;

  return (
    <div className="req-panel">
      {nothing && <p className="req-empty">No requests. Search for people on the Contacts tab to send one.</p>}

      {incoming.length > 0 && (
        <section className="req-section">
          <h3>Requests for you ({incoming.length})</h3>
          {incoming.map((r) => (
            <Row key={r.id} user={r.user}>
              <button className="btn btn-green" title="Accept" onClick={() => onAccept(r.id)}>
                <Check size={18} />
              </button>
              <button className="btn btn-ghost" title="Decline" onClick={() => onDecline(r.id)}>
                <X size={18} />
              </button>
              <button className="btn btn-ghost" title="Block" onClick={() => onBlock(r.user.id)}>
                <Ban size={18} />
              </button>
            </Row>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="req-section">
          <h3>Waiting for them to accept ({outgoing.length})</h3>
          {outgoing.map((r) => (
            <Row key={r.id} user={r.user}>
              <button className="btn btn-ghost" onClick={() => onCancel(r.id)}>
                Cancel
              </button>
            </Row>
          ))}
        </section>
      )}

      {blocked.length > 0 && (
        <section className="req-section">
          <h3>Blocked ({blocked.length})</h3>
          <p className="req-note">Blocked people can’t call you, invite you to group calls or send you requests.</p>
          {blocked.map((u) => (
            <Row key={u.id} user={u}>
              <button className="btn btn-ghost" onClick={() => onUnblock(u.id)}>
                Unblock
              </button>
            </Row>
          ))}
        </section>
      )}
    </div>
  );
}
