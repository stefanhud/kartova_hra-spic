import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNow } from '../hooks';
import { euro, stepLabel } from '../money';
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
  dealerChoice: (action: 'PAY' | 'SKIP') => void;
  deal: () => void;
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
}

export function Dock({ view, me, clockOffset, connected, selection, actions }: Props) {
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
  // Debt from a carried-over pot is paid at your first decision of the hand.
  const due = me && view.phase === 'BETTING_1' && !isBanker ? me.debt : 0;

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
    const ready = view.players.filter(p => p.connected && !p.benched).length;
    if (me.benched) status = 'You skipped dealing — back in when the pot is won';
    else if (ready < 2) status = 'Waiting for another player…';
    else if (me.debt > 0) status = `You owe ${euro(me.debt)} to play on for this pot`;
    else status = `${ready} players ready — anyone can deal`;
  } else if (view.phase === 'DEALER_CHOICE') {
    if (hasClock) {
      tone = 'turn';
      status = `Your deal — you owe ${euro(me.debt)}`;
    } else {
      status = turnPlayer ? `${turnPlayer.name} decides whether to deal…` : 'Choosing the banker…';
    }
  } else if (me.benched) {
    status = 'You sit out until the pot is won';
  } else if (me.sittingOut) {
    status = 'You join from the next hand';
  } else if (me.isFolded) {
    status = turnPlayer ? `You're out this hand · ${turnPlayer.name} to act` : "You're out this hand";
  } else if (onTurn && !hasClock) {
    status = view.phase === 'TALON_SWAP' ? 'No swap can beat the bar — passing…' : 'You call automatically (banker)…';
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
      status = due > 0 ? `Your turn — pay ${euro(due)} owed to play on` : 'Your turn';
    }
  } else if (isBanker && isBetting(view.phase)) {
    status = turnPlayer ? `Banker: you call everything · ${turnPlayer.name} to act` : 'Banker: you call everything';
  } else {
    status = turnPlayer ? `Waiting for ${turnPlayer.name}…` : 'Dealing…';
  }

  // ----- controls -----
  let controls: ReactNode = null;
  const owed = me ? Math.max(0, view.currentBet - me.bet) : 0;

  if (me && view.phase === 'WAITING') {
    const ready = view.players.filter(p => p.connected && !p.benched).length;
    controls = (
      <button type="button" className="btn btn--primary btn--wide" onClick={actions.deal} disabled={ready < 2}>Deal cards</button>
    );
  } else if (me && view.phase === 'DEALER_CHOICE' && hasClock) {
    const short = me.debt - me.chips;
    controls = (
      <div className="duo">
        <button type="button" className="btn btn--primary btn--stack" onClick={() => actions.dealerChoice('PAY')}>
          Pay {euro(me.debt)} &amp; deal
          <span className="btn__sub">{short > 0 ? `tops up ${euro(short)} from wallet` : 'and play this hand'}</span>
        </button>
        <button type="button" className="btn btn--neutral btn--stack" onClick={() => actions.dealerChoice('SKIP')}>
          Skip
          <span className="btn__sub">sit out until the pot is won</span>
        </button>
      </div>
    );
  } else if (me && inRound && !me.isFolded && !me.sittingOut && isBetting(view.phase)) {
    if (isBanker) {
      controls = (
        <div className="btn btn--ghost btn--note btn--wide" aria-disabled="true">
          The banker calls everything automatically
        </div>
      );
    } else {
      const active = hasClock;
      // Short of chips? The missing money comes from the wallet (shown in the running score).
      const short = owed + due - me.chips;
      const callText = owed === 0 ? 'Check' : `Call ${euro(owed)}`;
      const callSub = [due > 0 && `+ ${euro(due)} owed`, short > 0 && `top up ${euro(short)}`].filter(Boolean).join(' · ') || null;
      const mayRaise = view.raiserSeats.includes(me.seatIndex);
      const minRaiseCost = view.currentBet + view.config.raiseSteps[0] - me.bet + due;
      const raiseLabel = !mayRaise ? 'No raise' : active && !view.canRaise ? 'Raise used'
        : minRaiseCost > me.chips ? 'Top up & raise' : 'Raise';
      controls = (
        <div className={`betbar${active ? '' : ' is-idle'}`}>
          <button type="button" className="btn btn--danger" disabled={!active} onClick={() => actions.bet('FOLD')}>Fold</button>
          <button type="button" className={`btn btn--primary${callSub ? ' btn--stack' : ''}`} disabled={!active}
            onClick={() => actions.bet('CALL')}>
            {callText}
            {callSub && <span className="btn__sub">{callSub}</span>}
          </button>
          <div className={`raise${mayRaise ? '' : ' is-off'}`} role="group" aria-label="Raise by"
            title={mayRaise ? 'One raise and one re-raise per round' : 'Only the first and last player may raise'}>
            <span className="raise__label">{raiseLabel}</span>
            <div className="raise__row">
              {view.config.raiseSteps.map(step => {
                return (
                  <button key={step} type="button" className="btn btn--raise"
                    disabled={!active || !view.canRaise}
                    onClick={() => actions.bet('RAISE', step)} aria-label={`Raise by ${euro(step)}`}>
                    +{stepLabel(step)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
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
