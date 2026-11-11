import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import useCall from '../hooks/useCall';
import useGroupCall from '../hooks/useGroupCall';
import usePageActive from '../hooks/usePageActive';
import api, { errorMessage } from '../services/api';
import {
  notificationPermission,
  requestNotificationPermission,
  setTitleBadge,
} from '../utils/alerts';
import AddContact from '../components/AddContact';
import CallHistory from '../components/CallHistory';
import ContactList from '../components/ContactList';
import IncomingCall from '../components/IncomingCall';
import CallScreen from '../components/CallScreen';
import NotifyBanner from '../components/NotifyBanner';
import RequestsPanel from '../components/RequestsPanel';
import GroupCallScreen from '../components/GroupCallScreen';
import NewGroupCall from '../components/NewGroupCall';
import { Clock, LogOut, UserPlus, Users, Video } from '../components/Icons';
import Brand from '../components/Brand';
import './Dashboard.css';

const BANNER_KEY = 'notify-banner-dismissed';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const call = useCall(socket);
  const group = useGroupCall(socket, user.id, { canRing: call.status === 'idle' });
  const pageActive = usePageActive();

  const [tab, setTab] = useState('contacts'); // 'contacts' | 'requests' | 'recents'
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [blocked, setBlocked] = useState([]);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [online, setOnline] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [calls, setCalls] = useState([]);
  const [missedUnseen, setMissedUnseen] = useState(0);

  const [notifPermission, setNotifPermission] = useState(notificationPermission);
  const [bannerDismissed, setBannerDismissed] = useState(() => localStorage.getItem(BANNER_KEY) === '1');

  // Contacts, contact requests and the blocked list
  const loadPeople = useCallback(() => {
    Promise.all([api.get('/contacts'), api.get('/contacts/requests'), api.get('/contacts/blocked')])
      .then(([c, r, b]) => {
        setContacts(c.data.contacts);
        setOnline((prev) => {
          const next = new Set(prev);
          c.data.contacts.forEach((x) => x.online && next.add(x.user.id));
          return next;
        });
        setRequests(r.data);
        setBlocked(b.data.blocked);
      })
      .catch((err) => setError(errorMessage(err, 'Could not load contacts')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  // Call history + missed-call count
  const loadCalls = useCallback(() => {
    api
      .get('/calls')
      .then(({ data }) => {
        setCalls(data.calls);
        setMissedUnseen(data.missedUnseen);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  // Live presence (who is online) from the socket
  useEffect(() => {
    if (!socket) return;

    const onList = (ids) => setOnline(new Set(ids));
    const onUpdate = ({ userId, online: isOnline }) =>
      setOnline((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });

    socket.on('presence:list', onList);
    socket.on('presence:update', onUpdate);
    // A call just finished (or was missed), or we reconnected after a gap: refresh history
    socket.on('calls:updated', loadCalls);
    socket.on('connect', loadCalls);
    // Someone sent / accepted / removed a request, or blocked me
    socket.on('contacts:updated', loadPeople);
    return () => {
      socket.off('presence:list', onList);
      socket.off('presence:update', onUpdate);
      socket.off('calls:updated', loadCalls);
      socket.off('connect', loadCalls);
      socket.off('contacts:updated', loadPeople);
    };
  }, [socket, loadCalls, loadPeople]);

  // Missed-call count in the tab title, e.g. "(2) Vyro Calls"
  useEffect(() => {
    setTitleBadge(missedUnseen);
    return () => setTitleBadge(0);
  }, [missedUnseen]);

  // Looking at Recents (with the tab in view) counts as having seen the missed calls
  useEffect(() => {
    if (tab !== 'recents' || !pageActive || missedUnseen === 0) return;
    api
      .post('/calls/seen')
      .then(() => setMissedUnseen(0))
      .catch(() => {});
  }, [tab, pageActive, missedUnseen]);

  const act = async (fn, fallback) => {
    setError('');
    try {
      await fn();
      loadPeople();
    } catch (err) {
      setError(errorMessage(err, fallback));
    }
  };

  const handleRemove = (id) => act(() => api.delete(`/contacts/${id}`), 'Could not remove contact');
  const handleAccept = (id) => act(() => api.post(`/contacts/requests/${id}/accept`), 'Could not accept the request');
  const handleDecline = (id) => act(() => api.post(`/contacts/requests/${id}/decline`), 'Could not decline the request');
  const handleCancel = (id) => act(() => api.delete(`/contacts/requests/${id}`), 'Could not cancel the request');
  const handleUnblock = (userId) => act(() => api.delete(`/contacts/blocked/${userId}`), 'Could not unblock');
  const handleBlock = (target) => {
    const name = target.name || 'this person';
    if (!window.confirm(`Block ${name}? They won't be able to call you or send you requests, and they'll be removed from your contacts.`)) return;
    act(() => api.post('/contacts/blocked', { userId: target.id }), 'Could not block this person');
  };

  const startGroup = (users, type) => {
    setShowGroupPicker(false);
    group.startGroup(users, type);
  };

  const enableNotifications = async () => {
    setNotifPermission(await requestNotificationPermission());
  };

  const dismissBanner = () => {
    localStorage.setItem(BANNER_KEY, '1');
    setBannerDismissed(true);
  };

  const inCall = call.status !== 'idle' || group.status !== 'idle';
  const requestCount = requests.incoming.length;
  const showBanner = notifPermission === 'default' && !bannerDismissed;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-user">
          <Brand variant="icon" />
          <div className="avatar">{user.name.charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="dashboard-user-name">{user.name}</div>
            <div className="dashboard-user-email">{user.email}</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={logout}>
          <LogOut size={18} /> Log out
        </button>
      </header>

      <div className="dashboard-body">
        {showBanner && <NotifyBanner onEnable={enableNotifications} onDismiss={dismissBanner} />}

        <nav className="dashboard-tabs">
          <button
            className={`dashboard-tab ${tab === 'contacts' ? 'active' : ''}`}
            onClick={() => setTab('contacts')}
          >
            <Users size={17} /> Contacts
          </button>
          <button
            className={`dashboard-tab ${tab === 'requests' ? 'active' : ''}`}
            onClick={() => setTab('requests')}
          >
            <UserPlus size={17} /> Requests
            {requestCount > 0 && <span className="tab-badge">{requestCount}</span>}
          </button>
          <button
            className={`dashboard-tab ${tab === 'recents' ? 'active' : ''}`}
            onClick={() => setTab('recents')}
          >
            <Clock size={17} /> Recents
            {missedUnseen > 0 && <span className="tab-badge">{missedUnseen}</span>}
          </button>
        </nav>

        {error && <p className="error-text">{error}</p>}

        {tab === 'contacts' && (
          <>
            <AddContact onChanged={loadPeople} />
            <button
              className="btn btn-primary dashboard-group-btn"
              disabled={inCall || !socket || contacts.length < 2}
              title={contacts.length < 2 ? 'You need at least 2 contacts for a group call' : 'Start a group call'}
              onClick={() => setShowGroupPicker(true)}
            >
              <Users size={18} /> <Video size={18} /> New group call
            </button>
            {loading ? (
              <p style={{ color: 'var(--muted)' }}>Loading contacts…</p>
            ) : (
              <ContactList
                contacts={contacts}
                online={online}
                busy={inCall || !socket}
                onCall={call.startCall}
                onRemove={handleRemove}
                onBlock={handleBlock}
              />
            )}
          </>
        )}

        {tab === 'requests' && (
          <RequestsPanel
            incoming={requests.incoming}
            outgoing={requests.outgoing}
            blocked={blocked}
            onAccept={handleAccept}
            onDecline={handleDecline}
            onCancel={handleCancel}
            onBlock={(userId) => handleBlock({ id: userId, name: requests.incoming.find((r) => r.user.id === userId)?.user.name })}
            onUnblock={handleUnblock}
          />
        )}

        {tab === 'recents' && (
          <CallHistory
            calls={calls}
            online={online}
            busy={inCall || !socket}
            onCall={call.startCall}
          />
        )}
      </div>

      {showGroupPicker && (
        <NewGroupCall
          contacts={contacts}
          online={online}
          onStart={startGroup}
          onClose={() => setShowGroupPicker(false)}
        />
      )}

      {group.status === 'incoming' && group.invite && (
        <IncomingCall
          peer={group.invite.from}
          label={`Group ${group.invite.callType} call · ${group.invite.size} people`}
          callType={group.invite.callType}
          onAccept={group.acceptInvite}
          onReject={group.declineInvite}
        />
      )}

      {group.status === 'active' && group.room && (
        <GroupCallScreen
          callType={group.room.callType}
          myId={user.id}
          myName={user.name}
          members={group.members}
          streams={group.streams}
          localStream={group.localStream}
          muted={group.muted}
          cameraOff={group.cameraOff}
          onToggleMute={group.toggleMute}
          onToggleCamera={group.toggleCamera}
          onLeave={group.leave}
        />
      )}

      {call.status === 'incoming' && call.peer && (
        <IncomingCall
          peer={call.peer}
          callType={call.callType}
          onAccept={call.acceptCall}
          onReject={call.rejectCall}
        />
      )}

      {['calling', 'connecting', 'connected'].includes(call.status) && call.peer && (
        <CallScreen
          status={call.status}
          peer={call.peer}
          callType={call.callType}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          muted={call.muted}
          cameraOff={call.cameraOff}
          recording={call.recording}
          peerRecording={call.peerRecording}
          calleeOffline={call.calleeOffline}
          onToggleMute={call.toggleMute}
          onToggleCamera={call.toggleCamera}
          onToggleRecording={call.toggleRecording}
          onHangUp={call.hangUp}
        />
      )}

      {(call.notice || group.notice) && <div className="toast">{call.notice || group.notice}</div>}
    </div>
  );
}
