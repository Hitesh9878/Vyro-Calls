import { Bell, X } from './Icons';
import './NotifyBanner.css';

// Asks (once) for permission to show desktop notifications for calls
export default function NotifyBanner({ onEnable, onDismiss }) {
  return (
    <div className="notify-banner">
      <Bell size={18} />
      <span>Get notified about calls when this tab is in the background.</span>
      <button className="btn btn-primary" onClick={onEnable}>
        Turn on
      </button>
      <button className="btn btn-ghost notify-close" title="Not now" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
