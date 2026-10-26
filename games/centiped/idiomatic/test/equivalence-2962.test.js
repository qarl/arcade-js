// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for moveCentipedeSegment (ROM 0x2962) -- the per-segment centipede mover. It reads
// the phase byte $34+X, advances it on even $00 frames, re-seeds the $44/$74 deltas on the home column,
// then runs the wall / edge / neighbour tests. Every exit is a tail transfer to a sibling step handler
// (0x2ac7 / 0x2a92 / 0x2aa6 / 0x2a90), all kept as cyclic m.calls until merge; the dissolved callees
// (loadObjectTileInputs, resolveTileCellAtXY, detectColumnCollision, foldSignedMagnitude, negateA) run
// as direct JS. Dispatching: oracle and rewrite both run the full chain (which recurses through the
// whole segment sweep), so equivalence is the RAM diff (minus stack scratch below the entry SP). pokeyRandom is neutralised:
// the sweep's clock-derived RNG would otherwise diverge under the idiomatic layer's cycle-free execution.
// Run: node --test games/centiped/idiomatic/test/equivalence-2962.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2962 as oracleRom } from "../../translated/loc_2962.js";
import { moveCentipedeSegment } from "../moveCentipedeSegment.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_34 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2962;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const neutralize = (m) => { m.io.pokeyRandom = () => 0xff; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(32, 3000) : [];

// Seed a fresh machine: regs.x = s.x, plus each { addr: value } in s.cells.
function seed(m, s) {
  m.regs.x = s.x ?? 0;
  m.mem.write8(0x01fe, 0x00); m.mem.write8(0x01ff, 0x30); // a plausible caller-return word for the tail chain
  for (const [addr, val] of Object.entries(s.cells ?? {})) m.mem.write8(Number(addr), val);
  return m;
}

test("CAPTURE: real 0x2962 dispatches -- moveCentipedeSegment == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = neutralize(cap.clone()), c = neutralize(cap.clone());
    oracle(o); moveCentipedeSegment(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: exits and interior branches across the mover == oracle", () => {
  const cases = [
    // negative phase -> straight to the wrap/dec tail (0x2ac7)
    { tag: "negative phase -> 0x2ac7", x: 0x0b, cells: { 0x3f: 0x80 } },
    // phase bit6 set -> short distance ($63-$64) folds under 8 -> plain step tail (0x2a92)
    { tag: "distance < 8 -> 0x2a92", x: 0x00, cells: { 0x34: 0x40, 0x64: 0x00, 0x63: 0x00, 0xf0: 0x00, 0x88: 0x00, 0x94: 0x00 } },
    // phase bit6 set -> large distance -> edge handler
    { tag: "distance >= 8 -> edge", x: 0x00, cells: { 0x34: 0x40, 0x64: 0x00, 0x63: 0x20, 0xf0: 0x00, 0x88: 0x00, 0x94: 0x00 } },
    // home-column reseed of $44/$74 to +/-2 (both signs)
    { tag: "home-column reseed", x: 0x00, cells: { 0x34: 0x00, 0x64: 0x00, 0xf0: 0x00, 0x88: 0x00, 0x94: 0x01, 0x44: 0x81, 0x74: 0x01 } },
    // masked!=0 -> edge -> forward branch, key>=9 -> store-and-step, $ef!=0 -> ADD
    { tag: "store add ($ef!=0)", x: 0x00, cells: { 0x34: 0x00, 0x64: 0x0a, 0xf0: 0x00, 0x74: 0x05, 0xef: 0x01 } },
    // same route, $ef==0 -> SUBTRACT
    { tag: "store sub ($ef==0)", x: 0x00, cells: { 0x34: 0x00, 0x64: 0x0a, 0xf0: 0x00, 0x74: 0x05, 0xef: 0x00 } },
    // forward-edge neighbour-fold loop: current slot passes, neighbour slot folded (cell<9 write path)
    { tag: "neighbour-fold loop write", x: 0x05, cells: {
        0xf0: 0x00, 0x39: 0x00, 0x69: 0x03, 0x79: 0x05,
        0x3a: 0x40, 0x3b: 0x00, 0x6a: 0x02, 0x46: 0x81, 0x7a: 0x11 } },
    // near-edge $97 flag write (phase < 0x10, low nibble < 9)
    { tag: "near-edge $97 flag", x: 0x00, cells: { 0x34: 0x02, 0x64: 0x00, 0xf0: 0x00, 0x88: 0x00, 0x94: 0x00, 0x54: 0x00, 0x74: 0x00 } },
  ];
  for (const s of cases) {
    const o = neutralize(new Machine(ROM)); seed(o, s);
    const c = neutralize(new Machine(ROM)); seed(c, s);
    oracle(o); moveCentipedeSegment(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped phase increment is caught by the RAM diff", () => {
  // even $00 frame, phase 0 -> oracle bumps $34+X to 1 and the run exits without touching it again.
  const s = { x: 0x0b, cells: { 0x00: 0x00, 0x3f: 0x00, 0x5f: 0x00, 0x7f: 0x00, 0x4f: 0x00, 0x6f: 0x00, 0xf0: 0x00, 0x88: 0x00, 0x94: 0x00 } };
  const o = neutralize(new Machine(ROM)); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[(loc_34 + 0x0b) & 0xff], 0x01, "precondition: oracle advanced the phase to 1");
  const brokenPhase = 0x00; // BUG: never advanced the phase
  assert.notEqual(brokenPhase, o.mem8[(loc_34 + 0x0b) & 0xff], "the RAM diff FAILED to catch a skipped phase bump");
});

test("SP-TOOTH: the dispatching mover is seam-placeable", () => {
  const m = ROM_PRESENT ? neutralize(CAPS[0].clone()) : new Machine(ROM);
  const r = seamPlaceable(withOmittedRet, moveCentipedeSegment, TARGET, m);
  assert.equal(r.placeable, true, `moveCentipedeSegment must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: mover dispatch placeable");
});
