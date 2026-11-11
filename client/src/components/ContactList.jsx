import { useState } from 'react';
import { Ban, Phone, Search, Trash, Video, X } from './Icons';
import './ContactList.css';

export default function ContactList({ contacts, online, busy, onCall, onRemove, onBlock }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // Filter by name, then: online contacts first, alphabetical within each group
  const sorted = contacts
    .filter((c) => !q || c.user.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const diff = Number(online.has(b.user.id)) - Number(online.has(a.user.id));
      return diff || a.user.name.localeCompare(b.user.name);
    });

  return (
    <section className="contact-list">
      <div className="contact-list-header">
        {q ? `Contacts (${sorted.length} of ${contacts.length})` : `Contacts (${contacts.length})`}
      </div>

      {contacts.length > 0 && (
        <div className="contact-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search contacts by name"
            aria-label="Search contacts by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="contact-search-clear" title="Clear search" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {contacts.length === 0 && (
        <p className="contact-list-empty">
          No contacts yet. Search for someone above and send a request. Once they accept, you can call each other.
        </p>
      )}

      {contacts.length > 0 && sorted.length === 0 && (
        <p className="contact-list-empty">No contacts match “{query.trim()}”.</p>
      )}

      {sorted.map((c) => {
        const isOnline = online.has(c.user.id);
        return (
          <div className="contact-item" key={c.id}>
            <div className="contact-avatar-wrap">
              <div className="avatar">{c.user.name.charAt(0)}</div>
              <span className={`contact-status-dot ${isOnline ? 'online' : ''}`} />
            </div>

            <div className="contact-info">
              <div className="contact-name">{c.user.name}</div>
              <div className="contact-email">{isOnline ? 'Online' : `Offline · ${c.user.email}`}</div>
            </div>

            <div className="contact-actions">
              <button
                className="btn btn-green"
                title={isOnline ? 'Voice call' : 'Voice call (they are offline, we will email them)'}
                disabled={busy}
                onClick={() => onCall(c.user, 'audio')}
              >
                <Phone size={18} />
              </button>
              <button
                className="btn btn-primary"
                title={isOnline ? 'Video call' : 'Video call (they are offline, we will email them)'}
                disabled={busy}
                onClick={() => onCall(c.user, 'video')}
              >
                <Video size={18} />
              </button>
              <button className="btn btn-ghost" title="Block" onClick={() => onBlock(c.user)}>
                <Ban size={18} />
              </button>
              <button
                className="btn btn-ghost"
                title="Remove contact"
                onClick={() => onRemove(c.id)}
              >
                <Trash size={18} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
