// client/src/components/Table.tsx
import React from 'react';
import styled from 'styled-components';

interface Card {
  suit: string;
  rank: string;
  value: number;
}

interface Player {
  seatIndex: number;
  name: string;
  chips: number;
  hand: Card[];
  isFolded: boolean;
  specialStatus?: string;
  isFaceUp?: boolean;
  score?: number;
}

interface TableProps {
  players: Player[];
  talon?: Card[];
  mySeatIndex: number | null;
  phase: string;
  dealerSeatIndex: number;
  onSit: (seatIndex: number) => void;
  onCardClick?: (location: 'HAND' | 'TALON', index: number) => void;
}

// ... (KEEP ALL STYLED COMPONENTS THE SAME: TableWrapper, Seat, CardImg, CardBack, etc.) ...
// I will omit the styled components here to save space, but DO NOT DELETE THEM from your file.
// Just ensure you keep the styled components definition you already had.

const TableWrapper = styled.div`
  position: relative;
  width: 800px;
  height: 400px;
  background-color: #27ae60;
  border: 15px solid #1e824c;
  border-radius: 200px;
  margin: 50px auto;
  box-shadow: inset 0 0 50px rgba(0,0,0,0.5);
  display: flex;
  justify-content: center;
  align-items: center;
`;

const Seat = styled.button<{ $top: string; $left: string; $occupied: boolean; $isFolded: boolean }>`
  position: absolute;
  top: ${props => props.$top};
  left: ${props => props.$left};
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 3px solid ${props => props.$occupied ? (props.$isFolded ? '#7f8c8d' : '#f1c40f') : 'rgba(255,255,255,0.3)'};
  background: ${props => props.$occupied ? '#34495e' : 'rgba(0,0,0,0.2)'};
  color: white;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  transform: translate(-50%, -50%);
  z-index: 10;
  opacity: ${props => props.$isFolded ? 0.6 : 1};

  &:hover {
    background: ${props => props.$occupied ? '#34495e' : 'rgba(255,255,255,0.1)'};
  }
`;

const CardImg = styled.img<{ $offset: number }>`
  width: 40px;
  height: 60px;
  position: absolute;
  bottom: -40px;
  left: ${props => 30 + props.$offset * 20}px;
  box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  transition: transform 0.1s;
  
  &:hover {
    transform: translateY(-10px);
    z-index: 20;
  }
`;

const CardBack = styled.div<{ $offset: number }>`
  width: 40px;
  height: 60px;
  position: absolute;
  bottom: -40px;
  left: ${props => 30 + props.$offset * 20}px;
  box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
  border-radius: 4px;
  background: repeating-linear-gradient(45deg, #c0392b, #c0392b 10px, #e74c3c 10px, #e74c3c 20px);
  border: 2px solid white;
`;

const ChipsDisplay = styled.div`
  position: absolute;
  top: -25px;
  background: rgba(0,0,0,0.6);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  color: #f1c40f;
  white-space: nowrap;
`;

const ScoreBubble = styled.div`
  position: absolute;
  /* Position it just above the cards area */
  bottom: 25px; 
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border: 2px solid #2c3e50;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: bold;
  color: #2c3e50;
  font-size: 14px;
  z-index: 30;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  pointer-events: none; /* Let clicks pass through to seat */
  white-space: nowrap;
`;

const DealerBadge = styled.div`
  position: absolute;
  top: -10px;
  right: -10px;
  width: 25px;
  height: 25px;
  background: white;
  color: black;
  border: 2px solid black;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: bold;
  font-size: 14px;
  z-index: 25;
  box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
`;

const StatusBadge = styled.div`
  position: absolute;
  bottom: 80px;
  background: #e74c3c;
  color: white;
  font-weight: bold;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  z-index: 20;
`;

const TalonContainer = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 10px;
  z-index: 5;
`;

const TalonCard = styled.img`
  width: 50px;
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0,0,0,0.5);
  transition: transform 0.1s;
  &:hover { transform: scale(1.1); }
`;

const SEAT_POSITIONS = [
  { top: '15%', left: '50%' },
  { top: '30%', left: '85%' },
  { top: '70%', left: '85%' },
  { top: '85%', left: '50%' },
  { top: '70%', left: '15%' },
  { top: '30%', left: '15%' },
];

export const Table: React.FC<TableProps> = ({ 
  players, talon = [], mySeatIndex, phase, dealerSeatIndex, onSit, onCardClick 
}) => {
  return (
    <TableWrapper>
      <h2 style={{ color: 'rgba(255,255,255,0.1)', position: 'absolute', top: '35%', pointerEvents: 'none', userSelect: 'none' }}>ŠPIC</h2>
      
      <TalonContainer>
        {talon.map((card, i) => (
          <TalonCard 
            key={i}
            src={`/cards/${card.suit}${card.rank}.png`}
            onClick={() => onCardClick && onCardClick('TALON', i)}
          />
        ))}
      </TalonContainer>

      {SEAT_POSITIONS.map((pos, index) => {
        const player = players.find(p => p.seatIndex === index);
        const isMe = mySeatIndex === index;
        const isDealer = index === dealerSeatIndex;
        
        // --- FIXED LOGIC HERE ---
        // 1. Define what phases are "Blind" for the dealer
        const isBlindPhase = phase.startsWith('BETTING') || phase === 'DEALING_3' || phase === 'DEALER_SPECIAL';
        
        // 2. USE isBlindPhase in the check
        const amIBlind = isMe && isDealer && isBlindPhase; 
        
        // 👇👇👇 REPLACE THE OLD 'showFace' LINE WITH THIS 👇👇👇
        const showFace = (isMe && !amIBlind) || phase === 'SHOWDOWN' || player?.isFaceUp;
        // 👆👆👆 ADDS CHECK FOR 'isFaceUp'

        return (
          <Seat 
            key={index} 
            $top={pos.top} 
            $left={pos.left} 
            $occupied={!!player}
            $isFolded={player?.isFolded || false}
            onClick={() => !player && onSit(index)}
          >
            {player ? (
              <>
                <ChipsDisplay>${player.chips}</ChipsDisplay>
                <strong>{player.name}</strong>
                {player.specialStatus === 'BICYKEL' && <StatusBadge>BICYKEL</StatusBadge>}
                
                {isDealer && <DealerBadge>D</DealerBadge>}

                {/* 👇👇👇 ADD SCORE BUBBLE HERE 👇👇👇 */}
                {showFace && player.score !== undefined && player.score > 0 && (
                     <ScoreBubble>
                        {player.score}
                     </ScoreBubble>
                )}
                {/* 👆👆👆 END ADDITION 👆👆👆 */}

                {player.hand.map((card, i) => (
                   showFace ? (
                     <CardImg 
                       key={i} 
                       src={`/cards/${card.suit}${card.rank}.png`} 
                       $offset={i} 
                       onClick={(e) => {
                         e.stopPropagation();
                         if (onCardClick && isMe && !amIBlind) onCardClick('HAND', i);
                       }}
                     />
                   ) : (
                     <CardBack key={i} $offset={i} />
                   )
                ))}
              </>
            ) : (
              <span>Sit</span>
            )}
          </Seat>
        );
      })}
    </TableWrapper>
  );
};