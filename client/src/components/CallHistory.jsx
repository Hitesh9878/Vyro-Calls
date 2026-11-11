import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from './Icons';
import './CallHistory.css';

function formatDuration(sec) {
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
}

function formatWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })}, ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function describe(c) {
  const incoming = c.direction === 'incoming';
  if (c.status === 'missed') return incoming ? 'Missed' : 'No answer';
  if (c.status === 'declined') return incoming ? 'You declined' : 'Declined';
  const label = incoming ? 'Incoming' : 'Outgoing';
  return c.duration ? `${label} · ${formatDuration(c.duration)}` : label;
}

export default function CallHistory({ calls, online, busy, onCall }) {
  if (calls.length === 0) {
    return (
      <section className="call-history">
        <p className="call-history-empty">No calls yet. Your recent and missed calls will show up here.</p>
      </section>
    );
  }

  return (
    <section className="call-history">
      {calls.map((c) => {
        const missedIn = c.direction === 'incoming' && c.status === 'missed';
        const Icon = missedIn ? PhoneMissed : c.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
        const isOnline = online.has(c.peer.id);
        const group = c.isGroup ? 'Group · ' : '';

        return (
          <div className="call-row" key={c.id}>
            <div className={`call-row-icon ${missedIn ? 'missed' : ''}`}>
              <Icon size={18} />
            </div>

            <div className="call-row-info">
              <div className={`call-row-name ${missedIn ? 'missed' : ''}`}>{c.peer.name}</div>
              <div className="call-row-detail">
                {c.callType === 'video' && <Video size={13} />}
                {group}{describe(c)} · {formatWhen(c.startedAt)}
              </div>
            </div>

            <div className="call-row-actions">
              <button
                className="btn btn-green"
                title={isOnline ? 'Call back' : 'Call back (offline, we will email them)'}
                disabled={busy}
                onClick={() => onCall(c.peer, 'audio')}
              >
                <Phone size={18} />
              </button>
              <button
                className="btn btn-primary"
                title={isOnline ? 'Video call' : 'Video call (offline, we will email them)'}
                disabled={busy}
                onClick={() => onCall(c.peer, 'video')}
              >
                <Video size={18} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
