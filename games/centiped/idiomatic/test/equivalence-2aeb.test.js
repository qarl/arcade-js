// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2aeb (ROM 0x2aeb) vs the frozen translated oracle. The companion axis-delta
// integrator: it adds the incoming delta A (plus carry) into $63, parks the sum in $8b, and -- when the
// resolved tile cell at ($73, row 0) is empty -- clamps that sum into [$0b,$f4], else reloads $63 unchanged.
// It dissolves resolveTileCellAtXY, negateA and clampAndHalveSignedDelta; when the enable $86 is negative it
// RTSs, else it negates $bb, halves it, accumulates into $85 and falls through into loc_2b24 (kept as an
// m.call the spine dissolves) with A = the halved delta and the accumulate carry live.
//
// A takes the incoming register A and carry as params (the fall-through predecessor's live-outs), so the
// crafted arms seat regs.a / regs.fC. Two exit shapes, both seam-placeable (early-out omits its ROM ret ->
// SP unmoved; fall-through reaches it via loc_2b24's tail-transfer -> SP +2 on the caller slot). The clock is
// frozen to a constant origin so any POKEY read down the dispatched chain is deterministic on both sides.
// Run: node --test games/centiped/idiomatic/test/equivalence-2aeb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2aeb as oracleRom } from "../../translated/loc_2aeb.js";
import { loc_2aeb as integrate } from "../loc_2aeb.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_63, loc_73, MOVE_SUBSTEP_ACCUM_B, loc_86, loc_8b, loc_bb } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2aeb;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function pinClock(m) {
  m.mem.clock = () => 0;
  m.io.pokeyC0 = null;
  m.io.pokeyLastAccess = 0;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 4000) : [];

function seed({ a = 0x40, carry = false, m63 = 0x30, m73 = 0x20, m86 = 0x10, mbb = 0x22, m85 = 0x10 } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x0100 | ((0xfb + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfb + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.regs.a = a;
  m.regs.fC = carry;
  m.mem.write8(loc_63, m63);
  m.mem.write8(loc_73, m73);
  m.mem.write8(loc_86, m86);
  m.mem.write8(loc_bb, mbb);
  m.mem.write8(MOVE_SUBSTEP_ACCUM_B, m85);
  return pinClock(m);
}

test("CAPTURE: real 0x2aeb dispatches -- loc_2aeb == oracle in RAM (-stack, clock pinned)", () => {
  for (const cap of CAPS) {
    const o = pinClock(cap.clone());
    const c = pinClock(cap.clone());
    oracle(o);
    integrate(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (clock pinned)`);
});

test("CRAFTED: the clamp branches, both exit shapes, and the incoming carry == oracle", () => {
  const cases = [
    { tag: "fall-through, mid-range sum", a: 0x40, m86: 0x10 },
    { tag: "enable negative -> RTS", a: 0x40, m86: 0x80 },
    { tag: "sum below rail -> clamp to $0b", a: 0x05, m63: 0x02, m86: 0x10 },
    { tag: "sum above rail -> clamp to $f4", a: 0xf0, m63: 0x30, m86: 0x10 },
    { tag: "incoming carry bumps the sum", a: 0x40, carry: true, m86: 0x10 },
    { tag: "negative $bb negated + halved", a: 0x30, m86: 0x10, mbb: 0xc0, m85: 0x20 },
  ];
  for (const s of cases) {
    const o = seed(s);
    const c = seed(s);
    oracle(o);
    integrate(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
  console.log("  CRAFTED: loc_2aeb == oracle on 6 arms (clamp rails + both exit shapes)");
});

test("TEETH: a dropped $63 clamp store is caught by the RAM diff", () => {
  const s = { a: 0x05, m63: 0x30, m86: 0x10 }; // oracle rewrites $63 with the in-range clamped sum
  const o = seed(s);
  const c = seed(s);
  oracle(o);
  integrate(c);
  assert.equal(ramDiff(o, c), null, "precondition: loc_2aeb matches the oracle");
  assert.notEqual(o.mem.read8(loc_63), s.m63, "oracle rewrote $63 with the clamped sum");
  c.mem8[loc_63] = s.m63; // BUG: never stored the clamped sum into $63
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped $63 clamp store");
  assert.equal(d.addr, loc_63, "diff should be at the $63 clamp cell");
  console.log("  TEETH: dropped-clamp twin caught at $63");
});

test("SP-TOOTH: the fall-through tail-dispatch places; a net-adrift push pair is refused", () => {
  const r = seamPlaceable(withOmittedRet, integrate, TARGET, seed({ a: 0x40, m86: 0x10 }));
  assert.equal(r.placeable, true, `seam refused the tail-dispatch body: ${r.error}`);
  // +2 tail-dispatcher (loc_2b24's chain RTS pops the caller slot): a SINGLE stray push nets to moved 0 and
  // places vacuously; TWO unmatched pushes leave SP net -2 (moved 0xfe) -> refused.
  const strayPush = (m) => { integrate(m); m.push16(0x9999); m.push16(0x9999); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed({ a: 0x40, m86: 0x10 }));
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-TOOTH: tail-dispatch body placeable; stray-push mutant refused");
});
