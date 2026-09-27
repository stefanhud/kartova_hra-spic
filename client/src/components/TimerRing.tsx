import { useState, type CSSProperties } from 'react';

interface Props {
  remaining: number; // ms left when the turn state was sent
  duration: number;  // full length of the turn in ms
  className?: string;
}

// Countdown drawn as a depleting ring/bar. Remount it (key={turnNonce}) for every new turn:
// the elapsed time is captured once so later state updates don't make it jump.
export function TimerRing({ remaining, duration, className = 'ring' }: Props) {
  const [style] = useState<CSSProperties>(() => ({
    animationDuration: `${duration}ms`,
    animationDelay: `${-Math.max(0, Math.min(duration, duration - remaining))}ms`,
  }));
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="ring__track" cx="50" cy="50" r="46" pathLength={100} />
      <circle className="ring__fill" cx="50" cy="50" r="46" pathLength={100} style={style} />
    </svg>
  );
}

export function TimerBar({ remaining, duration }: Props) {
  const [style] = useState<CSSProperties>(() => ({
    animationDuration: `${duration}ms`,
    animationDelay: `${-Math.max(0, Math.min(duration, duration - remaining))}ms`,
  }));
  return (
    <div className="timerbar" aria-hidden="true">
      <div className="timerbar__fill" style={style} />
    </div>
  );
}
