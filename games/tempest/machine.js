// SPDX-License-Identifier: GPL-3.0-only
// Tempest machine — Atari tempest board + MOS 6502. SKELETON (§2): translated/ is empty, so reset()
// dispatches the 6502 reset vector (0xFFFC -> 0xD93F) and the first m.call throws NotImplemented -- the
// boot-gap crawl (§3) worklist. The interrupt is a FREE-RUNNING periodic IRQ at CLOCK_3KHZ/12 = 246.09Hz
// (tempest.cpp:644), i.e. one IRQ every 1512000/246.09 = 6144 CPU cycles (NOT vblank-tied, NOT frame-aligned;
// acked by write 0x5000). There is no vblank NMI and no CPU-polled vblank bit -- the game syncs to drawing
// via the AVG done_r poll (IN0 bit6). The §4 clock-free yield model keys on that poll; nothing runs yet, so
// only the seam wiring + reset dispatch are load-bearing now. Video is the byte-exact vector pipeline
// (boards/tempest/{avg.js,vector-raster.js} via video.js).

import { AddressSpace } from "../../boards/tempest/memory.js";
import { Io, NotImplemented } from "../../boards/tempest/io.js";
import { renderFrameRGB } from "../../boards/tempest/video.js";
import { Regs, F_B, F_U } from "../../core/cpu/6502.js";
import { makeIndexedView } from "../../core/mem-views.js";
import { buildRoutines } from "./routines.js";

export const CYCLES_PER_FRAME = 25200; // 1.512MHz / 60
export const RESET_VECTOR = 0xfffc; // 6502 reset/IRQ vectors live at the top of the 0xF000 ROM reload
export const IRQ_VECTOR = 0xfffe;
export const IRQ_PERIOD = 6144; // CLOCK_3KHZ/12 = 246.09Hz -> 1512000/246.09 = 6144 cycles/IRQ (free-running)

// Assemble the 64K maincpu image MAME builds: program at 0x9000-0xDFFF, then a RELOAD of the last 4K
// (-237, offset 0x4000 of the concat) at 0xF000-0xFFFF for the reset/IRQ vectors (tempest.cpp:704-709).
function assembleMaincpu(maincpu) {
  const img = new Uint8Array(0x10000);
  img.set(maincpu.subarray(0, 0x5000), 0x9000);
  img.set(maincpu.subarray(0x4000, 0x5000), 0xf000);
  return img;
}

export class FramesComplete extends Error {
  constructor() {
    super("frame budget exhausted");
    this.name = "FramesComplete";
  }
}

export class Machine {
  constructor(maincpu, routines, opts = {}) {
    // (maincpu, routinesMap, opts) internally; (maincpu, opts) from the browser worker.
    if (!(routines instanceof Map)) {
      opts = routines || {};
      routines = buildRoutines();
      if (opts.overrides) for (const [addr, fn] of opts.overrides) routines.set(Number(addr), fn);
    }
    this.io = new Io({ avgprom: opts.avgprom });
    this.mem = new AddressSpace(assembleMaincpu(maincpu), opts.vectorrom, this.io);
    this.regs = new Regs(); // 6502 post-reset defaults: s=0xfd, I set (core/cpu/6502.js)
    this.routines = routines;
    this.rom = maincpu;
    this.assets = opts;

    this.mem8 = makeIndexedView(this.mem, 8);
    this.mem16 = makeIndexedView(this.mem, 16);

    this.cycles = 0;
    this.pc = 0;
    this.pcKnown = true;
    this.booted = false;
    this.frames = [];
    this.stoppedBy = null;
    this.inputTape = null;
    this.maxFrames = opts.maxFrames ?? Infinity;
    this.maxCycles = opts.maxCycles ?? Infinity;
    this.nextBoundary = CYCLES_PER_FRAME;
    this.nextIrqCycle = Infinity; // armed by runFrames; Infinity = quiescent (clone / boot-gap crawl)
    this.irqLine = false; // the periodic IRQ line: asserted every IRQ_PERIOD, cleared by wdclr (0x5000)

    this.captureVideo = false;
    this.videoFrames = [];
    this._lastVectorList = null;

    this.io.onAckIrq = () => { this.irqLine = false; }; // wdclr_w -> CLEAR_LINE (tempest.cpp:378)
    this.mem.clock = () => this.cycles;
  }

  static async create(maincpu, opts = {}) {
    const routines = buildRoutines();
    if (opts.overrides) for (const [addr, fn] of opts.overrides) routines.set(Number(addr), fn);
    return new Machine(maincpu, routines, opts);
  }

  reset() {
    // PC <- [0xFFFC]. The reset target (0xD93F) is the first routine to translate (§3 boot-gap crawl).
    const target = this.mem.read16(RESET_VECTOR);
    this.step(target, 0);
    this.booted = true;
    return this.call(target);
  }

  step(nextAddr, cycles) {
    this.pc = nextAddr;
    this.pcKnown = true;
    this.mem.pc = nextAddr;
    this.tick(cycles);
  }

  tick(n) {
    this.cycles += n;
    // Free-running 246Hz IRQ: assert the line every IRQ_PERIOD cycles, then fire if unmasked. ⚠ §3/§4
    // GROUNDING ITEM: MAME's line stays asserted until wdclr acks it, so an IRQ that arrives while I is set
    // is PENDING and fires when I next clears (CLI/RTI/PLP). This skeleton fires only at the period tick
    // (drops a masked IRQ); refine to pending-until-ack + re-check on I-clear once §3 reaches the IRQ path
    // (ground vs MAME). Irrelevant to the first boot gap (reset does SEI then hits its first m.call).
    while (this.cycles >= this.nextIrqCycle) {
      this.nextIrqCycle += IRQ_PERIOD;
      this.irqLine = true; // asserts; stays asserted until wdclr (0x5000) acks it -- MAME's periodic_int
    }
    // Take a pending IRQ at THIS instruction boundary if unmasked; an IRQ asserted while I is set is PENDING
    // and fires at the boundary after I next clears (CLI/RTI/PLP) -- not dropped. This matches MAME and keeps
    // the IRQ COUNT (and $53, the main-loop frame counter) in lockstep with the reference.
    if (this.irqLine && !this.regs.fI && this.pcKnown) this.fireIrq();
    while (this.cycles >= this.nextBoundary && this.frames.length < this.maxFrames) {
      this.applyInputs(this.frames.length);
      this.frames.push(this.mem.dumpState());
      this.nextBoundary += CYCLES_PER_FRAME;
    }
    if (this.cycles >= this.maxCycles) throw new FramesComplete();
    this.pcKnown = false;
  }

  call(addr, ...args) {
    const fn = this.routines.get(addr);
    if (fn === undefined) {
      throw new NotImplemented(`m.call: no routine registered at 0x${addr.toString(16).padStart(4, "0")}`);
    }
    return fn(this, ...args);
  }

  // ---- 6502 stack: page 1 (0x0100|S), 8-bit S wrap, high byte pushed first ---------------
  push8(v) {
    this.mem.write8(0x0100 | this.regs.s, v & 0xff);
    this.regs.s = (this.regs.s - 1) & 0xff;
  }
  pull8() {
    this.regs.s = (this.regs.s + 1) & 0xff;
    return this.mem.read8(0x0100 | this.regs.s);
  }
  push16(v) {
    this.push8((v >> 8) & 0xff);
    this.push8(v & 0xff);
  }
  pull16() {
    const lo = this.pull8();
    const hi = this.pull8();
    return lo | (hi << 8);
  }

  ret(cycles = 6) {
    this.step((this.pull16() + 1) & 0xffff, cycles);
  }
  rti(cycles = 6) {
    this.regs.p = this.pull8();
    this.step(this.pull16() & 0xffff, cycles);
  }

  fireIrq() {
    if (this.idiomaticIrq) {
      // Idiomatic clock-free mode: the main loop holds no live CPU registers across the frame yield and the
      // handler is SP-neutral, so fire the vector handler as a DIRECT call -- no PC/P push, no I mask, no
      // seam. This retires the guest stack pointer (the last CPU register) from the idiomatic layer.
      // Clock-free has no cycle clock to advance the POKEY RANDOM LFSR (m.cycles stays 0), so RANDOM would
      // freeze at 0xff; step the RNG polys per IRQ by one IRQ period (game-time) so the shipped RNG free-runs.
      this.io.advanceRngPolys(IRQ_PERIOD);
      return this.call(this.mem.read16(IRQ_VECTOR));
    }
    if (this.regs.fI) return false;
    if (!this.pcKnown) throw new Error("IRQ with unknown PC: a routine used tick() rather than step()");
    this.push16(this.pc);
    this.push8((this.regs.p & ~F_B) | F_U);
    this.regs.fI = true;
    const target = this.mem.read16(IRQ_VECTOR);
    this.step(target, 7);
    return this.call(target);
  }

  applyInputs(frameIndex) {
    if (!this.inputTape) return;
    const assert = {};
    for (const t of this.inputTape) {
      const due = frameIndex >= t.frame && (t.dur == null || frameIndex < t.frame + t.dur);
      if (due) assert[t.port] = (assert[t.port] || 0) | t.bits;
    }
    this.io.inputAssert = assert;
  }

  /** Bounded run for the boot-gap crawl: boot never returns, so NotImplemented localises the next gap. */
  runFrames(count) {
    this.io.inputAssert = null;
    this.frames = [this.mem.dumpState()];
    this.maxFrames = count;
    this.maxCycles = count * CYCLES_PER_FRAME + CYCLES_PER_FRAME;
    this.cycles = 0;
    this.nextBoundary = CYCLES_PER_FRAME;
    this.nextIrqCycle = IRQ_PERIOD;
    if (count <= 1) return this.frames;
    try {
      this.reset();
      this.stoppedBy = "returned";
    } catch (e) {
      if (e instanceof FramesComplete) this.stoppedBy = null;
      else if (e instanceof NotImplemented) this.stoppedBy = e;
      else throw e;
    } finally {
      this.maxFrames = Infinity;
      this.maxCycles = Infinity;
      this.nextBoundary = Infinity;
      this.nextIrqCycle = Infinity;
    }
    return this.frames;
  }

  renderFrame() {
    return renderFrameRGB(this);
  }
  dumpState() {
    return this.mem.dumpState();
  }
  stateOffsetToAddr(off) {
    return this.mem.stateOffsetToAddr(off);
  }

  clone() {
    const c = new Machine(this.rom, this.routines, this.assets);
    c.mem.workRam.set(this.mem.workRam);
    c.mem.vectorRam.set(this.mem.vectorRam);
    c.io.colorram.set(this.io.colorram);
    c.io.flipX = this.io.flipX;
    c.io.flipY = this.io.flipY;
    c.io.earom = this.io.earom.clone();
    c.io.mathbox = this.io.mathbox.clone();
    c.io.pokeys = this.io.pokeys.map((p, i) => p.clone(c.io.pokeys[i].potBits, c.io.pokeys[i].onWrite));
    c.io.knob = this.io.knob;
    c.io.inputAssert = structuredClone(this.io.inputAssert);
    c.io.dsw1 = this.io.dsw1;
    c.io.dsw2 = this.io.dsw2;
    c.io.cabinet = this.io.cabinet;
    c.io.playerSelect = this.io.playerSelect;
    if (c.io.avg) Object.assign(c.io.avg, { flipX: this.io.flipX, flipY: this.io.flipY, doneFlag: this.io.avg?.doneFlag, goPending: this.io.avg?.goPending });
    c.regs.copyFrom(this.regs);
    c.cycles = this.cycles;
    c.pc = this.pc;
    c.pcKnown = this.pcKnown;
    c.nextBoundary = Infinity;
    c.maxFrames = Infinity;
    c.maxCycles = Infinity;
    return c;
  }
}

// ---- §4 idiomatic dispatch seam ---------------------------------------------------------------------
// An idiomatic routine OMITS its ROM ret; withOmittedRet completes it. 6502 page-1 stack: regs.s is 8-bit,
// the JSR pushed the return (ret-1) at 0x0100|(s+1),(s+2), m.ret pulls it +1. moved 0 = omitted ret (seam
// rets); moved 2 with pc on the caller slot = a translated tail-transfer already ret'd; anything else adrift.
const GeneratorFunction = function* () {}.constructor;

export function withOmittedRet(fn, addr = null) {
  if (fn instanceof GeneratorFunction) return fn;
  const at = addr === null ? "" : ` at 0x${(addr & 0xffff).toString(16).padStart(4, "0")}`;
  return (m, ...args) => {
    const seat = m.regs.s;
    const lo = m.mem.read8(0x0100 | ((seat + 1) & 0xff));
    const hi = m.mem.read8(0x0100 | ((seat + 2) & 0xff));
    const callerRet = (((hi << 8) | lo) + 1) & 0xffff;
    const r = fn(m, ...args);
    if (r && typeof r.next === "function" && typeof r.throw === "function") return r; // coroutine: not done
    const moved = (m.regs.s - seat) & 0xff;
    if (moved === 0) { m.ret(); return r; }
    if (moved === 2 && m.pc === callerRet) return r;
    throw new Error(
      `the seam cannot place this dispatch${at}: SP moved ${moved}, pc 0x${(m.pc & 0xffff).toString(16)}. ` +
        "A placeable rewrite either omits its ROM ret (SP unmoved) or reaches it via a translated " +
        "tail-transfer (SP +2, pc on the caller slot); a net-nonzero SP move must be DISSOLVED, not overridden.",
    );
  };
}

export async function resolveOverrides(spec = {}, baseUrl = import.meta.url) {
  const map = new Map();
  for (const [key, ent] of Object.entries(spec)) {
    const addr = parseInt(key, 16);
    const mod = await import(new URL(ent.module, baseUrl).href);
    const fn = mod[ent.export];
    if (typeof fn !== "function") throw new Error(`override ${key}: ${ent.module} has no export "${ent.export}"`);
    // An interrupt handler (irq) is entered via the vector push and self-manages its stack (push a/x/y + rti),
    // so it is dispatched RAW -- the withOmittedRet return-seam would mis-read its +3 SP move and throw.
    map.set(addr, ent.irq ? fn : withOmittedRet(fn, addr));
  }
  return map;
}

/** §4 idiomatic override table: build the live map from idiomatic/names.js ROUTINES {addr:{name,entry?}}. */
export async function resolveAllIdiomatic(baseUrl = import.meta.url) {
  const { ROUTINES } = await import(new URL("idiomatic/names.js", baseUrl).href);
  const spec = {};
  for (const [addr, meta] of Object.entries(ROUTINES)) {
    spec[Number(addr).toString(16)] = { module: `./idiomatic/${meta.name}.js`, export: meta.entry ?? meta.name, irq: meta.irq };
  }
  return resolveOverrides(spec, baseUrl);
}
