import { useRef, type CSSProperties } from 'react';
import { useElementSize } from '../hooks';
import { euro } from '../money';
import type { GameView, Player } from '../types';
import { PlayingCard } from './PlayingCard';
import { Seat, type TurnTimer } from './Seat';

export interface SwapSelection {
  nonce: number;        // turn the selection belongs to; stale selections are ignored
  hand: number | null;
  talon: number | null;
}

interface Props {
  view: GameView;
  me: Player | null;
  swapping: boolean;           // it's my talon-swap decision
  selection: SwapSelection;
  onTalonTap: (index: number) => void;
  onSeatTap: (seat: number) => void;
}

function phaseCaption(v: GameView) {
  switch (v.phase) {
    case 'WAITING': return v.players.length < 2 ? 'Waiting for players' : 'Ready to deal';
    case 'DEALER_CHOICE': return 'Pay or skip the deal';
    case 'BETTING_1': return v.currentBet > 0 ? `Betting · round 1 · ${euro(v.currentBet)} bet` : 'Betting · round 1';
    case 'BETTING_2': return v.currentBet > 0 ? `Betting · round 2 · ${euro(v.currentBet)} bet` : 'Betting · round 2';
    case 'DEALER_SPECIAL': return "Banker's option";
    case 'TALON_SWAP': return 'Talon swap';
    case 'SHOWDOWN': return 'Showdown';
  }
}

export function Table({ view, me, swapping, selection, onTalonTap, onSeatTap }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(stageRef);
  const shape = h > w * 1.08 ? 'tall' : 'wide';
  const short = shape === 'wide' && h > 0 && h < 440; // landscape phones

  const seats = view.config.seats;
  const anchor = me?.seatIndex ?? 0; // you always sit at the bottom
  const posOf = (seat: number) => (seat - anchor + seats) % seats;
  const inRound = view.phase !== 'WAITING' && view.phase !== 'SHOWDOWN';
  const winners = view.phase === 'SHOWDOWN' ? view.result?.winnerIds ?? [] : [];

  const timer: TurnTimer | null = inRound && view.turnDeadline > 0
    ? { nonce: view.turnNonce, remaining: view.turnDeadline - view.serverNow, duration: view.turnDuration }
    : null;

  // Talon highlighting while it's my swap.
  const sel = swapping && selection.nonce === view.turnNonce ? selection : null;
  const talonState = (t: number) => {
    if (!swapping) return { cls: '', badge: null };
    const opts = view.swapOptions;
    if (sel?.talon === t) {
      const o = sel.hand !== null ? opts.find(x => x.h === sel.hand && x.t === t) : null;
      return { cls: 'is-selected', badge: o ? <span className="card__badge">{o.score}</span> : null };
    }
    if (sel?.hand != null) {
      const o = opts.find(x => x.h === sel.hand && x.t === t);
      return o ? { cls: 'is-target', badge: <span className="card__badge">{o.score}</span> } : { cls: 'is-dim', badge: null };
    }
    return opts.some(x => x.t === t) ? { cls: 'is-playable', badge: null } : { cls: 'is-dim', badge: null };
  };

  const barPill = (view.phase === 'TALON_SWAP' || view.phase === 'DEALER_SPECIAL')
    ? (view.minScoreToBeat > 0 ? `Bar to beat · ${view.minScoreToBeat}` : 'Bar · Flush or Trojica')
    : null;

  return (
    <div className="stage" ref={stageRef} data-shape={shape} data-short={short || undefined}>
      <div className="felt">
        <div className="felt__logo">ŠPIC</div>
      </div>

      <div className="center">
        {view.phase === 'SHOWDOWN' && view.result ? (
          <div className={`result${view.result.winnerIds.length ? ' is-win' : ''}`} role="status">
            <div className="result__headline">
              <span className="result__icon" aria-hidden="true">{view.result.winnerIds.length ? '🏆' : '↻'}</span>
              {view.result.headline}
            </div>
            <div className="result__detail">{view.result.detail}</div>
          </div>
        ) : (
          <>
            <div className={`pot${view.pot > 0 ? '' : ' is-empty'}`} key={`pot-${view.pot}`}>
              <span className="pot__label">Pot</span>
              <span className="pot__amount">{euro(view.pot)}</span>
            </div>
            {view.potThreshold > 0 && (
              <div className="pill tone-gold">
                {view.spicTie ? 'First Špic takes the pot' : `Win needs more than ${view.potThreshold}`}
              </div>
            )}
          </>
        )}

        {view.talon.length > 0 ? (
          <div className={`talon${swapping ? ' is-live' : ''}${view.phase === 'SHOWDOWN' ? ' is-done' : ''}`}>
            {view.talon.map((c, i) => {
              const st = talonState(i);
              return (
                <PlayingCard
                  key={`${c.suit}${c.rank}`}
                  card={c}
                  className={`deal-in ${st.cls}`}
                  style={{ '--i': i } as CSSProperties}
                  badge={st.badge}
                  onClick={swapping ? () => onTalonTap(i) : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div className="caption">{phaseCaption(view)}</div>
        )}

        {barPill && <div className="pill tone-blue">{barPill}</div>}
      </div>

      {view.players.map(p => p.bet > 0 && (
        <div key={`bet-${p.id}`} className={`bet bp${posOf(p.seatIndex)}`}>
          <span className="bet__chip" />{euro(p.bet)}
        </div>
      ))}

      {Array.from({ length: seats }, (_, seat) => {
        const player = view.players.find(p => p.seatIndex === seat);
        const pos = posOf(seat);
        if (!player) {
          const canSit = !me || (view.phase === 'WAITING');
          return (
            <button
              key={`empty-${seat}`}
              type="button"
              className={`seat-empty sp${pos}`}
              onClick={canSit ? () => onSeatTap(seat) : undefined}
              disabled={!canSit}
              aria-label={me ? `Move to seat ${seat + 1}` : `Sit at seat ${seat + 1}`}
            >
              <span className="seat-empty__ring">+</span>
              <span className="seat-empty__label">{me ? (canSit ? 'Move' : '') : 'Sit'}</span>
            </button>
          );
        }
        const isTurn = inRound && view.turnIndex === seat && !player.isFolded;
        return (
          <Seat
            key={player.id}
            player={player}
            pos={pos}
            isMe={player.id === view.you}
            isDealer={seat === view.dealerIndex && (view.phase !== 'WAITING' || view.roundId > 0)}
            isTurn={isTurn}
            timer={isTurn ? timer : null}
            phase={view.phase}
            isWinner={winners.includes(player.id)}
          />
        );
      })}

    </div>
  );
}
