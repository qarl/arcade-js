// SPDX-License-Identifier: GPL-3.0-only
/**
 * driveEnemyWaveForLifePhase vs the frozen oracle: natural dispatches, every decision branch crafted, and a full
 * occupancy sweep of the wave body, each masked for the dead stack scratch the dissolved tails leave
 * and held to a shadow-AF ceiling. The twins address the shape record themselves: the oracle reads its
 * second byte through the HL its rst 08 leaves on the entry, internal to this routine and no longer
 * returned by fetchTableByte; a TWIN CONTROL holds the defect-free twin caught nowhere. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-36af.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { driveEnemyWaveForLifePhase as candidate } from "../driveEnemyWaveForLifePhase.js";
import { loc_36af as oracle } from "../../translated/loc_36af.js";
import { u8, u16 } from "../../../../core/int.js";
import { drawRandomByte } from "../drawRandomByte.js";
import { offsetAddress } from "../offsetAddress.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { pickScriptAtRandomOrInTurn } from "../pickScriptAtRandomOrInTurn.js";
import { stepCraftFlightScript } from "../stepCraftFlightScript.js";
import { spawnEnemyWaveIntoFreeSlots } from "../spawnEnemyWaveIntoFreeSlots.js";
import { turnFiveCraftAway } from "../turnFiveCraftAway.js";
import { gateTheFreeSlotSearchAndPickItsRun } from "../gateTheFreeSlotSearchAndPickItsRun.js";
import { spawnEnemyCraftWhenBandUnderTwo } from "../spawnEnemyCraftWhenBandUnderTwo.js";
import { requestEnemyWaveSound } from "../requestEnemyWaveSound.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x36af;
const WAVE_HOLD = 0xacc6;
const ERA_INDEX = 0xad04;
const LIFE_PHASE = 0xad06;
const LIFE_TICKS_LOW = 0xad05;
const KILLS_REMAINING = 0xad02;
const CRAFT_SPAWN_SLOT_COUNT = 0xacc1;
const PLAYER_HEADING = 0xa802;
const WAVE_MARK = 0xacc2;
const STRIDE_INDEX = 0xacc3;
const FILLED_SLOTS = 0xa811;
const WAVE_STATUS = 0xa812;
const CRAFT_BAND = 0xa850;
const ENTRY_BAND = 0xaa1a;
const BIAS_TABLE = 0x38d9;
const DESCRIPTOR_TABLE = 0x397b;
const EDGE_POSITION_TABLE = 0x38e9;
const RECORD_STRIDE = 16;
const SLOTS = 5;
const PATTERNS = 1 << SLOTS;

// Every data write lands well below here; the seat sits above it, so masking the scratch can never
// hide a real byte. Asserted against the watched floor.
const DATA_TOP = 0xadff;
// The caller reads no register back from this routine, so all working registers are dead; only the
// shadow accumulator/flags, which nothing here touches, stay an invariant.
const EXCLUDED = REG_FIELDS.filter((k) => k !== "a_" && k !== "f_");

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── real dispatches ─────────────────────────────────────────────────────────────────────────────

let realCache = null;
const REAL_CAP = 120;
function real() {
  if (realCache) return realCache;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting && entries.length < REAL_CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  realCache = entries;
  return entries;
}

// ── the masked comparison ───────────────────────────────────────────────────────────────────────

function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const rO = oracle(a);
  let rC, threw = null;
  try { rC = cand(b); } catch (e) { threw = String(e).slice(0, 60); }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (threw || da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  let reg = null;
  if (!threw) {
    for (const k of REG_FIELDS) {
      if (EXCLUDED.includes(k)) continue;
      if (a.regs[k] !== b.regs[k]) { reg = { k, a: a.regs[k], b: b.regs[k] }; break; }
    }
  }
  return { escaped, reg, threw, low, seat, spDiff: a.regs.sp - b.regs.sp, rO, rC };
}
const diverges = (cand, m) => {
  const r = compare(cand, m);
  return !!(r.escaped || r.reg || r.threw || r.rO !== r.rC);
};

function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── crafted states ──────────────────────────────────────────────────────────────────────────────

function craft(o) {
  const c = real()[0].clone();
  c.mem8[WAVE_HOLD] = o.hold ?? 0;
  c.mem8[ERA_INDEX] = o.era ?? 0;
  c.mem8[LIFE_PHASE] = o.phase ?? 0x09;
  c.mem8[LIFE_TICKS_LOW] = o.low ?? 0;
  c.mem8[KILLS_REMAINING] = o.kills ?? 0;
  c.mem8[CRAFT_SPAWN_SLOT_COUNT] = o.round ?? SLOTS;
  if (o.hl !== undefined) c.regs.hl = o.hl;
  if (o.occ !== undefined) {
    for (let i = 0; i < SLOTS; i++) c.mem8[CRAFT_BAND + i * RECORD_STRIDE] = (o.occ >> i) & 1 ? 0xff : 0;
  }
  return c;
}

function occupancyStates() {
  const out = [];
  for (let occ = 0; occ < PATTERNS; occ++) out.push(craft({ occ }));
  return out;
}
// hold and lowNZ write nothing; the rest each write, and the last forces a stale HL past the seat.
const branches = () => [
  ["hold", craft({ hold: 1 })],
  ["era4", craft({ era: 4 })],
  ["phase7", craft({ phase: 0x07 })],
  ["phase8", craft({ phase: 0x08, occ: 0 })],
  ["lowNZ", craft({ phase: 0x09, low: 3 })],
  ["stale-hl", craft({ phase: 0x07, hl: EDGE_POSITION_TABLE })],
];
const corpus = () => [...occupancyStates(), ...branches().map(([, m]) => m)];

// ── broken twins ────────────────────────────────────────────────────────────────────────────────

// The rewrite with one deliberate defect, re-implemented so the defect governs the whole body.
function twin(opts) {
  const o = { respectHold: true, bossEra: 4, seatHl: true, clearMark: true, advanceDescriptor: true, ...opts };
  return function body(m) {
    const { regs, mem8 } = m;
    if (o.respectHold && mem8[WAVE_HOLD] !== 0) return;
    if (mem8[ERA_INDEX] === o.bossEra) return spawnEnemyWaveIntoFreeSlots(m);
    if (o.seatHl) regs.hl = LIFE_TICKS_LOW;
    const phase = mem8[LIFE_PHASE] & 0x0f;
    if (phase === 7) return turnFiveCraftAway(m);
    if (phase < 7) return gateTheFreeSlotSearchAndPickItsRun(m);
    if (phase < 9) return spawnEnemyCraftWhenBandUnderTwo(m);
    if (mem8[LIFE_TICKS_LOW] !== 0) return;

    const parityBit = drawRandomByte(m) & 1;
    mem8[WAVE_MARK] = 0xff;
    mem8[STRIDE_INDEX] = u8(2 * mem8[ERA_INDEX] + parityBit);
    const headingIndex = u8(mem8[PLAYER_HEADING] + 8) >> 4;
    regs.hl = BIAS_TABLE;
    regs.a = headingIndex;
    const bias = mem8[offsetAddress(m)];
    regs.a = u8(16 * mem8[STRIDE_INDEX]);
    regs.hl = DESCRIPTOR_TABLE;
    let descriptor = offsetAddress(m);

    const count = mem8[KILLS_REMAINING] !== 0 ? mem8[CRAFT_SPAWN_SLOT_COUNT] : SLOTS;
    mem8[FILLED_SLOTS] = 0;
    let record = CRAFT_BAND;
    let entry = ENTRY_BAND;
    let remaining = count;
    do {
      if (mem8[record] === 0) {
        // The oracle reads the second shape byte through the HL its rst 08 leaves on the entry, inside
        // this routine; fetchTableByte no longer hands that pointer back, so the twin addresses it.
        const index = u8(2 * (mem8[descriptor] + bias));
        const at = u16(EDGE_POSITION_TABLE + index);
        mem8[entry + 0x31] = fetchTableByte(m, EDGE_POSITION_TABLE, index);
        mem8[entry] = mem8[u16(at + 1)];
        const aimed = u8(mem8[PLAYER_HEADING] + 0x80);
        mem8[record + 0x01] = aimed;
        mem8[record + 0x02] = aimed;
        mem8[record + 0x0a] = u8(pickScriptAtRandomOrInTurn(m) + 9);
        mem8[record + 0x0e] = mem8[descriptor + 1];
        if (o.advanceDescriptor) descriptor = u16(descriptor + 2);
        mem8[record + 0x03] = 0;
        mem8[record + 0x05] = 0;
        mem8[record + 0x09] = 0x20;
        stepCraftFlightScript(m, record);
        mem8[record] = mem8[record + 0x0e] === 0 ? 0xff : 0xfe;
        mem8[FILLED_SLOTS] = u8(mem8[FILLED_SLOTS] + 1);
      }
      record = u16(record + RECORD_STRIDE);
      entry = u16(entry + 2);
      remaining = u8(remaining - 1);
    } while (remaining !== 0);

    mem8[WAVE_MARK] = o.clearMark ? 0 : 0xff;
    mem8[WAVE_STATUS] = 0xe4;
    const filled = mem8[FILLED_SLOTS];
    if (filled >= SLOTS) return requestEnemyWaveSound(m);
    const owed = mem8[CRAFT_SPAWN_SLOT_COUNT];
    mem8[FILLED_SLOTS] = owed;
    if (filled >= owed) return requestEnemyWaveSound(m);
  };
}

// The control for the register ceiling: scribbles the shadow accumulator the routine never touches.
function movesShadowA(m) {
  const r = candidate(m);
  m.regs.a_ = (m.regs.a_ + 1) & 0xff;
  return r;
}

const TWINS = [
  ["no-op", () => {}, 36],
  ["ignores-hold", twin({ respectHold: false }), 1],
  ["wrong-boss-era", twin({ bossEra: 5 }), 1],
  ["leaves-mark-set", twin({ clearMark: false }), 32],
  ["descriptor-frozen", twin({ advanceDescriptor: false }), 26],
  ["stale-hl-tails", twin({ seatHl: false }), 1],
];

function sweep(cand, states) {
  let caught = 0;
  for (const s of states) if (diverges(cand, s)) caught++;
  return caught;
}
function movedOver(cand, states) {
  const moved = new Set();
  for (const s of states) {
    const a = s.clone();
    const b = s.clone();
    oracle(a);
    try { cand(b); } catch { continue; }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────────

test("REAL: every natural dispatch replays identically, and some write", { skip }, () => {
  const entries = real();
  assert.ok(entries.length > 0, "vacuous: nothing dispatched this address");
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.threw, null, r.threw && `the candidate threw: ${r.threw}`);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    assert.equal(r.reg, null, r.reg && `register ${r.reg.k} diverged: ${r.reg.a} vs ${r.reg.b}`);
    assert.equal(r.rO, r.rC, "the return value diverged");
  }
  const wrote = entries.filter((e) => footprint(e) > 0).length;
  assert.ok(wrote > 0, "no natural dispatch makes the oracle write, so this arm would pass a no-op");
  console.log(`  REAL: ${entries.length} dispatches identical, ${wrote} of them write`);
});

test("PATHS: every decision branch replays, and the writing ones really write", { skip }, () => {
  const B = branches();
  for (const [name, m] of B) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${name}: escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.reg, null, `${name}: register ${r.reg && r.reg.k} diverged`);
    assert.equal(r.rO, r.rC, `${name}: the return value diverged`);
  }
  // ★ Vacuity guard: the held and lowNZ branches write nothing while the four handoffs each do, so a
  // rewrite that ignored the gate, the era or the phase could not pass all six.
  const fp = Object.fromEntries(B.map(([n, m]) => [n, footprint(m)]));
  assert.equal(fp.hold, 0, "the held gate wrote something");
  assert.equal(fp.lowNZ, 0, "the spent-tick branch wrote something");
  assert.ok(fp.era4 > 0 && fp.phase7 > 0 && fp.phase8 > 0 && fp["stale-hl"] > 0, "a handoff wrote nothing");
  console.log(`  PATHS: footprints ${JSON.stringify(fp)}`);
});

test("OCCUPANCY: all 32 free/busy patterns of the wave band replay, and vary", { skip }, () => {
  const states = occupancyStates();
  for (const s of states) {
    const r = compare(candidate, s);
    assert.equal(r.escaped, null, `escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.reg, null, `register ${r.reg && r.reg.k} diverged`);
  }
  const allFree = footprint(craft({ occ: 0 }));
  const allBusy = footprint(craft({ occ: PATTERNS - 1 }));
  assert.notEqual(allFree, allBusy,
    "a full band and an empty one move the same bytes, so the sweep is not reaching the decision the " +
      "slot heads drive and the patterns are decoration");
  console.log(`  OCCUPANCY: ${PATTERNS} patterns identical; all-free moves ${allFree}, all-busy ${allBusy}`);
});

test("SP AND RETURN: +2 re-seat on every path, mask floor over the data, returns equal", { skip }, () => {
  for (const s of corpus()) {
    const r = compare(candidate, s);
    assert.equal(r.spDiff, 2, "the oracle no longer pops exactly one return the rewrite leaves");
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
    assert.equal(r.rO, r.rC, "the return value diverged");
  }
  console.log("  SP: +2 on every path; window over the data; returns identical");
});

test("EXCLUDED, measured: nothing moves outside the ceiling, with a control that does", { skip }, () => {
  const states = corpus();
  const moved = movedOver(candidate, states);
  const control = movedOver(movesShadowA, states);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !EXCLUDED.includes(k)),
    "the measurement reports nothing even for a twin that scribbles the shadow accumulator, so a clean " +
      "reading here proves nothing");
  const unexpected = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: control moves ${REG_FIELDS.filter((k) => control.has(k) && !EXCLUDED.includes(k)).join(", ")}`);
});

test("TEETH CONTROL: the shadow-accumulator twin is caught on every crafted state", { skip }, () => {
  const states = corpus();
  assert.equal(sweep(movesShadowA, states), states.length, "the control twin slipped a state");
  console.log(`  TEETH CONTROL: caught on ${states.length}/${states.length}`);
});

test("TWIN CONTROL: the twin with no defect switched on is caught on no crafted state", { skip }, () => {
  // The twins address the shape record themselves (the rst 08 hand-off of HL is internal to the
  // oracle and no longer returned); this holds that base faithful, so each count below is its defect's.
  const states = corpus();
  assert.equal(sweep(twin({}), states), 0, "the defect-free twin diverged, so the twin counts measure the scaffold");
  console.log(`  TWIN CONTROL: the defect-free twin is caught on 0/${states.length}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted states`, { skip }, () => {
    const states = corpus();
    const caught = sweep(brokenTwin, states);
    assert.ok(caught > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught}/${states.length}`);
  });
}
