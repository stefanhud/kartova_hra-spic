// client/src/App.tsx
import { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { Table } from './components/Table';
import { Controls } from './components/Controls';

const socket = io('http://localhost:3001');

function App() {
  // --- STATE ---
  const [gameState, setGameState] = useState<any>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  
  // ✅ FIXED: Moved inside the component
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);


  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on('connect', () => console.log("Connected"));

    // Listen for state updates from server
    socket.on('gameState', (newState) => {
      setGameState(newState);
    });

    return () => {
      socket.off('gameState');
    };
  }, []);

  // --- ACTIONS ---
  const handleSit = (seatIndex: number) => {
    const name = prompt("Enter your name:");
    if (name) {
      socket.emit('joinGame', name, seatIndex);
      setMySeat(seatIndex);
    }
  };

  const handleAction = (action: string, amount?: number) => {
    socket.emit('playerAction', action, amount);
  };

  // --- NEW HANDLER ---
  const handleDealerSpecial = (action: 'TAKE' | 'PASS') => {
    console.log("Dealer clicked:", action); // Debugging
    socket.emit('dealerSpecial', action);
  };
  // -------------------

  // --- RENDER LOADING ---
  if (!gameState) return <div style={{color: 'white'}}>Loading Game State...</div>;

  // --- TURN LOGIC ---
  const activePlayer = gameState.players.find((p: any) => p.seatIndex === gameState.turnIndex);
  const isMyTurn = activePlayer && mySeat !== null && activePlayer.seatIndex === mySeat;
  const myPlayer = gameState.players.find((p: any) => p.seatIndex === mySeat);

  // --- CARD CLICK LOGIC ---
  const handleCardClick = (location: 'HAND' | 'TALON', index: number) => {
    if (!isMyTurn || gameState.phase !== 'TALON_SWAP') return;

    if (location === 'HAND') {
      // Select card from my hand
      setSelectedHandIndex(index);
      console.log(`Selected hand card index: ${index}`); // Debug log
    } else if (location === 'TALON') {
      // If we already selected a hand card, perform the swap!
      if (selectedHandIndex !== null) {
        socket.emit('swapCard', selectedHandIndex, index);
        setSelectedHandIndex(null); // Reset selection
      }
    }
  };

  return (
    <div style={{ backgroundColor: '#2c3e50', minHeight: '100vh', padding: '20px', color: 'white' }}>
      <h1 style={{textAlign: 'center'}}>Bar Špic</h1>
      
      {/* START BUTTON */}
      {gameState.phase === 'WAITING' && gameState.players.length >= 2 && (
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <button 
            onClick={() => socket.emit('startGame')}
            style={{
              padding: '10px 20px', 
              fontSize: '18px', 
              background: '#f1c40f', 
              border: 'none', 
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            DEAL CARDS
          </button>
        </div>
      )}

      {/* WINNER BANNER */}
      {gameState.phase === 'SHOWDOWN' && (
        <div style={{
          position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(231, 76, 60, 0.9)', padding: '20px 40px', borderRadius: '10px',
          zIndex: 200, textAlign: 'center', border: '2px solid white'
        }}>
          <h1 style={{margin: 0, fontSize: '40px'}}>SHOWDOWN!</h1>
          <h2 style={{margin: '10px 0'}}>
             {gameState.gameWinner ? 
                `Winner: ${gameState.players.find((p:any) => p.id === gameState.gameWinner)?.name}` 
                : "It's a Tie!"}
          </h2>
        </div>
      )}
      
      {/* TABLE AREA */}
      <Table 
        players={gameState.players} 
        talon={gameState.talon} 
        mySeatIndex={mySeat}           // <--- Pass this
        phase={gameState.phase}        // <--- Pass this
        dealerSeatIndex={gameState.dealerIndex} // <--- PASS THIS
        onSit={handleSit} 
        onCardClick={handleCardClick} 
      />

      {/* CONTROLS (Betting OR Talon Phase) */}
      {(gameState.phase.startsWith('BETTING') || gameState.phase === 'TALON_SWAP' || gameState.phase === 'DEALER_SPECIAL') && myPlayer && (
        <Controls 
          onAction={handleAction}
          currentBet={gameState.currentBet}
          myBet={myPlayer.bet}
          myChips={myPlayer.chips}
          onDealerSpecial={handleDealerSpecial} // <--- Added
          isMyTurn={isMyTurn}
          phase={gameState.phase}
          onPass={() => socket.emit('passTurn')}
        />
      )}

      {/* LOGS */}
      <div style={{ maxWidth: '600px', margin: '20px auto', background: 'rgba(0,0,0,0.3)', padding: '10px' }}>
        <h3>Game Log:</h3>
        <ul>
          {gameState.log.map((entry: string, i: number) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;