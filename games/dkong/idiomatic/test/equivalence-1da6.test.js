// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for writeMarioSpriteRecord (ROM 0x1da6) — the movement-machine
 * tail that copies Mario's live fields into his 4-byte hardware sprite record.
 *
 * The routine WRITES MEMORY (the 4 bytes 0x694C..0x694F) and ends in a `ret`, so it is
 * gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * register file (its live-out is memory-only; see the routine header), and every case
 * runs on a FRESH clone (a reused clone is only safe for a read-only leaf; this writes).
 * The idiomatic routine models the Z80 `ret` as a JS return and touches no pc/SP, so the
 * harness performs ONE m.ret() on the candidate clone after the call to line pc + SP up
 * with the oracle (the oracle's `ret` at 0x1dbc pops the caller's return; that pop reads
 * bytes in STACK_SCRATCH, excluded by the contract).
 *
 *   1. EQUAL (real dispatches) — hook 0x1da6 in a real attract run (the 25m demo walks
 *      Mario, so the mover's tail dispatches here every processed frame) and clone the
 *      machine at each true dispatch. oracle vs candidate must agree on RAM + pc + SP for
 *      every one. Because the routine is one straight-line arm, real captures ARE its full
 *      behavioural coverage; they also vary MARIO_X / MARIO_SPRITE_CODE / MARIO_Y as Mario
 *      moves, exercising the field-to-slot mapping on live data.
 *
 *   2. EQUAL (crafted source bytes) — from a real captured state, poke the four source
 *      fields to distinct sentinel values (incl. a case where every field differs and a
 *      case where X == Y) so the exact source->slot mapping is pinned even for fields that
 *      barely vary in attract (MARIO_SPRITE_ATTR is a constant 2 in play). Each compared
 *      identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a sorted-source copy — reads the four source bytes in ADDRESS order
 *          (0x6203,0x6205,0x6207,0x6208 -> slots +0..+3), the exact mis-order the oracle
 *          header warns against; diverges whenever code != attr or code != Y.
 *      (b) a dropped-Y copy — writes MARIO_X into slot +3 instead of MARIO_Y (a plausible
 *          copy-paste slip); diverges whenever X != Y.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1da6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1da6 as oracle } from "../../translated/loc_1da6.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, MARIO_SPRITE_ATTR, MARIO_SPRITE_RECORD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1da6;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. Its `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/**
 * Hook 0x1da6 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Every caller reaches 0x1da6 by `m.call(0x1da6)`, which resolves through
 * the routine registry the override overlays, so every dispatch is captured here.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured state with the four source fields poked to sentinels + a safe SP. */
function craft(seed, { x, code, attr, y }) {
  const e = seed.clone();
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_SPRITE_CODE, code);
  e.mem.write8(MARIO_SPRITE_ATTR, attr);
  e.mem.write8(MARIO_Y, y);
  e.regs.sp = 0x6bfe; // the ret's pop lands in STACK_SCRATCH, well clear of work RAM
  return e;
}

/** Broken twin (a): SORTED-source copy — reads the four source bytes in address order
 *  (0x6203,0x6205,0x6207,0x6208) into slots +0..+3, the exact mis-order the oracle warns
 *  against. Slots +1..+3 get Y/code/attr instead of code/attr/Y. */
function brokenSortedSource(m) {
  const { mem } = m;
  mem.write8(MARIO_SPRITE_RECORD + 0, mem.read8(MARIO_X));           // ok
  mem.write8(MARIO_SPRITE_RECORD + 1, mem.read8(MARIO_Y));           // BUG: Y where code belongs
  mem.write8(MARIO_SPRITE_RECORD + 2, mem.read8(MARIO_SPRITE_CODE)); // BUG: code where attr belongs
  mem.write8(MARIO_SPRITE_RECORD + 3, mem.read8(MARIO_SPRITE_ATTR)); // BUG: attr where Y belongs
}

/** Broken twin (b): DROPPED-Y copy — writes MARIO_X into slot +3 instead of MARIO_Y (a
 *  copy-paste slip that forgets to switch the source). Diverges whenever X != Y. */
function brokenDropY(m) {
  const { mem } = m;
  mem.write8(MARIO_SPRITE_RECORD + 0, mem.read8(MARIO_X));
  mem.write8(MARIO_SPRITE_RECORD + 1, mem.read8(MARIO_SPRITE_CODE));
  mem.write8(MARIO_SPRITE_RECORD + 2, mem.read8(MARIO_SPRITE_ATTR));
  mem.write8(MARIO_SPRITE_RECORD + 3, mem.read8(MARIO_X));           // BUG: X, not MARIO_Y
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): writeMarioSpriteRecord == oracle on every captured 0x1da6 entry", () => {
  const caps = captureDispatches(256, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1da6 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, writeMarioSpriteRecord); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const xs = new Set(caps.map((c) => hx(c.mem.read8(MARIO_X))));
  const ys = new Set(caps.map((c) => hx(c.mem.read8(MARIO_Y))));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(distinct MARIO_X: ${xs.size}, distinct MARIO_Y: ${ys.size})`,
  );
});

// -- 2. EQUAL (crafted source bytes) ------------------------------------------

test("EQUAL (crafted): distinct-sentinel source bytes pin the exact field-to-slot mapping", () => {
  const caps = captureDispatches(1, 2000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "all four fields distinct", e: craft(seed, { x: 0x11, code: 0x22, attr: 0x33, y: 0x44 }) },
    { name: "X == Y, code != attr", e: craft(seed, { x: 0x55, code: 0x88, attr: 0x99, y: 0x55 }) },
    { name: "code == Y (would hide a sorted-source swap on slot+1 vs +3)", e: craft(seed, { x: 0x01, code: 0x77, attr: 0x02, y: 0x77 }) },
    { name: "extremes 0x00 / 0xff", e: craft(seed, { x: 0x00, code: 0xff, attr: 0x00, y: 0xff }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, writeMarioSpriteRecord);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} distinct-sentinel entries identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the sorted-source copy and the dropped-Y copy are CAUGHT", () => {
  const caps = captureDispatches(256, 2000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // Craft an entry where all four fields differ, so BOTH twins must diverge on it.
  const distinct = craft(seed, { x: 0x11, code: 0x22, attr: 0x33, y: 0x44 });

  const sorted = contractDiffs(distinct, brokenSortedSource);
  const dropY = contractDiffs(distinct, brokenDropY);
  assert.ok(sorted.length > 0, "the sorted-source copy escaped on the all-distinct entry — the gate is worthless");
  assert.ok(dropY.length > 0, "the dropped-Y copy escaped on the all-distinct entry — the gate is worthless");

  // And confirm each is caught on the real dispatches where the relevant fields differ,
  // not merely on the crafted one.
  const sortedReal = caps.filter((c) => {
    const code = c.mem.read8(MARIO_SPRITE_CODE), attr = c.mem.read8(MARIO_SPRITE_ATTR), y = c.mem.read8(MARIO_Y);
    return code !== y || code !== attr;                 // sorted-source shows when +1/+2/+3 change
  });
  const dropYReal = caps.filter((c) => c.mem.read8(MARIO_X) !== c.mem.read8(MARIO_Y));
  let caughtSorted = 0, caughtDropY = 0;
  for (const c of sortedReal) if (contractDiffs(c, brokenSortedSource).length > 0) caughtSorted++;
  for (const c of dropYReal) if (contractDiffs(c, brokenDropY).length > 0) caughtDropY++;
  assert.equal(caughtSorted, sortedReal.length,
    `sorted-source escaped on ${sortedReal.length - caughtSorted}/${sortedReal.length} real dispatches where fields differ`);
  assert.equal(caughtDropY, dropYReal.length,
    `dropped-Y escaped on ${dropYReal.length - caughtDropY}/${dropYReal.length} real dispatches where X != Y`);

  console.log(
    `  TEETH: sorted-source caught on the crafted entry (${sorted[0]}) and all ${sortedReal.length} real fields-differ dispatches; ` +
      `dropped-Y caught on the crafted entry (${dropY[0]}) and all ${dropYReal.length} real X!=Y dispatches`,
  );
});
