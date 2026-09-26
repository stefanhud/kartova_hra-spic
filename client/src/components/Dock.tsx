import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNow } from '../hooks';
import type { GameView, Player } from '../types';
import { isBetting, isHidden } from '../types';
import { PlayingCard } from './PlayingCard';
import type { SwapSelection } from './Table';
import { TimerBar } from './TimerRing';

export interface DockActions {
  bet: (action: 'FOLD' | 'CALL' | 'RAISE', step?: number) => void;
  look: () => void;
  swap: (hand: number, talon: number) => void;
  pass: () => void;
  dealerSpecial: (action: 'TAKE' | 'PASS') => void;
  deal: () => void;
  rebuy: () => void;
  clearSelection: () => void;
  selectHand: (index: number) => void;
}

interface Props {
  view: GameView;
  me: Player | null;
  clockOffset: number;
  connected: boolean;
  selection: SwapSelection;
  actions: DockActions;
  rebuyAmount: number;
}

export function Dock({ view, me, clockOffset, connected, selection, actions, rebuyAmount }: Props) {
  const [looking, setLooking] = useState(false); // first tap on "look" asks for confirmation
  const inRound = view.phase !== 'WAITING' && view.phase !== 'SHOWDOWN';
  const onTurn = !!me && inRound && view.turnIndex === me.seatIndex && !me.isFolded;
  const hasClock = onTurn && view.turnDeadline > 0;
  const now = useNow(hasClock);
  const secondsLeft = hasClock && now ? Math.max(0, Math.ceil((view.turnDeadline - (now + clockOffset)) / 1000)) : null;

  const blind = !!me && me.hand.length > 0 && isHidden(me.hand[0]);
  const isBanker = !!me && me.seatIndex === view.dealerIndex;
  const canLook = isBanker && blind && isBetting(view.phase) && !me!.hasLooked && !me!.isFolded;
  const swapping = hasClock && view.phase === 'TALON_SWAP';
  const sel = swapping && selection.nonce === view.turnNonce ? selection : null;
  const turnPlayer = view.players.find(p => p.seatIndex === view.turnIndex);

  // ----- status line -----
  let status: string;
  let tone = '';
  if (!connected) {
    status = 'Reconnecting…';
    tone = 'warn';
  } else if (!me) {
    status = view.players.length < view.config.seats ? 'Tap an empty seat to join the table' : 'Table is full — watching';
  } else if (view.phase === 'SHOWDOWN') {
    status = 'Next hand in a moment…';
  } else if (view.phase === 'WAITING') {
    const ready = view.players.filter(p => p.connected && p.chips > 0).length;
    if (me.chips === 0) status = 'Out of chips — rebuy to keep playing';
    else if (ready < 2) status = 'Waiting for another player…';
    else status = `${ready} players ready — anyone can deal`;
  } else if (me.sittingOut) {
    status = 'You join from the next hand';
  } else if (me.isFolded) {
    status = turnPlayer ? `You're out this hand · ${turnPlayer.name} to act` : "You're out this hand";
  } else if (onTurn && !hasClock) {
    status = view.phase === 'TALON_SWAP' ? 'No swap can beat the bar — passing…' : 'Blind banker calls automatically…';
  } else if (hasClock) {
    tone = 'turn';
    if (view.phase === 'TALON_SWAP') {
      status = sel?.hand != null && sel.talon != null ? 'Confirm your swap'
        : sel?.hand != null ? 'Now tap a table card'
          : sel?.talon != null ? 'Now tap a card from your hand'
            : 'Your swap — tap a card to exchange, or keep';
    } else if (view.phase === 'DEALER_SPECIAL') {
      status = 'Banker’s option — take the table hand?';
    } else {
      status = 'Your turn';
    }
  } else {
    status = turnPlayer ? `Waiting for ${turnPlayer.name}…` : 'Dealing…';
  }

  // ----- controls -----
  let controls: ReactNode = null;
  const owed = me ? Math.max(0, view.currentBet - me.bet) : 0;

  if (me && view.phase === 'WAITING') {
    const ready = view.players.filter(p => p.connected && p.chips > 0).length;
    controls = me.chips === 0 ? (
      <button type="button" className="btn btn--primary btn--wide" onClick={actions.rebuy}>Rebuy €{rebuyAmount}</button>
    ) : (
      <button type="button" className="btn btn--primary btn--wide" onClick={actions.deal} disabled={ready < 2}>Deal cards</button>
    );
  } else if (me && inRound && !me.isFolded && !me.sittingOut && isBetting(view.phase)) {
    const active = hasClock;
    controls = (
      <div className={`betbar${active ? '' : ' is-idle'}`}>
        {isBanker ? (
          <div className="btn btn--ghost btn--note" aria-disabled="true">Banker<br />can't fold</div>
        ) : (
          <button type="button" className="btn btn--danger" disabled={!active} onClick={() => actions.bet('FOLD')}>Fold</button>
        )}
        <button type="button" className="btn btn--primary" disabled={!active} onClick={() => actions.bet('CALL')}>
          {owed === 0 ? 'Check' : owed >= me.chips ? `All-in €${me.chips}` : `Call €${owed}`}
        </button>
        <div className="raise" role="group" aria-label="Raise by">
          <span className="raise__label">Raise</span>
          <div className="raise__row">
            {Array.from({ length: view.config.maxRaise }, (_, i) => i + 1).map(step => {
              const cost = view.currentBet + step - me.bet;
              return (
                <button key={step} type="button" className="btn btn--raise" disabled={!active || cost > me.chips}
                  onClick={() => actions.bet('RAISE', step)} aria-label={`Raise by €${step}`}>
                  +{step}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  } else if (swapping) {
    const option = sel && sel.hand != null && sel.talon != null
      ? view.swapOptions.find(o => o.h === sel.hand && o.t === sel.talon)
      : null;
    controls = option ? (
      <div className="duo">
        <button type="button" className="btn btn--ghost" onClick={actions.clearSelection}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={() => actions.swap(option.h, option.t)}>
          Swap → {option.score}
        </button>
      </div>
    ) : (
      <div className="duo">
        {sel && (sel.hand != null || sel.talon != null) && (
          <button type="button" className="btn btn--ghost" onClick={actions.clearSelection}>Cancel</button>
        )}
        <button type="button" className="btn btn--neutral" onClick={actions.pass}>
          {me && (me.score ?? 0) > view.minScoreToBeat ? 'Keep my hand' : 'Pass'}
        </button>
      </div>
    );
  } else if (hasClock && view.phase === 'DEALER_SPECIAL') {
    controls = (
      <div className="duo">
        <button type="button" className="btn btn--gold" onClick={() => actions.dealerSpecial('TAKE')}>Take table hand</button>
        <button type="button" className="btn btn--neutral" onClick={() => actions.dealerSpecial('PASS')}>Keep my hand</button>
      </div>
    );
  }

  // ----- my hand -----
  const handTap = swapping ? (i: number) => actions.selectHand(i) : undefined;
  const handState = (i: number) => {
    if (!swapping) return '';
    if (sel?.hand === i) return 'is-selected';
    if (sel?.talon != null) {
      return view.swapOptions.some(o => o.t === sel.talon && o.h === i) ? 'is-target' : 'is-dim';
    }
    return view.swapOptions.some(o => o.h === i) ? 'is-playable' : 'is-dim';
  };
  const handBadge = (i: number) => {
    if (!sel || sel.talon == null || sel.hand === i) return null;
    const o = view.swapOptions.find(x => x.t === sel.talon && x.h === i);
    return o ? <span className="card__badge">{o.score}</span> : null;
  };

  const handLabel = blind ? 'Blind' : me?.handDesc;

  return (
    <div className="dock">
      <div className={`dock__status ${tone}`} role="status" aria-live="polite">
        <span className="dock__status-text">{status}</span>
        {secondsLeft !== null && <span className="dock__secs">{secondsLeft}s</span>}
      </div>
      {hasClock && <TimerBar key={view.turnNonce} remaining={view.turnDeadline - view.serverNow} duration={view.turnDuration} />}

      <div className="dock__hand">
        {me && me.hand.length > 0 ? (
          <div className={`hand${me.isFolded ? ' is-folded' : ''}${swapping ? ' is-live' : ''}`}>
            {me.hand.map((c, i) => (
              <PlayingCard
                key={`${view.roundId}-${i}-${c.suit}${c.rank}`}
                card={c}
                className={`deal-in ${handState(i)}`}
                style={{ '--i': i } as CSSProperties}
                onClick={handTap ? () => handTap(i) : undefined}
                badge={handBadge(i)}
              />
            ))}
            {handLabel && <span className={`hand__label${blind ? ' is-blind' : ''}`}>{handLabel}</span>}
          </div>
        ) : (
          <div className="hand hand--empty" aria-hidden="true">
            <span className="card ghost" />
            <span className="card ghost" />
            <span className="card ghost" />
          </div>
        )}

        {canLook && (
          <button
            type="button"
            className={`look${looking ? ' is-confirm' : ''}`}
            onClick={() => {
              if (looking) {
                setLooking(false);
                actions.look();
              } else {
                setLooking(true);
                setTimeout(() => setLooking(false), 3500);
              }
            }}
          >
            <span className="look__eye" aria-hidden="true">👁</span>
            <span className="look__text">{looking ? 'Tap again to look' : 'Look at cards'}</span>
            <span className="look__sub">{looking ? 'You lose the talon option' : 'Blind play keeps the talon option'}</span>
          </button>
        )}
      </div>

      <div className="dock__controls">{controls}</div>
    </div>
  );
}
