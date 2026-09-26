import React from 'react';
import styled from 'styled-components';

interface ControlsProps {
  onAction: (action: string, amount?: number) => void;
  currentBet: number;
  myBet: number;
  myChips: number;
  onDealerSpecial: (action: 'TAKE' | 'PASS') => void;
  isMyTurn: boolean;
  phase: string;
  onPass: () => void;
  isDealer?: boolean;
}

const Bar = styled.div`
  position: fixed;
  z-index: 100;
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: nowrap;
  /* mobile: centered along the bottom, above the one-line log */
  bottom: 38px;
  left: 50%;
  transform: translateX(-50%);
  width: 96vw;
  justify-content: center;
  /* desktop: tucked into the bottom-right corner, PokerNow-style */
  @media (min-width: 561px) {
    left: auto;
    right: 24px;
    transform: none;
    bottom: 40px;
    width: auto;
  }
`;

const ActionBtn = styled.button<{ $tone: 'green' | 'red' | 'grey' }>`
  position: relative;
  min-width: 108px;
  padding: 16px 20px 15px;
  border-radius: 10px;
  background: rgba(20, 20, 22, 0.9);
  border: 1.5px solid ${p => (p.$tone === 'red' ? '#e0533d' : p.$tone === 'grey' ? '#6a6a72' : '#3ecf7a')};
  color: ${p => (p.$tone === 'red' ? '#ff6a52' : p.$tone === 'grey' ? '#c6c6cc' : '#4ee08c')};
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: background 0.12s, transform 0.05s;
  &:hover { background: rgba(40, 40, 44, 0.95); }
  &:active { transform: translateY(1px); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 560px) {
    min-width: 0;
    flex: 1 1 0;
    padding: 15px 6px;
    font-size: 15px;
  }
`;

const Key = styled.span`
  position: absolute;
  top: 5px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.35);
`;

const InfoCard = styled.div`
  min-width: 116px;
  padding: 14px 18px;
  border-radius: 10px;
  background: rgba(20, 20, 22, 0.85);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  color: #f4d24b;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const RaiseGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(20, 20, 22, 0.9);
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 5px 7px;
  flex: 0 0 auto;
`;
const RaiseLabel = styled.span`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
`;
const RaiseRow = styled.div`
  display: flex;
  gap: 5px;
`;
const RaiseBtn = styled.button<{ $ok: boolean }>`
  padding: 8px 11px;
  border-radius: 7px;
  border: 1.5px solid ${p => (p.$ok ? '#3e86cf' : '#4a4a52')};
  background: rgba(20, 20, 22, 0.6);
  color: ${p => (p.$ok ? '#5fa8ee' : '#6a6a72')};
  font-size: 14px;
  font-weight: 800;
  cursor: ${p => (p.$ok ? 'pointer' : 'not-allowed')};
  &:hover { background: ${p => (p.$ok ? 'rgba(40,40,44,0.95)' : 'rgba(20,20,22,0.6)')}; }
`;

const SwapHint = styled.div`
  position: fixed;
  bottom: 38px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  @media (min-width: 561px) {
    left: auto;
    right: 24px;
    transform: none;
    bottom: 40px;
  }
`;

export const Controls: React.FC<ControlsProps> = ({
  onAction, currentBet, myBet, myChips, onDealerSpecial, isMyTurn, phase, onPass, isDealer,
}) => {
  const callAmount = currentBet - myBet;
  const canCheck = callAmount === 0;

  if (phase === 'DEALER_SPECIAL' && isMyTurn) {
    return (
      <Bar>
        <ActionBtn $tone="green" onClick={() => onDealerSpecial('TAKE')}>TAKE CARDS</ActionBtn>
        <ActionBtn $tone="red" onClick={() => onDealerSpecial('PASS')}>REVEAL HAND</ActionBtn>
      </Bar>
    );
  }

  if (phase === 'TALON_SWAP') {
    if (!isMyTurn) return null;
    // The "tap a card, then a table card" instruction is already shown as the hand label,
    // so this is just a compact PASS action.
    return (
      <SwapHint>
        <ActionBtn as="button" $tone="grey" style={{ minWidth: 0, padding: '11px 30px' }} onClick={onPass}>
          PASS
        </ActionBtn>
      </SwapHint>
    );
  }

  if (!isMyTurn) return null;

  return (
    <Bar>
      {isDealer ? (
        <InfoCard>Banker<br />must call</InfoCard>
      ) : (
        <ActionBtn $tone="red" onClick={() => onAction('FOLD')}>
          FOLD <Key>F</Key>
        </ActionBtn>
      )}

      <ActionBtn $tone="green" onClick={() => onAction('CALL')}>
        {canCheck ? 'CHECK' : `CALL €${callAmount}`}
        <Key>{canCheck ? 'K' : 'C'}</Key>
      </ActionBtn>

      <RaiseGroup>
        <RaiseLabel>RAISE BY</RaiseLabel>
        <RaiseRow>
          {[1, 2, 3].map(amount => {
            const totalBet = currentBet + amount;
            const cost = totalBet - myBet;
            const ok = myChips >= cost;
            return (
              <RaiseBtn key={amount} $ok={ok} disabled={!ok} onClick={() => ok && onAction('RAISE', totalBet)}>
                +€{amount}
              </RaiseBtn>
            );
          })}
        </RaiseRow>
      </RaiseGroup>
    </Bar>
  );
};
