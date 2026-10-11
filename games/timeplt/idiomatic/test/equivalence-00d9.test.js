// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceVerticalBlankInterrupt — memory-equivalent to the frozen oracle at ROM 0x00D9, the vertical-blank
 * service body, in its DISSOLVED form (see _vblankService.js for the contract every gate in this family
 * shares: memory outside the oracle's measured dead stack scratch, every device, SP unmoved).
 *
 * The oracle stacks both register banks, does the frame's work, pushes 0x0174 as the return slot of the
 * phase arm it dispatches through RST 0x30 off the four-word table at 0x015F, and lets that arm's `ret`
 * land on the close at 0x0174, which unstacks everything and returns through the resume word the
 * interrupt pushed. The rewrite keeps the work and drops the rest: no bank save, no exchange, no
 * trampoline slot — a direct `switch` on the low two bits of the sequence phase — and a direct call of
 * the close. The packed-decimal frame counter the oracle steps with `inc a / daa` is re-expressed as a
 * pure step over the stored byte, and proved over every byte value rather than the few the tape visits.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — every eighth dispatch of the coin-start tape across attract, credit and play.
 *   2. PHASES — the corpus reaches all four arms of the switch, so each case is compared at least once.
 *   3. TABLE — the four cases are the four words of the ROM table at 0x015F, read out of the image and
 *      named through ROUTINES, and the module's switch calls exactly those, in slot order.
 *   4. BCD — the flags the oracle carries into its `daa` are MEASURED over the corpus (carry and
 *      subtract clear on every execution); the pure step equals `inc8`+`daa` under that carry-in for all
 *      256 stored bytes; the same 256 bytes are then planted in a real entry and the whole service run
 *      both ways; and a control shows a set carry would change 154 results, so the measurement matters.
 *   4b. GATE — the flip-screen condition crafted into all four states of its two cells (the corpus
 *      only ever holds one), each run both ways, with the oracle shown to write two different values.
 *   5. WINDOW — the oracle's dead-stack depth measured, its floor above all game data, with a control
 *      that the instrument sees a push at all.
 *   6. BOUNDARY — a byte below the window is caught, one at the seat is caught, one inside is masked.
 *   7. SP — the oracle nets +4 on every entry (the accumulator the 0x00D8 byte stacked, then the resume
 *      word); the rewrite nets 0, and a twin that pops a slot is caught.
 *   8. REGISTERS — not compared (not live-out of the dissolved interrupt); the measured divergent set is
 *      printed so a reader sees what the oracle's restore was doing.
 *   9. TEETH — ten twins, each caught on the corpus, the BCD sweep or the gate crafts.
 *
 * HOLE: the arms are gated by their own files; this gate composes them and inherits what the tape visits.
 * HOLE: tampered-image paths are out of reach of a genuine image and are not exercised here.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-00d9.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { romsPresent, START_FRAME } from "./_harness.js";
import {
  captureAt, dissolvedDiff, runOracle, oracleDepth, footprint, hex4, DATA_TOP,
} from "./_vblankService.js";
import { serviceVerticalBlankInterrupt, nextPackedDecimalCount } from "../serviceVerticalBlankInterrupt.js";
import { loc_00d9 as oracle } from "../../translated/loc_00d9.js";
import { publishSpriteShadow } from "../publishSpriteShadow.js";
import { drainBothDeferredCellLists } from "../drainBothDeferredCellLists.js";
import { serviceCoinInputs } from "../serviceCoinInputs.js";
import { dispatchSequencePhase0SubStepArm } from "../dispatchSequencePhase0SubStepArm.js";
import { dispatchSequencePhase1SubStepArm } from "../dispatchSequencePhase1SubStepArm.js";
import { dispatchSequencePhase2SubStepArm } from "../dispatchSequencePhase2SubStepArm.js";
import { dispatchSequenceSubStepArm } from "../dispatchSequenceSubStepArm.js";
import { sendOneQueuedSoundThenReopenFrameInterrupt } from "../sendOneQueuedSoundThenReopenFrameInterrupt.js";
import {
  ROUTINES, SEQUENCE_PHASE, SEQUENCE_PHASE_ARM_TABLE, BCD_FRAME_COUNTER, FRAME_TICK, ACTIVE_PLAYER,
  UPRIGHT_CABINET, SCREEN_UNFLIPPED, FLIPSCREEN_LATCH, DIP1_MIRROR, IN0_MIRROR, IN1_MIRROR, IN2_MIRROR,
  COINAGE_SETTINGS, DSW1_PORT, IN0_PORT, IN1_PORT, IN2_PORT, DSW0_PORT, NMI_ENABLE_LATCH, WATCHDOG_RESET,
  BANK_LAUNCH_COOLDOWN, WAVE_CLAIM_TIMER, ATTACKER_SPAWN_COOLDOWN,
} from "../names.js";
import { Regs, F_C, F_N, REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x00d9;
const DAA_PC = 0x0138; // the oracle's `daa`, reached after `inc a` at 0x0137
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const CORPUS_ENTRIES = 150;
const CAPTURE_STRIDE = 8;

const corpus = () => captureAt(TARGET, "coin-start", {}, { limit: CORPUS_ENTRIES, stride: CAPTURE_STRIDE });
const diff = (cand, e) => dissolvedDiff(oracle, cand, e);

// ── twins: the service re-expressed with one knob turned each ─────────────────────────────

const ARMS = [
  dispatchSequencePhase0SubStepArm,
  dispatchSequencePhase1SubStepArm,
  dispatchSequencePhase2SubStepArm,
  dispatchSequenceSubStepArm,
];

function build({
  tick = true, bcd = nextPackedDecimalCount, invert = 0xff, gate = true, timers = true, coins = true,
  arms = ARMS, close = true, popAfter = false,
} = {}) {
  return (m) => {
    const { mem8 } = m;
    publishSpriteShadow(m);
    drainBothDeferredCellLists(m);
    mem8[NMI_ENABLE_LATCH] = 0;
    mem8[WATCHDOG_RESET] = 0;
    mem8[SCREEN_UNFLIPPED] = gate && mem8[ACTIVE_PLAYER] !== 0 && mem8[UPRIGHT_CABINET] === 0 ? 0 : 1;
    mem8[FLIPSCREEN_LATCH] = mem8[SCREEN_UNFLIPPED];
    mem8[DIP1_MIRROR] = mem8[DSW1_PORT] ^ invert;
    mem8[IN0_MIRROR] = mem8[IN0_PORT] ^ invert;
    mem8[IN1_MIRROR] = mem8[IN1_PORT] ^ invert;
    mem8[IN2_MIRROR] = mem8[IN2_PORT] ^ invert;
    mem8[COINAGE_SETTINGS] = mem8[DSW0_PORT] ^ invert;
    if (tick) mem8[FRAME_TICK] = mem8[FRAME_TICK] + 1;
    mem8[BCD_FRAME_COUNTER] = bcd(mem8[BCD_FRAME_COUNTER]);
    if (timers) {
      for (const t of [BANK_LAUNCH_COOLDOWN, WAVE_CLAIM_TIMER, ATTACKER_SPAWN_COOLDOWN]) {
        if (mem8[t] !== 0) mem8[t] = mem8[t] - 1;
      }
    }
    if (coins) serviceCoinInputs(m);
    arms[mem8[SEQUENCE_PHASE] & 0x03](m);
    if (close) sendOneQueuedSoundThenReopenFrameInterrupt(m);
    if (popAfter) m.pop16();
  };
}

const TWINS = [
  ["no-op", () => {}, "corpus"],
  ["no-frame-tick", build({ tick: false }), "corpus"],
  ["bcd-binary", build({ bcd: (v) => (v + 1) & 0xff }), "bcd"],
  ["no-invert", build({ invert: 0 }), "corpus"],
  ["wrong-gate", build({ gate: false }), "gate"],
  ["no-timers", build({ timers: false }), "corpus"],
  ["no-coin-service", build({ coins: false }), "corpus"],
  ["swapped-arms-1-3", build({ arms: [ARMS[0], ARMS[3], ARMS[2], ARMS[1]] }), "corpus"],
  ["no-close", build({ close: false }), "corpus"],
  ["pops-a-slot", build({ popAfter: true }), "corpus"],
];

// ── the gate ─────────────────────────────────────────────────────────────────────────────

test("CORPUS: every captured dispatch agrees outside the dead stack window", { skip }, () => {
  const entries = corpus();
  assert.ok(entries.length > 0, "vacuous: the tape never reached the service");
  for (const e of entries) {
    const d = diff(serviceVerticalBlankInterrupt, e);
    assert.equal(d, null, d);
  }
  const foot = entries.map((e) => footprint(oracle, e));
  assert.ok(foot.every((n) => n > 0), "a captured dispatch made the oracle write nothing");
  console.log(`  CORPUS: ${entries.length} dispatches identical; oracle footprints ${Math.min(...foot)}..${Math.max(...foot)} bytes`);
});

test("PHASES: the corpus reaches every arm of the switch", { skip }, () => {
  const counts = [0, 0, 0, 0];
  for (const e of corpus()) counts[e.mem8[SEQUENCE_PHASE] & 0x03]++;
  assert.ok(counts.every((n) => n > 0), `an arm was never compared: per-phase counts ${counts.join("/")}`);
  // The capture spans the start of play, so this is not an attract-only corpus.
  assert.ok(corpus().length * CAPTURE_STRIDE > START_FRAME, "the corpus stops short of the frame play starts on");
  console.log(`  PHASES: per-arm dispatch counts ${counts.join("/")}`);
});

test("TABLE: the switch's four cases are the ROM table's four words, in slot order", { skip }, () => {
  const rom = corpus()[0].rom;
  const want = [];
  for (let i = 0; i < 4; i++) {
    const at = SEQUENCE_PHASE_ARM_TABLE + 2 * i;
    const word = rom[at] | (rom[at + 1] << 8);
    const meta = ROUTINES[word];
    assert.ok(meta, `slot ${i} of the table holds ${hex4(word)}, which names no routine`);
    want.push(meta.entry ?? meta.name);
  }
  const src = readFileSync(new URL("../serviceVerticalBlankInterrupt.js", import.meta.url), "utf8");
  const got = [];
  for (const [, idx, fn] of src.matchAll(/case (\d): (\w+)\(m\)/g)) got[Number(idx)] = fn;
  assert.deepEqual(got, want, "the switch does not call the table's targets in slot order");
  // The control: the same parse on a text with two cases swapped reads differently.
  const swapped = src.replace(/case 1: (\w+)\(m\)/, "case 1: SWAP(m)");
  const got2 = [];
  for (const [, idx, fn] of swapped.matchAll(/case (\d): (\w+)\(m\)/g)) got2[Number(idx)] = fn;
  assert.notDeepEqual(got2, want, "the source parse cannot see a changed case, so the match above is decoration");
  console.log(`  TABLE: ${want.join(", ")}`);
});

test("BCD: the carry-in is measured, the pure step is exhaustive, and the service agrees on all 256 bytes", { skip }, () => {
  // (a) The flags the oracle carries into its `daa`, measured over the corpus.
  let execs = 0;
  let carry = 0;
  let subtract = 0;
  for (const e of corpus()) {
    const m = e.clone();
    const daa = m.regs.daa.bind(m.regs);
    m.regs.daa = function () {
      if (m.pc === DAA_PC) {
        execs++;
        if (this.f & F_C) carry++;
        if (this.f & F_N) subtract++;
      }
      return daa();
    };
    oracle(m);
  }
  assert.equal(execs, corpus().length, "the daa tap did not fire once per dispatch, so it measured nothing");
  assert.equal(carry, 0, `the oracle entered its daa with carry set on ${carry} of ${execs} dispatches`);
  assert.equal(subtract, 0, `the oracle entered its daa with subtract set on ${subtract} of ${execs} dispatches`);

  // (b) The pure step against the CPU's own inc8+daa, carry clear, every byte.
  const cpu = (v, c) => {
    const r = new Regs();
    r.f = c ? F_C : 0;
    r.a = r.inc8(v);
    r.daa();
    return r.a;
  };
  for (let v = 0; v < 256; v++) {
    assert.equal(nextPackedDecimalCount(v), cpu(v, 0), `the pure step differs from inc8+daa at ${hex4(v)}`);
  }
  // The control: a set carry-in changes the result, so (a) is load-bearing and not a formality.
  let moved = 0;
  for (let v = 0; v < 256; v++) if (cpu(v, 1) !== cpu(v, 0)) moved++;
  assert.ok(moved > 0, "a set carry changes nothing, so measuring it proves nothing");

  // (c) In situ: every byte planted in a real entry, the whole service run both ways.
  const base = corpus()[0];
  for (let v = 0; v < 256; v++) {
    const e = base.clone();
    e.mem8[BCD_FRAME_COUNTER] = v;
    const d = diff(serviceVerticalBlankInterrupt, e);
    assert.equal(d, null, `planted ${hex4(v)}: ${d}`);
  }
  console.log(`  BCD: daa entered ${execs}x, carry 0, subtract 0; 256/256 pure = inc8+daa; ` +
    `256/256 planted services agree; carry=1 would change ${moved}/256`);
});

/** The flip-screen gate's four states, crafted on one real entry. */
function gateCrafts() {
  const out = [];
  for (const player of [0, 1]) {
    for (const upright of [0, 1]) {
      const e = corpus()[0].clone();
      e.mem8[ACTIVE_PLAYER] = player;
      e.mem8[UPRIGHT_CABINET] = upright;
      out.push([`player=${player} upright=${upright}`, e]);
    }
  }
  return out;
}

test("GATE: all four states of the flip-screen condition agree, and the oracle writes both values", { skip }, () => {
  const written = new Set();
  for (const [label, e] of gateCrafts()) {
    const d = diff(serviceVerticalBlankInterrupt, e);
    assert.equal(d, null, `${label}: ${d}`);
    written.add(runOracle(oracle, e).m.mem8[SCREEN_UNFLIPPED]);
  }
  assert.deepEqual([...written].sort(), [0, 1], "the crafts do not drive the oracle to both values, so they test nothing");
  console.log(`  GATE: 4 crafted states agree; the oracle writes ${[...written].sort().join(" and ")}`);
});

test("WINDOW: the oracle's dead-stack depth, its floor above the data, instrument checked", { skip }, () => {
  const depths = corpus().map((e) => oracleDepth(oracle, e));
  const seat = corpus()[0].regs.sp;
  const probe = runOracle(() => {}, corpus()[0]);
  probe.m.push16(0x1234);
  assert.equal(probe.seat - probe.m.regs.sp, 2, "the push instrument's baseline is off");
  const deepest = Math.max(...depths);
  for (const e of corpus()) {
    assert.ok(e.regs.sp - deepest > DATA_TOP, `the window floor ${hex4(e.regs.sp - deepest)} reaches game data`);
  }
  console.log(`  WINDOW: depth ${Math.min(...depths)}..${deepest} bytes below seat ${hex4(seat)}; floor clears ${hex4(DATA_TOP)}`);
});

test("BOUNDARY: a byte below the window is caught, one at the seat is caught, one inside is masked", { skip }, () => {
  const base = corpus()[0];
  const depth = oracleDepth(oracle, base);
  const scribble = (offset) => (m) => {
    serviceVerticalBlankInterrupt(m);
    const at = (base.regs.sp + offset) & 0xffff;
    m.mem8[at] = (m.mem8[at] + 1) & 0xff;
  };
  assert.notEqual(diff(scribble(-depth - 1), base), null, "a byte below the window was swallowed");
  assert.notEqual(diff(scribble(0), base), null, "a byte at the entry seat was swallowed");
  assert.equal(diff(scribble(-1), base), null, "a byte inside the window was caught, so the catches prove nothing");
  console.log(`  BOUNDARY: ${hex4(base.regs.sp - depth - 1)} caught, ${hex4(base.regs.sp)} caught, ${hex4(base.regs.sp - 1)} masked`);
});

test("SP: the oracle unwinds four bytes it never pushed here; the rewrite moves SP not at all", { skip }, () => {
  for (const e of corpus()) {
    const o = runOracle(oracle, e);
    assert.equal((o.m.regs.sp - e.regs.sp) & 0xffff, 4, "the oracle did not net +4 (the stacked accumulator, then the resume word)");
    const r = e.clone();
    serviceVerticalBlankInterrupt(r);
    assert.equal(r.regs.sp, e.regs.sp, "the rewrite moved SP");
  }
  console.log(`  SP: oracle +4 on all ${corpus().length} dispatches; rewrite 0`);
});

test("REGISTERS: not live-out of the dissolved interrupt; the divergent set is measured and shown", { skip }, () => {
  const moved = new Set();
  for (const e of corpus()) {
    const a = runOracle(oracle, e).m;
    const b = e.clone();
    serviceVerticalBlankInterrupt(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  REGISTERS (measured, not compared): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ") || "none"}`);
});

for (const [label, twin, where] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    let caught = 0;
    let of = 0;
    if (where === "corpus") {
      for (const e of corpus()) { of++; if (diff(twin, e) !== null) caught++; }
    } else if (where === "gate") {
      for (const [, e] of gateCrafts()) { of++; if (diff(twin, e) !== null) caught++; }
    } else {
      const base = corpus()[0];
      for (let v = 0; v < 256; v++) {
        const e = base.clone();
        e.mem8[BCD_FRAME_COUNTER] = v;
        of++;
        if (diff(twin, e) !== null) caught++;
      }
    }
    console.log(`  TEETH/${label}: caught on ${caught}/${of} (${where})`);
    assert.ok(caught > 0, `every ${where} entry PASSED the ${label} twin`);
  });
}
