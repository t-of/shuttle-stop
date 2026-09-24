// ピタオリ本体。決まりごと（数値・動き・判定・記録）は logic.js、ここは画面・操作・描画。
import {
  WORLD_W, ROW_H, OVER_DELAY, RESULT_LOCK, rowTop, newGame, woven, step, stop,
  cameraTarget, follow, shareText, readBest, writeBest,
} from './logic.js';

WebAppKit.init({ title: 'ピタオリ', text: '左右に行き来する布の帯をタップで止めて、下の段に重ねて織り上げる。はみ出たぶんは切り落とされるので、ぴったり止めて細くしないのがこつ。' });

// https と localhost（開発・audit）で登録する。それ以外の http では serviceWorker がない
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const $ = (id) => document.getElementById(id);
// localStorage に触るだけで例外が出る環境もあるので、ここで受け止める
const storage = (() => { try { return localStorage; } catch { return null; } })();
let best = readBest(storage);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ---- 見た目（平らな布。影や側面で厚みを出さない） ----
const BG = '#efe8da';
const WARP = '#d9d0bf';
const FG = '#2a2622';
// logic.js の色番号の順。ink は柄の色
const CLOTH = [
  { fill: '#2d4a7a', ink: 'rgba(239, 232, 218, 0.55)' },  // 藍
  { fill: '#c8414b', ink: 'rgba(239, 232, 218, 0.5)' },   // 紅
  { fill: '#d6a53a', ink: 'rgba(42, 38, 34, 0.3)' },      // からし
  { fill: '#5f8f6b', ink: 'rgba(239, 232, 218, 0.5)' },   // 若竹
  { fill: '#bfae8e', ink: 'rgba(42, 38, 34, 0.25)' },     // 生成りの濃い色（土台）
];
const WARP_GAP = 18;
const PITA_TIME = 0.8;    // 「ぴったり」の文字を出す秒数
const FLASH_TIME = 0.3;   // ぴったりの光

// 布の帯を 1 本描く。y は段の上端、ox は柄の起点（切れ端と残った段で柄がつながるように）
function drawBand(c, x, y, w, style, ox) {
  const look = CLOTH[style.c];
  const top = y + 1, h = ROW_H - 2;
  c.fillStyle = look.fill;
  c.fillRect(x, top, w, h);
  if (style.p === 'plain') return;
  c.save();
  c.beginPath();
  c.rect(x, top, w, h);
  c.clip();
  c.fillStyle = look.ink;
  const from = ox + Math.floor((x - ox) / 12) * 12;
  if (style.p === 'stripe') {            // 細い縞（横糸の色替え）
    c.fillRect(x, top + 8, w, 2);
    c.fillRect(x, top + 13, w, 1);
    c.fillRect(x, top + 26, w, 2);
  } else if (style.p === 'check') {      // 格子
    for (let gx = from + 6; gx < x + w; gx += 12) c.fillRect(gx - 0.75, top, 1.5, h);
    c.fillRect(x, top + 11, w, 1.5);
    c.fillRect(x, top + 23.5, w, 1.5);
  } else {                               // 点（互い違い）
    c.beginPath();
    for (let gx = from; gx < x + w + 12; gx += 12) {
      c.moveTo(gx + 6 + 1.7, top + 9); c.arc(gx + 6, top + 9, 1.7, 0, Math.PI * 2);
      c.moveTo(gx + 1.7, top + 27); c.arc(gx, top + 27, 1.7, 0, Math.PI * 2);
    }
    c.fill();
  }
  c.restore();
}

// たて糸（狙いの目安）。両端の耳だけ少し太く
function drawWarp(c, h) {
  c.fillStyle = WARP;
  for (let x = WARP_GAP / 2; x < WORLD_W; x += WARP_GAP) c.fillRect(x - 0.5, 0, 1, h);
  c.fillRect(0, 0, 2, h);
  c.fillRect(WORLD_W - 2, 0, 2, h);
}

// ---- タイトルの見本（動かない。数段織った布） ----
function drawSample() {
  const cv = $('sample');
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const s = (r.width * dpr) / WORLD_W;
  const c = cv.getContext('2d');
  c.setTransform(s, 0, 0, s, 0, 0);
  const h = cv.height / s;
  c.fillStyle = BG;
  c.fillRect(0, 0, WORLD_W, h);
  drawWarp(c, h);
  const rows = [
    [68, 224, { c: 4, p: 'plain' }], [68, 224, { c: 0, p: 'check' }], [80, 212, { c: 2, p: 'dot' }], [92, 200, { c: 1, p: 'stripe' }],
  ];
  const base = h - 8 - ROW_H;
  rows.forEach(([x, w, st], i) => drawBand(c, x, base - i * ROW_H, w, st, x));
  drawBand(c, 140, base - rows.length * ROW_H - 10, 200, { c: 3, p: 'plain' }, 140);   // 行き来している帯
}

// ---- 画面の切り替え（隠すときは display: none） ----
let screen = 'title';
function show(s) {
  screen = s;
  $('title').hidden = s !== 'title';
  $('play').hidden = s === 'title';
  $('result').hidden = s !== 'result';
}

function titleBest() {
  $('titleBest').textContent = `${best.rows} 段`;
}

// ---- ステージ ----
const canvas = $('stage');
const ctx = canvas.getContext('2d');
let scale = 1;   // 世界の 1 単位が何 CSS px か
let H = 700;     // ステージの高さ（世界の単位）
let dpr = 1;

// 幅は最大 480px。横長の画面でも縦に 400 単位は見えるように、高さに合わせて幅をしぼる
function resize() {
  const wrap = $('stageWrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  if (!ww || !wh) return;
  const w = Math.floor(Math.min(ww, 480, wh * 0.9));
  dpr = devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${wh}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(wh * dpr);
  scale = w / WORLD_W;
  H = wh / scale;
  render();
}

let game = null;
let cam = 0;       // ステージの上端の y（世界の単位）
let overT = 0;     // 終わってからの秒
let pita = null;   // { i: 段, t: 経過秒 } ぴったりの光と文字
let lockUntil = 0; // 結果のボタンを押せるようになる時刻
let raf = 0;
let last = 0;

function hud() {
  $('rows').textContent = woven(game);
  $('perfect').textContent = game.perfect;
}

function start() {
  if (screen === 'result' && performance.now() < lockUntil) return;
  game = newGame();
  overT = 0;
  pita = null;
  show('play');
  resize();
  cam = cameraTarget(game.rows.length, H);
  hud();
  last = performance.now();
  if (!raf) raf = requestAnimationFrame(frame);
}

function toTitle() {
  if (performance.now() < lockUntil) return;
  cancelAnimationFrame(raf);
  raf = 0;
  game = null;
  titleBest();
  show('title');
  drawSample();
}

function act() {
  if (screen !== 'play' || !game) return;
  const kind = stop(game);
  if (!kind) return;
  hud();
  if (kind === 'perfect') pita = { i: game.rows.length - 1, t: 0 };
  if (game.over) {
    overT = 0;
    const rows = woven(game);
    const isNew = writeBest(storage, best, rows, game.perfect);
    if (isNew) best = { rows, perfect: game.perfect };
    $('rNew').hidden = !isNew;
  }
}

function finish() {
  const rows = woven(game);
  $('rRows').textContent = rows;
  $('rPerfect').textContent = game.perfect;
  $('rBest').textContent = `ベスト ${best.rows} 段（ぴったり ${best.perfect} 回）`;
  lockUntil = performance.now() + RESULT_LOCK * 1000;
  show('result');
}

// 結果のカードが下に重なるときは、織った布のいちばん上がカードの上に見えるところまで上げる
function resultCam() {
  const target = cameraTarget(game.rows.length, H);
  const card = document.querySelector('.result__card').getBoundingClientRect();
  const stage = canvas.getBoundingClientRect();
  if (card.left > stage.left + stage.width / 2) return target;   // 横画面ではカードは右にあり、布にかからない
  return Math.max(target, rowTop(game.rows.length - 1) - ((card.top - stage.top) / scale - 24));
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (game) {
    step(game, dt, cam + H);
    cam = follow(cam, screen === 'result' ? resultCam() : cameraTarget(game.rows.length, H), dt, reduced.matches);
    if (pita) pita.t += dt;
    if (game.over && screen === 'play') {
      overT += dt;
      if (overT >= OVER_DELAY) finish();
    }
  }
  render();
  raf = requestAnimationFrame(frame);
}

function render() {
  if (!game) return;
  const c = ctx;
  c.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  c.fillStyle = BG;
  c.fillRect(0, 0, WORLD_W, H);
  drawWarp(c, H);
  c.translate(0, -cam);

  // 見えている段だけ描く（段 i は y = −i × ROW_H から下へ ROW_H）
  const lo = Math.max(0, Math.floor(-(cam + H) / ROW_H));
  const hi = Math.min(game.rows.length - 1, Math.ceil((ROW_H - cam) / ROW_H));
  for (let i = lo; i <= hi; i++) {
    const r = game.rows[i];
    drawBand(c, r.x, rowTop(i), r.w, r.style, r.px);
  }
  const m = game.mover;
  if (m) drawBand(c, m.x, rowTop(game.rows.length), m.w, m.style, m.x);

  for (const b of game.bits) {
    c.save();
    c.translate(b.cx, b.cy);
    c.rotate(b.rot);
    drawBand(c, -b.w / 2, -ROW_H / 2, b.w, b.style, -b.w / 2 + b.px);
    c.restore();
  }

  if (pita && pita.t < PITA_TIME) {
    const r = game.rows[pita.i];
    const y = rowTop(pita.i);
    if (!reduced.matches && pita.t < FLASH_TIME) {   // 置いた段がその場で短く光る
      c.fillStyle = `rgba(255, 252, 244, ${0.6 * (1 - pita.t / FLASH_TIME)})`;
      c.fillRect(r.x, y + 1, r.w, ROW_H - 2);
    }
    // 「ぴったり」の文字は段の横の空いているほうに
    const right = WORLD_W - (r.x + r.w) >= r.x;
    c.globalAlpha = Math.min(1, 3 * (1 - pita.t / PITA_TIME));
    c.fillStyle = FG;
    c.font = `700 15px system-ui, -apple-system, 'Hiragino Sans', sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = right ? 'left' : 'right';
    const lift = reduced.matches ? 0 : pita.t * 10;
    c.fillText('ぴったり', right ? r.x + r.w + 8 : r.x - 8, y + ROW_H / 2 - lift);
    c.globalAlpha = 1;
  }
}

// ---- 操作 ----
$('play').addEventListener('pointerdown', (e) => {
  if (screen !== 'play') return;
  e.preventDefault();
  act();
});
addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.target.closest && e.target.closest('button, a')) return;   // ボタンの上では、そのボタンが押される
  e.preventDefault();
  if (e.repeat) return;
  if (screen === 'title') start();
  else if (screen === 'play') act();
  else start();
});
$('start').addEventListener('click', start);
$('again').addEventListener('click', start);
$('toTitle').addEventListener('click', toTitle);
$('shareResult').addEventListener('click', () => {
  if (performance.now() < lockUntil) return;
  WebAppKit.share({ text: shareText(woven(game), game.perfect) });
});
addEventListener('resize', () => { if (screen === 'title') drawSample(); else resize(); });

titleBest();
drawSample();
