import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Record, Video, VideoOff } from './Icons';
import './CallScreen.css';

function formatTime(total) {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallScreen({
  status,
  peer,
  callType,
  localStream,
  remoteStream,
  muted,
  cameraOff,
  recording,
  peerRecording,
  calleeOffline,
  onToggleMute,
  onToggleCamera,
  onToggleRecording,
  onHangUp,
}) {
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const [seconds, setSeconds] = useState(0);

  const isVideo = callType === 'video';

  // Attach media streams to the <video>/<audio> elements
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream, isVideo]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, isVideo]);

  // Call timer
  useEffect(() => {
    if (status !== 'connected') {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const label =
    status === 'calling'
      ? calleeOffline
        ? 'Calling… they are offline, we emailed them'
        : 'Calling…'
      : status === 'connecting'
      ? 'Connecting…'
      : formatTime(seconds);

  const showRemoteVideo = isVideo && remoteStream && status === 'connected';

  return (
    <div className="call-screen">
      <div className="call-stage">
        {(recording || peerRecording) && (
          <div className="call-rec-banners">
            {recording && <div className="call-rec-pill">Recording this call</div>}
            {peerRecording && <div className="call-rec-pill">{peer.name} is recording this call</div>}
          </div>
        )}

        {/* Remote media. A <video> element also plays audio for video calls. */}
        {isVideo ? (
          <video
            ref={remoteRef}
            className="call-remote-video"
            style={{ visibility: showRemoteVideo ? 'visible' : 'hidden' }}
            autoPlay
            playsInline
          />
        ) : (
          <audio ref={remoteRef} autoPlay />
        )}

        <div className={`call-info ${showRemoteVideo ? 'overlay' : ''}`}>
          {!showRemoteVideo && <div className="avatar avatar-lg">{peer.name.charAt(0)}</div>}
          <div className="call-name">{peer.name}</div>
          <div className="call-status">{label}</div>
        </div>

        {isVideo && localStream && (
          <video
            ref={localRef}
            className="call-local-video"
            style={{ display: cameraOff ? 'none' : 'block' }}
            autoPlay
            playsInline
            muted
          />
        )}
      </div>

      <div className="call-controls">
        <button
          className={`btn ${muted ? 'active' : ''}`}
          title={muted ? 'Unmute' : 'Mute'}
          onClick={onToggleMute}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>

        {isVideo && (
          <button
            className={`btn ${cameraOff ? 'active' : ''}`}
            title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            onClick={onToggleCamera}
          >
            {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}

        <button
          className={`btn ${recording ? 'recording' : ''}`}
          title={
            status !== 'connected'
              ? 'You can record once the call is connected'
              : recording
              ? 'Stop recording'
              : 'Record call'
          }
          disabled={status !== 'connected'}
          onClick={onToggleRecording}
        >
          <Record size={22} />
        </button>

        <button className="btn btn-red" title="End call" onClick={onHangUp}>
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}
