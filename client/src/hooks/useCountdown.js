import { useCallback, useEffect, useState } from 'react';

// Counts down from `start` seconds; used for the "Resend code in 30s" button.
export default function useCountdown(start = 30) {
  const [left, setLeft] = useState(start);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const reset = useCallback(() => setLeft(start), [start]);
  return [left, reset];
}
