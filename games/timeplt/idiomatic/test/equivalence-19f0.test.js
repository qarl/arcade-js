// SPDX-License-Identifier: GPL-3.0-only
/**
 * resetPlayfieldForLifeStart — memory-equivalent to the frozen oracle at ROM 0x19F0.
 * GATE: strict unit-capture at the two real dispatches the coin -> start tape produces, masked over
 *   the dead stack scratch the frozen side leaves (it pushes below its seat and takes a return the
 *   rewrite does not, so SP drifts two and the window under the seat is scribbled); plus crafted
 *   entries that vary the era and seed the scatter/slot cells, and teeth with exact catch counts.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-19f0.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { resetPlayfieldForLifeStart } from "../resetPlayfieldForLifeStart.js";
import { loc_19f0 as oracle } from "../../translated/loc_19f0.js";

import { dressPlayerSpriteForHeading } from "../dressPlayerSpriteForHeading.js";
import { freeAllShotSlots } from "../freeAllShotSlots.js";
import { retireObjectAndHold } from "../retireObjectAndHold.js";
import { retireSlotIntoSharedCooldown } from "../retireSlotIntoSharedCooldown.js";
import { retireSlotIntoCooldown } from "../retireSlotIntoCooldown.js";
import { retireSlotAndSubPixel } from "../retireSlotAndSubPixel.js";
import { freeAndNumberEveryObjectSlot } from "../freeAndNumberEveryObjectSlot.js";
import { seatEraSceneryCodesThenSetAttributesAndRunScenery } from "../seatEraSceneryCodesThenSetAttributesAndRunScenery.js";
import { fetchTableWord } from "../fetchTableWord.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x19f0;
const DISPATCHES = 2;
const SP_DRIFT = 2;
const DATA_TOP = 0xadff;

const ERA_INDEX = 0xad04;
const ERA_SEED = 0xad0a;
const RECORD_TABLE = 0x1b04;
const BAND_SOURCE = 0xacc0;
const SENTINEL = 0x5a;
const ERAS = [0, 1, 2, 3, 4, 5];
const SCATTER = [0xa844, 0xa837, 0xa827, 0xa817, 0xa814, 0xacc1, 0xacc4, 0xa8c6, 0xa8d6, 0xa8e6, 0xa8f4, 0xa8f6];
const SLOT7 = [0xa950, 0xa953, 0xa955, 0xaa3a, 0xaa3a + 49];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function windowed(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  candidate(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let first = null;
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    first = { addr, a: da[i], b: db[i] };
    break;
  }
  return { first, low, seat, spDiff: a.regs.sp - b.regs.sp };
}

const diffAt = (candidate, machine) => windowed(candidate, machine).first;

let entries = null;
function capture() {
  if (entries) return entries;
  const out = [];
  const host = makeMachine(new Map([[TARGET, (mm) => { out.push(mm.clone()); return oracle(mm); }]]));
  const frames = host.runFrames(ENTRY_FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  entries = out;
  return entries;
}

/** A real entry with the era forced and the scatter/slot targets sentinelled, so a missing or
 * misdirected write is always visible rather than hidden by an already-matching cell. */
function crafted(era) {
  const m = capture()[0].clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[ERA_SEED] = (era * 7) & 0xff;
  for (const a of SCATTER) m.mem8[a] = SENTINEL;
  for (const a of SLOT7) m.mem8[a] = SENTINEL;
  return m;
}
const craftedAll = () => ERAS.map(crafted);

// ── twins ───────────────────────────────────────────────────────────────────────────────

/** The candidate body with knobs, so each twin is one wrong dial and nothing else. */
function runBody(m, { slots = 7, band = "shift", scatter = "full", clearEntries = true } = {}) {
  const { regs, mem8, mem16 } = m;
  mem16[0xa808] = 0;
  mem16[0xa80a] = 0;
  mem16[0xad06] = 0;
  mem8[0xad0d] = 0;
  mem8[0xa8f7] = 0;
  mem8[0xad05] = 0;
  mem8[0xa9d7] = mem8[0xa9d6];
  mem8[BAND_SOURCE] = mem8[0xad0a];
  mem8[0xaa81] = 0;
  mem8[0xacc6] = 0;
  mem8[0xa802] = 0x80;
  mem8[0xa801] = 0;
  mem8[0xa800] = 0xff;
  mem8[0xaa41] = 0x78;
  mem8[0xaa10] = 0x84;
  dressPlayerSpriteForHeading(m);
  freeAllShotSlots(m);
  retireObjectAndHold(m, 0xa8c0, 0xaa28);
  regs.ix = 0xa8e0;
  regs.iy = 0xaa2c;
  retireSlotIntoSharedCooldown(m);
  retireSlotIntoCooldown(m, 0xa8f0, 0xaa2e);
  let record = 0xa8f0;
  let entry = 0xaa2e;
  for (let i = 0; i < slots; i++) {
    retireSlotAndSubPixel(m, record, entry);
    record += 16;
    entry += 2;
  }
  freeAndNumberEveryObjectSlot(m);
  if (clearEntries) for (const off of [0, 2, 4, 6, 0x31, 0x33, 0x35, 0x37]) mem8[0xaa28 + off] = 0;
  seatEraSceneryCodesThenSetAttributesAndRunScenery(m);
  const shifted = band === "shift" ? (mem8[ERA_INDEX] & 0x0f) << 4 : mem8[ERA_INDEX] & 0x0f;
  regs.a = u8(mem8[BAND_SOURCE] + shifted);
  regs.hl = RECORD_TABLE;
  const src = fetchTableWord(m);
  if (scatter === "skip") return;
  mem8[0xa844] = mem8[src];
  mem8[0xa837] = mem8[src + 1];
  mem8[0xa827] = mem8[src + 2];
  if (scatter === "s3single") mem8[0xa817] = mem8[src + 3];
  else mem8[0xa814] = mem8[0xa817] = mem8[src + 3];
  mem8[0xacc1] = mem8[src + 4];
  mem8[0xacc4] = mem8[src + 5];
  mem8[0xa8c6] = mem8[src + 6];
  mem8[0xa8d6] = mem8[src + 7];
  mem8[0xa8e6] = mem8[src + 8];
  mem8[0xa8f4] = mem8[0xa8f6] = mem8[src + 9];
}

const brokenNoOp = () => {};
const brokenSkipScatter = (m) => runBody(m, { scatter: "skip" });
const brokenBandNoShift = (m) => runBody(m, { band: "noshift" });
const brokenOneSlotShort = (m) => runBody(m, { slots: 6 });
const brokenScatterOneCell = (m) => runBody(m, { scatter: "s3single" });

/** Each twin's exact catch count over the six crafted entries and the two real ones. bandNoShift
 * misses the crafted era whose low nibble is zero; the slot- and scatter-cell twins are invisible
 * on the real entries because those cells already hold what the routine would leave. */
const TWINS = [
  ["no-op", brokenNoOp, 6, 2],
  ["skip-scatter", brokenSkipScatter, 6, 2],
  ["band-no-shift", brokenBandNoShift, 5, 0],
  ["one-slot-short", brokenOneSlotShort, 6, 0],
  ["scatter-one-cell", brokenScatterOneCell, 6, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatches: masked dump identical, SP drifts exactly two", { skip }, () => {
  const es = capture();
  assert.equal(es.length, DISPATCHES, "the dispatch count moved");
  for (const e of es) {
    const r = windowed(resetPlayfieldForLifeStart, e);
    assert.equal(r.first, null, `a real dispatch diverged: ${show(r.first)}`);
    assert.equal(r.spDiff, SP_DRIFT, `the frozen side no longer re-seats two bytes higher (${r.spDiff})`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  }
  console.log(`  EQUAL: ${es.length} dispatches identical; window floor ${hex4(windowed(resetPlayfieldForLifeStart, es[0]).low)}`);
});

test("NOT VACUOUS: a no-op candidate FAILS on a real cell", { skip }, () => {
  const d = diffAt(brokenNoOp, capture()[0]);
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not a register");
  console.log(`  NOT VACUOUS: caught — ${show(d)}`);
});

test("CRAFTED: identical from every seeded era", { skip }, () => {
  for (const e of craftedAll()) {
    assert.equal(diffAt(resetPlayfieldForLifeStart, e), null, "a crafted era diverged");
  }
  console.log(`  CRAFTED: ${ERAS.length} eras identical`);
});

for (const [label, twin, craftedCount, realCount] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const onCrafted = craftedAll().filter((e) => diffAt(twin, e)).length;
    const onReal = capture().filter((e) => diffAt(twin, e)).length;
    assert.ok(onCrafted + onReal > 0, `every entry PASSED the ${label} twin`);
    assert.equal(onCrafted, craftedCount, `the ${label} twin's crafted catch count moved`);
    assert.equal(onReal, realCount, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: caught on ${onCrafted}/${ERAS.length} crafted, ${onReal}/${DISPATCHES} real`);
  });
}
