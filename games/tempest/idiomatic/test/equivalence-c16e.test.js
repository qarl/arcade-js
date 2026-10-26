// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildLevelLayout (ROM 0xc16e-0xc1c2) -- a CALLER that dissolves jsr $aa13 and jsr $c235
// into direct idiomatic calls, then primes flags and unpacks a clamped $c1fd table entry into the four
// per-column arrays. Live-out is RAM plus the exit [X, Y] it returns (table index, 0xff), so each arm compares RAM
// (dumpState minus stack scratch below the entry SP) and the CAPTURE arm also the returned pair. The
// sub-calls can read POKEY random on some states, so CRAFTED runs both arms on clones of one seeded base
// (poly-frozen); CAPTURE clones each real dispatch. Caller: the module omits the ROM ret, seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-c16e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c16e } from "../../translated/loc_c16e.js";
import { buildLevelLayout } from "../buildLevelLayout.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc16e;
const oracle = atEntry(loc_c16e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc16e dispatches -- buildLevelLayout == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(buildLevelLayout(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// $9f=0x30 -> mask 0x30 -> keep -> >>1 = 0x18 -> |0x07 = 0x1f: the down-loop reads $c1fd+0x1f..+0x18.
function seed(m) {
  m.mem.write8(0x9f, 0x30);
  m.mem.write8(0x0133, 0x00); // clear path -> writes $5800
}

test("CRAFTED: flags primed, header bytes mirrored, table entry unpacked", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o); buildLevelLayout(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.mem.read8(0x5e), 0x80, "$5e primed");
  assert.equal(c.mem.read8(0x0114), 0xff, "$0114 primed");
  assert.equal(c.mem.read8(0x0133), 0x00, "$0133 reset");
  assert.equal(c.mem.read8(0x2000), c.mem.read8(0xcec6), "$2000 = $cec6");
  assert.equal(c.mem.read8(0x2001), c.mem.read8(0xcec7), "$2001 = $cec7");
  const packed = c.mem.read8(0xc1fd + 0x1f); // idx at y=7
  assert.equal(c.mem.read8(0x0020), packed & 0x0f, "$0019+7 low nibble");
  assert.equal(c.mem.read8(0x0028), packed >> 4, "$0021+7 high nibble");
  // 0x0800-0x080F is WRITE-ONLY color RAM (reads throw UnmappedAccess); check it via its device.
  assert.equal(c.mem.io.colorram[0x07], packed & 0x0f, "$0800+7 low nibble");
  assert.equal(c.mem.io.colorram[0x0f], packed >> 4, "$0808+7 high nibble");
});

test("TEETH: a twin that skips the $0114 prime and the table unpack diverges from the oracle", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o);
  const broken = (_m) => { /* BUG: never primes flags nor unpacks the table */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped setup");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildLevelLayout, TARGET, m);
  assert.equal(r.placeable, true, `buildLevelLayout must be seam-placeable; got: ${r.error}`);
});
