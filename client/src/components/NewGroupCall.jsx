import { useState } from 'react';
import { Phone, Video, X } from './Icons';
import './NewGroupCall.css';

const MAX_INVITEES = 5; // up to 6 people including you

export default function NewGroupCall({ contacts, online, onStart, onClose }) {
  const [picked, setPicked] = useState([]);

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_INVITEES ? [...prev, id] : prev));

  const start = (type) => onStart(contacts.filter((c) => picked.includes(c.user.id)).map((c) => c.user), type);
  const sorted = [...contacts].sort(
    (a, b) => Number(online.has(b.user.id)) - Number(online.has(a.user.id)) || a.user.name.localeCompare(b.user.name)
  );

  return (
    <div className="incoming-backdrop" onClick={onClose}>
      <div className="ngc-card" onClick={(e) => e.stopPropagation()}>
        <div className="ngc-head">
          <h2>New group call</h2>
          <button className="btn btn-ghost" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="ngc-hint">
          Pick 2–{MAX_INVITEES} contacts ({picked.length} selected). Offline contacts get an email invitation.
        </p>

        <div className="ngc-list">
          {sorted.length === 0 && <p className="contact-list-empty">You have no contacts yet.</p>}
          {sorted.map((c) => (
            <label className="ngc-item" key={c.id}>
              <input type="checkbox" checked={picked.includes(c.user.id)} onChange={() => toggle(c.user.id)} />
              <div className="avatar">{c.user.name.charAt(0)}</div>
              <div className="ngc-name">
                {c.user.name}
                <span className={`ngc-state ${online.has(c.user.id) ? 'on' : ''}`}>
                  {online.has(c.user.id) ? 'Online' : 'Offline'}
                </span>
              </div>
            </label>
          ))}
        </div>

        <div className="ngc-actions">
          <button className="btn btn-green" disabled={picked.length < 2} onClick={() => start('audio')}>
            <Phone size={18} /> Voice
          </button>
          <button className="btn btn-primary" disabled={picked.length < 2} onClick={() => start('video')}>
            <Video size={18} /> Video
          </button>
        </div>
      </div>
    </div>
  );
}
