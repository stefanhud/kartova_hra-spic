import { useCallback, useEffect, useRef, useState } from 'react';
import { Dock, type DockActions } from './components/Dock';
import { LogSheet, RulesSheet, SitSheet } from './components/Sheets';
import { Table, type SwapSelection } from './components/Table';
import { useWakeLock } from './hooks';
import { euro } from './money';
import { forgetSeat, loadPrefs, rememberSeat, savePrefs, socket } from './socket';
import type { GameView, Snapshot } from './types';
import { isBetting } from './types';

type Toast = { id: number; text: string; tone: 'error' | 'info' };
const NO_SELECTION: SwapSelection = { nonce: -1, hand: null, talon: null };

function Icon({ name }: { name: 'log' | 'help' | 'leave' }) {
  const paths = {
    log: 'M4 6h16M4 12h16M4 18h10',
    help: 'M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2V14M12 17.5v.01',
    leave: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {name === 'help' && <circle cx="12" cy="12" r="9.5" />}
      <path d={paths[name]} />
    </svg>
  );
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [replaced, setReplaced] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'log' | 'rules' | null>(null);
  const [selection, setSelection] = useState<SwapSelection>(NO_SELECTION);
  const [prefs, setPrefs] = useState(loadPrefs);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastSeq = useRef(0);

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'error', ms = 3500) => {
    clearTimeout(toastTimer.current);
    setToast({ id: ++toastSeq.current, text, tone });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // --- socket ---
  useEffect(() => {
    const onState = (view: GameView) => setSnap({ view, clockOffset: view.serverNow - Date.now() });
    const onConnect = () => {
      setConnected(true);
      setReplaced(false);
    };
    const onDisconnect = () => setConnected(false);
    const onError = (msg: string) => showToast(msg, 'error');
    const onNoSwap = () => showToast('No swap can beat the bar — you pass.', 'info', 2600);
    const onReplaced = () => setReplaced(true);

    socket.on('gameState', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('actionError', onError);
    socket.on('noSwap', onNoSwap);
    socket.on('sessionReplaced', onReplaced);
    return () => {
      socket.off('gameState', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('actionError', onError);
      socket.off('noSwap', onNoSwap);
      socket.off('sessionReplaced', onReplaced);
    };
  }, [showToast]);

  const view = snap?.view ?? null;
  const buyIn = prefs.buyIn ?? view?.config.defaultBuyIn ?? 2000; // euro cents
  const me = view?.players.find(p => p.id === view.you) ?? null;
  const seated = !!me;
  const inRound = !!view && view.phase !== 'WAITING' && view.phase !== 'SHOWDOWN';
  const myClock = !!view && !!me && inRound && view.turnIndex === me.seatIndex && view.turnDeadline > 0 && !me.isFolded;
  const swapping = myClock && view!.phase === 'TALON_SWAP';
  const myTurnNonce = myClock ? view!.turnNonce : null;

  useEffect(() => {
    if (seated) rememberSeat();
  }, [seated]);

  useWakeLock(seated);

  // Buzz and flag the tab when it's your move (it's easy to look away at a 6-player table).
  useEffect(() => {
    if (myTurnNonce === null) {
      document.title = 'ŠPIC';
      return;
    }
    document.title = '● Your turn — ŠPIC';
    navigator.vibrate?.(60);
  }, [myTurnNonce]);

  // --- actions ---
  const select = useCallback((kind: 'hand' | 'talon', index: number) => {
    if (!view || !swapping) return;
    const cur = selection.nonce === view.turnNonce ? selection : { ...NO_SELECTION, nonce: view.turnNonce };
    const other = kind === 'hand' ? cur.talon : cur.hand;
    const valid = view.swapOptions.some(o =>
      kind === 'hand' ? o.h === index && (other === null || o.t === other) : o.t === index && (other === null || o.h === other));
    if (cur[kind] === index) {
      setSelection({ ...cur, [kind]: null });
      return;
    }
    if (!valid) {
      const bar = view.minScoreToBeat > 0 ? `beat ${view.minScoreToBeat}` : 'make a Flush or Trojica';
      showToast(other === null ? `That card can't ${bar} with any swap.` : `That swap can't ${bar}.`, 'info', 2400);
      return;
    }
    setSelection({ ...cur, [kind]: index });
  }, [view, swapping, selection, showToast]);

  const clearSelection = useCallback(() => setSelection(NO_SELECTION), []);

  const actions: DockActions = {
    bet: (action, step) => socket.emit('playerAction', action, step),
    look: () => socket.emit('bankerLook'),
    swap: (h, t) => {
      socket.emit('swapCard', h, t);
      clearSelection();
    },
    pass: () => {
      socket.emit('passTurn');
      clearSelection();
    },
    dealerSpecial: action => socket.emit('dealerSpecial', action),
    dealerChoice: action => socket.emit('dealerChoice', action),
    deal: () => socket.emit('startGame'),
    rebuy: () => socket.emit('rebuy', buyIn),
    clearSelection,
    selectHand: i => select('hand', i),
  };

  const leave = () => {
    if (inRound && me && !me.isFolded && !window.confirm('Leave the table? You will fold this hand.')) return;
    socket.emit('leaveGame');
    forgetSeat();
  };

  const onSeatTap = (seat: number) => {
    if (me) socket.emit('joinGame', me.name, seat, buyIn); // move seats between hands
    else setSitSeat(seat);
  };

  const confirmSit = (name: string, buyIn: number) => {
    const next = { name, buyIn };
    savePrefs(next);
    setPrefs(next);
    if (sitSeat !== null) socket.emit('joinGame', name, sitSeat, buyIn);
    setSitSeat(null);
  };

  // Keyboard shortcuts for desktop players.
  useEffect(() => {
    if (!view || !myClock) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (isBetting(view.phase)) {
        if (k === 'f') socket.emit('playerAction', 'FOLD');
        else if (k === 'c' || k === 'k') socket.emit('playerAction', 'CALL');
        else if (['1', '2', '3'].includes(k)) socket.emit('playerAction', 'RAISE', view.config.raiseSteps[Number(k) - 1]);
        else return;
        e.preventDefault();
      } else if (view.phase === 'TALON_SWAP' && k === 'p') {
        socket.emit('passTurn');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, myClock]);

  if (!view) {
    return (
      <div className="splash">
        <div className="splash__logo">ŠPIC</div>
        <div className="splash__text">{connected ? 'Loading table…' : 'Connecting to the table…'}</div>
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const lastLog = view.log[view.log.length - 1]?.text ?? '';

  return (
    <div className={`app${connected ? '' : ' is-offline'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">ŠPIC</span>
          <span className="brand__meta">ante {euro(view.config.ante)}</span>
        </div>
        <button type="button" className="ticker" onClick={() => setSheet('log')} aria-label="Open table log">
          <span className="ticker__text" key={view.log[view.log.length - 1]?.id}>{lastLog}</span>
        </button>
        <div className="topbar__actions">
          <button type="button" className="icon-btn" onClick={() => setSheet('rules')} aria-label="How to play"><Icon name="help" /></button>
          <button type="button" className="icon-btn" onClick={() => setSheet('log')} aria-label="Table log"><Icon name="log" /></button>
          {me && <button type="button" className="icon-btn icon-btn--danger" onClick={leave} aria-label="Leave table"><Icon name="leave" /></button>}
        </div>
      </header>

      <Table
        view={view}
        me={me}
        swapping={swapping}
        selection={selection}
        onTalonTap={i => select('talon', i)}
        onSeatTap={onSeatTap}
      />

      <Dock
        view={view}
        me={me}
        clockOffset={snap!.clockOffset}
        connected={connected}
        selection={selection}
        actions={actions}
        rebuyAmount={buyIn}
      />

      {toast && <div className={`toast tone-${toast.tone}`} key={toast.id} role="alert">{toast.text}</div>}
      {!connected && <div className="netbanner">Connection lost — reconnecting…</div>}

      {sitSeat !== null && (
        <SitSheet
          seat={sitSeat}
          initialName={prefs.name}
          initialBuyIn={buyIn}
          minBuyIn={view.config.minBuyIn}
          maxBuyIn={view.config.maxBuyIn}
          onConfirm={confirmSit}
          onCancel={() => setSitSeat(null)}
        />
      )}
      {sheet === 'log' && <LogSheet log={view.log} onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesSheet onClose={() => setSheet(null)} />}

      {replaced && (
        <div className="overlay">
          <div className="sheet sheet--center">
            <div className="sheet__title">Open in another tab</div>
            <p className="sheet__text">Your seat is being played from another tab or window.</p>
            <button type="button" className="btn btn--primary btn--wide" onClick={() => socket.connect()}>Play here instead</button>
          </div>
        </div>
      )}
    </div>
  );
}
