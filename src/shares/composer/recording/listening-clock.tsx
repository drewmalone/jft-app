import { useEffect, useState } from 'react';

/** One elapsed-time counter shared by the inline and dock presentations. */
export function useListeningTime(listening: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [listening]);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ListeningClock({ time }: { time: string }) {
  return (
    <p
      role="timer"
      className="listening-clock"
      aria-label="Listening time"
      aria-live="off"
    >
      {time}
    </p>
  );
}
