// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for readControls (ROM 0x0087) — the per-frame joystick port select +
 * edge-debounce that builds P1_INPUT (0x6010) / P1_INPUT_RAW (0x6011).
 *
 * readControls is NOT reached in plain attract: entry_0066 skips it while ATTRACT (0x6007)
 * != 0, and it is CALLED DIRECTLY (not via m.call), so its own address 0x0087 is not a
 * dispatch point to hook. But it reads ONLY memory (DIP_UPRIGHT, 0x600E, the selected input
 * port, and P1_INPUT_RAW) and writes ONLY 0x6010/0x6011 — a pure function of memory state.
 * So it is validated the strong way, MEMORY-equivalence against the frozen oracle (RAM −
 * STACK_SCRATCH, pc, SP), never the full register file and never cycles:
 *
 *   1. EQUAL (exhaustive core) — the cooked-word math is a pure function of (raw, prevRaw).
 *      With the cabinet pinned upright (IN0 selected), sweep ALL 256x256 (raw, prevRaw)
 *      pairs: for each, drive the port via io.inputAssert and P1_INPUT_RAW, run oracle and
 *      candidate, and compare the two output bytes + throw-parity (raw bit 6 -> soft-reset
 *      throw). This pins the direction nibble, the jump EDGE detect, the <<3 jump-bit shift,
 *      and the bit-6 arm over the whole input space.
 *
 *   2. EQUAL (port select) — the IN0/IN1 choice the core sweep holds fixed. With IN0 and IN1
 *      set to distinguishable values, sweep (DIP_UPRIGHT, 0x600E) across on/off classes and
 *      confirm the candidate reads the SAME port the oracle does (and matches the documented
 *      upright->IN0, cocktail->IN1-if-0x600E-else-IN0 rule).
 *
 *   3. TEETH (exhaustive core) — a twin that reads the RAW jump bit instead of the
 *      edge-detected one (drops `(~prevRaw) &`) MUST be caught by the core sweep, at any
 *      (raw, prevRaw) with the jump bit set in BOTH.
 *
 *   4. REALISM + PURITY (captured driven dispatches) — drive a coin+start+move tape into a
 *      credited game so readControls runs, hook the NMI's m.call(0x0141) DMA blit (the last
 *      dispatch before the direct readControls call, touching none of its inputs), and clone
 *      the machine at real in-game frames. For each: (a) PURITY — the oracle changes ONLY
 *      0x6010/0x6011 (licenses the memory-only contract); (b) EQUAL — candidate reproduces
 *      the oracle on RAM(−stack) + pc + SP.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0087.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0087 as oracle } from "../../translated/loc_0087.js";
import { readControls as candidate } from "../readControls.js";
import { loc_0141 } from "../../translated/loc_0141.js";
import { Machine } from "../../machine.js";
import { DIP_UPRIGHT, P1_INPUT, P1_INPUT_RAW, ATTRACT, STACK_SCRATCH } from "../names.js";
import { NotImplemented } from "../../../../boards/dkong/io.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const IN0 = 0x7c00; // player-1 joystick port
const IN1 = 0x7c80; // player-2 joystick port (cocktail)
const COCKTAIL_PLAYER_SELECT = 0x600e;
const DMA_BLIT = 0x0141; // the NMI's last m.call before the direct readControls call

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const ha = (v) => "0x" + (v & 0xffff).toString(16);

// Run `fn`, returning true iff it threw the soft-reset NotImplemented (the raw-bit-6 arm).
// Any other error is a real failure and is rethrown.
function threw(fn) {
  try {
    fn();
    return false;
  } catch (e) {
    if (e instanceof NotImplemented) return true;
    throw e;
  }
}

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// Every RAM address that changed between two dumps (as a sorted array), for the footprint check.
function changedAddrs(before, after, offToAddr) {
  const out = [];
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (before[i] !== after[i]) out.push(offToAddr(i));
  }
  return out;
}

// -- 1. EQUAL (exhaustive core) + 3. TEETH share this sweep ---------------------

/**
 * Sweep all 256x256 (raw, prevRaw) with the cabinet pinned upright (so IN0 is the selected
 * port), comparing `candidateFn` to the oracle on the two output bytes and on throw-parity.
 * The two machines stay in lockstep (readControls' only writes are 0x6010/0x6011, both
 * reset or overwritten each iteration), so reusing one machine per side is exact.
 * Returns { mismatch, count }.
 */
function sweepCore(candidateFn) {
  const oM = new Machine(ROM).clone();
  const cM = new Machine(ROM).clone();
  oM.mem.write8(DIP_UPRIGHT, 1); // upright -> selects IN0
  cM.mem.write8(DIP_UPRIGHT, 1);
  let count = 0;
  for (let raw = 0; raw < 256; raw++) {
    for (let prev = 0; prev < 256; prev++) {
      oM.io.inputAssert = { [IN0]: raw };
      cM.io.inputAssert = { [IN0]: raw };
      oM.mem.write8(P1_INPUT_RAW, prev);
      cM.mem.write8(P1_INPUT_RAW, prev);
      const tO = threw(() => oracle(oM));
      const tC = threw(() => candidateFn(cM));
      count++;
      if (tO !== tC) {
        return { mismatch: { raw, prev, why: `throw ${tO}/${tC}` }, count };
      }
      const o10 = oM.mem.read8(P1_INPUT), c10 = cM.mem.read8(P1_INPUT);
      const o11 = oM.mem.read8(P1_INPUT_RAW), c11 = cM.mem.read8(P1_INPUT_RAW);
      if (o10 !== c10 || o11 !== c11) {
        return {
          mismatch: { raw, prev, why: `0x6010 ${hx(o10)}/${hx(c10)} 0x6011 ${hx(o11)}/${hx(c11)}` },
          count,
        };
      }
    }
  }
  return { mismatch: null, count };
}

test("EQUAL (exhaustive core): readControls == oracle over all 256x256 (raw, prevRaw)", () => {
  const { mismatch, count } = sweepCore(candidate);
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at raw=${hx(mismatch.raw)} prev=${hx(mismatch.prev)}: ${mismatch.why}`,
  );
  assert.equal(count, 256 * 256, "must have swept the full 65,536 (raw, prevRaw) grid");
  console.log(`  EQUAL/core: ${count} (raw, prevRaw) pairs — output bytes + throw-parity identical`);
});

// -- 2. EQUAL (port select) ---------------------------------------------------

// Expected selected raw per the DK rule: upright -> IN0; cocktail -> IN1 if 0x600E != 0, else IN0.
function expectedRaw(upright, alt, in0val, in1val) {
  if (upright !== 0) return in0val;
  return alt !== 0 ? in1val : in0val;
}

test("EQUAL (port select): candidate reads the same IN0/IN1 the oracle does", () => {
  const UPRIGHTS = [0x00, 0x01, 0x80, 0xff];
  const ALTS = [0x00, 0x01, 0x40, 0xff];
  // Distinguishable port values (no bit 6, so neither arm throws); varied prev to also
  // exercise the edge path on whichever port is chosen.
  const PORTS = [
    { in0: 0x25, in1: 0x1a },
    { in0: 0x1a, in1: 0x25 },
    { in0: 0x0f, in1: 0x30 },
  ];
  const PREVS = [0x00, 0x10, 0x35];

  const base = new Machine(ROM).clone();
  let count = 0;
  let mismatch = null;
  outer: for (const upright of UPRIGHTS) {
    for (const alt of ALTS) {
      for (const { in0, in1 } of PORTS) {
        for (const prev of PREVS) {
          const mA = base.clone();
          const mB = base.clone();
          for (const m of [mA, mB]) {
            m.mem.write8(DIP_UPRIGHT, upright);
            m.mem.write8(COCKTAIL_PLAYER_SELECT, alt);
            m.mem.write8(P1_INPUT_RAW, prev);
            m.io.inputAssert = { [IN0]: in0, [IN1]: in1 };
          }
          oracle(mA);
          candidate(mB);
          count++;
          const want = expectedRaw(upright, alt, in0, in1);
          if (mA.mem.read8(P1_INPUT_RAW) !== want) {
            mismatch = { upright, alt, in0, in1, prev, why: `oracle read ${hx(mA.mem.read8(P1_INPUT_RAW))} want ${hx(want)}` };
            break outer;
          }
          if (
            mB.mem.read8(P1_INPUT) !== mA.mem.read8(P1_INPUT) ||
            mB.mem.read8(P1_INPUT_RAW) !== mA.mem.read8(P1_INPUT_RAW)
          ) {
            mismatch = {
              upright, alt, in0, in1, prev,
              why: `0x6010 ${hx(mA.mem.read8(P1_INPUT))}/${hx(mB.mem.read8(P1_INPUT))} ` +
                `0x6011 ${hx(mA.mem.read8(P1_INPUT_RAW))}/${hx(mB.mem.read8(P1_INPUT_RAW))}`,
            };
            break outer;
          }
        }
      }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `select mismatch upright=${hx(mismatch.upright)} 0x600E=${hx(mismatch.alt)} ` +
      `IN0=${hx(mismatch.in0)} IN1=${hx(mismatch.in1)} prev=${hx(mismatch.prev)}: ${mismatch.why}`,
  );
  console.log(`  EQUAL/select: ${count} (upright, 0x600E, ports, prev) combos — same port + bytes as the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: uses the RAW jump bit (raw & 0x10) instead of the edge-detected bit
 * ((~prevRaw) & raw & 0x10). Identical to the oracle unless the jump bit is HELD (set in
 * both raw and prevRaw), where the oracle clears P1_INPUT bit 7 (no fresh press) but the
 * twin keeps it set. Everything else (direction, shift, store, bit-6 throw) matches, so only
 * a real (raw, prevRaw) sweep across the held-jump case catches it.
 */
function brokenReadControls(m) {
  const { mem } = m;
  let raw;
  if (mem.read8(DIP_UPRIGHT) !== 0) raw = mem.read8(IN0);
  else if (mem.read8(COCKTAIL_PLAYER_SELECT) !== 0) raw = mem.read8(IN1);
  else raw = mem.read8(IN0);
  const direction = raw & 0x0f;
  const jumpEdge = (raw & 0x10) << 3; // BUG: no `(~prevRaw) &` — not edge-detected
  const cooked = (jumpEdge | direction) & 0xff;
  mem.write8(P1_INPUT, cooked);
  mem.write8(P1_INPUT_RAW, raw);
  if (raw & 0x40) {
    throw new NotImplemented("input bit 6 set: soft-reset via input, path not yet exercised");
  }
}

test("TEETH (exhaustive core): the raw-jump-bit twin (no edge detect) is CAUGHT by the sweep", () => {
  const { mismatch, count } = sweepCore(brokenReadControls);
  assert.notEqual(mismatch, null, "the core sweep FAILED to catch a dropped jump-edge detect — it is worthless");
  console.log(
    `  TEETH/core: caught after ${count} pairs at raw=${hx(mismatch.raw)} prev=${hx(mismatch.prev)} (${mismatch.why})`,
  );
});

// -- 4. REALISM + PURITY (captured driven dispatches) -------------------------

// Coin + start credits and starts a 1P game (ATTRACT -> 0 so readControls runs); the IN0
// joystick asserts give the port varied bits, incl. pulsed jump for press EDGES.
const MOVE_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 },   // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 },   // start1 (IN2 bit2)
  { port: 0x7c00, bits: 0x01, frame: 80, dur: 60 },  // right (held)
  { port: 0x7c00, bits: 0x10, frame: 110, dur: 2 },  // jump pulse (press edge)
  { port: 0x7c00, bits: 0x10, frame: 150, dur: 12 }, // jump held (edge then held)
  { port: 0x7c00, bits: 0x02, frame: 200, dur: 60 }, // left
  { port: 0x7c00, bits: 0x04, frame: 280, dur: 40 }, // up
  { port: 0x7c00, bits: 0x10, frame: 300, dur: 2 },  // jump pulse
  { port: 0x7c00, bits: 0x08, frame: 360, dur: 40 }, // down
  { port: 0x7c00, bits: 0x10, frame: 400, dur: 2 },  // jump pulse
  { port: 0x7c00, bits: 0x03, frame: 460, dur: 40 }, // right (combined bits)
];

/**
 * Drive MOVE_TAPE and clone the machine at real in-game (ATTRACT==0) frames, sampling one of
 * every `stride` dispatches (spread over the run, capped at `cap`). Hooks the NMI's DMA blit
 * 0x0141 — the last m.call before readControls — and delegates to the oracle loc_0141 so the
 * host game proceeds undisturbed. Capturing is fenced off after the host run.
 */
function captureInGameDispatches(stride, cap, maxFrames) {
  const caps = [];
  let seen = 0;
  let capturing = true;
  const snap = new Map([[DMA_BLIT, (mm) => {
    if (capturing && mm.mem.read8(ATTRACT) === 0) {
      if (seen % stride === 0 && caps.length < cap) caps.push(mm.clone());
      seen++;
    }
    return loc_0141(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = MOVE_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

test("REALISM + PURITY: real captured in-game dispatches — footprint {0x6010,0x6011}, RAM(−stack)+pc+SP match", () => {
  const caps = captureInGameDispatches(5, 120, 1500);
  assert.ok(caps.length >= 1, "expected at least one real in-game readControls entry during a credited game");

  let compared = 0;
  let movementSeen = 0;
  for (const cap of caps) {
    // PURITY / footprint: the oracle changes ONLY 0x6010/0x6011.
    const p = cap.clone();
    const before = p.dumpState();
    threw(() => oracle(p)); // (bit 6 never asserted by the tape, so this never throws)
    const after = p.dumpState();
    const changed = changedAddrs(before, after, (o) => p.stateOffsetToAddr(o));
    for (const addr of changed) {
      assert.ok(
        addr === P1_INPUT || addr === P1_INPUT_RAW,
        `oracle wrote outside {0x6010,0x6011}: ${ha(addr)} — footprint is not memory-only`,
      );
    }

    // EQUAL: candidate reproduces the oracle on RAM(−stack) + pc + SP.
    const a = cap.clone();
    const b = cap.clone();
    const tA = threw(() => oracle(a));
    const tB = threw(() => candidate(b));
    assert.equal(tB, tA, "throw-parity diverged on a real dispatch");
    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${ha(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b}`,
    );
    assert.equal(b.regs.sp, a.regs.sp, `SP diverged: oracle=${ha(a.regs.sp)} cand=${ha(b.regs.sp)}`);
    assert.equal(b.pc, a.pc, `pc diverged: oracle=${ha(a.pc)} cand=${ha(b.pc)}`);
    if (a.mem.read8(P1_INPUT) !== 0) movementSeen++;
    compared++;
  }
  console.log(
    `  REALISM: ${compared} real in-game dispatches — footprint {0x6010,0x6011}, RAM(−stack)+pc+SP identical ` +
      `(${movementSeen} with a non-zero cooked control word)`,
  );
});
