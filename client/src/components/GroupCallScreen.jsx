import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from './Icons';
import './GroupCallScreen.css';

function formatTime(total) {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function Tile({ name, stream, isVideo, self, muted, cameraOff, pending }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream, isVideo]);

  const showVideo = isVideo && stream && !pending && !(self && cameraOff);

  return (
    <div className={`gc-tile ${self ? 'self' : ''}`}>
      {/* A <video> element also plays the audio of remote participants */}
      {(stream || isVideo) && (
        <video
          ref={ref}
          className="gc-video"
          style={{ visibility: showVideo ? 'visible' : 'hidden', transform: self ? 'scaleX(-1)' : undefined }}
          autoPlay
          playsInline
          muted={self}
        />
      )}
      {!showVideo && (
        <div className="gc-avatar-wrap">
          <div className="avatar avatar-lg">{name.charAt(0)}</div>
        </div>
      )}
      <div className="gc-label">
        {name}
        {self ? ' (you)' : ''}
        {self && muted ? ' · muted' : ''}
        {pending ? ' · ringing…' : ''}
      </div>
    </div>
  );
}

export default function GroupCallScreen({
  callType,
  myId,
  myName,
  members,
  streams,
  localStream,
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
  onLeave,
}) {
  const [seconds, setSeconds] = useState(0);
  const isVideo = callType === 'video';

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const others = members.filter((m) => m.id !== myId && (m.status === 'joined' || m.status === 'pending'));
  const joinedCount = others.filter((m) => m.status === 'joined').length + 1;

  return (
    <div className="call-screen">
      <div className="gc-header">
        Group {isVideo ? 'video' : 'voice'} call · {joinedCount} in call · {formatTime(seconds)}
      </div>

      <div className={`gc-grid gc-n${Math.min(others.length + 1, 6)}`}>
        <Tile name={myName} stream={localStream} isVideo={isVideo} self muted={muted} cameraOff={cameraOff} />
        {others.map((m) => (
          <Tile
            key={m.id}
            name={m.name}
            stream={streams[m.id]}
            isVideo={isVideo}
            pending={m.status === 'pending'}
          />
        ))}
      </div>

      <div className="call-controls">
        <button className={`btn ${muted ? 'active' : ''}`} title={muted ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
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

        <button className="btn btn-red" title="Leave call" onClick={onLeave}>
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}
