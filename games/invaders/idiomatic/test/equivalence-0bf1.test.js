// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for updateFleetAndDrawCopyright (ROM 0x0bf1) -- run 0x190a then tail-jump into 0x199a. 0x190a is still
// frozen (same batch), so its m.call is KEPT (both sides invoke the identical translated 0x190a); the tail
// is DISSOLVED into drawTaitoCopyright (the idiomatic 0x199a). The kept call needs its push16 so 0x190a's
// tail-ret balances; the tail-jmp then collapses into a plain omitted-ret leaf -- the module leaves SP
// where it found it and the seam completes the ret (SP-TOOTH). Live-out is RAM only (its caller runAttractCycle
// re-drives registers). The oracle's + module's call/ret residue sits just below the entry SP and is
// excluded from the RAM diff. NOTE: when 0x190a lands, the LEAD dissolves the kept call to a direct
// idiomatic call (dropping the push16/addr cruft) and this test's kept-call arms move with it.
// Run: node --test games/invaders/idiomatic/test/equivalence-0bf1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bf1 as oracle } from "../../translated/loc_0bf1.js";
import { updateFleetAndDrawCopyright } from "../updateFleetAndDrawCopyright.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, INPUT_CODE_STAGE_FLAG, TAITO_COPYRIGHT_SCREEN_ADDR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0bf1;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
// Exclude stack scratch below the entry SP (the fixed window AND the call/ret residue just below SP).
const diffBelow = (sp) => (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
  (off) => ma.stateOffsetToAddr(off), (a) => deadStackBelow(STACK_SCRATCH, sp)(a) || (a != null && a >= sp - 0x20 && a < sp));

// Sum a run of screen bytes down a sprite column (stride 0x20) to prove the copyright limb painted.
function drawn(m, base, cols) {
  let acc = 0;
  for (let i = 0; i < cols; i++) acc |= m.mem.read8((base + i * 0x20) & 0xffff);
  return acc;
}

function seat(m) { m.regs.sp = 0x23fe; m.mem.write16(0x23fe, 0x0b77); m.io.setInte(false); }
// Force drawTaitoCopyright's paint path: stage flag already advanced, port-1 code == 0x34.
function seatPainting(m) { seat(m); m.mem.write8(INPUT_CODE_STAGE_FLAG, 1); m.io.in1 = 0x34; }

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0bf1 dispatches -- updateFleetAndDrawCopyright == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); updateFleetAndDrawCopyright(c);
    assert.equal(diffBelow(cap.regs.sp)(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: neutral state -- kept 0x190a + dissolved tail match the oracle in RAM", () => {
  const o = new Machine(ROM); seat(o);
  const c = new Machine(ROM); seat(c);
  oracle(o); updateFleetAndDrawCopyright(c);
  assert.equal(diffBelow(0x23fe)(o, c), null);
});

test("CRAFTED: painting state -- copyright drawn, still equal to the oracle", () => {
  const o = new Machine(ROM); seatPainting(o);
  const c = new Machine(ROM); seatPainting(c);
  oracle(o); updateFleetAndDrawCopyright(c);
  assert.equal(diffBelow(0x23fe)(o, c), null);
  const p = new Machine(ROM); seatPainting(p); updateFleetAndDrawCopyright(p);
  assert.notEqual(drawn(p, TAITO_COPYRIGHT_SCREEN_ADDR, 8), 0, "Taito copyright painted");
});

test("TEETH: a twin that drops the tail copyright draw diverges in the copyright region", () => {
  function updateFleetAndDrawCopyright_noTail(m) {
    m.push16(0x0bf4); m.call(0x190a);
    // BUG: drops the tail drawTaitoCopyright
  }
  const o = new Machine(ROM); seatPainting(o);
  const c = new Machine(ROM); seatPainting(c);
  oracle(o); updateFleetAndDrawCopyright_noTail(c);
  const d = diffBelow(0x23fe)(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped copyright draw");
  assert.ok(d.addr >= (TAITO_COPYRIGHT_SCREEN_ADDR & 0xffff) - 0x20,
    `divergence must be in the copyright region; got ${hx(d.addr ?? 0)}`);
});

test("SP-TOOTH: the kept-call omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM); seat(m);
  const r = seamPlaceable(withOmittedRet, updateFleetAndDrawCopyright, TARGET, m);
  assert.equal(r.placeable, true, `updateFleetAndDrawCopyright must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: kept-call omitted-ret leaf (moved 0) placeable");
});
