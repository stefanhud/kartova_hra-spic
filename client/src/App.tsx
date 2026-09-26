// client/src/App.tsx
import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { Table } from './components/Table';
import { Controls } from './components/Controls';

const SERVER_URL = window.location.port === '5173'
  ? `http://${window.location.hostname}:3001`
  : undefined;

// Connect using the calculated URL
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'] // Improves mobile connection stability
});

function App() {
  // --- STATE ---
  const [gameState, setGameState] = useState<any>(null);
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sitSeat, setSitSeat] = useState<number | null>(null); // seat awaiting a name in the modal
  const [nameInput, setNameInput] = useState<string>('');
  const [buyIn, setBuyIn] = useState<number>(50); // chips brought to the table
  const [noSwapNotice, setNoSwapNotice] = useState(false); // "you can't improve, passing" info screen
  const noSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [logOpen, setLogOpen] = useState(false); // collapsed to one line by default

  // Remembered so we can automatically re-take our seat after a reconnect
  const myInfoRef = useRef<{ name: string; seat: number; buyIn: number } | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected');
      // Re-join after a dropped connection (mobile browsers suspend sockets a lot)
      if (myInfoRef.current) {
        socket.emit('joinGame', myInfoRef.current.name, myInfoRef.current.seat, myInfoRef.current.buyIn);
      }
    });

    socket.on('gameState', (newState) => {
      setGameState(newState);
    });

    socket.on('actionError', (msg: string) => {
      setErrorMsg(msg);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setErrorMsg(null), 4000);
    });

    // Server says this player has no improving swap — show a brief notice; it auto-passes.
    socket.on('noSwap', () => {
      setNoSwapNotice(true);
      if (noSwapTimer.current) clearTimeout(noSwapTimer.current);
      noSwapTimer.current = setTimeout(() => setNoSwapNotice(false), 2600);
    });

    return () => {
      socket.off('connect');
      socket.off('gameState');
      socket.off('actionError');
      socket.off('noSwap');
    };
  }, []);

  // --- ACTIONS ---
  const handleSit = (seatIndex: number) => {
    setNameInput(localStorage.getItem('spicName') || '');
    const saved = Number(localStorage.getItem('spicBuyIn')) || 50;
    setBuyIn(Math.min(100, Math.max(5, saved)));
    setSitSeat(seatIndex);
  };

  const confirmSit = () => {
    const name = nameInput.trim();
    if (!name || sitSeat === null) return;
    localStorage.setItem('spicName', name);
    localStorage.setItem('spicBuyIn', String(buyIn));
    socket.emit('joinGame', name, sitSeat, buyIn);
    myInfoRef.current = { name, seat: sitSeat, buyIn };
    setSitSeat(null);
  };

  const handleLeave = () => {
    socket.emit('leaveGame');
    myInfoRef.current = null; // don't auto-rejoin on reconnect
  };

  const handleAction = (action: string, amount?: number) => {
    socket.emit('playerAction', action, amount);
  };

  const handleDealerSpecial = (action: 'TAKE' | 'PASS') => {
    socket.emit('dealerSpecial', action);
  };

  const handleBankerLook = () => {
    socket.emit('bankerLook');
  };

  // --- RENDER LOADING ---
  if (!gameState) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '18px', background: 'radial-gradient(circle at 50% 22%, #23232a 0%, #151518 58%, #0d0d0f 100%)', fontFamily: 'system-ui, sans-serif' }}>
      Connecting to table…
    </div>
  );

  // --- TURN LOGIC (seat derived from the server's view, not local guess) ---
  const myPlayer = gameState.players.find((p: any) => p.id === socket.id);
  const mySeat = myPlayer ? myPlayer.seatIndex : null;
  const isMyTurn = myPlayer != null && gameState.turnIndex === mySeat;
  const amIDealer = myPlayer != null && mySeat === gameState.dealerIndex;
  const canBankerLook = amIDealer && gameState.phase.startsWith('BETTING') && !myPlayer.hasLooked && !myPlayer.isFolded;

  // --- CARD CLICK LOGIC ---
  const handleCardClick = (location: 'HAND' | 'TALON', index: number) => {
    if (!isMyTurn || gameState.phase !== 'TALON_SWAP') return;

    if (location === 'HAND') {
      setSelectedHandIndex(index);
    } else if (location === 'TALON') {
      if (selectedHandIndex !== null) {
        socket.emit('swapCard', selectedHandIndex, index);
        setSelectedHandIndex(null);
      }
    }
  };

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 22%, #23232a 0%, #151518 58%, #0d0d0f 100%)',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      position: 'relative',
      color: 'white',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    }}>

      {/* Header */}
      <div style={{ position: 'absolute', top: '12px', left: '18px', zIndex: 50, pointerEvents: 'none' }}>
        <span style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '2px', color: '#f4f4f6' }}>ŠPIC</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginLeft: '10px' }}>
          Ante 5 · 6-max
        </span>
      </div>

      {/* LEAVE TABLE (only while seated) */}
      {myPlayer && (
        <button
          onClick={handleLeave}
          style={{
            position: 'absolute', top: '12px', right: '14px', zIndex: 50,
            padding: '8px 14px', borderRadius: '9px', cursor: 'pointer',
            background: 'rgba(20,20,22,0.85)', border: '1.5px solid #e0533d', color: '#ff6a52',
            fontSize: '13px', fontWeight: 800, letterSpacing: '0.5px'
          }}
        >
          LEAVE
        </button>
      )}

      {/* TAKE A SEAT MODAL */}
      {sitSeat !== null && (
        <div
          onClick={() => setSitSeat(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(380px, 92vw)',
              background: 'rgba(24,24,28,0.98)',
              borderRadius: '16px',
              padding: '26px 24px 22px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 0 0 1.5px rgba(62,207,122,0.35)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f4f4f6', letterSpacing: '0.3px' }}>Take a seat</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginTop: '4px' }}>
              Seat {sitSeat + 1} · name & buy-in
            </div>
            <input
              autoFocus
              value={nameInput}
              maxLength={16}
              placeholder="Your name"
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmSit();
                if (e.key === 'Escape') setSitSeat(null);
              }}
              style={{
                width: '100%', marginTop: '18px', padding: '13px 15px',
                background: 'rgba(0,0,0,0.35)', border: '1.5px solid rgba(255,255,255,0.14)',
                borderRadius: '10px', color: '#fff', fontSize: '16px', fontWeight: 600,
                outline: 'none', textAlign: 'center'
              }}
              onFocus={e => (e.target.style.borderColor = '#3ecf7a')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.14)')}
            />

            {/* Buy-in slider (chips brought to the table) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '20px', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', color: 'rgba(255,255,255,0.4)' }}>BUY-IN</span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#3ecf7a' }}>€{buyIn}</span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={buyIn}
              onChange={e => setBuyIn(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#3ecf7a', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
              <span>€5</span>
              <span>€100</span>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button
                onClick={() => setSitSeat(null)}
                style={{
                  flex: 1, padding: '13px', borderRadius: '10px', cursor: 'pointer',
                  background: 'rgba(20,20,22,0.9)', border: '1.5px solid #6a6a72', color: '#c6c6cc',
                  fontSize: '15px', fontWeight: 800
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmSit}
                disabled={!nameInput.trim()}
                style={{
                  flex: 1, padding: '13px', borderRadius: '10px',
                  cursor: nameInput.trim() ? 'pointer' : 'not-allowed',
                  background: nameInput.trim() ? '#3ecf7a' : 'rgba(62,207,122,0.3)',
                  border: 'none', color: nameInput.trim() ? '#0d1f14' : 'rgba(13,31,20,0.5)',
                  fontSize: '15px', fontWeight: 800
                }}
              >
                Take Seat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* START BUTTON — sits in the clear band below the table so it never overlaps a pod */}
      {gameState.phase === 'WAITING' && gameState.players.length >= 2 && (
        <div style={{ position: 'fixed', bottom: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <button
            onClick={() => socket.emit('startGame')}
            style={{ padding: '15px 34px', fontSize: '17px', background: '#3ecf7a', color: '#0d1f14', border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: '0.5px', borderRadius: '12px', boxShadow: '0 8px 22px rgba(62,207,122,0.4)' }}
          >
            DEAL CARDS
          </button>
        </div>
      )}

      {/* ERROR TOAST (e.g. blocked swap) */}
      {errorMsg && (
        <div style={{
          position: 'absolute', top: '58px', left: '50%', transform: 'translateX(-50%)',
          background: '#e0533d', color: 'white', padding: '11px 20px', borderRadius: '10px',
          zIndex: 300, fontWeight: 700, boxShadow: '0 6px 18px rgba(0,0,0,0.5)', maxWidth: '90vw', textAlign: 'center', fontSize: '14px'
        }}>
          {errorMsg}
        </div>
      )}

      {/* "NOTHING TO SWAP" NOTICE — blocks the swap cards, then the server auto-passes */}
      {noSwapNotice && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 90,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8,8,10,0.55)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)'
        }}>
          <div style={{
            background: 'rgba(24,24,28,0.98)', borderRadius: '16px', padding: '24px 30px',
            textAlign: 'center', maxWidth: '86vw',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 0 0 1.5px rgba(224,83,61,0.4)'
          }}>
            <div style={{ fontSize: '34px', marginBottom: '6px' }}>🚫</div>
            <div style={{ fontSize: '19px', fontWeight: 800, color: '#f4f4f6' }}>No improving swap</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginTop: '6px' }}>
              You can't beat the current hand — passing to the next player…
            </div>
          </div>
        </div>
      )}

      {/* WINNER BANNER */}
      {gameState.phase === 'SHOWDOWN' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(20,20,24,0.95)', padding: '26px 46px', borderRadius: '18px', zIndex: 200, textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.6), inset 0 0 0 1.5px rgba(62,207,122,0.5)', maxWidth: '90vw' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 6vw, 46px)', textTransform: 'uppercase', color: '#3ecf7a', letterSpacing: '1px' }}>Showdown</h1>
          <h2 style={{ margin: '14px 0 0 0', fontSize: 'clamp(17px, 4vw, 28px)', fontWeight: 700, color: '#f2f2f4' }}>
             {gameState.gameWinner ?
                `${gameState.players.find((p: any) => p.id === gameState.gameWinner)?.name} wins the pot`
                : "It's a tie — pot stays"}
          </h2>
        </div>
      )}

      {/* TABLE */}
      <Table
        players={gameState.players}
        talon={gameState.talon}
        mySeatIndex={mySeat}
        phase={gameState.phase}
        dealerSeatIndex={gameState.dealerIndex}
        turnIndex={gameState.turnIndex}
        turnNonce={gameState.turnNonce}
        onSit={handleSit}
        onCardClick={handleCardClick}
        selectedHandIndex={selectedHandIndex}
        pot={gameState.pot}
        potThreshold={gameState.potThreshold}
      />

      {/* CONTROLS */}
      {(gameState.phase.startsWith('BETTING') || gameState.phase === 'TALON_SWAP' || gameState.phase === 'DEALER_SPECIAL') && myPlayer && (
        <Controls
          onAction={handleAction}
          currentBet={gameState.currentBet}
          myBet={myPlayer.bet}
          myChips={myPlayer.chips}
          onDealerSpecial={handleDealerSpecial}
          isMyTurn={isMyTurn}
          phase={gameState.phase}
          onPass={() => socket.emit('passTurn')}
          isDealer={amIDealer}
        />
      )}

      {/* BANKER'S BLIND CHOICE — look at your cards (forfeits the talon-swap privilege) */}
      {canBankerLook && (
        <div style={{
          position: 'fixed', bottom: '250px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 95, textAlign: 'center'
        }}>
          <button
            onClick={handleBankerLook}
            style={{ padding: '11px 20px', background: 'rgba(20,20,22,0.9)', color: '#c99bf0', border: '1.5px solid #8e44ad', borderRadius: '10px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}
          >
            👁 LOOK AT CARDS
          </button>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '5px' }}>
            forfeits the talon-swap privilege
          </div>
        </div>
      )}

      {/* LOG — one line at the very bottom, tap to expand/collapse */}
      <div
        onClick={() => setLogOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 70,
          background: 'rgba(0,0,0,0.55)',
          color: 'rgba(255,255,255,0.72)',
          fontSize: '12px',
          lineHeight: 1.5,
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          borderTop: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        {logOpen ? (
          <div style={{ maxHeight: '38vh', overflowY: 'auto', padding: '8px 12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>
              GAME LOG ▾
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {gameState.log.slice().reverse().map((entry: string, i: number) => (
                <li key={i} style={{ marginBottom: '3px', opacity: i === 0 ? 1 : 0.65 }}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ padding: '7px 12px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {gameState.log[gameState.log.length - 1]}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>▴</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
