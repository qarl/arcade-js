// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for typeDrawScriptRecord (0x184c, generator): type [TYPE_PACE_COUNT] glyphs from DE to HL,
// 6 frames per glyph. FRAME HOOK, identical on both arms: one frame = the real ISR pair (m.fireNmi, pc seated at
// the 0x0a9e wait head) + a RAM dump; the oracle fires it on each taken back-edge of the 0x0a9e vblank wait, the
// idiomatic arm at each yield (as runIdiomaticGame does). Cycle IRQs are off, so frames happen only there; the
// run ends at the oracle's ret / generator done. Compared: every per-frame dump + the final RAM, minus only the
// cells the oracle's push16 wrote (call/ISR ghosts; entry SP 0x23fc or 0x23fe), whose last non-push stores are
// compared instead.
// Also compared: the port/INTE log (port 6 aside) and the watchdog kick count, exactly. SP is asserted:
// the idiomatic arm leaves it untouched, the oracle ends at entry SP + 2 (its ret).
// LIVE-OUT: none. Callers: 0x0bb7 `in 2` (A) then 0ab6 `mvi a` or `lxi b`; typeDrawScript's loop reads only BC,
// which the oracle push/pop-preserves (the idiomatic walker keeps it in a JS local) -- asserted equal anyway.
// Run: node --test games/invaders/idiomatic/test/equivalence-184c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_184c as oracle } from "../../translated/loc_184c.js";
import { typeDrawScriptRecord } from "../typeDrawScriptRecord.js";
import { typePacedSpriteRun } from "../typePacedSpriteRun.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { TYPE_PACE_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x184c;
const WAIT_TOP = 0x0a9e; // typePacedSpriteRun's `lda 0x20c0` vblank-wait head
const MAX_FRAMES = 2000;

function capture(K, frames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: ov }).runFrames(frames);
  const pristine = new Machine(ROM).routines;
  for (const c of caps) c.routines = pristine;
  return caps;
}
// First 4 = typeDrawScript's loop (BC 0x1dd3..), 5th = finishAttractCycle 0x0bb4 (count 0x12), 6-7 = 0x0bc0 script.
const CAPS = ROM_PRESENT ? capture(7, 1600) : []; // ~frames 252-431, 1359, 1467, 1575

// A body that spins without ever reaching a frame fails here instead of hanging until the runner's timeout.
const SPIN_READS = 1 << 20;
// Canonical RAM address (global_mask 0x7fff, 0x4000 mirror), or -1 off RAM. WIN = shadowed bytes below entry SP.
const ramAddr = (a) => { a &= 0x7fff; if (a >= 0x6000) a -= 0x4000; return a >= 0x2000 && a < 0x4000 ? a : -1; };
const WIN = 0x40;

function run(entry, body) {
  const m = entry.clone();
  m.nextInt1 = m.nextInt2 = m.nextBoundary = Infinity;
  const dumps = [], pushed = new Set(); // pushed = every cell a push16 (call or ISR accept) wrote this run
  // shadow = the last NON-push value stored into each cell of the WIN bytes below entry SP (-1 = none yet).
  const lo = ramAddr(entry.regs.sp) - WIN, shadow = new Int16Array(WIN).fill(-1), shadows = [];
  let inFrame = false, inPush = false, reads = 0;
  const frame = () => {
    if (dumps.length >= MAX_FRAMES) throw new Error("frame cap exceeded");
    inFrame = true; m.pcKnown = true; m.pc = WAIT_TOP; m.fireNmi(); inFrame = false;
    dumps.push(m.dumpState()); shadows.push(shadow.slice()); reads = 0;
  };
  const push16 = m.push16.bind(m), step = m.step.bind(m), read8 = m.mem.read8.bind(m.mem);
  const write8 = m.mem.write8.bind(m.mem);
  m.push16 = (v) => {
    inPush = true; push16(v); inPush = false;
    pushed.add(ramAddr(m.regs.sp)).add(ramAddr(m.regs.sp + 1));
  };
  m.mem.write8 = (a, v, bus) => {
    const i = ramAddr(a) - lo;
    if (!inPush && i >= 0 && i < WIN) shadow[i] = v & 0xff;
    write8(a, v, bus);
  };
  m.mem.read8 = (a) => {
    if (++reads > SPIN_READS) throw new Error(`no-frame spin: ${SPIN_READS} reads since frame ${dumps.length}`);
    return read8(a);
  };
  m.step = (a, cyc) => { step(a, cyc); if (!inFrame && a === WAIT_TOP && cyc === 10) frame(); };
  const io = [], out = m.io.portOut.bind(m.io), inte = m.io.setInte.bind(m.io);
  m.io.portOut = (p, v) => { if ((p & 7) !== 6) io.push(`${dumps.length}:${p}=${v & 0xff}`); return out(p, v); };
  m.io.setInte = (on) => { io.push(`${dumps.length}:inte=${!!on}`); return inte(on); };
  const g = body(m);
  if (g && typeof g.next === "function") for (let r = g.next(); !r.done; r = g.next()) frame();
  return { m, dumps, pushed, lo, shadow, shadows, io };
}

const runOracle = (e) => run(e, (m) => oracle(m));
const runModule = (e, fn = typeDrawScriptRecord) => run(e, (m) => fn(m, m.regs.de, m.regs.hl));

// Excluded from the RAM diff: only the cells the ORACLE's push16 wrote this run (return addresses and ISR-accepted
// PCs, which the idiomatic arm keeps in JS). Each one's last non-push store is shadowed on both arms and compared
// instead, so a plain store into an excluded cell cannot hide.
function divergence(o, c) {
  const cells = [...o.pushed], span = cells.length ? Math.max(...cells) - Math.min(...cells) + 1 : 0;
  assert.ok(span <= 0x20, `oracle stack ghosts span ${span} bytes`);
  assert.ok(cells.every((a) => a - o.lo >= 0 && a - o.lo < WIN), "an oracle push cell lies outside the shadow window");
  const ex = (a) => a != null && o.pushed.has(a);
  const at = (x, y) => firstStateDiff(x, y, (off) => o.m.stateOffsetToAddr(off), ex);
  const sh = (x, y) => {
    for (const a of cells) if (x[a - o.lo] !== y[a - o.lo]) return { shadow: a, values: [x[a - o.lo], y[a - o.lo]] };
    return null;
  };
  if (o.dumps.length !== c.dumps.length) return { frames: [o.dumps.length, c.dumps.length] };
  for (let i = 0; i < o.dumps.length; i++) {
    const d = at(o.dumps[i], c.dumps[i]) || sh(o.shadows[i], c.shadows[i]);
    if (d) return { frame: i, ...d };
  }
  return at(o.m.dumpState(), c.m.dumpState()) || sh(o.shadow, c.shadow);
}

// Planted twin for every TEETH test: the faithful body, then plain (non-push) stores into two oracle push cells.
const ghost = (fn) => function* (m, ...args) {
  const sp = m.regs.sp;
  yield* fn(m, ...args);
  for (const a of [sp - 1, sp - 7]) m.mem8[a & 0xffff] ^= 0x5a;
};

function assertEqual(entry, label) {
  const o = runOracle(entry), c = runModule(entry);
  const d = divergence(o, c);
  assert.equal(d, null, `${label}: ${JSON.stringify(d)}`);
  assert.deepEqual(c.io, o.io, `${label}: port/INTE log (port 6 aside)`);
  assert.equal(c.m.io.watchdogKicks, o.m.io.watchdogKicks, `${label}: watchdog kicks`);
  assert.equal(c.m.regs.sp, entry.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (entry.regs.sp + 2) & 0xffff, `${label}: oracle SP after its ret`);
  assert.equal(c.dumps.length, 6 * (entry.mem.read8(TYPE_PACE_COUNT) || 256), `${label}: 6 frames per glyph`);
  assert.equal(c.m.regs.bc, o.m.regs.bc, `${label}: BC preserved like the oracle`);
  const vram = (x) => x.mem.ram.subarray(0x400);
  assert.ok(vram(c.m).some((v, i) => v !== vram(entry)[i]), `${label}: no glyph landed (hollow run)`);
  return { o, c };
}

function crafted(base, { count, de, hl }) {
  const e = base.clone(); e.routines = base.routines;
  if (count !== undefined) e.mem.write8(TYPE_PACE_COUNT, count);
  if (de !== undefined) e.regs.de = de;
  if (hl !== undefined) e.regs.hl = hl;
  return e;
}

test("CAPTURE: real 0x184c dispatches -- per-frame RAM == oracle", () => {
  assert.equal(CAPS.length, 7, "expected the 0x183a, 0x0bb4 and 0x0bc0 dispatches within 1600 frames");
  assert.ok(CAPS.every((c) => c.regs.sp === 0x23fc || c.regs.sp === 0x23fe), "every entry SP is 0x23fc or 0x23fe");
  assert.ok(CAPS.some((c) => c.mem.read8(TYPE_PACE_COUNT) !== 0x0a), "a real entry with a non-0x0a count");
  CAPS.forEach((cap, i) => assertEqual(cap, `cap ${i}`));
});

test("CRAFTED: count boundaries 1, 2, 0 (wraps to 256 glyphs) and 0x81 / 0xe4 (with 2 and the 0x0a / 0x12 captures, every count bit), crafted source/dest", () => {
  assertEqual(crafted(CAPS[0], { count: 1 }), "count 1");
  assertEqual(crafted(CAPS[0], { count: 2, de: 0x1c10, hl: 0x3010 }), "count 2");
  assertEqual(crafted(CAPS[4], { count: 0, de: 0x1a00, hl: 0x2a02 }), "count 0");
  assertEqual(crafted(CAPS[0], { count: 0x81 }), "count 0x81");
  assertEqual(crafted(CAPS[4], { count: 0xe4, de: 0x1a00, hl: 0x2a02 }), "count 0xe4");
});

function* oneShort(m, de, hl) { yield* typePacedSpriteRun(m, de, (m.mem8[TYPE_PACE_COUNT] - 1) & 0xff, hl); }
function* fixedCount(m, de, hl) { yield* typePacedSpriteRun(m, de, 0x0a, hl); }
function* swapped(m, de, hl) { yield* typePacedSpriteRun(m, hl, m.mem8[TYPE_PACE_COUNT], de); }

test("TEETH: broken twins diverge (one glyph short, hard-coded count, swapped de/hl, ghost push-cell stores)", () => {
  for (const [name, fn, e] of [["oneShort", oneShort, CAPS[0]], ["fixedCount", fixedCount, CAPS[4]],
    ["swapped", swapped, CAPS[0]]]) {
    assert.notEqual(divergence(runOracle(e), runModule(e, fn)), null, `${name} twin passed`);
  }
  CAPS.forEach((e, i) => assert.notEqual(divergence(runOracle(e), runModule(e, ghost(typeDrawScriptRecord))), null,
    `ghost twin passed on cap ${i}`));
});
