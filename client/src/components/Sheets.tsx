import { useState, type ReactNode } from 'react';
import type { GameView, LogEntry, Player, Settings } from '../types';
import { settle, stepLabel } from '../money';
import { useI18n, type Lang } from '../i18n';

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
  const { t, money: euro } = useI18n();
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
        <div className="sheet__title">{t('takeSeat', { n: seat + 1 })}</div>
        <label className="field">
          <span className="field__label">{t('yourName')}</span>
          <input
            autoFocus
            className="field__input"
            value={name}
            maxLength={16}
            placeholder={t('namePh')}
            autoComplete="nickname"
            enterKeyHint="go"
            onChange={e => setName(e.target.value)}
          />
        </label>

        <div className="field">
          <div className="field__row">
            <span className="field__label">{t('buyIn')}</span>
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
            aria-label={t('buyIn')}
          />
        </div>

        <div className="duo">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className="btn btn--primary" disabled={!valid}>{t('sitDown')}</button>
        </div>
      </form>
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="overlay overlay--bottom" onClick={onClose}>
      <div className="sheet sheet--log" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__head">
          <div className="sheet__title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LogSheet({ log, onClose }: { log: LogEntry[]; onClose: () => void }) {
  const { t, msg } = useI18n();
  return (
    <BottomSheet title={t('tableLog')} onClose={onClose}>
      <ol className="log">
        {log.slice().reverse().map(entry => <li key={entry.id}>{msg(entry)}</li>)}
      </ol>
    </BottomSheet>
  );
}

export function RulesSheet({ view, onClose }: { view: GameView; onClose: () => void }) {
  const { t, lang, money: euro } = useI18n();
  const ante = euro(view.config.ante);
  const steps = view.config.raiseSteps.map(euro);
  const raises = lang === 'sk' ? `${steps[0]}, ${steps[1]} alebo ${steps[2]}` : `${steps[0]}, ${steps[1]} or ${steps[2]}`;
  const secs = view.config.turnSeconds;

  return (
    <BottomSheet title={t('howToPlay')} onClose={onClose}>
      {lang === 'sk' ? (
        <div className="rules">
          <p>Každý vloží <b>{ante}</b> a dostane dve karty. Stávky, tretia karta, znova stávky — potom sa na stôl vyloží štvorkartový <b>talón</b>.</p>
          <p><b>Stávky:</b> zvyšovať môže len prvý hráč (vľavo od bankára) a posledný hráč (vpravo od bankára), o {raises} — jedno zvýšenie a jedno prebitie za kolo. Ostatní dorovnávajú alebo zložia. Na ťah je {secs} sekúnd.</p>
          <p><b>Bankár</b> (B) nikdy nezloží a dorovná všetko naslepo. Ak sa do kariet nepozrie a na talóne je farba alebo trojica, môže si ju zobrať. Keď sa pozrie, o túto možnosť príde.</p>
          <p>Pri talóne si každý môže vymeniť jednu kartu so stolom, ale len ak nová ruka <b>prekoná latku</b> (najlepšiu doteraz vymenenú ruku). Inak pas.</p>
          <ul>
            <li><b>Zlatý špic</b> — tri esá · 33</li>
            <li><b>Špic</b> — farba za 31</li>
            <li><b>Trojica</b> — tri rovnaké · 30,5</li>
            <li><b>Farba</b> — tri karty jednej farby · súčet kariet (A 11, K/Q/J/10 10)</li>
            <li><b>Bicykel</b> — tri farby bez páru: mŕtva ruka, automaticky zložené</li>
          </ul>
          <p>Na výhru kasy treba farbu alebo trojicu, aj keď ostatní zložia.</p>
          <p><b>Remíza:</b> kasa ostáva. Ďalší víťaz musí prekonať remízové skóre — po remíze na Špici berie kasu prvý Špic. Dva Špice v jednej hre sú remíza.</p>
          <p><b>Peňaženka:</b> nemáš dosť? Ťukni <b>Dobiť a dorovnať</b> (alebo zvýšiť) a chýbajúce peniaze idú z peňaženky — bankár dobíja automaticky. Priebežné skóre (+/−) je pod žetónmi a <b>Vyúčtovanie</b> (tlačidlo €) ukáže, kto komu platí.</p>
          <p><b>Pokračovanie o kasu:</b> kto nedohral remízovú hru, dlhuje, čo zaplatili tí, čo dohrali (mínus to, čo sám vložil). Zaplatí pri prvom rozhodnutí ďalšej hry, alebo zloží. Bankár s dlhom môže zaplatiť a rozdať, alebo vynechať a stáť mimo, kým niekto nevyhrá kasu.</p>
          <p><b>Hostiteľ</b> (prvý, kto si sadol) môže medzi hrami v ⚙ meniť čas na ťah, vklad a zvýšenia.</p>
        </div>
      ) : (
        <div className="rules">
          <p>Everyone antes <b>{ante}</b> and gets two cards. Bet, get a third card, bet again — then the four-card <b>talon</b> is dealt.</p>
          <p><b>Betting:</b> only the first player (left of the banker) and the last player (right of the banker) may raise, by {raises} — one raise and one re-raise per round. Everyone else calls or folds. Each turn has {secs} seconds.</p>
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
          <p>The <b>host</b> (the first player to sit down) can change the turn timer, ante and raises under ⚙ between hands.</p>
        </div>
      )}
    </BottomSheet>
  );
}

export function SettleSheet({ view, onClose }: { view: GameView; onClose: () => void }) {
  const { t, money: euro, balance: balanceLabel } = useI18n();
  const rows = [
    ...view.players.map(p => ({ name: p.name, balance: p.chips - p.bought, left: false })),
    ...view.departed.map(d => ({ name: d.name, balance: d.balance, left: true })),
  ].sort((a, b) => b.balance - a.balance);
  const payments = settle(rows.map(r => ({ name: r.left ? `${r.name} (${t('leftTag')})` : r.name, balance: r.balance })));

  return (
    <BottomSheet title={t('settleUp')} onClose={onClose}>
      <div className="settle">
        {view.pot > 0 && <p className="settle__note">{t('stillInPot', { amount: view.pot })}</p>}
        <div className="settle__label">{t('scores')}</div>
        <ul className="settle__list">
          {rows.map((r, i) => (
            <li key={i}>
              <span>{r.name}{r.left && <em> · {t('leftTag')}</em>}</span>
              <b className={r.balance > 0 ? 'is-up' : r.balance < 0 ? 'is-down' : ''}>{balanceLabel(r.balance)}</b>
            </li>
          ))}
        </ul>
        <div className="settle__label">{t('payments')}</div>
        {view.pot > 0 ? (
          <p className="settle__note">{t('paymentsLater')}</p>
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
          <p className="settle__note">{t('nobodyOwes')}</p>
        )}
      </div>
    </BottomSheet>
  );
}

function Choice<T>({ label, options, value, format, disabled, onPick }: {
  label: string;
  options: T[];
  value: T;
  format: (v: T) => string;
  disabled?: boolean;
  onPick: (v: T) => void;
}) {
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="chips-pick" role="radiogroup" aria-label={label}>
        {options.map(o => (
          <button key={format(o)} type="button" role="radio" aria-checked={same(o, value)} disabled={disabled}
            className={`chip-pick${same(o, value) ? ' is-on' : ''}`} onClick={() => onPick(o)}>
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SettingsProps {
  view: GameView;
  me: Player | null;
  muted: boolean;
  onLang: (lang: Lang) => void;
  onMuted: (muted: boolean) => void;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsSheet({ view, me, muted, onLang, onMuted, onSave, onClose }: SettingsProps) {
  const { t, lang, money: euro } = useI18n();
  const current: Settings = { turnSeconds: view.config.turnSeconds, ante: view.config.ante, raiseSteps: view.config.raiseSteps };
  const [draft, setDraft] = useState<Settings>(current);
  const host = view.players.find(p => p.id === view.hostId);
  const isHost = !!me && me.id === view.hostId;
  const canEdit = isHost && view.phase === 'WAITING';
  const changed = JSON.stringify(draft) !== JSON.stringify(current);
  const shown = canEdit ? draft : current;
  const opts = view.config.options;

  return (
    <BottomSheet title={t('settingsTitle')} onClose={onClose}>
      <div className="settings">
        <div className="settle__label">{t('mySettings')}</div>
        <Choice<Lang> label={t('language')} options={['sk', 'en']} value={lang}
          format={l => (l === 'sk' ? 'Slovensky' : 'English')} onPick={onLang} />
        <Choice<boolean> label={t('sound')} options={[true, false]} value={!muted}
          format={on => (on ? `🔊 ${t('on')}` : `🔇 ${t('off')}`)} onPick={on => onMuted(!on)} />

        <div className="settle__label">{t('tableSettings')}</div>
        <p className="settle__note">
          {!host ? t('hostNone') : !isHost ? t('hostOnly', { name: host.name }) : canEdit ? t('hostBetween') : t('hostWait')}
        </p>
        <Choice label={t('turnTimer')} options={opts.turnSeconds} value={shown.turnSeconds} disabled={!canEdit}
          format={n => t('seconds', { n })} onPick={turnSeconds => setDraft({ ...draft, turnSeconds })} />
        <Choice label={t('ante')} options={opts.ante} value={shown.ante} disabled={!canEdit}
          format={euro} onPick={ante => setDraft({ ...draft, ante })} />
        <Choice label={`${t('raises')} (€)`} options={opts.raiseSteps} value={shown.raiseSteps} disabled={!canEdit}
          format={s => s.map(x => stepLabel(x, lang)).join(' · ')} onPick={raiseSteps => setDraft({ ...draft, raiseSteps })} />
        {isHost && (
          <button type="button" className="btn btn--primary btn--wide" disabled={!canEdit || !changed}
            onClick={() => onSave(draft)}>
            {canEdit && !changed ? t('saved') : t('save')}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
