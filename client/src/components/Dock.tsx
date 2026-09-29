import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNow } from '../hooks';
import { useI18n } from '../i18n';
import { stepLabel } from '../money';
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

// Same rule as the server: at least match the bar (Trojicas compare by rank, 888 > 777),
// and while a pot is carried the hand must be able to win it.
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function reachesBar(me: Player, view: GameView) {
  const score = me.score ?? 0;
  if (score <= 0 || score < view.minScoreToBeat) return false;
  if (view.potThreshold > 0 && (view.spicTie ? score < 31 : score <= view.potThreshold)) return false;
  if (score > view.minScoreToBeat || view.barHand?.k !== 'trojica' || me.handDesc?.k !== 'trojica') return true;
  return RANKS.indexOf(String(me.handDesc.v)) >= RANKS.indexOf(String(view.barHand.v));
}

export function Dock({ view, me, clockOffset, connected, selection, actions }: Props) {
  const { t, lang, hand } = useI18n();
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
    status = t('reconnecting');
    tone = 'warn';
  } else if (!me) {
    status = view.players.length < view.config.seats ? t('tapSeat') : t('tableFull');
  } else if (view.phase === 'SHOWDOWN') {
    status = t('nextSoon');
  } else if (view.phase === 'WAITING') {
    const ready = view.players.filter(p => p.connected && !p.benched).length;
    if (me.benched) status = t('youBenched');
    else if (ready < 2) status = t('waitingOther');
    else if (me.debt > 0) status = t('youOwe', { amount: me.debt });
    else status = t('readyDeal', { n: ready });
  } else if (view.phase === 'DEALER_CHOICE') {
    if (hasClock) {
      tone = 'turn';
      status = t('yourDealOwe', { amount: me.debt });
    } else {
      status = turnPlayer ? t('decidesDeal', { name: turnPlayer.name }) : t('choosingBanker');
    }
  } else if (me.benched) {
    status = t('sitOutTillWin');
  } else if (me.sittingOut) {
    status = t('joinNext');
  } else if (me.isFolded) {
    status = t('youreOut', { name: turnPlayer?.name });
  } else if (onTurn && !hasClock) {
    status = view.phase === 'TALON_SWAP' ? t('noSwapPassing') : t('autoCallBanker');
  } else if (hasClock) {
    tone = 'turn';
    if (view.phase === 'TALON_SWAP') {
      status = sel?.hand != null && sel.talon != null ? t('confirmSwap')
        : sel?.hand != null ? t('tapTable')
          : sel?.talon != null ? t('tapHand')
            : t('yourSwap');
    } else if (view.phase === 'DEALER_SPECIAL') {
      status = t('bankerOptionQ');
    } else {
      status = due > 0 ? t('yourTurnPay', { amount: due }) : t('yourTurn');
    }
  } else if (isBanker && isBetting(view.phase)) {
    status = t('bankerCallsAll', { name: turnPlayer?.name });
  } else {
    status = turnPlayer ? t('waitingFor', { name: turnPlayer.name }) : t('dealing');
  }

  // ----- controls -----
  let controls: ReactNode = null;
  const owed = me ? Math.max(0, view.currentBet - me.bet) : 0;

  if (me && view.phase === 'WAITING') {
    const ready = view.players.filter(p => p.connected && !p.benched).length;
    controls = (
      <button type="button" className="btn btn--primary btn--wide" onClick={actions.deal} disabled={ready < 2}>{t('dealCards')}</button>
    );
  } else if (me && view.phase === 'DEALER_CHOICE' && hasClock) {
    controls = (
      <div className="duo">
        <button type="button" className="btn btn--primary btn--stack" onClick={() => actions.dealerChoice('PAY')}>
          {t('payDeal', { amount: me.debt })}
          <span className="btn__sub">{t('andPlay')}</span>
        </button>
        <button type="button" className="btn btn--neutral btn--stack" onClick={() => actions.dealerChoice('SKIP')}>
          {t('skip')}
          <span className="btn__sub">{t('sitOutSub')}</span>
        </button>
      </div>
    );
  } else if (me && inRound && !me.isFolded && !me.sittingOut && isBetting(view.phase)) {
    if (isBanker) {
      controls = (
        <div className="btn btn--ghost btn--note btn--wide" aria-disabled="true">
          {t('bankerNote')}
        </div>
      );
    } else {
      const active = hasClock;
      const callText = owed === 0 ? t('check') : t('call', { amount: owed });
      const callSub = due > 0 ? t('plusOwed', { amount: due }) : null;
      const mayRaise = view.raiserSeats.includes(me.seatIndex);
      const raiseLabel = !mayRaise ? t('noRaise') : active && !view.canRaise ? t('raiseUsed') : t('raise');
      controls = (
        <div className={`betbar${active ? '' : ' is-idle'}`}>
          <button type="button" className="btn btn--danger" disabled={!active} onClick={() => actions.bet('FOLD')}>{t('fold')}</button>
          <button type="button" className={`btn btn--primary${callSub ? ' btn--stack' : ''}`} disabled={!active}
            onClick={() => actions.bet('CALL')}>
            {callText}
            {callSub && <span className="btn__sub">{callSub}</span>}
          </button>
          <div className={`raise${mayRaise ? '' : ' is-off'}`} role="group" aria-label={t('raiseBy')}
            title={mayRaise ? t('raiseRule') : t('raiseOff')}>
            <span className="raise__label">{raiseLabel}</span>
            <div className="raise__row">
              {view.config.raiseSteps.map(step => {
                return (
                  <button key={step} type="button" className="btn btn--raise"
                    disabled={!active || !view.canRaise}
                    onClick={() => actions.bet('RAISE', step)} aria-label={t('raiseByX', { amount: step })}>
                    +{stepLabel(step, lang)}
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
        <button type="button" className="btn btn--ghost" onClick={actions.clearSelection}>{t('cancel')}</button>
        <button type="button" className="btn btn--primary" onClick={() => actions.swap(option.h, option.t)}>
          {t('swapTo', { score: option.score })}
        </button>
      </div>
    ) : (
      <div className="duo">
        {sel && (sel.hand != null || sel.talon != null) && (
          <button type="button" className="btn btn--ghost" onClick={actions.clearSelection}>{t('cancel')}</button>
        )}
        <button type="button" className="btn btn--neutral" onClick={actions.pass}>
          {me && reachesBar(me, view) ? t('keepHand') : t('pass')}
        </button>
      </div>
    );
  } else if (hasClock && view.phase === 'DEALER_SPECIAL') {
    controls = (
      <div className="duo">
        <button type="button" className="btn btn--gold" onClick={() => actions.dealerSpecial('TAKE')}>{t('takeTable')}</button>
        <button type="button" className="btn btn--neutral" onClick={() => actions.dealerSpecial('PASS')}>{t('keepHand')}</button>
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

  const handLabel = blind ? t('blind') : hand(me?.handDesc);

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
            <span className="look__text">{looking ? t('tapToLook') : t('lookCards')}</span>
            <span className="look__sub">{looking ? t('loseTalon') : t('blindKeeps')}</span>
          </button>
        )}
      </div>

      <div className="dock__controls">{controls}</div>
    </div>
  );
}
