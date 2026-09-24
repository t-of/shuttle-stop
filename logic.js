// ピタオリの決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）の両方から読む。

// ---- 調整つまみ（長さは世界の単位。世界の幅は 360 に固定し、画面に合わせて拡大・縮小して描く） ----
export const WORLD_W = 360;
export const ROW_H = 38;              // 段の高さ（描くのは上下 1 ずつあけた 36）
export const BASE_W = 224;            // 土台（0 段目）の幅。左右中央
export const SPEED_BASE = 144;        // 速さ = SPEED_BASE + min(SPEED_STEP × (k + 1), SPEED_ADD_MAX)（1 秒あたり）
export const SPEED_STEP = 7.2;
export const SPEED_ADD_MAX = 270;
export const PERFECT = 4;             // 左端のずれがこれ以下なら「ぴったり」
export const LOCK = 0.15;             // 秒。帯が出てからこの間は止められない
export const MIN_W = 6;               // 置いた段がこれより細いと終わり
export const OVER_DELAY = 0.65;       // 秒。終わってから結果を出すまで
export const RESULT_LOCK = 0.4;       // 秒。結果が出てからボタンを押せるまで
export const GRAVITY = 1800;          // 切れ端（1 秒あたりの 2 乗）
export const CUT_VX = 72;             // 切れ端の横の速さ・回る速さ（はみ出た向きへ）
export const CUT_SPIN = 4.8;
export const DROP_VX = 90;            // まるごと落ちた帯（動いていた向きへ）
export const DROP_SPIN = 3;
export const GONE_BELOW = 200;        // 画面の下からこれだけ出たら切れ端を消す
export const CAM_START = 0.7;         // 始めは土台の上面がステージの高さの 70% の位置
export const CAM_TOP = 0.35;          // 動く帯の上端はステージの高さの 35% より上に来ない
export const CAM_RATE = 12;           // 追いかけ: 1 秒あたり 1 − exp(−12 × 経過秒)

// 布の色と柄（色の値は main.js。ここでは番号だけ）
export const COLOR_COUNT = 4;          // 普通の段に使う色（0〜3）
export const BASE_COLOR = 4;           // 土台だけの色（生成りの濃い色）。普通の段には使わない
export const PATTERNS = ['plain', 'stripe', 'check', 'dot'];

// 縦の座標は下が +。段 i の上端は y = −i × ROW_H（土台の上面が y = 0）
export const rowTop = (i) => -i * ROW_H;

export function speed(k) {
  return SPEED_BASE + Math.min(SPEED_STEP * (k + 1), SPEED_ADD_MAX);
}

// 前の段と同じ色にはしない（1 段ごとに色がずれていく帯にしないため、順番ではなくランダム）
export function pickStyle(prev, rand = Math.random) {
  const same = prev && prev.c < COLOR_COUNT;   // 土台の上ならどの色でもよい
  let c = Math.floor(rand() * (same ? COLOR_COUNT - 1 : COLOR_COUNT));
  if (same && c >= prev.c) c++;
  return { c, p: PATTERNS[Math.floor(rand() * PATTERNS.length)] };
}

export function newGame(rand = Math.random) {
  const g = {
    rows: [{ x: (WORLD_W - BASE_W) / 2, w: BASE_W, px: (WORLD_W - BASE_W) / 2, style: { c: BASE_COLOR, p: 'plain' } }],
    perfect: 0,
    bits: [],       // 落ちていく切れ端（見た目だけ）
    mover: null,
    over: false,
  };
  spawn(g, rand);
  return g;
}

// 織った段数（土台は数えない）
export const woven = (g) => g.rows.length - 1;

function spawn(g, rand) {
  const top = g.rows[g.rows.length - 1];
  const dir = rand() < 0.5 ? 1 : -1;
  g.mover = { x: dir > 0 ? 0 : WORLD_W - top.w, w: top.w, dir, age: 0, style: pickStyle(top.style, rand) };
}

// 帯を動かし、切れ端を落とす。bottom = 画面の下端の y（切れ端を消す目安）
export function step(g, dt, bottom = Infinity) {
  const m = g.mover;
  if (m) {
    m.age += dt;
    m.x += m.dir * speed(woven(g)) * dt;
    // 端で折り返す（1 回の dt で 2 度はね返るほど速くはならない）
    if (m.x + m.w > WORLD_W) { m.x = 2 * (WORLD_W - m.w) - m.x; m.dir = -1; }
    if (m.x < 0) { m.x = -m.x; m.dir = 1; }
    m.x = Math.min(Math.max(m.x, 0), WORLD_W - m.w);
  }
  for (const b of g.bits) {
    b.vy += GRAVITY * dt;
    b.cx += b.vx * dt;
    b.cy += b.vy * dt;
    b.rot += b.spin * dt;
  }
  // 回っていても、いちばん上の角が画面の下から GONE_BELOW 出たら消す
  g.bits = g.bits.filter((b) => b.cy - Math.hypot(b.w, ROW_H) / 2 <= bottom + GONE_BELOW);
}

function addBit(g, x, w, y, px, style, dir, vx, spin) {
  g.bits.push({ cx: x + w / 2, cy: y + ROW_H / 2, w, px: px - x, style, vx: dir * vx, vy: 0, rot: 0, spin: dir * spin });
}

// 止める。結果は null（まだ止められない）/ 'perfect' / 'cut' / 'miss'（重ならず終わり）
// 置いた段が細すぎたときは 'cut' のまま g.over = true になる
export function stop(g, rand = Math.random) {
  const m = g.mover;
  if (!m || g.over || m.age < LOCK) return null;
  const below = g.rows[g.rows.length - 1];
  const y = rowTop(g.rows.length);
  const lo = Math.max(m.x, below.x);
  const hi = Math.min(m.x + m.w, below.x + below.w);
  g.mover = null;
  if (hi - lo <= 0) {
    addBit(g, m.x, m.w, y, m.x, m.style, m.dir, DROP_VX, DROP_SPIN);
    g.over = true;
    return 'miss';
  }
  let kind;
  if (Math.abs(m.x - below.x) <= PERFECT) {
    g.rows.push({ x: below.x, w: below.w, px: below.x, style: m.style });
    g.perfect++;
    kind = 'perfect';
  } else {
    if (m.x < lo) addBit(g, m.x, lo - m.x, y, m.x, m.style, -1, CUT_VX, CUT_SPIN);
    if (m.x + m.w > hi) addBit(g, hi, m.x + m.w - hi, y, m.x, m.style, 1, CUT_VX, CUT_SPIN);
    g.rows.push({ x: lo, w: hi - lo, px: m.x, style: m.style });
    kind = 'cut';
  }
  if (g.rows[g.rows.length - 1].w < MIN_W) g.over = true;
  else spawn(g, rand);
  return kind;
}

// ---- 画面の追いかけ（cam = ステージの上端の y、H = ステージの高さ。どちらも世界の単位） ----
// 目標は段が増えると上がるだけで、下には戻らない（段数だけで決まるので覚えておかなくてよい）
export function cameraTarget(rows, H) {
  return Math.min(-CAM_START * H, rowTop(rows) - CAM_TOP * H);
}

export function follow(cam, target, dt, instant = false) {
  return instant ? target : cam + (target - cam) * (1 - Math.exp(-CAM_RATE * dt));
}

export const shareText = (rows, perfect) => `ピタオリで ${rows} 段織った（ぴったり ${perfect} 回）`;

// ---- 記録（localStorage はほかのアプリと共有されるので、キーは 'pitaori.' で始める） ----
export const BEST_KEY = 'pitaori.best';

// storage が null でも、読めなくても、壊れていても 0 から
export function readBest(storage) {
  try {
    const v = JSON.parse(storage.getItem(BEST_KEY));
    if (v && v.v === 1 && Number.isFinite(v.rows) && v.rows >= 0) {
      return { rows: Math.floor(v.rows), perfect: Number.isFinite(v.perfect) ? Math.floor(v.perfect) : 0 };
    }
  } catch { /* 読めなければ 0 から */ }
  return { rows: 0, perfect: 0 };
}

// 段数が上回ったときだけ保存して true を返す（保存できなくても true。その回は更新として見せる）
export function writeBest(storage, best, rows, perfect) {
  if (rows <= best.rows) return false;
  try { storage.setItem(BEST_KEY, JSON.stringify({ v: 1, rows, perfect })); } catch { /* 保存できなくても遊べる */ }
  return true;
}
