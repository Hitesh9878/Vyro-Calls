import { useCallback, useEffect, useRef, useState } from 'react';
import { startRinging, stopRinging } from '../utils/ringer';
import { isAway, showNotification, startTitleFlash, stopTitleFlash } from '../utils/alerts';
import { getMedia, iceServers, mediaErrorMessage } from '../utils/rtc';

/**
 * Group voice / video calls. Every participant keeps a direct WebRTC connection to every
 * other participant (a "mesh"), so this is meant for small groups. The server only relays
 * signalling. Whoever joins later is the one who sends the offers.
 *
 * status: idle | starting | incoming | active
 */
export default function useGroupCall(socket, myId, { canRing = true } = {}) {
  const [status, setStatus] = useState('idle');
  const [invite, setInvite] = useState(null); // { roomId, from, callType, size }
  const [room, setRoom] = useState(null); // { id, callType, host }
  const [members, setMembers] = useState([]); // [{ id, name, status }]
  const [streams, setStreams] = useState({}); // userId -> MediaStream
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [notice, setNotice] = useState('');

  const statusRef = useRef('idle');
  const roomRef = useRef(null);
  const inviteRef = useRef(null);
  const localRef = useRef(null);
  const pcs = useRef(new Map()); // userId -> RTCPeerConnection
  const pendingIce = useRef(new Map()); // userId -> candidates that arrived before the connection was ready
  const canRingRef = useRef(canRing);
  canRingRef.current = canRing;

  const changeStatus = useCallback((next) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const closePeer = useCallback((userId) => {
    const pc = pcs.current.get(userId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcs.current.delete(userId);
    }
    pendingIce.current.delete(userId);
    setStreams((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const cleanup = useCallback(() => {
    [...pcs.current.keys()].forEach(closePeer);
    if (localRef.current) {
      localRef.current.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    }
    roomRef.current = null;
    inviteRef.current = null;
    setLocalStream(null);
    setStreams({});
    setMembers([]);
    setRoom(null);
    setInvite(null);
    setMuted(false);
    setCameraOff(false);
    changeStatus('idle');
  }, [changeStatus, closePeer]);

  const sendSignal = useCallback(
    (to, data) => {
      const roomId = roomRef.current?.id;
      if (roomId) socket.emit('group:signal', { roomId, to, data });
    },
    [socket]
  );

  const createPeer = useCallback(
    (peerId) => {
      closePeer(peerId);
      const pc = new RTCPeerConnection({ iceServers });
      localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current));

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(peerId, { type: 'ice', candidate: e.candidate });
      };
      pc.ontrack = (e) => setStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') setNotice('Lost connection to a participant.');
      };
      pcs.current.set(peerId, pc);
      return pc;
    },
    [closePeer, sendSignal]
  );

  const flushIce = useCallback(async (peerId, pc) => {
    const queued = pendingIce.current.get(peerId) || [];
    pendingIce.current.delete(peerId);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        console.warn('ICE candidate error', e);
      }
    }
  }, []);

  // I joined after these people: I send each of them an offer
  const connectTo = useCallback(
    async (peerId) => {
      try {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(peerId, { type: 'offer', sdp: offer });
      } catch (e) {
        console.error(e);
      }
    },
    [createPeer, sendSignal]
  );

  // ---- actions -----------------------------------------------------------
  const startGroup = useCallback(
    async (users, type = 'audio') => {
      if (!socket || statusRef.current !== 'idle') return;
      setNotice('');
      try {
        const stream = await getMedia(type);
        localRef.current = stream;
        setLocalStream(stream);
        changeStatus('starting');
        socket.emit('group:create', { invitees: users.map((u) => u.id), callType: type });
      } catch (err) {
        console.error(err);
        setNotice(mediaErrorMessage(err));
        cleanup();
      }
    },
    [socket, changeStatus, cleanup]
  );

  const acceptInvite = useCallback(async () => {
    const inv = inviteRef.current;
    if (!inv || !socket) return;
    try {
      const stream = await getMedia(inv.callType);
      // The invitation may have ended while the permission prompt was open
      if (inviteRef.current?.roomId !== inv.roomId) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);
      stopRinging();
      socket.emit('group:join', { roomId: inv.roomId });
    } catch (err) {
      console.error(err);
      setNotice(mediaErrorMessage(err));
      socket.emit('group:decline', { roomId: inv.roomId });
      cleanup();
    }
  }, [socket, cleanup]);

  const declineInvite = useCallback(() => {
    const inv = inviteRef.current;
    if (inv && socket) socket.emit('group:decline', { roomId: inv.roomId });
    cleanup();
  }, [socket, cleanup]);

  const leave = useCallback(() => {
    if (socket && roomRef.current) socket.emit('group:leave');
    cleanup();
  }, [socket, cleanup]);

  const toggleMute = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() || [];
    tracks.forEach((t) => (t.enabled = !t.enabled));
    setMuted(tracks.length > 0 && !tracks[0].enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() || [];
    tracks.forEach((t) => (t.enabled = !t.enabled));
    setCameraOff(tracks.length > 0 && !tracks[0].enabled);
  }, []);

  // ---- sounds + background alerts for an invitation -----------------------
  useEffect(() => {
    if (status !== 'incoming' || !invite) return;
    startRinging('incoming');

    let notification = null;
    const sync = () => {
      if (isAway()) {
        if (!notification) {
          notification = showNotification(`Group ${invite.callType === 'video' ? 'video' : 'voice'} call`, {
            body: `${invite.from.name} is inviting you`,
            tag: 'group-invite',
            requireInteraction: true,
          });
        }
        startTitleFlash(`📞 ${invite.from.name} invited you to a group call`);
      } else {
        stopTitleFlash();
        notification?.close();
        notification = null;
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      stopRinging();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      stopTitleFlash();
      notification?.close();
    };
  }, [status, invite]);

  // ---- signalling events -------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onInvite = (inv) => {
      // Busy with another call: ignore it (the server logs it as missed after a minute)
      if (statusRef.current !== 'idle' || !canRingRef.current) return;
      inviteRef.current = inv;
      setInvite(inv);
      changeStatus('incoming');
    };

    const onCreated = ({ roomId, callType, host, skipped }) => {
      const r = { id: roomId, callType, host };
      roomRef.current = r;
      setRoom(r);
      changeStatus('active');
      if (skipped?.length) setNotice(`Couldn't invite: ${skipped.join(', ')}.`);
    };

    const onMembers = ({ roomId, members: list }) => {
      if (roomRef.current?.id === roomId) setMembers(list);
    };

    const onJoined = ({ roomId, callType, host, members: list }) => {
      const r = { id: roomId, callType, host };
      roomRef.current = r;
      inviteRef.current = null;
      setInvite(null);
      setRoom(r);
      setMembers(list);
      changeStatus('active');
      list.filter((m) => m.id !== myId && m.status === 'joined').forEach((m) => connectTo(m.id));
    };

    const onMember = ({ roomId, userId, name, status: st }) => {
      if (roomRef.current?.id !== roomId) return;
      setMembers((prev) => {
        const exists = prev.some((m) => m.id === userId);
        return exists
          ? prev.map((m) => (m.id === userId ? { ...m, status: st } : m))
          : [...prev, { id: userId, name, status: st }];
      });
      if (st !== 'joined' && st !== 'pending') closePeer(userId);
      if (st === 'declined') setNotice(`${name} declined the group call.`);
    };

    const onSignal = async ({ roomId, from, data }) => {
      if (roomRef.current?.id !== roomId || !data) return;
      try {
        if (data.type === 'offer') {
          const pc = createPeer(from);
          await pc.setRemoteDescription(data.sdp);
          await flushIce(from, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(from, { type: 'answer', sdp: answer });
        } else if (data.type === 'answer') {
          const pc = pcs.current.get(from);
          if (!pc) return;
          await pc.setRemoteDescription(data.sdp);
          await flushIce(from, pc);
        } else if (data.type === 'ice') {
          const pc = pcs.current.get(from);
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(data.candidate).catch((e) => console.warn('ICE candidate error', e));
          } else {
            const list = pendingIce.current.get(from) || [];
            list.push(data.candidate);
            pendingIce.current.set(from, list);
          }
        }
      } catch (e) {
        console.error('group signal error', e);
      }
    };

    // The invitation ended (timeout / the caller left) or I answered it in another tab
    const onInviteEnded = ({ roomId }) => {
      if (statusRef.current !== 'incoming' || inviteRef.current?.roomId !== roomId) return;
      setNotice(`Missed group call from ${inviteRef.current.from.name}.`);
      if (isAway()) showNotification('Missed group call', { body: `From ${inviteRef.current.from.name}`, tag: 'missed-call' });
      cleanup();
    };
    const onHandled = ({ roomId }) => {
      if (statusRef.current === 'incoming' && inviteRef.current?.roomId === roomId) cleanup();
    };

    const onError = ({ message }) => {
      setNotice(message || 'Group call error.');
      if (statusRef.current !== 'active') cleanup();
    };

    const announceReady = () => socket.emit('group:ready');

    socket.on('group:invite', onInvite);
    socket.on('group:created', onCreated);
    socket.on('group:members', onMembers);
    socket.on('group:joined', onJoined);
    socket.on('group:member', onMember);
    socket.on('group:signal', onSignal);
    socket.on('group:invite-ended', onInviteEnded);
    socket.on('group:handled', onHandled);
    socket.on('group:error', onError);
    socket.on('connect', announceReady);
    if (socket.connected) announceReady();

    return () => {
      socket.off('group:invite', onInvite);
      socket.off('group:created', onCreated);
      socket.off('group:members', onMembers);
      socket.off('group:joined', onJoined);
      socket.off('group:member', onMember);
      socket.off('group:signal', onSignal);
      socket.off('group:invite-ended', onInviteEnded);
      socket.off('group:handled', onHandled);
      socket.off('group:error', onError);
      socket.off('connect', announceReady);
    };
  }, [socket, myId, changeStatus, cleanup, closePeer, connectTo, createPeer, flushIce, sendSignal]);

  // Auto-dismiss notices
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // Release devices if the component unmounts mid-call
  useEffect(() => cleanup, [cleanup]);

  return {
    status,
    invite,
    room,
    members,
    streams,
    localStream,
    muted,
    cameraOff,
    notice,
    startGroup,
    acceptInvite,
    declineInvite,
    leave,
    toggleMute,
    toggleCamera,
  };
}
