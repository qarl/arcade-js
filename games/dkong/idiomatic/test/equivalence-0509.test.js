// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for blinkSpritePairByX (ROM 0x0509) — the bit-6-clear arm of the
 * rivet-board colour-cycle blink block: read the player X (MARIO_X, 0x6203) and route the
 * decorative-sprite-pair blink to loc_04f9 "blink OFF" when X >= 0x80 (right half) or
 * loc_04e1 "blink ON" when X < 0x80 (left half).
 *
 * loc_0509 is a pure two-way DISPATCHER. Its only own effect is the branch on 0x6203; the
 * memory it leaves is entirely the taken arm's {0x6901, 0x6905} (both arms write both
 * bytes) — bit 7 forced clear on the OFF arm, set on the ON arm — so the two arms ALWAYS
 * differ in bit 7 of the result and the branch is observable on every input. It is
 * validated memory-equivalent to the frozen oracle (RAM minus the stack scratch below the entry SP; never the
 * full register file, never cycles):
 *
 *   loc_0509 is NOT reached in attract (0 dispatches / 6000 frames: it needs the 100m
 *   rivet board, BOARD 0x6227 == 4, which attract never reaches). So — exactly as its two
 *   callees are gated — realistic bases are captured at the store tail 0x04ac (reached
 *   ~1500x/attract) and loc_0509 entries are CRAFTED on them:
 *
 *   1. CRAFTED + FOOTPRINT (real attract bases) — over a matrix of MARIO_X (below, AT, and
 *      above the 0x80 boundary), the two blink bytes, and the sweep counter C (non-toggle
 *      + toggle phase), on each real base: (a) the oracle's write footprint ⊆ {0x6901,
 *      0x6905}; (b) ARMS EXERCISED — X >= 0x80 clears bit 7 on both bytes, X < 0x80 sets it
 *      (both arms reached); (c) REALISM — a fresh-clone whole-machine RAM diff (minus dead
 *      stack) between the oracle and blinkSpritePairByX is empty.
 *
 *   2. TEETH — a boundary-flipped twin (`>` instead of `>=`) mis-routes ONLY at X == 0x80
 *      (OFF vs ON) and so agrees everywhere else; the same crafted matrix (which includes
 *      X == 0x80) MUST catch it. Proves the boundary is genuinely exercised.
 *
 * The oracle side runs the pure frozen chain: on a bare-registry clone, the oracle
 * loc_0509's `m.call(0x04f9|0x04e1)` resolves to the translated callees and their tail
 * `m.call(0x04ac)` to translated loc_04ac (the capture hook delegates to it once caps are
 * full). The candidate calls the already-idiomatic callees directly — both proven
 * memory-equivalent, so any RAM diff is loc_0509's own branch logic.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0509.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0509 as oracle } from "../../translated/loc_0509.js";
import { loc_04ac as oracle04ac } from "../../translated/loc_04ac.js";
import { blinkSpritePairByX } from "../blinkSpritePairByX.js";
import { blinkSpritePairOff } from "../blinkSpritePairOff.js"; // ROM 0x04f9
import { blinkSpritePairOn } from "../blinkSpritePairOn.js"; // ROM 0x04e1
import { Machine } from "../../machine.js";
import { MARIO_X, SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

// The store tail 0x04ac IS reached in attract; loc_0509 (which routes into the blink arms
// that feed it) is not. So we capture realistic bases at 0x04ac and craft loc_0509 entries.
const CAPTURE_TARGET = 0x04ac;
const SPRITE0_CODE = SPRITE_BUFFER + 1; // 0x6901 — record #0's code byte
const SPRITE1_CODE = SPRITE_BUFFER + 5; // 0x6905 — record #1's code byte

// A valid stack-scratch SP so the oracle's terminal `ret`s (through the blink arm + store
// tail) pop mapped bytes. It lives in STACK_SCRATCH, which the RAM diff excludes, and is
// set identically on both sides.
const SAFE_SP = 0x6bfe;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- whole-machine plumbing ---------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
 * demands a fresh clone per side) and diff RAM outside the dead stack.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/** Every RAM addr (outside the stack scratch below the entry SP) whose byte the oracle changed on `entry`. */
function oracleWriteFootprint(entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const m = entry.clone();
  const before = m.dumpState();
  oracle(m);
  const after = m.dumpState();
  const addrs = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    addrs.push(addr);
  }
  return addrs;
}

/**
 * Hook 0x04ac in a real attract run and clone the machine at up to K real dispatches —
 * realistic bases whose sprite buffer and colour-cycle counter are genuine in-play states.
 * The wrapper snapshots the entry state, then runs the store tail's oracle DIRECTLY (not
 * via the now-overridden registry) so the host game proceeds undisturbed to a clean stop
 * and self-recursion is avoided.
 */
function captureBases(K, maxFrames) {
  const caps = [];
  const overrides = new Map([[CAPTURE_TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle04ac(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return caps;
}

// The crafted matrix. MARIO_X spans both screen halves AND the exact 0x80 boundary (both
// sides of the `cp 0x80` and the boundary value itself). The blink bytes cover bit-7
// set/clear so the ON/OFF arms are distinguishable. C covers a non-toggle value and the
// store tail's toggle phase ((C & 0x47) == 0x40).
const XS = [0x00, 0x40, 0x7f, 0x80, 0x81, 0xb3, 0xff];
const V1S = [0x00, 0x7f, 0x80, 0xff];
const V5S = [0x00, 0x03, 0x7f, 0x80, 0x83, 0xff];
const CS = [0x00, 0x40, 0xc0]; // non-toggle + two toggle-phase counters

/** Build one crafted loc_0509 entry on a real base. */
function craftEntry(base, x, v1, v5, c) {
  const entry = base.clone();
  entry.mem.write8(MARIO_X, x);
  entry.mem.write8(SPRITE0_CODE, v1);
  entry.mem.write8(SPRITE1_CODE, v5);
  entry.regs.c = c;
  entry.regs.sp = SAFE_SP;
  return entry;
}

// -- 1. CRAFTED + FOOTPRINT (real attract bases) ------------------------------

test("CRAFTED + FOOTPRINT: crafted loc_0509 entries on real attract states — footprint ⊆ {0x6901,0x6905}, both arms exercised, whole-machine identical", () => {
  const bases = captureBases(6, 3000);
  assert.ok(bases.length >= 1, "expected at least one real 0x04ac dispatch to use as a realistic base");

  let cases = 0;
  let sawOff = 0; // X >= 0x80 -> blink OFF taken
  let sawOn = 0; //  X <  0x80 -> blink ON  taken
  for (const base of bases) {
    for (const x of XS) {
      for (const c of CS) {
        for (const v1 of V1S) {
          for (const v5 of V5S) {
            const entry = craftEntry(base, x, v1, v5, c);

            // (a) FOOTPRINT: the oracle's write footprint on this real state ⊆ {0x6901, 0x6905}.
            for (const addr of oracleWriteFootprint(entry)) {
              assert.ok(
                addr === SPRITE0_CODE || addr === SPRITE1_CODE,
                `oracle wrote RAM at ${hx(addr)} (outside {0x6901,0x6905}) — memory-only model not licensed`,
              );
            }

            // (b) ARMS EXERCISED: the branch matches `cp 0x80 / jp nc`. Right half clears
            // bit 7 on record 0's code byte; left half sets it. (0x6905 goes through the
            // store tail's optional low-2-bit toggle, so bit 7 there is the stable witness.)
            const oc = entry.clone();
            oracle(oc);
            const b1 = oc.mem.read8(SPRITE0_CODE) & 0x80;
            const b5 = oc.mem.read8(SPRITE1_CODE) & 0x80;
            if (x >= 0x80) {
              assert.equal(b1, 0, `X=${hb(x)} (>=0x80) should blink OFF: bit 7 of 0x6901 not cleared`);
              assert.equal(b5, 0, `X=${hb(x)} (>=0x80) should blink OFF: bit 7 of 0x6905 not cleared`);
              sawOff++;
            } else {
              assert.equal(b1, 0x80, `X=${hb(x)} (<0x80) should blink ON: bit 7 of 0x6901 not set`);
              assert.equal(b5, 0x80, `X=${hb(x)} (<0x80) should blink ON: bit 7 of 0x6905 not set`);
              sawOn++;
            }

            // (c) REALISM: fresh-clone whole-machine RAM diff (minus dead stack) is empty.
            const ram = diffAgainstOracle(entry, blinkSpritePairByX);
            assert.equal(
              ram,
              null,
              ram && `whole-machine mismatch (x=${hb(x)} v1=${hb(v1)} v5=${hb(v5)} c=${hb(c)}) at ${hx(ram.addr)}: ` +
                `oracle=${ram.a} cand=${ram.b}`,
            );
            cases++;
          }
        }
      }
    }
  }
  assert.ok(sawOff >= 1, "expected the OFF arm (X >= 0x80) to be exercised");
  assert.ok(sawOn >= 1, "expected the ON arm (X < 0x80) to be exercised");
  console.log(
    `  CRAFTED/footprint: ${cases} crafted entries on ${bases.length} real attract bases — ` +
      `footprint ⊆ {0x6901,0x6905}, whole-machine identical (${sawOff} OFF / ${sawOn} ON arm)`,
  );
});

// -- 2. TEETH -----------------------------------------------------------------

/**
 * Broken twin: uses `>` instead of `>=`, so it mis-routes the single boundary value
 * X == 0x80 (oracle takes OFF, twin takes ON) and agrees on every other X. Only a matrix
 * that includes X == 0x80 catches it — which is exactly why the crafted set does.
 */
function brokenBlinkByX(m) {
  if (m.mem.read8(MARIO_X) > 0x80) {
    blinkSpritePairOff(m); // BUG: `>` drops the boundary — X == 0x80 wrongly falls to ON
  } else {
    blinkSpritePairOn(m);
  }
}

test("TEETH: the boundary-flipped (`>` vs `>=`) twin is CAUGHT at X == 0x80", () => {
  const bases = captureBases(2, 3000);
  assert.ok(bases.length >= 1, "expected at least one real 0x04ac base for the teeth check");

  let caught = null;
  outer: for (const base of bases) {
    for (const x of XS) {
      for (const c of CS) {
        for (const v1 of V1S) {
          for (const v5 of V5S) {
            const entry = craftEntry(base, x, v1, v5, c);
            const ram = diffAgainstOracle(entry, brokenBlinkByX);
            if (ram) {
              caught = { x, v1, v5, c, ram };
              break outer;
            }
          }
        }
      }
    }
  }
  assert.notEqual(caught, null, "the crafted matrix FAILED to catch a boundary-flipped branch — it is worthless");
  assert.equal(caught.x, 0x80, `expected the boundary twin to first diverge at X == 0x80, got X=${hb(caught.x)}`);
  console.log(
    `  TEETH: caught the boundary-flipped twin at x=${hb(caught.x)} v1=${hb(caught.v1)} v5=${hb(caught.v5)} ` +
      `c=${hb(caught.c)} — RAM at ${hx(caught.ram.addr)} (oracle=${caught.ram.a} broken=${caught.ram.b})`,
  );
});
