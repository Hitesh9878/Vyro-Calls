// Ways to get the person's attention when the tab is in the background:
// desktop notifications, a flashing tab title, and a missed-call count in the title.

const BASE_TITLE = 'Vyro Calls';

// ---- tab title --------------------------------------------------------------
let badge = 0;
let flashText = null;
let flashOn = false;
let flashTimer = null;

function renderTitle() {
  const prefix = badge > 0 ? `(${badge}) ` : '';
  document.title = flashText && flashOn ? flashText : `${prefix}${BASE_TITLE}`;
}

export function setTitleBadge(count) {
  badge = count;
  renderTitle();
}

export function startTitleFlash(text) {
  stopTitleFlash();
  flashText = text;
  flashOn = true;
  renderTitle();
  flashTimer = setInterval(() => {
    flashOn = !flashOn;
    renderTitle();
  }, 1000);
}

export function stopTitleFlash() {
  clearInterval(flashTimer);
  flashTimer = null;
  flashText = null;
  flashOn = false;
  renderTitle();
}

// ---- "is the person looking at the app?" ------------------------------------
// True when the tab is hidden OR the browser window isn't focused.
export const isAway = () => document.hidden || !document.hasFocus();

// ---- desktop notifications --------------------------------------------------
export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () =>
  notificationsSupported() ? Notification.permission : 'unsupported';

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// Returns the Notification (so the caller can close it) or null if not allowed/supported.
export function showNotification(title, { body, tag, requireInteraction = false, silent = false } = {}) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null;
  try {
    const n = new Notification(title, { body, tag, requireInteraction, silent });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return n;
  } catch {
    return null; // e.g. mobile browsers that only allow service-worker notifications
  }
}
