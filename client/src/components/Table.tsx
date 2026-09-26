// client/src/components/Table.tsx
import React, { useEffect, useState } from 'react';
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
  bet?: number;
  specialStatus?: string;
  isFaceUp?: boolean;
  score?: number;
  hasLooked?: boolean;
}

interface TableProps {
  players: Player[];
  talon?: Card[];
  mySeatIndex: number | null;
  phase: string;
  dealerSeatIndex: number;
  onSit: (seatIndex: number) => void;
  onCardClick?: (location: 'HAND' | 'TALON', index: number) => void;
  selectedHandIndex?: number | null;
  pot: number;
  potThreshold?: number;
  turnIndex: number;
  turnNonce?: number;
}

// Two table layouts: a wide oval for desktop, a compact portrait table for phones.
// `reserved` is the bottom band kept clear for the hand/swap layer + controls.
const LANDSCAPE = {
  w: 820, h: 420, radius: '210px / 205px', baseW: 900, baseH: 480, reserved: 250,
  seats: [
    { top: '13%', left: '50%' }, { top: '30%', left: '86%' }, { top: '72%', left: '86%' },
    { top: '87%', left: '50%' }, { top: '72%', left: '14%' }, { top: '30%', left: '14%' },
  ],
  chips: [
    { top: '27%', left: '50%' }, { top: '38%', left: '71%' }, { top: '63%', left: '71%' },
    { top: '72%', left: '50%' }, { top: '63%', left: '29%' }, { top: '38%', left: '29%' },
  ],
  potTop: '30%', talonTop: '56%',
};
const PORTRAIT = {
  w: 320, h: 480, radius: '160px / 240px', baseW: 410, baseH: 560, reserved: 300,
  seats: [
    { top: '7%', left: '50%' }, { top: '25%', left: '84%' }, { top: '75%', left: '84%' },
    { top: '93%', left: '50%' }, { top: '75%', left: '16%' }, { top: '25%', left: '16%' },
  ],
  chips: [
    { top: '18%', left: '50%' }, { top: '31%', left: '65%' }, { top: '69%', left: '65%' },
    { top: '82%', left: '50%' }, { top: '69%', left: '35%' }, { top: '31%', left: '35%' },
  ],
  potTop: '40%', talonTop: '56%',
};

const Root = styled.div<{ $reserved: number }>`
  width: 100%;
  height: calc(100% - ${p => p.$reserved}px);
  margin-top: 44px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const Felt = styled.div<{ $w: number; $h: number; $radius: string }>`
  position: relative;
  width: ${p => p.$w}px;
  height: ${p => p.$h}px;
  border-radius: ${p => p.$radius};
  background: radial-gradient(ellipse at 50% 42%, #33b071 0%, #219055 55%, #147a43 100%);
  border: 16px solid #101013;
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.7),
    inset 0 0 90px rgba(0, 0, 0, 0.55),
    inset 0 0 0 2px rgba(255, 255, 255, 0.06),
    inset 0 3px 1px rgba(255, 255, 255, 0.07),
    0 0 0 1px rgba(255, 255, 255, 0.03);

  /* woven "speed cloth" texture */
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image:
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 5px),
      repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px 5px);
    pointer-events: none;
  }
  /* soft centre glow / edge vignette */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(ellipse at 50% 42%, rgba(255, 255, 255, 0.07) 0%, transparent 45%),
      radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(0, 0, 0, 0.35) 100%);
    pointer-events: none;
  }
`;

const Watermark = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 84px;
  font-weight: 800;
  letter-spacing: 6px;
  color: rgba(255, 255, 255, 0.045);
  user-select: none;
  pointer-events: none;
`;

/* ---- Pot ---- */
const PotPill = styled.div<{ $top: string }>`
  position: absolute;
  top: ${p => p.$top};
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 22px;
  padding: 7px 22px 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 90px;
  z-index: 6;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 14px rgba(0, 0, 0, 0.4);
`;
const PotMain = styled.div`
  font-size: 26px;
  font-weight: 800;
  color: #ffffff;
  line-height: 1;
`;
const PotSub = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 3px;
`;

/* ---- Seat pod ---- */
const SeatBox = styled.div<{ $top: string; $left: string }>`
  position: absolute;
  top: ${p => p.$top};
  left: ${p => p.$left};
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 10;
`;

const EmptySeat = styled.button`
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.45);
  }
`;

const Pod = styled.div<{ $active: boolean; $folded: boolean }>`
  position: relative;
  min-width: 104px;
  background: ${p => (p.$active ? 'rgba(31,109,67,0.92)' : 'rgba(34,34,40,0.9)')};
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 12px;
  padding: 8px 14px 9px;
  text-align: center;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1.5px ${p => (p.$active ? '#39d98a' : 'rgba(255,255,255,0.08)')};
  opacity: ${p => (p.$folded ? 0.45 : 1)};
  transition: background 0.2s, box-shadow 0.2s;
  ${p => p.$active && `box-shadow: 0 6px 16px rgba(0,0,0,0.45), inset 0 0 0 1.5px #39d98a, 0 0 22px rgba(57,217,138,0.5);`}
`;
// Depleting 10s countdown bar shown on the active player's pod.
const TimerBar = styled.div`
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 4px;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, #39d98a, #f4d24b);
  transform-origin: left center;
  animation: timerDeplete 15s linear forwards;
  @keyframes timerDeplete {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }
`;

const PodName = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #f2f2f4;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const PodStack = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #f4d24b;
  margin-top: 1px;
`;

/* small cards shown above an opponent pod */
const MiniCards = styled.div`
  display: flex;
  margin-bottom: -6px;
  height: 46px;
`;
const MiniCard = styled.img`
  width: 34px;
  height: 48px;
  border-radius: 4px;
  margin-left: -10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  &:first-child { margin-left: 0; }
`;
const cardBack = `
  background-color: #9e2531;
  background-image:
    repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 7px),
    repeating-linear-gradient(-45deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 7px),
    radial-gradient(circle at 50% 45%, #b93140 0%, #8a1f2a 100%);
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.45);
  border: 2.5px solid #f4f4f4;
`;

const MiniBack = styled.div`
  width: 34px;
  height: 48px;
  border-radius: 5px;
  margin-left: -10px;
  ${cardBack}
  &:first-child { margin-left: 0; }
`;

const DealerBtn = styled.div`
  position: absolute;
  top: -8px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  z-index: 12;
`;

const Badge = styled.div<{ $tone?: 'red' | 'blue' }>`
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  background: ${p => (p.$tone === 'blue' ? '#2f7de0' : '#e0533d')};
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  z-index: 13;
`;

const ScoreChip = styled.div`
  position: absolute;
  top: -10px;
  left: -10px;
  background: #fff;
  color: #1a1a1a;
  font-size: 12px;
  font-weight: 800;
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 10px;
  text-align: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  z-index: 12;
`;

/* bet chip on the felt */
const BetChip = styled.div<{ $top: string; $left: string }>`
  position: absolute;
  top: ${p => p.$top};
  left: ${p => p.$left};
  transform: translate(-50%, -50%);
  min-width: 34px;
  height: 34px;
  padding: 0 9px;
  border-radius: 17px;
  background: radial-gradient(circle at 38% 30%, #ffe97a 0%, #e9ca34 62%, #cba81e 100%);
  color: #4a3a00;
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  /* layered rings mimic a poker chip edge */
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.55),
    inset 0 0 0 5px #d8b524,
    inset 0 0 0 6px rgba(255, 255, 255, 0.4),
    0 4px 9px rgba(0, 0, 0, 0.55);
  z-index: 9;
`;

/* ---- center talon (normal view) ---- */
const TalonRow = styled.div<{ $top: string }>`
  position: absolute;
  top: ${p => p.$top};
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 8px;
  z-index: 5;
`;
const TalonMini = styled.img<{ $w: number; $h: number }>`
  width: ${p => p.$w}px;
  height: ${p => p.$h}px;
  border-radius: 5px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
`;

/* ---- fixed bottom layer: your hand (+ swap talon) ---- */
const BottomLayer = styled.div`
  position: fixed;
  left: 50%;
  bottom: 132px; /* sits clear above the action controls in both layouts */
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  z-index: 60;
  width: 100%;
  pointer-events: none;
`;
const Group = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: auto;
`;
const GroupLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
`;
const CardRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-end;
`;

const BigCard = styled.img<{ $w: number; $h: number; $selected?: boolean; $swappable?: boolean }>`
  width: ${p => p.$w}px;
  height: ${p => p.$h}px;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.6);
  transition: transform 0.15s, width 0.15s, height 0.15s, box-shadow 0.15s;
  cursor: ${p => (p.$swappable ? 'pointer' : 'default')};
  ${p => p.$swappable && `&:hover { transform: translateY(-8px); }`}
  ${p => p.$selected && `
    transform: translateY(-14px);
    outline: 3px solid #f4d24b;
    box-shadow: 0 0 18px #f4d24b;
  `}
`;
const BigBack = styled.div<{ $w: number; $h: number }>`
  width: ${p => p.$w}px;
  height: ${p => p.$h}px;
  border-radius: 9px;
  ${cardBack}
  border-width: 3px;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.18), 0 6px 16px rgba(0, 0, 0, 0.6);
`;
const SwapTalonCard = styled(BigCard)`
  outline: 2px solid rgba(244, 210, 75, 0.55);
  animation: swapGlow 1.4s ease-in-out infinite;
  @keyframes swapGlow {
    0%, 100% { box-shadow: 0 6px 16px rgba(0,0,0,0.6), 0 0 6px rgba(244,210,75,0.4); }
    50% { box-shadow: 0 6px 16px rgba(0,0,0,0.6), 0 0 20px rgba(244,210,75,0.85); }
  }
`;

const src = (c: Card) => `/cards/${c.suit}${c.rank}.png`;

export const Table: React.FC<TableProps> = ({
  players, talon = [], mySeatIndex, phase, dealerSeatIndex,
  onSit, onCardClick, selectedHandIndex, pot, potThreshold = 0, turnIndex, turnNonce = 0,
}) => {
  const [scale, setScale] = useState(1);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const resize = () => {
      const isPortrait = window.innerWidth < 561;
      const L = isPortrait ? PORTRAIT : LANDSCAPE;
      const availW = window.innerWidth * 0.96;
      const availH = Math.max(window.innerHeight - L.reserved, 220);
      const s = Math.min(availW / L.baseW, availH / L.baseH, 1.7);
      setPortrait(isPortrait);
      setScale(Math.max(s, 0.34));
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
    };
  }, []);

  const L = portrait ? PORTRAIT : LANDSCAPE;

  const me = players.find(p => p.seatIndex === mySeatIndex) || null;
  const isMyTurn = mySeatIndex != null && mySeatIndex === turnIndex;
  const inHand = phase !== 'WAITING' && phase !== 'SHOWDOWN';
  const isBlindPhase = phase.startsWith('BETTING') || phase === 'DEALING_3' || phase === 'DEALER_SPECIAL';
  const amIBlindDealer = !!me && mySeatIndex === dealerSeatIndex && isBlindPhase && !me.hasLooked;
  const isSwapTurn = phase === 'TALON_SWAP' && isMyTurn && !!me && !me.isFolded;

  // hand card sizes: bigger during a swap turn
  const handW = isSwapTurn ? 96 : 72;
  const handH = isSwapTurn ? 134 : 100;

  // The big tappable talon in the bottom layer appears only during my own swap turn.
  const showBottomTalon = talon.length > 0 && isSwapTurn;
  const showBottomHand = !!me && me.hand.length > 0;

  return (
    <Root $reserved={L.reserved}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <Felt $w={L.w} $h={L.h} $radius={L.radius}>
          <Watermark>ŠPIC</Watermark>

          <PotPill $top={L.potTop}>
            <PotMain>€{pot}</PotMain>
            <PotSub>{potThreshold > 0 ? `beat ${potThreshold} to win` : 'pot'}</PotSub>
          </PotPill>

          {/* The 4 talon cards live on the felt (spirit of the game). During a swap turn
              they ALSO appear big & tappable in the bottom layer. */}
          {talon.length > 0 && (
            <TalonRow $top={L.talonTop}>
              {talon.map((c, i) => (
                <TalonMini key={i} src={src(c)} $w={portrait ? 34 : 52} $h={portrait ? 48 : 74} alt="" />
              ))}
            </TalonRow>
          )}

          {/* bet chips */}
          {players.map(p =>
            p.bet && p.bet > 0 ? (
              <BetChip key={`bet-${p.seatIndex}`} $top={L.chips[p.seatIndex].top} $left={L.chips[p.seatIndex].left}>
                {p.bet}
              </BetChip>
            ) : null
          )}

          {/* seats */}
          {L.seats.map((pos, index) => {
            const player = players.find(p => p.seatIndex === index);
            const isMe = mySeatIndex === index;
            const isDealer = index === dealerSeatIndex;
            const active = !!player && inHand && !player.isFolded && turnIndex === index;

            if (!player) {
              return (
                <SeatBox key={index} $top={pos.top} $left={pos.left}>
                  <EmptySeat onClick={() => onSit(index)}>SIT</EmptySeat>
                </SeatBox>
              );
            }

            // opponents show mini cards above the pod; my own cards live in the bottom layer
            const showFace = phase === 'SHOWDOWN' || player.isFaceUp;
            const showMini = !isMe && player.hand.length > 0;

            return (
              <SeatBox key={index} $top={pos.top} $left={pos.left}>
                {showMini && (
                  <MiniCards>
                    {player.hand.map((c, i) =>
                      showFace && c.suit !== 'X'
                        ? <MiniCard key={i} src={src(c)} alt="" />
                        : <MiniBack key={i} />
                    )}
                  </MiniCards>
                )}
                <Pod $active={active} $folded={!!player.isFolded}>
                  {isDealer && <DealerBtn>D</DealerBtn>}
                  {(showFace || isMe) && player.score !== undefined && player.score > 0 && (
                    <ScoreChip>{player.score}</ScoreChip>
                  )}
                  <PodName>{player.name}</PodName>
                  <PodStack>€{player.chips}</PodStack>
                  {player.specialStatus === 'BICYKEL' && <Badge>BICYKEL</Badge>}
                  {active && <TimerBar key={turnNonce} />}
                </Pod>
              </SeatBox>
            );
          })}
        </Felt>
      </div>

      {/* fixed bottom layer, below the table.
          - talon: shown here on mobile always, and on any device during my swap turn
          - my hand: always shown big here */}
      {(showBottomTalon || showBottomHand) && (
        <BottomLayer>
          {showBottomTalon && (
            <Group>
              <GroupLabel>Table — tap to swap in</GroupLabel>
              <CardRow>
                {talon.map((c, i) => (
                  <SwapTalonCard
                    key={i}
                    src={src(c)}
                    $w={82}
                    $h={116}
                    $swappable
                    onClick={() => onCardClick && onCardClick('TALON', i)}
                    alt=""
                  />
                ))}
              </CardRow>
            </Group>
          )}
          {showBottomHand && (
            <Group>
              {isSwapTurn && <GroupLabel>Your hand — tap a card, then a table card</GroupLabel>}
              <CardRow>
                {me!.hand.map((c, i) =>
                  amIBlindDealer ? (
                    <BigBack key={i} $w={handW} $h={handH} />
                  ) : (
                    <BigCard
                      key={i}
                      src={src(c)}
                      $w={handW}
                      $h={handH}
                      $swappable={isSwapTurn}
                      $selected={isSwapTurn && selectedHandIndex === i}
                      onClick={() => onCardClick && onCardClick('HAND', i)}
                      style={{ opacity: me!.isFolded ? 0.5 : 1 }}
                      alt=""
                    />
                  )
                )}
              </CardRow>
            </Group>
          )}
        </BottomLayer>
      )}
    </Root>
  );
};
