import { createContext, useContext } from 'react';
import type { ActionTag, HandCode, Msg } from './types';

// The server sends "what happened" (a key plus parameters); the words live here.
//
// Template syntax:
//   {name}      a parameter (arrays of names are joined with " & ")
//   {€amount}   money in euro cents
//   {hand}      a hand code (Flush 29, Trojica K, …)
//   [ … ]       optional: dropped unless every parameter inside is set (not 0/false/empty)
//   {?flag}     condition only (prints nothing), {!flag} = only when the flag is not set

export type Lang = 'en' | 'sk';

const en = {
  // --- table log ---
  tableOpen: 'Table open — take a seat!',
  back: '{name} is back.',
  lostConn: '{name} lost connection.',
  moved: '{name} moved from seat {from} to seat {to}.',
  satDown: '{name} sat down at seat {seat}.[{?late} Playing from the next hand.][ Owes {€debt} to join the carried-over pot.]',
  settings: '{name} changed the table: {turn}s per turn, ante {€ante}, raises {€s1} / {€s2} / {€s3}.',
  left: '{name} left the table[{?folds} and folds].',
  removed: '{name} was removed[{?folds} and folds].',
  tableEmpty: 'Table is empty — pot and scores cleared.',
  unbenched: 'Too few players — everyone who skipped is back in.',
  mustDeal: '{name} must deal (too few players to skip) and pays {€amount} owed.',
  dealerOwes: '{name} is next to deal but owes {€amount} — pay and deal, or skip?',
  paysAndDeals: '{name} pays {€amount} owed and deals.',
  skipsDeal: '{name} skips dealing and sits out until the pot is won.',
  skipsDealTimeout: '{name} ran out of time, skips dealing and sits out until the pot is won.',
  notEnough: 'Not enough players to deal.',
  newHand: 'New hand — {name} is the banker. Everyone antes {€ante}.',
  raised: '{name} raised to {€to}[ and pays {€debt} owed].',
  reraised: '{name} re-raised to {€to}[ and pays {€debt} owed].',
  folded: '{name} folded[ (still owes {€debt})].',
  foldTimeout: '{name} ran out of time — folded[ (still owes {€debt})].',
  checks: '[{?timedOut}{name} ran out of time —][{!timedOut}{name}][{?banker} (banker)] checks[ and pays {€debt} owed].',
  calls: '[{?timedOut}{name} ran out of time —][{!timedOut}{name}][{?banker} (banker)] calls {€amount}[ and pays {€debt} owed].',
  looked: '{name} (banker) looked at their cards — talon option gone.',
  bicykel: '{name} has a Bicykel — auto-fold.',
  proveHand: 'Everyone else is out — {name} goes to the talon to prove a hand.',
  thirdCard: 'Third card dealt — second betting round.',
  talonDealt: 'Betting closed — the talon is on the table.',
  bankerOption: 'Banker’s option: the talon holds {hand}!',
  keepsOwn: '{name} keeps their own hand.',
  keepsOwnTimeout: '{name} ran out of time — keeps their own hand.',
  takesTalon: '{name} takes the talon hand — {hand}!',
  bankerBicykel: '{name} (banker) has a Bicykel — auto-fold.',
  cantImprove: '{name} can’t improve — passes.',
  swapBicykel: '{name} swapped into a Bicykel — auto-fold.',
  swapped: '{name} swapped — [{?tie}ties the bar at {score}][{!tie}new bar is {score}].',
  passes: '{name} passes.',
  passTimeout: '{name} ran out of time — pass.',
  survivorNoHand: 'Everyone else folded, but {name} has no Flush or Trojica. Pot stays!',
  neededMore: '{name} won the hand with {score}, but needed more than {need}. Pot stays!',
  wins: '{name} wins {€amount} with {hand}.',
  winsFold: '{name} wins {€amount} — everyone else folded.',
  potStays: '[{?tie}Tie][{!tie}No winner] — the {€amount} pot stays.[{?spic} Next: the first Špic takes it.][ Next winner needs more than {need}.]',
  owing: 'To play on for this pot: {list}.',
  ready: 'Ready for the next hand.',

  // --- showdown card ---
  resWin: '{name} wins {€amount}',
  resTie: 'Tie — {€amount} stays',
  resStays: 'Pot of {€amount} stays',
  detFold: 'Everyone else folded',
  detHand: '{hand}',
  detMiss: '{name} had {score} but needed more than {need}',
  detTied: '{names} tied on {hand}',
  detNobody: 'Nobody is left in the hand',
  detNoHand: '{name} has no Flush or Trojica',
  detNoQualify: 'Nobody qualified',
  detSpic: 'next: the first Špic takes it',
  detBeat: 'next winner must beat {need}',

  // --- errors ---
  errSeatTaken: 'That seat is taken.',
  errMoveBetweenHands: 'You can change seats between hands.',
  errName: 'Enter a name first.',
  errNeedTwo: 'Need at least 2 players to deal.',
  errOnlyFirstLast: 'Only the first and last player may raise — one raise and one re-raise per round.',
  errSwapBeat: 'That swap only makes {score} — you need at least {need}.',
  errSwapMake: 'That swap only makes {score} — you need a Flush or Trojica.',
  errSwapTieCarried: 'That swap only ties {need} — while the pot is carried you have to beat it.',
  errSwapPot: 'That swap only makes {score} — to win this pot you need [{?spic}a Špic][{!spic}more than {need}].',
  errOnlyHost: 'Only the host can change the table settings.',
  errSettingsLater: 'Table settings can change between hands.',

  // --- hands and actions ---
  hZlaty: 'Zlatý špic', hSpic: 'Špic', hTrojica: 'Trojica {v}', hFlush: 'Flush {v}', hNone: 'No flush',
  hBicykel: 'Bicykel', hPartial: '{v} so far',
  aCheck: 'Check', aCall: 'Call {€a}', aRaise: 'Raise {€a}', aSwap: 'Swap', aPass: 'Pass', aTook: 'Took talon',
  aFold: 'Fold', aBicykel: 'Bicykel',

  // --- dock ---
  reconnecting: 'Reconnecting…',
  tapSeat: 'Tap an empty seat to join the table',
  tableFull: 'Table is full — watching',
  nextSoon: 'Next hand in a moment…',
  youBenched: 'You skipped dealing — back in when the pot is won',
  waitingOther: 'Waiting for another player…',
  youOwe: 'You owe {€amount} to play on for this pot',
  readyDeal: '{n} players ready — anyone can deal',
  yourDealOwe: 'Your deal — you owe {€amount}',
  decidesDeal: '{name} decides whether to deal…',
  choosingBanker: 'Choosing the banker…',
  sitOutTillWin: 'You sit out until the pot is won',
  joinNext: 'You join from the next hand',
  youreOut: 'You’re out this hand[ · {name} to act]',
  noSwapPassing: 'No swap can reach the bar — passing…',
  autoCallBanker: 'You call automatically (banker)…',
  confirmSwap: 'Confirm your swap',
  tapTable: 'Now tap a table card',
  tapHand: 'Now tap a card from your hand',
  yourSwap: 'Your swap — tap a card to exchange, or keep',
  bankerOptionQ: 'Banker’s option — take the table hand?',
  yourTurnPay: 'Your turn — pay {€amount} owed to play on',
  yourTurn: 'Your turn',
  bankerCallsAll: 'Banker: you call everything[ · {name} to act]',
  waitingFor: 'Waiting for {name}…',
  dealing: 'Dealing…',
  dealCards: 'Deal cards',
  payDeal: 'Pay {€amount} & deal',
  andPlay: 'and play this hand',
  skip: 'Skip',
  sitOutSub: 'sit out until the pot is won',
  bankerNote: 'The banker calls everything automatically',
  check: 'Check',
  call: 'Call {€amount}',
  plusOwed: '+ {€amount} owed',
  noRaise: 'No raise',
  raiseUsed: 'Raise used',
  raise: 'Raise',
  fold: 'Fold',
  raiseBy: 'Raise by',
  raiseByX: 'Raise by {€amount}',
  raiseRule: 'One raise and one re-raise per round',
  raiseOff: 'Only the first and last player may raise',
  cancel: 'Cancel',
  swapTo: 'Swap → {score}',
  keepHand: 'Keep my hand',
  pass: 'Pass',
  takeTable: 'Take table hand',
  blind: 'Blind',
  tapToLook: 'Tap again to look',
  lookCards: 'Look at cards',
  loseTalon: 'You lose the talon option',
  blindKeeps: 'Blind play keeps the talon option',

  // --- seats and table ---
  bWinner: 'Winner', bOffline: 'Offline', bBicykel: 'Bicykel', bOutTillWin: 'Out till win', bNextHand: 'Next hand',
  bFolded: 'Folded', bHost: 'Host',
  you: 'You',
  dealerMark: 'D',
  bankerTitle: 'Banker (dealer)',
  owes: 'owes {€amount}',
  capWaitPlayers: 'Waiting for players',
  capReady: 'Ready to deal',
  capChoice: 'Pay or skip the deal',
  capBet: 'Betting · round {n}[ · {€bet} bet]',
  capOption: 'Banker’s option',
  capSwap: 'Talon swap',
  capShowdown: 'Showdown',
  pot: 'Pot',
  firstSpic: 'First Špic takes the pot',
  winNeeds: 'Win needs more than {n}',
  barBeat: 'Bar to reach · {n}',
  barQualify: 'Bar · Flush or Trojica',
  barPot: 'Bar · [{?spic}Špic][{!spic}more than {n}]',
  moreThan: 'more than {n}',
  moveSeat: 'Move to seat {n}',
  sitSeat: 'Sit at seat {n}',
  move: 'Move',
  sit: 'Sit',

  // --- app ---
  noSwapToast: 'No swap can reach the bar — you pass.',
  cardCant: 'That card can’t [{?need}reach {need}][{!need}make a Flush or Trojica] with any swap.',
  swapCant: 'That swap can’t [{?need}reach {need}][{!need}make a Flush or Trojica].',
  titleTurn: '● Your turn — ŠPIC',
  loading: 'Loading table…',
  connecting: 'Connecting to the table…',
  anteShort: 'ante {€amount}',
  openLog: 'Open table log',
  howToPlay: 'How to play',
  settleUp: 'Settle up',
  tableLog: 'Table log',
  leaveTable: 'Leave table',
  settingsTitle: 'Settings',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  connLost: 'Connection lost — reconnecting…',
  otherTab: 'Open in another tab',
  otherTabText: 'Your seat is being played from another tab or window.',
  playHere: 'Play here instead',
  close: 'Close',

  // --- sheets ---
  takeSeat: 'Take seat {n}',
  yourName: 'Your name',
  namePh: 'e.g. Marek',
  sitDown: 'Sit down',
  stillInPot: '{€amount} is still in the pot — play until someone wins it before settling.',
  scores: 'Tonight’s scores',
  leftTag: 'left',
  payments: 'Payments',
  paymentsLater: 'Payments appear once the pot has been won.',
  nobodyOwes: 'Nobody owes anybody anything.',
  mySettings: 'On this phone',
  language: 'Language',
  sound: 'Sound',
  on: 'On',
  off: 'Off',
  tableSettings: 'Table',
  turnTimer: 'Turn timer',
  ante: 'Ante',
  raises: 'Raises',
  save: 'Save for next hand',
  saved: 'Saved',
  hostOnly: 'Only the host ({name}) can change the table.',
  hostNone: 'The first player to sit down hosts the table.',
  hostBetween: 'You’re the host. Changes are possible between hands.',
  hostWait: 'Changes are possible between hands.',
  cashedOut: '{name} settled up and left.[ Paid {pays}.][ Got {gets}.][ {€lost} stays in the pot (held by {holder}).]',
  leaveTitle: 'Leave the table',
  yourScore: 'Your score tonight',
  settleNow: 'Settle now',
  payTo: 'You → {name}',
  payFrom: '{name} → you',
  lostNote: 'Includes {€amount} you put into the current pot: it stays in the pot, so {holder} keeps that cash for whoever wins it.',
  evenNote: 'You’re even — nothing to settle.',
  foldNote: 'You will fold this hand.',
  settledLeave: 'Settled — leave',
  justLeave: 'Leave',
  leaveUnsettled: 'Leave without settling',
  unsettledSub: 'you stay on the Settle up list',
  seconds: '{n}s',
};

export type Key = keyof typeof en;

const sk: Record<Key, string> = {
  tableOpen: 'Stôl je otvorený — prisadni si!',
  back: '{name} je späť.',
  lostConn: '{name} stratil(a) spojenie.',
  moved: '{name} sa presunul(a) z miesta {from} na miesto {to}.',
  satDown: '{name} si sadol(-la) na miesto {seat}.[{?late} Hrá od ďalšej hry.][ Na pokračovanie o kasu dlhuje {€debt}.]',
  settings: '{name} zmenil(a) stôl: {turn} s na ťah, vklad {€ante}, zvýšenia {€s1} / {€s2} / {€s3}.',
  left: '{name} odišiel(-šla) od stola[{?folds} a zložil(a)].',
  removed: '{name} bol(a) odstránený(-á)[{?folds} a zložil(a)].',
  tableEmpty: 'Stôl je prázdny — kasa a skóre sú vynulované.',
  unbenched: 'Málo hráčov — všetci, čo vynechali, sú späť v hre.',
  mustDeal: '{name} musí rozdávať (málo hráčov na vynechanie) a platí dlh {€amount}.',
  dealerOwes: '{name} má rozdávať, ale dlhuje {€amount} — zaplatí a rozdá, alebo vynechá?',
  paysAndDeals: '{name} platí dlh {€amount} a rozdáva.',
  skipsDeal: '{name} vynecháva rozdávanie a stojí mimo, kým niekto nevyhrá kasu.',
  skipsDealTimeout: '{name} nestihol(-la) — vynecháva rozdávanie a stojí mimo, kým niekto nevyhrá kasu.',
  notEnough: 'Málo hráčov na rozdanie.',
  newHand: 'Nová hra — bankár je {name}. Každý vkladá {€ante}.',
  raised: '{name} zvyšuje na {€to}[ a platí dlh {€debt}].',
  reraised: '{name} prebíja na {€to}[ a platí dlh {€debt}].',
  folded: '{name} zložil(a)[ (stále dlhuje {€debt})].',
  foldTimeout: '{name} nestihol(-la) — zložené[ (stále dlhuje {€debt})].',
  checks: '[{?timedOut}{name} nestihol(-la) —][{!timedOut}{name}][{?banker} (bankár)] stojí[ a platí dlh {€debt}].',
  calls: '[{?timedOut}{name} nestihol(-la) —][{!timedOut}{name}][{?banker} (bankár)] dorovnáva {€amount}[ a platí dlh {€debt}].',
  looked: '{name} (bankár) sa pozrel(a) do kariet — talón prepadol.',
  bicykel: '{name} má bicykel — automaticky zložené.',
  proveHand: 'Ostatní sú mimo — {name} ide na talón dokázať ruku.',
  thirdCard: 'Tretia karta rozdaná — druhé kolo stávok.',
  talonDealt: 'Stávky uzavreté — talón je na stole.',
  bankerOption: 'Bankárova voľba: na talóne je {hand}!',
  keepsOwn: '{name} si necháva svoje karty.',
  keepsOwnTimeout: '{name} nestihol(-la) — necháva si svoje karty.',
  takesTalon: '{name} berie karty zo stola — {hand}!',
  bankerBicykel: '{name} (bankár) má bicykel — automaticky zložené.',
  cantImprove: '{name} sa nemá ako zlepšiť — pas.',
  swapBicykel: '{name} si vymenil(a) bicykel — automaticky zložené.',
  swapped: '{name} vymenil(a) — [{?tie}vyrovnáva latku {score}][{!tie}nová latka je {score}].',
  passes: '{name} pasuje.',
  passTimeout: '{name} nestihol(-la) — pas.',
  survivorNoHand: 'Ostatní zložili, ale {name} nemá farbu ani trojicu. Kasa ostáva!',
  neededMore: '{name} vyhral(a) s {score}, ale bolo treba viac ako {need}. Kasa ostáva!',
  wins: '{name} vyhráva {€amount} — {hand}.',
  winsFold: '{name} vyhráva {€amount} — ostatní zložili.',
  potStays: '[{?tie}Remíza][{!tie}Bez víťaza] — kasa {€amount} ostáva.[{?spic} Ďalej berie prvý Špic.][ Ďalší víťaz potrebuje viac ako {need}.]',
  owing: 'Na pokračovanie o kasu: {list}.',
  ready: 'Pripravené na ďalšiu hru.',

  resWin: '{name} vyhráva {€amount}',
  resTie: 'Remíza — {€amount} ostáva',
  resStays: 'Kasa {€amount} ostáva',
  detFold: 'Ostatní zložili',
  detHand: '{hand}',
  detMiss: '{name} mal(a) {score}, ale bolo treba viac ako {need}',
  detTied: 'Remíza {names} — {hand}',
  detNobody: 'V hre nikto neostal',
  detNoHand: '{name} nemá farbu ani trojicu',
  detNoQualify: 'Nikto nemá farbu ani trojicu',
  detSpic: 'ďalej berie prvý Špic',
  detBeat: 'ďalší víťaz musí prekonať {need}',

  errSeatTaken: 'Toto miesto je obsadené.',
  errMoveBetweenHands: 'Miesto sa dá zmeniť medzi hrami.',
  errName: 'Najprv zadaj meno.',
  errNeedTwo: 'Na rozdanie treba aspoň 2 hráčov.',
  errOnlyFirstLast: 'Zvyšovať môže len prvý a posledný hráč — jedno zvýšenie a jedno prebitie za kolo.',
  errSwapBeat: 'Táto výmena dá len {score} — potrebuješ aspoň {need}.',
  errSwapMake: 'Táto výmena dá len {score} — potrebuješ farbu alebo trojicu.',
  errSwapTieCarried: 'Táto výmena len vyrovná {need} — kým kasa ostáva, musíš ju prekonať.',
  errSwapPot: 'Táto výmena dá len {score} — na výhru tejto kasy treba [{?spic}Špic][{!spic}viac ako {need}].',
  errOnlyHost: 'Nastavenia stola môže meniť len hostiteľ.',
  errSettingsLater: 'Nastavenia stola sa dajú meniť medzi hrami.',

  hZlaty: 'Zlatý špic', hSpic: 'Špic', hTrojica: 'Trojica {v}', hFlush: 'Farba {v}', hNone: 'Bez farby',
  hBicykel: 'Bicykel', hPartial: 'zatiaľ {v}',
  aCheck: 'Stojí', aCall: 'Dorovná {€a}', aRaise: 'Zvýši na {€a}', aSwap: 'Mení', aPass: 'Pas', aTook: 'Berie talón',
  aFold: 'Zloží', aBicykel: 'Bicykel',

  reconnecting: 'Pripájam sa znova…',
  tapSeat: 'Ťukni na voľné miesto a prisadni si',
  tableFull: 'Stôl je plný — len sa pozeráš',
  nextSoon: 'Ďalšia hra o chvíľu…',
  youBenched: 'Vynechávaš rozdávanie — hráš, keď niekto vyhrá kasu',
  waitingOther: 'Čaká sa na ďalšieho hráča…',
  youOwe: 'Na pokračovanie o kasu dlhuješ {€amount}',
  readyDeal: 'Pripravení hráči: {n} — rozdať môže ktokoľvek',
  yourDealOwe: 'Rozdávaš ty — dlhuješ {€amount}',
  decidesDeal: '{name} sa rozhoduje, či rozdá…',
  choosingBanker: 'Vyberá sa bankár…',
  sitOutTillWin: 'Stojíš mimo, kým niekto nevyhrá kasu',
  joinNext: 'Hráš od ďalšej hry',
  youreOut: 'Túto hru nehráš[ · na ťahu je {name}]',
  noSwapPassing: 'Žiadna výmena nedosiahne latku — pas…',
  autoCallBanker: 'Ako bankár dorovnávaš automaticky…',
  confirmSwap: 'Potvrď výmenu',
  tapTable: 'Teraz ťukni na kartu na stole',
  tapHand: 'Teraz ťukni na kartu v ruke',
  yourSwap: 'Tvoja výmena — ťukni na kartu, alebo si nechaj',
  bankerOptionQ: 'Bankárova voľba — zobrať karty zo stola?',
  yourTurnPay: 'Si na ťahu — zaplať dlh {€amount} a hraj ďalej',
  yourTurn: 'Si na ťahu',
  bankerCallsAll: 'Bankár: dorovnávaš všetko[ · na ťahu je {name}]',
  waitingFor: 'Na ťahu je {name}…',
  dealing: 'Rozdáva sa…',
  dealCards: 'Rozdať karty',
  payDeal: 'Zaplatiť {€amount} a rozdať',
  andPlay: 'a hrať túto hru',
  skip: 'Vynechať',
  sitOutSub: 'stáť mimo, kým niekto nevyhrá kasu',
  bankerNote: 'Bankár dorovnáva všetko automaticky',
  check: 'Stojím',
  call: 'Dorovnať {€amount}',
  plusOwed: '+ dlh {€amount}',
  noRaise: 'Bez zvýšenia',
  raiseUsed: 'Zvýšenie minuté',
  raise: 'Zvýšiť',
  fold: 'Zložiť',
  raiseBy: 'Zvýšiť o',
  raiseByX: 'Zvýšiť o {€amount}',
  raiseRule: 'Jedno zvýšenie a jedno prebitie za kolo',
  raiseOff: 'Zvyšovať môže len prvý a posledný hráč',
  cancel: 'Zrušiť',
  swapTo: 'Vymeniť → {score}',
  keepHand: 'Nechám si',
  pass: 'Pas',
  takeTable: 'Zobrať zo stola',
  blind: 'Naslepo',
  tapToLook: 'Ťukni znova a pozri sa',
  lookCards: 'Pozrieť karty',
  loseTalon: 'Prídeš o talón',
  blindKeeps: 'Naslepo ti ostáva talón',

  bWinner: 'Víťaz', bOffline: 'Offline', bBicykel: 'Bicykel', bOutTillWin: 'Mimo do výhry', bNextHand: 'Ďalšia hra',
  bFolded: 'Zložené', bHost: 'Hostiteľ',
  you: 'Ty',
  dealerMark: 'B',
  bankerTitle: 'Bankár',
  owes: 'dlh {€amount}',
  capWaitPlayers: 'Čaká sa na hráčov',
  capReady: 'Pripravené na rozdanie',
  capChoice: 'Zaplatiť, alebo vynechať rozdávanie',
  capBet: 'Stávky · {n}. kolo[ · stávka {€bet}]',
  capOption: 'Bankárova voľba',
  capSwap: 'Výmena s talónom',
  capShowdown: 'Vyhodnotenie',
  pot: 'Kasa',
  firstSpic: 'Kasu berie prvý Špic',
  winNeeds: 'Na výhru treba viac ako {n}',
  barBeat: 'Latka · {n}',
  barQualify: 'Latka · farba alebo trojica',
  barPot: 'Latka · [{?spic}Špic][{!spic}viac ako {n}]',
  moreThan: 'viac ako {n}',
  moveSeat: 'Presunúť sa na miesto {n}',
  sitSeat: 'Sadnúť si na miesto {n}',
  move: 'Presun',
  sit: 'Sadnúť',

  noSwapToast: 'Žiadna výmena nedosiahne latku — pas.',
  cardCant: 'S touto kartou [{?need}nedosiahneš {need}][{!need}nespravíš farbu ani trojicu] žiadnou výmenou.',
  swapCant: 'Touto výmenou [{?need}nedosiahneš {need}][{!need}nespravíš farbu ani trojicu].',
  titleTurn: '● Si na ťahu — ŠPIC',
  loading: 'Načítava sa stôl…',
  connecting: 'Pripájam sa k stolu…',
  anteShort: 'vklad {€amount}',
  openLog: 'Otvoriť záznam hry',
  howToPlay: 'Ako hrať',
  settleUp: 'Vyúčtovanie',
  tableLog: 'Záznam hry',
  leaveTable: 'Odísť od stola',
  settingsTitle: 'Nastavenia',
  soundOn: 'Zvuk zapnutý',
  soundOff: 'Zvuk vypnutý',
  connLost: 'Spojenie prerušené — pripájam sa znova…',
  otherTab: 'Otvorené na inej karte',
  otherTabText: 'Tvoje miesto sa hrá z inej karty alebo okna.',
  playHere: 'Hrať radšej tu',
  close: 'Zavrieť',

  takeSeat: 'Miesto {n}',
  yourName: 'Tvoje meno',
  namePh: 'napr. Marek',
  sitDown: 'Sadnúť si',
  stillInPot: 'V kase je ešte {€amount} — pred vyúčtovaním hrajte, kým ju niekto nevyhrá.',
  scores: 'Dnešné skóre',
  leftTag: 'preč',
  payments: 'Platby',
  paymentsLater: 'Platby sa ukážu, keď niekto vyhrá kasu.',
  nobodyOwes: 'Nikto nikomu nič nedlhuje.',
  mySettings: 'Na tomto telefóne',
  language: 'Jazyk',
  sound: 'Zvuk',
  on: 'Zap.',
  off: 'Vyp.',
  tableSettings: 'Stôl',
  turnTimer: 'Čas na ťah',
  ante: 'Vklad',
  raises: 'Zvýšenia',
  save: 'Uložiť na ďalšiu hru',
  saved: 'Uložené',
  hostOnly: 'Stôl môže meniť len hostiteľ ({name}).',
  hostNone: 'Hostiteľom je prvý hráč, ktorý si sadne.',
  hostBetween: 'Si hostiteľ. Meniť sa dá medzi hrami.',
  hostWait: 'Meniť sa dá medzi hrami.',
  cashedOut: '{name} sa vyrovnal(a) a odišiel(-šla).[ Zaplatil(a): {pays}.][ Dostal(a): {gets}.][ {€lost} ostáva v kase (drží {holder}).]',
  leaveTitle: 'Odísť od stola',
  yourScore: 'Tvoje dnešné skóre',
  settleNow: 'Vyrovnaj sa teraz',
  payTo: 'Ty → {name}',
  payFrom: '{name} → ty',
  lostNote: 'Z toho {€amount} je tvoj vklad v tejto kase: ostáva v nej, hotovosť si drží {holder} pre toho, kto kasu vyhrá.',
  evenNote: 'Si na nule — nie je čo vyrovnávať.',
  foldNote: 'Túto hru zložíš.',
  settledLeave: 'Vyrovnané — odísť',
  justLeave: 'Odísť',
  leaveUnsettled: 'Odísť bez vyrovnania',
  unsettledSub: 'ostaneš vo vyúčtovaní',
  seconds: '{n} s',
};

const DICTS: Record<Lang, Record<Key, string>> = { en, sk };

export function money(cents: number, lang: Lang): string {
  const abs = Math.abs(cents);
  const text = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  const sign = cents < 0 ? '-' : '';
  if (lang === 'sk') return `${sign}${text.replace('.', ',')}\u00a0€`;
  return `${sign}€${text}`;
}

// Running score: "+€6.50", "−€12", "±€0".
export function balance(cents: number, lang: Lang): string {
  if (cents === 0) return `±${money(0, lang)}`;
  return `${cents > 0 ? '+' : '−'}${money(Math.abs(cents), lang)}`;
}

const isSet = (v: unknown) =>
  v !== undefined && v !== null && v !== false && v !== 0 && v !== '' && !(Array.isArray(v) && v.length === 0);

const TOKEN = /\{([?!€]?)(\w+)\}/g;

export interface I18n {
  lang: Lang;
  t: (key: Key, p?: Record<string, unknown>) => string;
  msg: (m: Msg | null | undefined) => string;
  hand: (code: HandCode | null | undefined) => string;
  action: (tag: ActionTag) => string;
  money: (cents: number) => string;
  balance: (cents: number) => string;
}

export function makeI18n(lang: Lang): I18n {
  const dict = DICTS[lang];
  const num = (v: number) => (lang === 'sk' ? String(v).replace('.', ',') : String(v));

  const value = (v: unknown): string => {
    if (typeof v === 'number') return num(v);
    if (Array.isArray(v)) {
      return v.map(x => (typeof x === 'object' && x && 'name' in x ? `${x.name} ${money(x.amount, lang)}` : String(x)))
        .join(typeof v[0] === 'object' ? ', ' : ' & ');
    }
    if (typeof v === 'object' && v && 'k' in v) return hand(v as HandCode);
    return v == null ? '' : String(v);
  };

  const render = (tpl: string, p: Record<string, unknown> = {}) =>
    tpl
      .replace(/\[([^\]]*)\]/g, (_, seg: string) =>
        [...seg.matchAll(TOKEN)].every(([, mod, k]) => (mod === '!' ? !isSet(p[k]) : isSet(p[k]))) ? seg : '')
      .replace(TOKEN, (_, mod: string, k: string) =>
        mod === '?' || mod === '!' ? '' : mod === '€' ? money(Number(p[k]) || 0, lang) : value(p[k]));

  const t = (key: Key, p?: Record<string, unknown>) => render(dict[key] ?? key, p);

  function hand(code: HandCode | null | undefined): string {
    if (!code) return '';
    const v = { v: code.v };
    switch (code.k) {
      case 'zlaty': return t('hZlaty');
      case 'spic': return t('hSpic');
      case 'trojica': return t('hTrojica', v);
      case 'flush': return t('hFlush', v);
      case 'bicykel': return t('hBicykel');
      case 'partial': return t('hPartial', v);
      default: return t('hNone');
    }
  }

  const ACTIONS: Record<ActionTag['k'], Key> = {
    check: 'aCheck', call: 'aCall', raise: 'aRaise', swap: 'aSwap', pass: 'aPass', took: 'aTook', fold: 'aFold', bicykel: 'aBicykel',
  };

  return {
    lang,
    t,
    msg: m => (m ? (m.key in dict ? t(m.key as Key, m.p) : m.key) : ''),
    hand,
    action: tag => t(ACTIONS[tag.k], { a: tag.a }),
    money: c => money(c, lang),
    balance: c => balance(c, lang),
  };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);

const LANG_KEY = 'spic.lang';

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'sk') return saved;
  } catch {
    /* private mode */
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some(l => /^(sk|cs)\b/i.test(l ?? '')) ? 'sk' : 'en';
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode */
  }
}
