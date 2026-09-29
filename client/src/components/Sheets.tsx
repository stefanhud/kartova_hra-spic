import { useState } from 'react';
import type { GameView, LogEntry } from '../types';
import { balanceLabel, euro, settle } from '../money';

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
            <span className="field__value">{euro(buyIn)}</span>
          </div>
          <div className="chips-pick">
            {[1000, 2000, 5000].filter(v => v >= minBuyIn && v <= maxBuyIn).map(v => (
              <button key={v} type="button" className={`chip-pick${buyIn === v ? ' is-on' : ''}`} onClick={() => setBuyIn(v)}>
                {euro(v)}
              </button>
            ))}
          </div>
          <input
            type="range"
            className="slider"
            min={minBuyIn}
            max={maxBuyIn}
            step={500}
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
          <p>Everyone antes <b>€0.50</b> and gets two cards. Bet, get a third card, bet again — then the four-card <b>talon</b> is dealt.</p>
          <p><b>Betting:</b> only the first player (left of the banker) and the last player (right of the banker) may raise, by €0.50, €1 or €2 — one raise and one re-raise per round. Everyone else calls or folds.</p>
          <p>The <b>banker</b> (D) never folds and calls everything, playing blind. If the banker never looks and the talon holds a Flush or Trojica, they may take it. Looking at the cards gives that up.</p>
          <p>In the talon round each player may swap one card with the table, but only if the new hand <b>beats the bar</b> (the best swapped hand so far). Otherwise pass.</p>
          <ul>
            <li><b>Zlatý špic</b> — three aces · 33</li>
            <li><b>Špic</b> — flush worth 31</li>
            <li><b>Trojica</b> — three of a kind · 30.5</li>
            <li><b>Flush</b> — three of a suit · sum of the cards (A 11, K/Q/J/10 10)</li>
            <li><b>Bicykel</b> — three suits, no pair: dead hand, auto-fold</li>
          </ul>
          <p>You need a Flush or Trojica to take the pot, even if everyone else folds.</p>
          <p><b>Ties:</b> the pot stays. The next winner must beat the tied score — after a tie on Špic, the first Špic takes it. Two Špics in one hand are a tie.</p>
          <p><b>Wallet:</b> short of chips? Tap <b>Top up &amp; call</b> (or raise) and the missing money comes from your wallet — the banker tops up automatically. Your running score (+/−) is under your chips, and <b>Settle up</b> (€ button) shows who pays whom at the end of the night.</p>
          <p><b>Playing on for a carried pot:</b> whoever didn't play the tied hand to the end owes what the finishers paid (minus what they put in themselves). You pay it at your first decision of the next hand, or fold. A banker who owes can pay and deal, or skip and sit out until the pot is won.</p>
        </div>
      </div>
    </div>
  );
}

export function SettleSheet({ view, onClose }: { view: GameView; onClose: () => void }) {
  const rows = [
    ...view.players.map(p => ({ name: p.name, balance: p.chips - p.bought, left: false })),
    ...view.departed.map(d => ({ name: d.name, balance: d.balance, left: true })),
  ].sort((a, b) => b.balance - a.balance);
  const payments = settle(rows.map(r => ({ name: r.left ? `${r.name} (left)` : r.name, balance: r.balance })));

  return (
    <div className="overlay overlay--bottom" onClick={onClose}>
      <div className="sheet sheet--log" onClick={e => e.stopPropagation()} role="dialog" aria-label="Settle up">
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__head">
          <div className="sheet__title">Settle up</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="settle">
          {view.pot > 0 && (
            <p className="settle__note">{euro(view.pot)} is still in the pot — play until someone wins it before settling.</p>
          )}
          <div className="settle__label">Tonight's scores</div>
          <ul className="settle__list">
            {rows.map((r, i) => (
              <li key={i}>
                <span>{r.name}{r.left && <em> · left</em>}</span>
                <b className={r.balance > 0 ? 'is-up' : r.balance < 0 ? 'is-down' : ''}>{balanceLabel(r.balance)}</b>
              </li>
            ))}
          </ul>
          <div className="settle__label">Payments</div>
          {view.pot > 0 ? (
            <p className="settle__note">Payments appear once the pot has been won.</p>
          ) : payments.length ? (
            <ul className="settle__list">
              {payments.map((p, i) => (
                <li key={i}>
                  <span>{p.from} <span className="settle__arrow">→</span> {p.to}</span>
                  <b>{euro(p.amount)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settle__note">Nobody owes anybody anything.</p>
          )}
        </div>
      </div>
    </div>
  );
}
