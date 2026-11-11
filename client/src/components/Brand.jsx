import fullLogo from '../assets/logo-full.png';
import iconLogo from '../assets/logo-icon.png';
import './Brand.css';

// variant "full": Vyro Calls wordmark + icon (auth pages). variant "icon": small mark (dashboard header).
export default function Brand({ variant = 'full' }) {
  if (variant === 'icon') {
    return <img className="brand-icon" src={iconLogo} alt="Vyro Calls" />;
  }
  return (
    <div className="brand-full">
      <img src={fullLogo} alt="Vyro Calls" />
    </div>
  );
}
