import { useCallback, useEffect, useRef, useState } from 'react';
import useRecorder from './useRecorder';
import { canPlayAudio, startRinging, stopRinging } from '../utils/ringer';
import { isAway, showNotification, startTitleFlash, stopTitleFlash } from '../utils/alerts';
import { getMedia, iceServers, mediaErrorMessage } from '../utils/rtc';

/**
 * Handles the whole call lifecycle with WebRTC + Socket.IO signalling.
 * status: idle | calling | incoming | connecting | connected
 */
export default function useCall(socket) {
  const [status, setStatus] = useState('idle');
  const [peer, setPeer] = useState(null); // { id, name, email }
  const [callType, setCallType] = useState('audio');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [notice, setNotice] = useState('');
  const [peerRecording, setPeerRecording] = useState(false); // the other person is recording
  const [calleeOffline, setCalleeOffline] = useState(false); // ringing someone who is offline (we emailed them)

  const recorder = useRecorder({ onSaved: () => setNotice('Recording saved to your downloads.') });
  const stopRecorder = recorder.stop;

  const pcRef = useRef(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const peerRef = useRef(null);
  const pendingIce = useRef([]);
  const incomingRef = useRef(null);
  const statusRef = useRef('idle');

  const changeStatus = useCallback((next) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  // Release camera/mic, close the connection and reset everything
  const cleanup = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
    }
    stopRecorder(); // saves the recording (if any) before the streams go away
    if (localRef.current) {
      localRef.current.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    }
    remoteRef.current = null;
    pendingIce.current = [];
    incomingRef.current = null;
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setPeer(null);
    setMuted(false);
    setCameraOff(false);
    setPeerRecording(false);
    setCalleeOffline(false);
    changeStatus('idle');
  }, [changeStatus, stopRecorder]);

  const flushIce = useCallback(async (pc) => {
    const queued = pendingIce.current;
    pendingIce.current = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        console.warn('ICE candidate error', e);
      }
    }
  }, []);

  const createPeer = useCallback(
    (peerId, stream) => {
      const pc = new RTCPeerConnection({ iceServers });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call:ice', { to: peerId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        remoteRef.current = e.streams[0];
        setRemoteStream(e.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') changeStatus('connected');
        if (pc.connectionState === 'failed') {
          socket.emit('call:end', { to: peerId });
          setNotice('Connection failed. Check your network and try again.');
          cleanup();
        }
      };
      return pc;
    },
    [socket, changeStatus, cleanup]
  );

  // ---- actions -----------------------------------------------------------
  const startCall = useCallback(
    async (contactUser, type = 'audio') => {
      if (!socket || statusRef.current !== 'idle') return;
      setNotice('');
      try {
        const stream = await getMedia(type);
        localRef.current = stream;
        peerRef.current = contactUser;

        setLocalStream(stream);
        setPeer(contactUser);
        setCallType(type);
        changeStatus('calling');

        const pc = createPeer(contactUser.id, stream);
        pcRef.current = pc;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:invite', { to: contactUser.id, offer, callType: type });
      } catch (err) {
        console.error(err);
        setNotice(mediaErrorMessage(err));
        cleanup();
      }
    },
    [socket, createPeer, changeStatus, cleanup]
  );

  const acceptCall = useCallback(async () => {
    const incoming = incomingRef.current;
    if (!incoming || !socket) return;

    try {
      const stream = await getMedia(incoming.callType);

      // The caller may have hung up while the permission prompt was open
      if (peerRef.current?.id !== incoming.from.id) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      localRef.current = stream;
      setLocalStream(stream);
      changeStatus('connecting');

      const pc = createPeer(incoming.from.id, stream);
      pcRef.current = pc;

      await pc.setRemoteDescription(incoming.offer);
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { to: incoming.from.id, answer });
    } catch (err) {
      console.error(err);
      setNotice(mediaErrorMessage(err));
      socket.emit('call:reject', { to: incoming.from.id });
      cleanup();
    }
  }, [socket, createPeer, flushIce, changeStatus, cleanup]);

  const rejectCall = useCallback(() => {
    const incoming = incomingRef.current;
    if (incoming && socket) socket.emit('call:reject', { to: incoming.from.id });
    cleanup();
  }, [socket, cleanup]);

  const hangUp = useCallback(() => {
    if (peerRef.current && socket) socket.emit('call:end', { to: peerRef.current.id });
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

  const toggleRecording = useCallback(() => {
    const other = peerRef.current;
    if (recorder.recording) {
      recorder.stop();
      if (other) socket.emit('call:recording', { to: other.id, recording: false });
      return;
    }
    if (statusRef.current !== 'connected' || !localRef.current || !remoteRef.current || !other) return;

    const started = recorder.start({
      local: localRef.current,
      remote: remoteRef.current,
      video: callType === 'video',
      label: other.name,
    });
    if (started) {
      // Let the other person know (they see a "recording" banner)
      socket.emit('call:recording', { to: other.id, recording: true });
    } else {
      setNotice('Recording is not supported in this browser.');
    }
  }, [socket, recorder, callType]);

  // ---- sounds ------------------------------------------------------------
  // Incoming ring for the callee, ringback tone for the caller, silence otherwise
  useEffect(() => {
    if (status === 'incoming') startRinging('incoming');
    else if (status === 'calling') startRinging('ringback');
    else stopRinging();
    return stopRinging;
  }, [status]);

  // ---- background-tab alerts for an incoming call -------------------------
  useEffect(() => {
    if (status !== 'incoming' || !peer) return;

    let notification = null;
    const sync = () => {
      if (isAway()) {
        if (!notification) {
          notification = showNotification(`Incoming ${callType === 'video' ? 'video' : 'voice'} call`, {
            body: peer.name,
            tag: 'incoming-call',
            requireInteraction: true,
            silent: canPlayAudio(), // we're already ringing in-page; let the OS beep only if we can't
          });
        }
        startTitleFlash(`📞 ${peer.name} is calling…`);
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
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      stopTitleFlash();
      notification?.close();
    };
  }, [status, peer, callType]);

  // ---- signalling events -------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onIncoming = ({ from, offer, callType: type }) => {
      incomingRef.current = { from, offer, callType: type };
      peerRef.current = from;
      pendingIce.current = [];
      setPeer(from);
      setCallType(type);
      changeStatus('incoming');
    };

    const onAnswered = async ({ answer }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(answer);
        await flushIce(pc);
        if (statusRef.current === 'calling') changeStatus('connecting');
      } catch (e) {
        console.error(e);
      }
    };

    const onIce = async ({ candidate }) => {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn('ICE candidate error', e);
        }
      } else {
        // Remote description isn't set yet, hold on to it
        pendingIce.current.push(candidate);
      }
    };

    const onRejected = () => {
      if (statusRef.current === 'idle') return; // stale event (e.g. another tab of mine)
      setNotice(`${peerRef.current?.name || 'The user'} declined the call.`);
      cleanup();
    };

    const missedCallAlert = (name) => {
      setNotice(name ? `Missed call from ${name}.` : 'Missed call.');
      if (isAway()) {
        showNotification('Missed call', { body: name ? `From ${name}` : undefined, tag: 'missed-call' });
      }
    };

    const onEnded = () => {
      if (statusRef.current === 'idle') return;
      if (statusRef.current === 'incoming') missedCallAlert(peerRef.current?.name);
      else setNotice('Call ended.');
      cleanup();
    };

    // Nobody answered within the server's ring timeout
    const onTimeout = () => {
      const s = statusRef.current;
      if (s === 'idle') return;
      const name = peerRef.current?.name;
      if (s === 'incoming') missedCallAlert(name);
      else if (s === 'calling') setNotice(`${name || 'The user'} didn't answer.`);
      else setNotice('The call timed out.');
      cleanup();
    };

    // I answered or declined in another tab: stop ringing here without a fuss
    const onHandled = () => {
      if (statusRef.current === 'incoming') cleanup();
    };

    const onRemoteRecording = ({ recording }) => setPeerRecording(!!recording);

    // Callee is offline: the server keeps ringing and has emailed them
    const onOfflineRinging = () => setCalleeOffline(true);
    // They opened the app and the call is now ringing on their screen
    const onRinging = () => setCalleeOffline(false);

    const onNotAllowed = ({ reason }) => {
      const name = peerRef.current?.name || 'this person';
      setNotice(
        reason === 'blocked_by_me'
          ? `You blocked ${name}. Unblock them to call.`
          : 'You can only call people who have accepted your contact request.'
      );
      cleanup();
    };

    const onBusy = ({ self } = {}) => {
      setNotice(self ? 'You are already in a call.' : `${peerRef.current?.name || 'The user'} is busy on another call.`);
      cleanup();
    };

    // Tell the server we're listening, so a call that came in while we were offline is delivered now
    const announceReady = () => socket.emit('call:ready');

    socket.on('call:incoming', onIncoming);
    socket.on('call:answered', onAnswered);
    socket.on('call:ice', onIce);
    socket.on('call:rejected', onRejected);
    socket.on('call:ended', onEnded);
    socket.on('call:offline-ringing', onOfflineRinging);
    socket.on('call:ringing', onRinging);
    socket.on('call:not-allowed', onNotAllowed);
    socket.on('call:busy', onBusy);
    socket.on('call:timeout', onTimeout);
    socket.on('call:handled', onHandled);
    socket.on('call:recording', onRemoteRecording);
    socket.on('connect', announceReady);
    if (socket.connected) announceReady();

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:answered', onAnswered);
      socket.off('call:ice', onIce);
      socket.off('call:rejected', onRejected);
      socket.off('call:ended', onEnded);
      socket.off('call:offline-ringing', onOfflineRinging);
      socket.off('call:ringing', onRinging);
      socket.off('call:not-allowed', onNotAllowed);
      socket.off('call:busy', onBusy);
      socket.off('call:timeout', onTimeout);
      socket.off('call:handled', onHandled);
      socket.off('call:recording', onRemoteRecording);
      socket.off('connect', announceReady);
    };
  }, [socket, changeStatus, cleanup, flushIce]);

  // Auto-dismiss notices
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Release devices if the component unmounts mid-call
  useEffect(() => cleanup, [cleanup]);

  return {
    status,
    peer,
    callType,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    notice,
    calleeOffline,
    recording: recorder.recording,
    peerRecording,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleRecording,
  };
}
