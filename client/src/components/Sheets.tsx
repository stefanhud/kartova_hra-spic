import { useState } from 'react';
import type { LogEntry } from '../types';

interface SitProps {
  seat: number;
  initialName: string;
  initialBuyIn: number;
  minBuyIn: number;
  maxBuyIn: number;
  onConfirm: (name: string, buyIn: number) => void;
  onCancel: () => void;
}

export function SitSheet({ seat, initialName, initialBuyIn, minBuyIn, maxBuyIn, onConfirm, onCancel }: SitProps) {
  const [name, setName] = useState(initialName);
  const [buyIn, setBuyIn] = useState(Math.min(maxBuyIn, Math.max(minBuyIn, initialBuyIn)));
  const valid = name.trim().length > 0;
  const submit = () => valid && onConfirm(name.trim(), buyIn);

  return (
    <div className="overlay" onClick={onCancel}>
      <form
        className="sheet sheet--sit"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={e => e.key === 'Escape' && onCancel()}
      >
        <div className="sheet__title">Take seat {seat + 1}</div>
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            autoFocus
            className="field__input"
            value={name}
            maxLength={16}
            placeholder="e.g. Marek"
            autoComplete="nickname"
            enterKeyHint="go"
            onChange={e => setName(e.target.value)}
          />
        </label>

        <div className="field">
          <div className="field__row">
            <span className="field__label">Buy-in</span>
            <span className="field__value">€{buyIn}</span>
          </div>
          <div className="chips-pick">
            {[20, 50, 100].filter(v => v >= minBuyIn && v <= maxBuyIn).map(v => (
              <button key={v} type="button" className={`chip-pick${buyIn === v ? ' is-on' : ''}`} onClick={() => setBuyIn(v)}>
                €{v}
              </button>
            ))}
          </div>
          <input
            type="range"
            className="slider"
            min={minBuyIn}
            max={maxBuyIn}
            step={5}
            value={buyIn}
            onChange={e => setBuyIn(Number(e.target.value))}
            aria-label="Buy-in amount"
          />
        </div>

        <div className="duo">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={!valid}>Sit down</button>
        </div>
      </form>
    </div>
  );
}

export function LogSheet({ log, onClose }: { log: LogEntry[]; onClose: () => void }) {
  return (
    <div className="overlay overlay--bottom" onClick={onClose}>
      <div className="sheet sheet--log" onClick={e => e.stopPropagation()} role="dialog" aria-label="Game log">
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__head">
          <div className="sheet__title">Table log</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close log">✕</button>
        </div>
        <ol className="log">
          {log.slice().reverse().map(entry => <li key={entry.id}>{entry.text}</li>)}
        </ol>
      </div>
    </div>
  );
}

export function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay overlay--bottom" onClick={onClose}>
      <div className="sheet sheet--log" onClick={e => e.stopPropagation()} role="dialog" aria-label="How to play">
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__head">
          <div className="sheet__title">How to play</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close rules">✕</button>
        </div>
        <div className="rules">
          <p>Everyone antes €5 and gets two cards. Bet, get a third card, bet again — then the four-card <b>talon</b> is dealt.</p>
          <p>In the talon round each player may swap one card with the table, but only if the new hand <b>beats the bar</b> (the best swapped hand so far). Otherwise pass.</p>
          <p>The <b>banker</b> (D) can't fold and plays blind. If they never look and the talon holds a Flush or Trojica, they may take it.</p>
          <ul>
            <li><b>Zlatý špic</b> — three aces · 33</li>
            <li><b>Špic</b> — flush worth 31</li>
            <li><b>Trojica</b> — three of a kind · 30.5</li>
            <li><b>Flush</b> — three of a suit · sum of the cards (A 11, K/Q/J/10 10)</li>
            <li><b>Bicykel</b> — three suits, no pair: dead hand, auto-fold</li>
          </ul>
          <p>A tie keeps the pot on the table, and the next winner must beat the tied score.</p>
        </div>
      </div>
    </div>
  );
}
