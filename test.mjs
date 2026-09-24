// node test.mjs — 画面を使わない部分のテスト（帯の動き・止めたときの重なりと切り落とし・ぴったり・終わり・記録）
import assert from 'node:assert/strict';
import * as L from './logic.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
// 決まった順に値を返す乱数（なくなったら 0）
const seq = (...xs) => () => (xs.length ? xs.shift() : 0);

// 帯を x に置いて止める（動きのテストとは別に、止めたときの判定だけを見る）
function placeAt(g, x) {
  g.mover.x = x;
  g.mover.age = L.LOCK;
  return L.stop(g, seq(0.9));
}

test('速さ: 最初 151.2、1 段ごとに 7.2 上がり、38 本目から 414 で一定', () => {
  near(L.speed(0), 151.2, 'k=0');
  near(L.speed(1) - L.speed(0), 7.2, '1 段ごと');
  assert.ok(L.speed(36) < 414);
  near(L.speed(37), 414, 'k=37');
  near(L.speed(100), 414, 'k=100');
});

test('始め: 土台は幅 224 で左右中央、帯は土台と同じ幅で画面の中から出る', () => {
  const r = L.newGame(seq(0.2));   // 0.2 < 0.5 → 左端から右へ
  assert.deepEqual([r.rows[0].x, r.rows[0].w], [68, 224]);
  assert.equal(L.woven(r), 0);
  assert.deepEqual([r.mover.x, r.mover.w, r.mover.dir], [0, 224, 1]);
  const l = L.newGame(seq(0.7));   // 右端から左へ
  assert.deepEqual([l.mover.x, l.mover.dir], [360 - 224, -1]);
});

test('動き: 速さのとおりに進み、左右の端で折り返し、画面の外へ出ない', () => {
  const g = L.newGame(seq(0.2));
  L.step(g, 0.1);
  near(g.mover.x, 15.12, '0.1 秒で 15.12');
  for (let i = 0; i < 2000; i++) {
    L.step(g, 1 / 60);
    assert.ok(g.mover.x >= 0 && g.mover.x + g.mover.w <= 360, `はみ出した x=${g.mover.x}`);
  }
  const h = L.newGame(seq(0.2));
  h.mover.x = 130;                 // 右端は 354。0.1 秒で 15.12 進むと 369.12 → 折り返して 338.88
  L.step(h, 0.1);
  near(h.mover.x + h.mover.w, 360 - 9.12, '右端で折り返す');
  assert.equal(h.mover.dir, -1);
});

test('押せない時間: 出てから 0.15 秒は止まらない', () => {
  const g = L.newGame(seq(0.2));
  L.step(g, 0.1);
  assert.equal(L.stop(g), null);
  assert.ok(g.mover);
  L.step(g, 0.06);
  assert.notEqual(L.stop(g, seq(0.9)), null);
});

test('ぴったり: 左端のずれが 4 以下なら下の段にそろえ、何も切らない', () => {
  const g = L.newGame(seq(0.2));
  assert.equal(placeAt(g, 68 + 4), 'perfect');
  assert.deepEqual([g.rows[1].x, g.rows[1].w], [68, 224]);
  assert.equal(g.perfect, 1);
  assert.equal(g.bits.length, 0);
  assert.equal(placeAt(g, 68 - 3.5), 'perfect');
  assert.equal(g.perfect, 2);
  assert.equal(placeAt(g, 68 + 4.01), 'cut');
  assert.equal(g.perfect, 2);
});

test('切り落とし: 重なった部分だけ残り、はみ出た部分は切れ端になって次の帯はその幅', () => {
  const g = L.newGame(seq(0.2));
  assert.equal(placeAt(g, 100), 'cut');       // 下は 68〜292、帯は 100〜324
  assert.deepEqual([g.rows[1].x, g.rows[1].w], [100, 192]);
  assert.equal(g.bits.length, 1);
  const bit = g.bits[0];
  assert.equal(bit.w, 32);                     // 右の 292〜324
  near(bit.cx, 308, '切れ端の中心');
  assert.ok(bit.vx > 0 && bit.spin > 0, '右へ落ちる');
  assert.equal(g.mover.w, 192);
  assert.equal(g.mover.x, 360 - 192);          // 0.9 → 右から出る
  assert.equal(L.woven(g), 1);
  assert.equal(g.over, false);

  const h = L.newGame(seq(0.2));
  placeAt(h, 20);                              // 左の 20〜68 がはみ出る
  assert.deepEqual([h.rows[1].x, h.rows[1].w], [68, 176]);
  assert.ok(h.bits[0].vx < 0 && h.bits[0].spin < 0, '左へ落ちる');
});

test('1 段も重ならない: まるごと落ちて終わり、その帯は数えない', () => {
  const g = L.newGame(seq(0.2));
  placeAt(g, 100);                             // 100〜292 が残る
  g.mover.x = 0; g.mover.w = 100; g.mover.age = 1;  // 0〜100 は重なりがちょうど 0
  assert.equal(L.stop(g), 'miss');
  assert.equal(g.over, true);
  assert.equal(L.woven(g), 1);
  assert.equal(g.mover, null);
  assert.equal(g.bits.length, 2);
  assert.equal(L.stop(g), null, '終わったあとは止まらない');
});

test('細すぎる: 置いた段が 6 未満なら、数えたうえで終わり', () => {
  const g = L.newGame(seq(0.2));
  assert.equal(placeAt(g, 292 - 5.9), 'cut');
  near(g.rows[1].w, 5.9, '残った幅');
  assert.equal(g.over, true);
  assert.equal(L.woven(g), 1);
  const h = L.newGame(seq(0.2));
  placeAt(h, 292 - 6);
  assert.equal(h.over, false, '6 ちょうどは続く');
});

test('切れ端: 重力で落ち、経過時間どおりに回り、画面の下から 200 出たら消える', () => {
  const g = L.newGame(seq(0.2));
  placeAt(g, 100);
  const b = g.bits[0];
  L.step(g, 0.5, 1000);
  near(b.vy, 900, '縦の速さ');
  near(b.cx, 308 + 36, '横へ 72/秒');
  near(b.rot, 2.4, '4.8 ラジアン/秒');
  // 1/60 秒を 30 回でも 0.5 秒 1 回でも、回る量は同じ（画面の速さで変わらない）
  const a = L.newGame(seq(0.2)); placeAt(a, 100);
  for (let i = 0; i < 30; i++) L.step(a, 1 / 60, 1000);
  near(a.bits[0].rot, 2.4, '細かく刻んでも同じ');
  for (let i = 0; i < 200 && g.bits.length; i++) L.step(g, 0.05, 0);
  assert.equal(g.bits.length, 0);
});

test('画面の追いかけ: 始めは土台の上面が 70%、動く帯の上端は 35% より上に来ない', () => {
  const H = 700;
  near(L.cameraTarget(1, H), -490, '始め');
  for (let rows = 1; rows < 60; rows++) {
    const cam = L.cameraTarget(rows, H);
    assert.ok(L.rowTop(rows) - cam >= L.CAM_TOP * H - 1e-9, `${rows} 段目`);
    assert.ok(cam <= L.cameraTarget(rows - 1, H), '下には戻らない');
  }
  near(L.follow(0, 100, 1, true), 100, 'reduced-motion はすぐ');
  near(L.follow(0, 100, 0.1), 100 * (1 - Math.exp(-1.2)), 'なめらかに');
});

test('色: 普通の段は土台の色を使わず、前の段と同じ色にならない', () => {
  assert.equal(L.newGame().rows[0].style.c, L.BASE_COLOR);
  const onBase = new Set();
  for (let i = 0; i < 200; i++) onBase.add(L.pickStyle({ c: L.BASE_COLOR }).c);
  assert.deepEqual([...onBase].sort(), [0, 1, 2, 3], '土台の上は 4 色すべて出る');
  let prev = { c: L.BASE_COLOR };
  for (let i = 0; i < 500; i++) {
    const s = L.pickStyle(prev);
    assert.ok(s.c >= 0 && s.c < L.COLOR_COUNT && s.c !== L.BASE_COLOR && s.c !== prev.c, `c=${s.c}`);
    assert.ok(L.PATTERNS.includes(s.p));
    prev = s;
  }
});

test('ひと通り遊ぶ: 毎回ずれて置くと細くなり、いつか終わる', () => {
  const g = L.newGame(() => 0.3);
  let guard = 0;
  while (!g.over && guard++ < 1000) {
    L.step(g, 0.2);
    L.stop(g, () => 0.3);
  }
  assert.ok(g.over);
  assert.ok(L.woven(g) >= 1);
});

test('記録: pitaori.best に { v: 1, rows, perfect }、上回ったときだけ書く、壊れていたら 0 から', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
  const s = mem();
  assert.deepEqual(L.readBest(s), { rows: 0, perfect: 0 });
  assert.equal(L.writeBest(s, L.readBest(s), 23, 5), true);
  assert.deepEqual(JSON.parse(s.m.get('pitaori.best')), { v: 1, rows: 23, perfect: 5 });
  assert.deepEqual(L.readBest(s), { rows: 23, perfect: 5 });
  assert.equal(L.writeBest(s, L.readBest(s), 23, 9), false, '同じ段数では書かない');
  assert.equal(L.writeBest(s, L.readBest(s), 10, 9), false);
  assert.deepEqual(L.readBest(s), { rows: 23, perfect: 5 });
  for (const bad of ['{', 'null', '"x"', '{"v":2,"rows":5}', '{"v":1,"rows":-1}', '{"v":1}']) {
    s.m.set('pitaori.best', bad);
    assert.deepEqual(L.readBest(s), { rows: 0, perfect: 0 }, bad);
  }
  const broken = { getItem() { throw new Error('private'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(L.readBest(broken), { rows: 0, perfect: 0 });
  assert.equal(L.writeBest(broken, { rows: 0, perfect: 0 }, 3, 1), true, '書けなくても遊べる');
  assert.deepEqual(L.readBest(null), { rows: 0, perfect: 0 });
});

test('共有の文', () => {
  assert.equal(L.shareText(12, 3), 'ピタオリで 12 段織った（ぴったり 3 回）');
});

console.log(`\n${n} 件すべて通った`);
