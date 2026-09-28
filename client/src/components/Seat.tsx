import type { CSSProperties } from 'react';
import type { Phase, Player } from '../types';
import { isHidden } from '../types';
import { euro } from '../money';
import { PlayingCard } from './PlayingCard';
import { TimerRing } from './TimerRing';

export interface TurnTimer {
  nonce: number;
  remaining: number;
  duration: number;
}

interface Props {
  player: Player;
  pos: number;              // 0 = bottom (you), then clockwise
  isMe: boolean;
  isDealer: boolean;
  isTurn: boolean;
  timer: TurnTimer | null;  // only for turns with a decision clock
  phase: Phase;
  isWinner: boolean;
}

function hueFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function badgeFor(p: Player, phase: Phase, isWinner: boolean): { text: string; tone: string } | null {
  const handLive = phase !== 'WAITING';
  if (isWinner) return { text: 'Winner', tone: 'gold' };
  if (!p.connected) return { text: 'Offline', tone: 'amber' };
  if (p.specialStatus === 'BICYKEL') return { text: 'Bicykel', tone: 'red' };
  if (p.benched) return { text: 'Out till win', tone: 'muted' };
  if (handLive && p.sittingOut) return { text: p.chips === 0 ? 'Busted' : 'Next hand', tone: 'muted' };
  if (handLive && p.isFolded) return { text: 'Folded', tone: 'muted' };
  if (p.chips === 0) return { text: handLive ? 'All-in' : 'Busted', tone: handLive ? 'purple' : 'muted' };
  return null;
}

export function Seat({ player: p, pos, isMe, isDealer, isTurn, timer, phase, isWinner }: Props) {
  const badge = badgeFor(p, phase, isWinner);
  const revealed = p.hand.length > 0 && !isHidden(p.hand[0]);
  const showCards = !isMe && p.hand.length > 0 && !(p.isFolded && !revealed);
  const bubble = phase !== 'WAITING' && phase !== 'SHOWDOWN' && p.lastAction && !['Fold', 'Bicykel'].includes(p.lastAction) ? p.lastAction : null;
  const initial = (Array.from(p.name.trim())[0] ?? '?').toUpperCase();

  const classes = [
    'seat', `sp${pos}`,
    isMe && 'is-me',
    isTurn && 'is-turn',
    (p.isFolded || p.sittingOut) && phase !== 'WAITING' && 'is-out',
    isWinner && 'is-winner',
    !p.connected && 'is-offline',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={{ '--hue': hueFor(p.name) } as CSSProperties}>
      {showCards && (
        <div className={`seat__cards${revealed ? ' is-revealed' : ''}`}>
          {p.hand.map((c, i) => (
            <PlayingCard key={i} card={c} mini className="deal-in" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      )}

      <div className="seat__body">
        <div className="seat__avatar">
          {timer && <TimerRing key={timer.nonce} remaining={timer.remaining} duration={timer.duration} />}
          <span className="seat__initial">{initial}</span>
          {isDealer && <span className="seat__dealer" title="Banker (dealer)">D</span>}
        </div>
        <div className="seat__plate">
          <div className="seat__name">{isMe ? 'You' : p.name}</div>
          <div className="seat__chips">{euro(p.chips)}</div>
          {p.bet > 0 && (
            <div className="seat__bet"><span className="bet__chip" />{euro(p.bet)}</div>
          )}
          {p.debt > 0 && !p.benched && <div className="seat__debt">owes {euro(p.debt)}</div>}
        </div>
        {bubble && <div className="seat__bubble" key={bubble}>{bubble}</div>}
      </div>

      {revealed && !isMe && p.handDesc && <div className="seat__desc">{p.handDesc}</div>}
      {badge && <div className={`seat__badge tone-${badge.tone}`}>{badge.text}</div>}
    </div>
  );
}
