// Shared WebRTC helpers for 1:1 and group calls.

export const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Optional TURN relay for users behind strict NATs
if (import.meta.env.VITE_TURN_URL) {
  iceServers.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USER,
    credential: import.meta.env.VITE_TURN_PASS,
  });
}

export function getMedia(type) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('insecure');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === 'video',
  });
}

export function mediaErrorMessage(err) {
  if (err?.message === 'insecure') {
    return 'Calls need HTTPS (or localhost) to access the microphone and camera.';
  }
  if (err?.name === 'NotAllowedError') {
    return 'Microphone/camera permission was denied.';
  }
  if (err?.name === 'NotFoundError') {
    return 'No microphone or camera was found.';
  }
  return 'Could not start the call.';
}
