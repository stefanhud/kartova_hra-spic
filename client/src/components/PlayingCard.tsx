import type { CSSProperties, ReactNode } from 'react';
import type { Card, Suit } from '../types';

const SUIT_PATHS: Record<Suit, ReactNode> = {
  H: <path d="M50 90C22 68 5 51 5 31 5 16 16 6 30 6c9 0 16 5 20 13 4-8 11-13 20-13 14 0 25 10 25 25 0 20-17 37-45 59z" />,
  D: <path d="M50 3c10 17 24 33 40 47-16 14-30 30-40 47C40 80 26 64 10 50 26 36 40 20 50 3z" />,
  S: <path d="M50 4c12 20 44 32 44 57 0 14-10 23-22 23-8 0-14-4-18-10 1 10 5 17 12 22H34c7-5 11-12 12-22-4 6-10 10-18 10C16 84 6 75 6 61 6 36 38 24 50 4z" />,
  C: (
    <>
      <circle cx="50" cy="27" r="20" />
      <circle cx="27" cy="57" r="20" />
      <circle cx="73" cy="57" r="20" />
      <circle cx="50" cy="52" r="12" />
      <path d="M46 55c0 17-5 30-13 41h34c-8-11-13-24-13-41z" />
    </>
  ),
};

const SUIT_NAMES: Record<Suit, string> = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
const RANK_NAMES: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };

export function SuitIcon({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g fill="currentColor">{SUIT_PATHS[suit]}</g>
    </svg>
  );
}

function cardLabel(c: Card) {
  if (c.suit === 'X') return 'Face-down card';
  return `${RANK_NAMES[c.rank] ?? c.rank} of ${SUIT_NAMES[c.suit]}`;
}

interface Props {
  card?: Card | null;         // missing or suit 'X' => face down
  mini?: boolean;             // compact face for small seat cards
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  badge?: ReactNode;          // small label on the card (e.g. swap result)
  disabled?: boolean;
  label?: string;
}

export function PlayingCard({ card, mini, className = '', style, onClick, badge, disabled, label }: Props) {
  const faceDown = !card || card.suit === 'X';
  const court = !faceDown && ['J', 'Q', 'K'].includes(card!.rank);
  const classes = ['card', faceDown ? 'back' : `face s-${card!.suit}`, court ? 'court' : '', mini ? 'mini' : '', className]
    .filter(Boolean).join(' ');
  const aria = label ?? (card ? cardLabel(card) : 'Face-down card');

  const content = faceDown ? null : (
    <>
      <span className="card__idx">
        <b>{card!.rank}</b>
        <SuitIcon suit={card!.suit as Suit} />
      </span>
      {!mini && court && (
        <svg className="card__crown" viewBox="0 0 38 20" aria-hidden="true">
          <path fill="currentColor" d="M2 18 0 4l10 7 9-11 9 11 10-7-2 14z" />
        </svg>
      )}
      {!mini && (
        <span className="card__pip">
          <SuitIcon suit={card!.suit as Suit} />
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} disabled={disabled} aria-label={aria}>
        {content}
        {badge}
      </button>
    );
  }
  return (
    <span className={classes} style={style} role="img" aria-label={aria}>
      {content}
      {badge}
    </span>
  );
}
