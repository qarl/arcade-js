// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for stageDigObjectSpriteRecord (ROM 0x2bd3) — publishes the dig object's
 * 4-byte sprite record into slot 2 of the staging buffer (0x8228) from the object's fields
 * (HAZARD_X, HAZARD_STATE, HAZARD_TYPE, HAZARD_Y), the leading coordinate byte biased down
 * and the trailing one biased up by the cabinet offset SPRITE_COORD_BIAS, then continues into the
 * per-frame background update 0x2f71 — now the decompiled advanceChamberCreature, called directly.
 *
 * OBSERVABLE-EQUIVALENCE CONTRACT. The background-update tail runs on BOTH arms — the oracle m.call's
 * the frozen registry copy, the idiomatic arm calls the imported advanceChamberCreature directly —
 * and the two are memory-equivalent (equivalence-2f71), from identical memory: the background update
 * loads everything fresh from RAM and never reads the dig record bytes or any incoming register, so
 * the two runs stay in lockstep (including the PRNG the background fall draws from, which advances
 * identically on both clones). So the gate compares OBSERVABLE RAM only via a dumpState diff. pc, SP
 * and the value registers are the declared-dead live-out and excluded; and because the oracle
 * marshals its tail through the Z80 stack while the stack-free idiomatic JS does not, the dead
 * stack scratch below the entry SP (within 0x8380..0x83ff) is excluded too.
 *
 * CRAFTED ENTRY. 0x2bd3 is never dispatched in a boot/attract run (the demo spawns no dig
 * object, so the target and dig-object fields all sit at 0 — a valid but non-discriminating
 * entry). Since the
 * record is a pure function of five RAM bytes, the gate runs it from real captured attract states
 * AND from a crafted arithmetic sweep that pokes those five bytes across the range including the
 * wrap edges (column < offset underflows the leading byte; row + offset overflows the trailing
 * byte), identically on both sides — that sweep is the load-bearing correctness evidence.
 *
 * FIVE checks:
 *   0. HARNESS — oracle vs oracle on real captured states is deterministic through the full
 *      0x2f71 tail (proves the compare plumbing and that the tail introduces no fork).
 *   1. EQUAL (real captured attract states) — idiomatic leaves the same whole RAM as the oracle.
 *   2. EQUAL (crafted arithmetic sweep, incl. wraps) — the four record bytes match the oracle
 *      across the input range; both biased ends wrap the same.
 *   3. NON-VACUOUS + WRITE-COMPLETE (sentinel entry) — with the four record bytes pre-set to a
 *      sentinel and nonzero inputs, every record byte is overwritten and both arms agree.
 *   4. TEETH — a twin that DROPS the offset on the leading byte (writes the raw column) MUST be
 *      caught at the record's leading byte; forced non-vacuous with a nonzero offset.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2bd3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bd3 as oracle } from "../../translated/loc_2bd3.js";
import { stageDigObjectSpriteRecord as idiomatic } from "../stageDigObjectSpriteRecord.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  HAZARD_X,
  HAZARD_STATE,
  HAZARD_TYPE,
  HAZARD_Y,
  SPRITE_COORD_BIAS,
  SPRITE_STAGING_BASE,
} from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const RECORD = SPRITE_STAGING_BASE + 8; // dig object's sprite-staging slot (slot 2 = base + 8)
const RECORD_ADDRS = [RECORD, RECORD + 1, RECORD + 2, RECORD + 3];
const INPUT_ADDRS = { bias: SPRITE_COORD_BIAS, x: HAZARD_X, state: HAZARD_STATE, attr: HAZARD_TYPE, y: HAZARD_Y };

// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead. The
// dissolved 0x2f71 tail (advanceChamberCreature) runs stack-free on the idiomatic side while the
// oracle marshals it through the Z80 stack, so those bytes differ and are excluded from the diff.
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Real attract machine states: run the game and clone it at a spread of frames. Each clone is
 * a genuine in-play machine (real RAM), independent of the source run, with its frame machinery
 * neutralised — safe to run the oracle's full chain (0x2bd3 -> 0x2f71) on.
 */
function captureStates(count, stride, startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  const caps = [];
  for (let i = 0; i < count; i++) {
    m.runFrames(stride);
    caps.push(m.clone());
  }
  return caps;
}

/** Run oracle and candidate on independent clones of `entry`; return the first differing RAM
 *  byte (or null). RAM only — pc/SP/value registers are the declared-dead live-out. */
function stateDiff(entry, fn) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  fn(b);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, entry.regs.sp)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Poke the five input bytes identically, returning a fresh entry clone. */
function withInputs(base, { bias, x, state, attr, y }) {
  const e = base.clone();
  e.mem.write8(INPUT_ADDRS.bias, bias);
  e.mem.write8(INPUT_ADDRS.x, x);
  e.mem.write8(INPUT_ADDRS.state, state);
  e.mem.write8(INPUT_ADDRS.attr, attr);
  e.mem.write8(INPUT_ADDRS.y, y);
  return e;
}

// -- 0. HARNESS: oracle vs oracle deterministic through the full 0x2f71 tail ---

test("HARNESS: the oracle run of 0x2bd3 (through the 0x2f71 tail) is deterministic on real states", () => {
  const caps = captureStates(6, 90, 90);
  assert.ok(caps.length >= 1, "expected at least one captured attract state");
  for (const cap of caps) {
    const a = cap.clone();
    oracle(a);
    const b = cap.clone();
    oracle(b);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `oracle not deterministic: diff at ${hx(d.addr ?? 0)} (a=${d.a} b=${d.b})`);
  }
  console.log(`  HARNESS: oracle run deterministic through the 0x2f71 tail over ${caps.length} real states`);
});

// -- 1. EQUAL over real captured attract states -------------------------------

test("EQUAL: stageDigObjectSpriteRecord leaves the same RAM as the oracle over real captured attract states", () => {
  const caps = captureStates(10, 90, 90);
  assert.ok(caps.length >= 1, "expected at least one captured attract state");
  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL: ${caps.length} real captured attract states — RAM identical to the oracle`);
});

// -- 2. EQUAL over a crafted arithmetic sweep (incl. wrap edges) --------------

test("EQUAL (crafted): the biased ends match the oracle across the input range, including wraps", () => {
  const [base] = captureStates(1, 1, 200);

  const values = [0, 1, 2, 5, 15, 16, 63, 64, 127, 128, 200, 254, 255];
  let n = 0;
  for (const bias of values) {
    for (const x of values) {
      for (const y of values) {
        // state/attr fixed here (pure copy-through); their variation is covered by the
        // sentinel check and the real-state sweep. This grid stresses both biased ends' wrap.
        const e = withInputs(base, { bias, x, state: 0x30, attr: 0x06, y });
        const d = stateDiff(e, idiomatic);
        assert.equal(
          d,
          null,
          d && `bias=${bias} x=${x} y=${y}: diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`,
        );
        n++;
      }
    }
  }

  // And a targeted check that the copy-through bytes (state, attr) track their sources too.
  for (const state of values) {
    for (const attr of values) {
      const e = withInputs(base, { bias: 7, x: 100, state, attr, y: 100 });
      const d = stateDiff(e, idiomatic);
      assert.equal(d, null, d && `state=${state} attr=${attr}: diff at ${hx(d.addr ?? 0)}`);
      n++;
    }
  }
  console.log(`  EQUAL/crafted: ${n} input combinations identical to the oracle (both ends wrap correctly)`);
});

// -- 3. NON-VACUOUS + WRITE-COMPLETE (sentinel entry) -------------------------

test("NON-VACUOUS: with every record byte pre-set to a sentinel, both arms overwrite all four and agree", () => {
  // Pick inputs whose built record bytes are all != the sentinel, so "overwritten" is observable.
  const [seed] = captureStates(1, 1, 220);
  const entry = withInputs(seed, { bias: 3, x: 40, state: 0x10, attr: 0x07, y: 40 });
  const SENTINEL = 0x55;
  for (const addr of RECORD_ADDRS) entry.mem.write8(addr, SENTINEL);

  const a = entry.clone(); // oracle
  const b = entry.clone(); // idiomatic
  oracle(a);
  idiomatic(b);

  for (const addr of RECORD_ADDRS) {
    assert.notEqual(b.mem.read8(addr), SENTINEL, `idiomatic left ${hx(addr)} unwritten (still the sentinel)`);
  }
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log(`  NON-VACUOUS: all ${RECORD_ADDRS.length} record bytes overwritten from the sentinel, arms agree`);
});

// -- 4. TEETH: an offset-dropping twin MUST be caught -------------------------

/** Broken twin: builds the record and runs the tail, but forgets the offset on the leading byte. */
function brokenLoc2bd3(m) {
  idiomatic(m); // writes the record (offset applied) then runs the 0x2f71 tail
  m.mem.write8(RECORD, m.mem.read8(HAZARD_X)); // BUG: leading byte should be column - offset
}

test("TEETH: a twin that drops the offset on the leading byte is CAUGHT", () => {
  const [seed] = captureStates(1, 1, 250);
  // Nonzero offset so column - offset != column, guaranteeing the twin diverges. The tail does
  // not overwrite the record bytes, so the corrupted leading byte survives to the diff.
  const entry = withInputs(seed, { bias: 9, x: 120, state: 0x30, attr: 0x06, y: 120 });

  const d = stateDiff(entry, brokenLoc2bd3);
  assert.notEqual(d, null, "the gate FAILED to catch an offset-dropping twin — it proves nothing");
  assert.equal(d.addr, RECORD, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(RECORD)})`);

  // and the correct routine is still EQUAL on the very same entry
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH: offset-dropping twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
