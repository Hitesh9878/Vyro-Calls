import { useCallback, useEffect, useRef, useState } from 'react';

const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const VIDEO_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

function pickMimeType(video) {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = video ? VIDEO_TYPES : AUDIO_TYPES;
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function fileName(label, ext) {
  const safe = (label || 'call').replace(/[^\w-]+/g, '_').slice(0, 30);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return `call-with-${safe}-${stamp}.${ext}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Records a call in the browser and saves it to the person's device when it stops.
 * Nothing is uploaded: the file never leaves this computer.
 *
 * Both sides' audio are mixed into one track. For video calls the other person's
 * video is recorded too (your own camera view is not).
 */
export default function useRecorder({ onSaved } = {}) {
  const [recording, setRecording] = useState(false);
  const active = useRef(null); // { recorder, audioCtx }
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // Returns true if recording started
  const start = useCallback(({ local, remote, video = false, label }) => {
    if (active.current) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    const mimeType = pickMimeType(video);
    if (mimeType === null || !AC) return false;

    try {
      const audioCtx = new AC();
      audioCtx.resume().catch(() => {});
      const mix = audioCtx.createMediaStreamDestination();

      [local, remote].forEach((stream) => {
        const tracks = stream?.getAudioTracks() || [];
        if (tracks.length) audioCtx.createMediaStreamSource(new MediaStream(tracks)).connect(mix);
      });

      const tracks = [...mix.stream.getAudioTracks()];
      if (video) {
        const v = remote?.getVideoTracks()[0];
        if (v) tracks.push(v);
      }

      const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
      const chunks = [];
      const hasVideo = tracks.some((t) => t.kind === 'video');

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || (hasVideo ? 'video/webm' : 'audio/webm');
        const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        audioCtx.close().catch(() => {});
        if (active.current?.recorder === recorder) active.current = null;
        setRecording(false);
        if (chunks.length) {
          download(new Blob(chunks, { type }), fileName(label, ext));
          onSavedRef.current?.();
        }
      };

      recorder.start(1000); // flush every second so a crash doesn't lose everything
      active.current = { recorder, audioCtx };
      setRecording(true);
      return true;
    } catch (err) {
      console.error('Could not start recording', err);
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    const r = active.current?.recorder;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  // Save what we have if the page goes away mid-recording
  useEffect(() => stop, [stop]);

  return { recording, start, stop };
}
