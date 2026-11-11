import { useEffect, useState } from 'react';
import api, { errorMessage } from '../services/api';
import { Check, Search, UserPlus } from './Icons';
import './AddContact.css';

const LABELS = { contact: 'In your contacts', sent: 'Request sent', received: 'Wants to connect — see Requests', blocked: 'Blocked' };

// Search people by name (or exact email) and send them a contact request.
// Calls become possible once they accept.
export default function AddContact({ onChanged }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(null);

  const q = query.trim();

  // Debounced search
  useEffect(() => {
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .get('/contacts/search', { params: { q } })
        .then(({ data }) => !cancelled && (setResults(data.results), setError('')))
        .catch((err) => !cancelled && setError(errorMessage(err, 'Search failed')))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const sendRequest = async (person) => {
    setError('');
    setSending(person.id);
    try {
      const { data } = await api.post('/contacts/requests', { userId: person.id });
      const relation = data.status === 'accepted' ? 'contact' : 'sent';
      setResults((prev) => prev.map((r) => (r.id === person.id ? { ...r, relation } : r)));
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not send the request'));
    } finally {
      setSending(null);
    }
  };

  return (
    <section className="add-contact">
      <h2>
        <UserPlus size={18} /> Find people
      </h2>
      <div className="add-contact-search">
        <Search size={16} />
        <input
          type="search"
          placeholder="Search by name or exact email"
          aria-label="Search people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}

      {q.length >= 2 && !searching && results.length === 0 && !error && (
        <p className="add-contact-empty">No one found. Try their full email address.</p>
      )}

      {results.map((p) => (
        <div className="add-contact-result" key={p.id}>
          <div className="avatar">{p.name.charAt(0)}</div>
          <div className="add-contact-who">
            <div className="contact-name">{p.name}</div>
            <div className="contact-email">{p.email}</div>
          </div>
          {p.relation === 'none' ? (
            <button className="btn btn-primary" disabled={sending === p.id} onClick={() => sendRequest(p)}>
              {sending === p.id ? 'Sending…' : 'Send request'}
            </button>
          ) : (
            <span className="add-contact-state">
              {(p.relation === 'sent' || p.relation === 'contact') && <Check size={14} />} {LABELS[p.relation]}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
