// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawScoreAdvanceTable (0x1815, generator): header sprite list, TYPE_PACE_COUNT := 0x0a, the
// untimed 0x1dbe column script, then the typed loc_1dcf tail. FRAME HOOK, identical on both arms: one frame = the
// real ISR pair (m.fireNmi, pc seated at the 0x0a9e wait head) + a RAM dump; the oracle fires it on each taken
// back-edge of the 0x0a9e vblank wait, the idiomatic arm at each yield (as runIdiomaticGame does). Cycle IRQs are
// off; the run ends at the tail's `rc` / generator done. Compared: every per-frame dump + final RAM, minus only
// the cells the oracle's push16 wrote (entry SP 0x23fe on both captures), whose last non-push stores are compared
// instead. Inputs are ROM data, prior VRAM and the ISR's RAM.
// Also compared: the port/INTE log (port 6 aside) and the watchdog kick count, exactly. SP is asserted:
// the idiomatic arm leaves it untouched, the oracle ends at entry SP + 2 (its ret).
// LIVE-OUT: none. Sole caller 0x0b11 continues at 0x0b14 `call 0ab6` (mvi a / sta / lda): no register read.
// Run: node --test games/invaders/idiomatic/test/equivalence-1815.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1815 as oracle } from "../../translated/loc_1815.js";
import { drawScoreAdvanceTable } from "../drawScoreAdvanceTable.js";
import { drawSpriteList } from "../drawSpriteList.js";
import { typeSecondDrawScript } from "../typeSecondDrawScript.js";
import { fetchNextDrawRecord } from "../fetchNextDrawRecord.js";
import { drawSpriteColumn16 } from "../drawSpriteColumn16.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { TYPE_PACE_COUNT, SHARED_TEXT_VRAM_DEST, SCORE_ADVANCE_TABLE_HEADER, SCORE_ADVANCE_DRAW_SCRIPT, loc_1dcf } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1815;
const TYPED_SCRIPT = loc_1dcf;
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
// Two real 0x0b11 dispatches, both at SP 0x23fe: frame 251 (first attract pass) and 2064 (after the demo game).
const CAPS = ROM_PRESENT ? capture(2, 2100) : [];

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
const runModule = (e, fn = drawScoreAdvanceTable) => run(e, (m) => fn(m));

// Excluded from the RAM diff: only the cells the ORACLE's push16 wrote this run (return addresses and ISR-accepted
// PCs, which the idiomatic arm keeps in JS). Each one's last non-push store is shadowed on both arms and compared
// instead: a plain store there cannot hide behind the exclusion.
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

const records = (m, bc) => { let n = 0; while (m.mem.read8((bc + 4 * n) & 0xffff) !== 0xff) n++; return n; };
const vram = (x) => x.mem.ram.subarray(0x400);

function assertEqual(entry, label) {
  const o = runOracle(entry), c = runModule(entry);
  const d = divergence(o, c);
  assert.equal(d, null, `${label}: ${JSON.stringify(d)}`);
  assert.deepEqual(c.io, o.io, `${label}: port/INTE log (port 6 aside)`);
  assert.equal(c.m.io.watchdogKicks, o.m.io.watchdogKicks, `${label}: watchdog kicks`);
  assert.equal(c.m.regs.sp, entry.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (entry.regs.sp + 2) & 0xffff, `${label}: oracle SP after its ret`);
  const glyphs = records(entry, TYPED_SCRIPT) * 0x0a; // count seated by the routine
  assert.equal(c.dumps.length, 6 * glyphs, `${label}: 6 frames per typed glyph`);
  assert.ok(vram(c.m).some((v, i) => v !== vram(entry)[i]), `${label}: nothing drawn (hollow run)`);
}

test("CAPTURE: real 0x1815 dispatches -- per-frame RAM == oracle", () => {
  assert.equal(CAPS.length, 2, "expected two 0x0b11 dispatches within 2100 frames");
  assert.ok(CAPS.every((c) => c.regs.sp === 0x23fe), "both 0x0b11 dispatches enter at SP 0x23fe");
  assert.ok(CAPS.every((c) => c.mem.read8(TYPE_PACE_COUNT) !== 0x0a), "entry count differs from the seated 0x0a");
  CAPS.forEach((cap, i) => assertEqual(cap, `cap ${i}`));
});

test("CRAFTED: a dirty framebuffer under the table (every drawn byte must overwrite, not merge)", () => {
  const e = CAPS[0].clone();
  for (let a = 0x2400; a < 0x4000; a++) e.mem.write8(a, (a * 37) & 0xff);
  assertEqual(e, "dirty VRAM");
});

// Twin body with the header id count as a knob: columns=false skips the untimed 0x1dbe script.
function* twin(m, { ids = 0x15, columns = true } = {}) {
  drawSpriteList(m, SCORE_ADVANCE_TABLE_HEADER, ids, SHARED_TEXT_VRAM_DEST);
  m.mem8[TYPE_PACE_COUNT] = 0x0a;
  for (let p = SCORE_ADVANCE_DRAW_SCRIPT; columns && m.mem8[p] !== 0xff; p = (p + 4) & 0xffff) {
    fetchNextDrawRecord(m, p);
    drawSpriteColumn16(m);
  }
  yield* typeSecondDrawScript(m);
}

test("TEETH: the twin's faithful setting passes; short header / no columns / ghost stores diverge", () => {
  const e = CAPS[0];
  assert.equal(divergence(runOracle(e), runModule(e, (m) => twin(m))), null, "faithful twin must pass");
  for (const [name, opt] of [["shortHeader", { ids: 0x14 }], ["noColumns", { columns: false }]]) {
    assert.notEqual(divergence(runOracle(e), runModule(e, (m) => twin(m, opt))), null, `${name} twin passed`);
  }
  CAPS.forEach((c, i) => assert.notEqual(divergence(runOracle(c), runModule(c, ghost(drawScoreAdvanceTable))), null,
    `ghost twin passed on cap ${i}`));
});
