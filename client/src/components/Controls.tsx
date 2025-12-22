// client/src/components/Controls.tsx
import React, { useState } from 'react';

interface ControlsProps {
  onAction: (action: string, amount?: number) => void;
  onPass?: () => void;
  onDealerSpecial?: (action: 'TAKE' | 'PASS') => void;
  phase: string;
  currentBet: number;
  myBet: number;
  myChips: number;
  isMyTurn: boolean;
}

export const Controls: React.FC<ControlsProps> = ({ 
  onAction, onPass, onDealerSpecial, phase, currentBet, myBet, myChips, isMyTurn 
}) => {
  const [raiseAmount, setRaiseAmount] = useState(currentBet + 10);
  
  // Hide if not my turn
  if (!isMyTurn) return <div style={{height: '60px'}}></div>;

  // --- 1. DEALER SPECIAL BUTTONS (Restored) ---
  // --- DEALER SPECIAL ---
  if (phase === 'DEALER_SPECIAL') {
      return (
        <div style={{ 
            position: 'fixed', bottom: '150px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '20px', background: 'rgba(0,0,0,0.9)', padding: '30px', borderRadius: '15px', 
            zIndex: 99999, // <--- EXTREME Z-INDEX to prevent unclickable state
            flexDirection: 'column', alignItems: 'center', boxShadow: '0 0 20px rgba(0,0,0,0.8)'
        }}>
            <h2 style={{color: '#f1c40f', margin: '0 0 15px 0'}}>Special Dealer Option!</h2>
            <div style={{display: 'flex', gap: '20px'}}>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDealerSpecial && onDealerSpecial('TAKE'); }}
                  style={{
                      background: '#2ecc71', color: 'white', padding: '20px 40px', 
                      borderRadius: '10px', border: '2px solid white', cursor: 'pointer', 
                      fontWeight: 'bold', fontSize: '18px'
                  }}
                >
                  TAKE 3 FROM TABLE
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDealerSpecial && onDealerSpecial('PASS'); }}
                  style={{
                      background: '#7f8c8d', color: 'white', padding: '20px 40px', 
                      borderRadius: '10px', border: '2px solid white', cursor: 'pointer',
                      fontWeight: 'bold', fontSize: '18px'
                  }}
                >
                  REVEAL MY HAND
                </button>
            </div>
        </div>
      );
  }

  // --- 2. TALON BUTTONS ---
  if (phase === 'TALON_SWAP') {
    return (
      <div style={{ 
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', 
        background: 'rgba(0,0,0,0.8)', padding: '15px', borderRadius: '15px', zIndex: 100
      }}>
        <h3 style={{color: '#bdc3c7', margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px'}}>
          Click cards to swap or...
        </h3>
        <button 
          onClick={onPass}
          style={{
            background: '#3498db', color: 'white', padding: '12px 30px', 
            borderRadius: '5px', cursor: 'pointer', border: 'none', 
            fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 0 #2980b9'
          }}
        >
          PASS / KNOCK
        </button>
      </div>
    );
  }

  // --- 3. BETTING BUTTONS ---
  const callAmount = currentBet - myBet;

  return (
    <div style={{ 
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: '10px', background: 'rgba(0,0,0,0.8)', padding: '15px', borderRadius: '15px', zIndex: 100
    }}>
      <button 
        style={{background: '#e74c3c', color: 'white', padding: '10px', borderRadius: '5px', cursor: 'pointer', border: 'none'}}
        onClick={() => onAction('FOLD')}
      >
        FOLD
      </button>

      <button 
        style={{background: '#f1c40f', color: '#2c3e50', padding: '10px 20px', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', border: 'none'}}
        onClick={() => onAction('CALL')}
      >
        {callAmount > 0 ? `CALL $${callAmount}` : 'CHECK'}
      </button>

      <div style={{display: 'flex', flexDirection: 'column', gap: '5px'}}>
        <button 
          style={{background: '#2ecc71', color: 'white', padding: '5px', borderRadius: '5px', cursor: 'pointer', border: 'none'}}
          onClick={() => onAction('RAISE', raiseAmount)}
        >
          RAISE TO ${raiseAmount}
        </button>
        <input 
          type="range" 
          min={currentBet + 5} 
          max={myChips} 
          step={5}
          value={raiseAmount} 
          onChange={(e) => setRaiseAmount(Number(e.target.value))} 
        />
      </div>
    </div>
  );
};