// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for typeDrawScript (0x183a, generator): walk the BC draw script, typing each 4-byte record via
// typeDrawScriptRecord, until a 0xff first byte. FRAME HOOK, identical on both arms: one frame = the real ISR pair
// (m.fireNmi, pc seated at the 0x0a9e wait head) + a RAM dump; the oracle fires it on each taken back-edge of the
// 0x0a9e vblank wait, the idiomatic arm at each yield (as runIdiomaticGame does). Cycle IRQs are off; the run ends
// at the oracle's `rc` / generator done. Compared: every per-frame dump + final RAM, minus only the cells the
// oracle's push16 wrote, whose last non-push stores are compared instead. The script cursor
// is the entry BC (the idiomatic `bc` argument).
// Also compared: the port/INTE log (port 6 aside) and the watchdog kick count, exactly. SP is asserted:
// the idiomatic arm leaves it untouched, the oracle ends at entry SP + 2 (its ret).
// LIVE-OUT: none. Callers: 0x0bc3 `call 0ab6` (mvi a / sta / lda) and the 0x1837 tail back to 0x0b14 `call 0ab6`;
// the carry `rc` leaves is dead (0ab6's `ana a` re-derives flags before any read).
// Run: node --test games/invaders/idiomatic/test/equivalence-183a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_183a as oracle } from "../../translated/loc_183a.js";
import { typeDrawScript } from "../typeDrawScript.js";
import { typeDrawScriptRecord } from "../typeDrawScriptRecord.js";
import { fetchNextDrawRecord } from "../fetchNextDrawRecord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { TYPE_PACE_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x183a;
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
// [0] = the 0x1837 fall-in (BC 0x1dcf, 4 records), [1] = finishAttractCycle 0x0bc0 (BC 0x1fa0, 2 records, count 0x12).
const CAPS = ROM_PRESENT ? capture(2, 1000) : [];

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
const runModule = (e, fn = typeDrawScript) => run(e, (m) => fn(m, m.regs.bc));

// Excluded from the RAM diff: only the cells the ORACLE's push16 wrote this run (return addresses and ISR-accepted
// PCs, which the idiomatic arm keeps in JS). At a VRAM entry SP these cells are displayed pixels, so each one's
// last non-push store is shadowed on both arms and compared instead: a plain store there cannot hide.
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

function assertEqual(entry, label) {
  const o = runOracle(entry), c = runModule(entry);
  const d = divergence(o, c);
  assert.equal(d, null, `${label}: ${JSON.stringify(d)}`);
  assert.deepEqual(c.io, o.io, `${label}: port/INTE log (port 6 aside)`);
  assert.equal(c.m.io.watchdogKicks, o.m.io.watchdogKicks, `${label}: watchdog kicks`);
  assert.equal(c.m.regs.sp, entry.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (entry.regs.sp + 2) & 0xffff, `${label}: oracle SP after its ret`);
  const glyphs = records(entry, entry.regs.bc) * (entry.mem.read8(TYPE_PACE_COUNT) || 256);
  assert.equal(c.dumps.length, 6 * glyphs, `${label}: 6 frames per glyph of every record`);
  if (glyphs) {
    const vram = (x) => x.mem.ram.subarray(0x400);
    assert.ok(vram(c.m).some((v, i) => v !== vram(entry)[i]), `${label}: no glyph landed (hollow run)`);
  }
}

function crafted(base, { bc, count }) {
  const e = base.clone();
  if (bc !== undefined) e.regs.bc = bc;
  if (count !== undefined) e.mem.write8(TYPE_PACE_COUNT, count);
  return e;
}

test("CAPTURE: real 0x183a dispatches (0x1dcf and 0x1fa0 scripts) -- per-frame RAM == oracle", () => {
  assert.deepEqual(CAPS.map((c) => c.regs.bc), [0x1dcf, 0x1fa0], "expected both real script entries");
  CAPS.forEach((cap, i) => assertEqual(cap, `cap ${i}`));
});

test("CRAFTED: empty script, single last record, counts 1 and 3 on both scripts", () => {
  assertEqual(crafted(CAPS[0], { bc: 0x1dce }), "empty (0xff at cursor)");
  assertEqual(crafted(CAPS[0], { bc: 0x1ddb }), "last record only");
  assertEqual(crafted(CAPS[0], { count: 1 }), "1dcf count 1");
  assertEqual(crafted(CAPS[1], { count: 3 }), "1fa0 count 3");
});

// Only 0xff ends a script (0x1857 `cpi 0xff`): a record whose dest low byte is 0xfe must still be typed.
const SCRIPT_RAM = 0x22f0;
test("CRAFTED: terminator boundary -- a 0xfe first byte is a record, not the end", () => {
  const e = crafted(CAPS[0], { bc: SCRIPT_RAM, count: 3 });
  const script = [0xfe, 0x25, 0x10, 0x1c, 0x10, 0x2a, 0x10, 0x1c, 0xff];
  script.forEach((v, i) => e.mem.write8(SCRIPT_RAM + i, v));
  assertEqual(e, "0xfe-led script");
  for (const arm of [runOracle(e).m, runModule(e).m]) {
    assert.deepEqual([...arm.mem.ram.subarray(SCRIPT_RAM - 0x2000, SCRIPT_RAM - 0x2000 + 9)], script, "script RAM clobbered");
  }
});

// Every non-0xff first byte is a record (one-record scripts, 0x00-0xfe); a 0x7f-led record and a record whose
// dest high byte is 0xff (0xff10 -> 0x3f10 VRAM under the 0x7fff mask and 0x4000 mirror) do not end the script.
test("CRAFTED: terminator sweep -- first bytes 0x00-0xfe, a 0x7f-led record and a 0xffxx dest", () => {
  for (let b = 0; b < 0xff; b++) {
    const e = crafted(CAPS[0], { bc: SCRIPT_RAM, count: 1 });
    [b, 0x25, 0x10, 0x1c, 0xff].forEach((v, i) => e.mem.write8(SCRIPT_RAM + i, v));
    assertEqual(e, `first byte 0x${b.toString(16)}`);
  }
  const e = crafted(CAPS[0], { bc: SCRIPT_RAM, count: 3 });
  [0x7f, 0x25, 0x10, 0x1c, 0x10, 0xff, 0x10, 0x1c, 0x20, 0x26, 0x10, 0x1c, 0xff]
    .forEach((v, i) => e.mem.write8(SCRIPT_RAM + i, v));
  assertEqual(e, "0x7f-led and 0xffxx-dest records");
});

function* firstOnly(m, bc) {
  if (m.mem8[bc] === 0xff) return;
  const rec = fetchNextDrawRecord(m, bc);
  yield* typeDrawScriptRecord(m, rec[1], rec[0]);
}
function* stride8(m, bc) {
  for (let p = bc; m.mem8[p] !== 0xff; p = (p + 8) & 0xffff) {
    const rec = fetchNextDrawRecord(m, p);
    yield* typeDrawScriptRecord(m, rec[1], rec[0]);
  }
}

test("TEETH: broken twins diverge (one record only, every other record, ghost stores into push cells)", () => {
  for (const [name, fn] of [["firstOnly", firstOnly], ["stride8", stride8]]) {
    assert.notEqual(divergence(runOracle(CAPS[0]), runModule(CAPS[0], fn)), null, `${name} twin passed`);
  }
  CAPS.forEach((e, i) => assert.notEqual(divergence(runOracle(e), runModule(e, ghost(typeDrawScript))), null,
    `ghost twin passed on cap ${i}`));
});
