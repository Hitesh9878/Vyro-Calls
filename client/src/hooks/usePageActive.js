import { useEffect, useState } from 'react';
import { isAway } from '../utils/alerts';

// true while the person is actually looking at the app (visible tab + focused window)
export default function usePageActive() {
  const [active, setActive] = useState(() => !isAway());

  useEffect(() => {
    const update = () => setActive(!isAway());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);

  return active;
}
