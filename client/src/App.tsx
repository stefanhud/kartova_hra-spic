import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dock, type DockActions } from './components/Dock';
import { CashOutSheet, LogSheet, RulesSheet, SettingsSheet, SettleSheet, SitSheet } from './components/Sheets';
import { Table, type SwapSelection } from './components/Table';
import { useWakeLock } from './hooks';
import { I18nContext, loadLang, makeI18n, saveLang, type Lang } from './i18n';
import { forgetSeat, loadPrefs, rememberSeat, savePrefs, socket } from './socket';
import { isMuted, play, setMuted } from './sounds';
import type { GameView, Msg, Settings, Snapshot } from './types';
import { isBetting } from './types';

type Toast = { id: number; text: string; tone: 'error' | 'info' };
const NO_SELECTION: SwapSelection = { nonce: -1, hand: null, talon: null };

type IconName = 'help' | 'leave' | 'settle' | 'settings' | 'sound' | 'muted';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    settle: 'M17 7.5A6 6 0 1 0 17 16.5M4 10.5h9M4 13.5h9',
    help: 'M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2V14M12 17.5v.01',
    leave: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
    settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
    sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
    muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
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
  const [sheet, setSheet] = useState<'log' | 'rules' | 'settle' | 'settings' | 'leave' | null>(null);
  const [lang, setLang] = useState<Lang>(loadLang);
  const [muted, setMutedState] = useState(isMuted);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { t, msg } = i18n;
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
    const onError = (err: Msg | string) => showToast(typeof err === 'string' ? err : msg(err), 'error');
    const onNoSwap = () => showToast(t('noSwapToast'), 'info', 2600);
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
  }, [showToast, msg, t]);

  const view = snap?.view ?? null;
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
    document.title = t('titleTurn');
    navigator.vibrate?.(60);
    play('turn');
  }, [myTurnNonce, t]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Table sounds, worked out from what changed since the last update.
  const prevView = useRef<GameView | null>(null);
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = view;
    if (!view || !prev) return;
    if (view.phase === 'SHOWDOWN' && prev.phase !== 'SHOWDOWN') {
      const winners = view.result?.winnerIds ?? [];
      play(view.you && winners.includes(view.you) ? 'bigWin' : winners.length ? 'win' : 'tie');
    } else if ((view.roundId !== prev.roundId && view.phase !== 'WAITING')
      || (view.phase === 'BETTING_2' && prev.phase === 'BETTING_1')
      || (view.talon.length > 0 && prev.talon.length === 0)) {
      play('deal');
    } else if (view.swappedPlayers.length > prev.swappedPlayers.length) {
      play('swap');
    } else if (view.pot > prev.pot && view.roundId === prev.roundId) {
      play('chip');
    }
  }, [view]);

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
      showToast(t(other === null ? 'cardCant' : 'swapCant', {
        need: view.minScoreToBeat > 0 ? view.barHand ?? view.minScoreToBeat
          : view.potThreshold > 0 ? (view.spicTie ? 'Špic' : t('moreThan', { n: view.potThreshold })) : 0,
      }), 'info', 2400);
      return;
    }
    setSelection({ ...cur, [kind]: index });
  }, [view, swapping, selection, showToast, t]);

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
    clearSelection,
    selectHand: i => select('hand', i),
  };

  // Leaving for good: settle up (the others play on) or leave the score on the Settle up list.
  const leave = (settled: boolean) => {
    socket.emit(settled ? 'cashOut' : 'leaveGame');
    forgetSeat();
    setSheet(null);
  };

  const onSeatTap = (seat: number) => {
    if (me) socket.emit('joinGame', me.name, seat); // move seats between hands
    else setSitSeat(seat);
  };

  const confirmSit = (name: string) => {
    const next = { name };
    savePrefs(next);
    setPrefs(next);
    if (sitSeat !== null) socket.emit('joinGame', name, sitSeat);
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

  const changeLang = (next: Lang) => {
    saveLang(next);
    setLang(next);
  };

  const changeMuted = (next: boolean) => {
    setMuted(next);
    setMutedState(next);
  };

  const saveSettings = (settings: Settings) => socket.emit('updateSettings', settings);

  if (!view) {
    return (
      <div className="splash">
        <div className="splash__logo">ŠPIC</div>
        <div className="splash__text">{connected ? t('loading') : t('connecting')}</div>
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const lastLog = msg(view.log[view.log.length - 1]);

  return (
    <I18nContext.Provider value={i18n}>
    <div className={`app${connected ? '' : ' is-offline'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">ŠPIC</span>
          <span className="brand__meta">{t('anteShort', { amount: view.config.ante })}</span>
        </div>
        <button type="button" className="ticker" onClick={() => setSheet('log')} aria-label={t('openLog')}>
          <span className="ticker__text" key={view.log[view.log.length - 1]?.id}>{lastLog}</span>
        </button>
        <div className="topbar__actions">
          <button type="button" className="icon-btn" onClick={() => setSheet('rules')} aria-label={t('howToPlay')}><Icon name="help" /></button>
          <button type="button" className="icon-btn" onClick={() => changeMuted(!muted)} aria-label={muted ? t('soundOff') : t('soundOn')}
            aria-pressed={!muted}><Icon name={muted ? 'muted' : 'sound'} /></button>
          <button type="button" className="icon-btn" onClick={() => setSheet('settings')} aria-label={t('settingsTitle')}><Icon name="settings" /></button>
          <button type="button" className="icon-btn" onClick={() => setSheet('settle')} aria-label={t('settleUp')}><Icon name="settle" /></button>
          {me && <button type="button" className="icon-btn icon-btn--danger" onClick={() => setSheet('leave')} aria-label={t('leaveTable')}><Icon name="leave" /></button>}
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
      />

      {toast && <div className={`toast tone-${toast.tone}`} key={toast.id} role="alert">{toast.text}</div>}
      {!connected && <div className="netbanner">{t('connLost')}</div>}

      {sitSeat !== null && (
        <SitSheet
          seat={sitSeat}
          initialName={prefs.name}
          onConfirm={confirmSit}
          onCancel={() => setSitSeat(null)}
        />
      )}
      {sheet === 'log' && <LogSheet log={view.log} onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesSheet view={view} onClose={() => setSheet(null)} />}
      {sheet === 'settle' && <SettleSheet view={view} onClose={() => setSheet(null)} />}
      {sheet === 'leave' && me && view.cashOut && (
        <CashOutSheet me={me} cashOut={view.cashOut} inHand={inRound && !me.isFolded}
          onSettled={() => leave(true)} onLeaveUnsettled={() => leave(false)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && (
        <SettingsSheet view={view} me={me} muted={muted} onLang={changeLang} onMuted={changeMuted}
          onSave={saveSettings} onClose={() => setSheet(null)} />
      )}

      {replaced && (
        <div className="overlay">
          <div className="sheet sheet--center">
            <div className="sheet__title">{t('otherTab')}</div>
            <p className="sheet__text">{t('otherTabText')}</p>
            <button type="button" className="btn btn--primary btn--wide" onClick={() => socket.connect()}>{t('playHere')}</button>
          </div>
        </div>
      )}
    </div>
    </I18nContext.Provider>
  );
}
