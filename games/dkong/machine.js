// SPDX-License-Identifier: GPL-3.0-only
/**
 * The Donkey Kong machine: address space + I/O + register file, plus the
 * frame accounting both validation modes are indexed by.
 *
 * FRAME SAMPLING CONTRACT (do not drift): state and frame buffers
 * are sampled at the frame boundary BEFORE that frame's CPU execution.
 *   state[0] = power-on state, before a single instruction runs
 *   state[N] = state after frames 0..N-1 have executed
 * This matches what MAME's frame notifier provides, so both sides sample
 * identically. Sampling after execution instead puts every frame off by one
 * and reads as a translation bug.
 */

import { AddressSpace } from "../../boards/dkong/memory.js";
import { IO, Inputs, NotImplemented } from "../../boards/dkong/io.js";
import { Regs } from "../../core/cpu/z80.js";
import { bootOnly, reset as romReset } from "./translated/boot.js";
import { entry_0066 } from "./translated/nmi.js";
import {
  buildPalette, CYCLES_PER_LINE, decodeSprites, decodeTiles, drawSprites,
  renderFrameRGB, renderRowRGB,
  SCREEN_H, splitProms, VBLANK_LINES,
} from "../../boards/dkong/video.js";

/**
 * Z80 T-states per video frame, DERIVED not fitted:
 *
 *   frame rate = pixclock / (htotal * vtotal) = 6144000 / (384 * 264)
 *              = 60.606060... Hz
 *   cycles     = 3072000 / 60.60606... = 50688 exactly
 *
 * It comes out an exact integer, which is a good sign we have the right
 * numbers rather than approximately the right ones.
 *
 * WHY CYCLE COUNTING IS NEEDED AT ALL: boot's RAM clear is ~29 T-states per
 * byte (ld (hl),a=7, inc hl=6, dec c=4, jr nz taken=12) over 6144 bytes,
 * which is 3.5 frames. So the first several frame boundaries fall INSIDE the
 * boot loops, and state[1..3] cannot be produced by "run boot, then sample" --
 * they require suspending mid-loop at the exact cycle the boundary lands on.
 */
export const CYCLES_PER_FRAME = 50688;

/**
 * The vblank NMI asserts AT THE FRAME BOUNDARY -- cycle N * 50688 -- not
 * partway into the frame.
 *
 * This was measured by tapping reads of 0x0066 (the NMI vector, so the
 * tap fires when the handler's first byte is fetched): NMI entries at 202771,
 * 253451, 304141, 354826, 405518, 456213 -- every one at frame N.000x.
 *
 * A PREVIOUS VERSION HAD 46080 HERE, from 50688 * 240 / 264 (VBSTART/VTOTAL).
 * That arithmetic is correct; the ERROR WAS UPSTREAM OF IT. MAME's frame
 * origin for this driver is the vblank point itself, not the top of the
 * visible display, so "46080 cycles into the frame" measures from the wrong
 * origin. Worth recording because the failure mode is instructive: the
 * constant was not slightly off, the REFERENCE FRAME was wrong, and fitting
 * a better-looking number would have made one frame agree while hiding that.
 *
 * The 10-21 cycle spread in the measurements is the CPU finishing whatever
 * instruction it was in before accepting the interrupt. We do not model that
 * as a constant: the NMI is checked at instruction boundaries, so the jitter
 * falls out of where the boundary happens to land.
 */
export const NMI_CYCLE_IN_FRAME = 0;

/**
 * Thrown to unwind out of the translated code once enough frames have been
 * captured. Boot is a straight-line routine with no "stop here" concept, so
 * the only way to suspend it at an arbitrary cycle is to unwind. Not an
 * error condition -- runFrames() catches it.
 */
export class FramesComplete extends Error {
  constructor() {
    super("requested frame count captured");
    this.name = "FramesComplete";
  }
}

export class Machine {
  /**
   * @param {Uint8Array} rom 16KB maincpu image
   * @param {object} [opts]
   * @param {Inputs} [opts.inputs]
   */
  /**
   * @param {Uint8Array} rom     16KB maincpu image
   * @param {object} [opts]
   * @param {Uint8Array} [opts.gfx1]  tile ROMs -- enables frame rendering
   * @param {Uint8Array} [opts.proms] colour PROMs -- enables frame rendering
   */
  constructor(rom, { inputs, gfx1, proms, gfx2 } = {}) {
    this.io = new IO({ inputs: inputs ?? new Inputs() });
    this.mem = new AddressSpace(rom, this.io);
    this.regs = new Regs();
    this.mem.clock = () => this.cycles;
    this.frame = 0;
    this.booted = false;

    this.cycles = 0;
    this.frames = []; // captured state dumps, one per frame boundary
    this.videoFrames = []; // completed RGB frames, one per frame, opt-in
    this.captureVideo = false; // off by default: 172032 bytes per frame
    this.rasterBuf = null; // frame being painted, row by row
    this.rasterRow = 0; // next scanline to paint, 0..SCREEN_H
    this.nextRowCycle = 0; // absolute cycle the next scanline starts at
    this.droppedFrames = 0; // frames abandoned mid-paint; only the last may be
    this.nextBoundary = Infinity; // set by runFrames()
    this.maxFrames = Infinity;
    this.maxCycles = Infinity;

    // Next vblank, in absolute cycles. Advances every frame whether or not
    // the NMI is masked -- vblank happens regardless; the mask only decides
    // whether the CPU notices.
    this.nextNmi = NMI_CYCLE_IN_FRAME;

    // Video decode is done once at construction: the tile ROMs and PROMs are
    // immutable, so nothing about them can change per frame.
    this.video = null;
    if (gfx1 && proms) {
      this.video = {
        tiles: decodeTiles(gfx1),
        charColour: splitProms(proms).charColour,
        palette: buildPalette(proms),
        // gfx2 is optional: without it the tilemap still renders and sprites
        // are simply not drawn (the pre-sprite behaviour). With it, the sprite
        // post-pass in finishRasterFrame runs.
        sprites: gfx2 ? decodeSprites(gfx2) : null,
      };
    }

    // ROM address of the NEXT instruction to execute -- what the Z80 pushes
    // when it accepts an NMI. Maintained by step(); tick() invalidates it.
    this.pc = 0x0000;
    this.pcKnown = false;
    this.nmiCount = 0;
    this.stoppedBy = null; // why a bounded run ended, if not the budget

    // Poke tape: [{addr,val,frame,mode}] set by emit.js --poke, matching
    // lua/poke_ram.lua. Applied at each frame boundary BEFORE that frame's CPU
    // exec (and before the state sample, so state[N] reflects the poke) --
    // hold rewrites every frame from `frame` on, once writes only at `frame`.
    this.pokes = null;

    // Input tape: [{port,bits,frame,mode}] set by emit.js --input. Asserts
    // coin/start/joystick bits on IN0/IN1/IN2 so the ROM's own credit/start
    // logic drives gameplay. once = frame N only (a momentary pulse -- the
    // default), hold = every frame from N (a held direction).
    this.inputTape = null;
  }

  /** Apply --poke entries due for `frameIndex`, at the frame boundary. */
  applyPokes(frameIndex) {
    if (!this.pokes) return;
    for (const p of this.pokes) {
      // dur frames from p.frame (null = indefinite hold); holdN releases after
      // N so the game's own code manages the byte during play.
      const due = frameIndex >= p.frame &&
        (p.dur == null || frameIndex < p.frame + p.dur);
      if (due) this.mem.write8(p.addr, p.val);
    }
  }

  /**
   * Set io.inputAssert for `frameIndex` from the --input tape. Stays active
   * for that whole frame's reads (the NMI may read IN2 mid-frame); recomputed
   * at the next boundary so a `once` pulse clears the frame after.
   */
  applyInputs(frameIndex) {
    if (!this.inputTape) return;
    const assert = {};
    for (const t of this.inputTape) {
      // dur frames from t.frame (null = indefinite); e.g. dur 6 = MAME's coin hold.
      const due = frameIndex >= t.frame &&
        (t.dur == null || frameIndex < t.frame + t.dur);
      if (due) assert[t.port] = (assert[t.port] || 0) | t.bits;
    }
    this.io.inputAssert = assert;
  }

  /**
   * Execute one translated instruction: `nextAddr` is the ROM address of the
   * instruction AFTER this one (the branch target when a jump is taken),
   * `cycles` its T-state cost.
   *
   * WHY THE PC RIDES ALONG. If an NMI is accepted here, the Z80 pushes the
   * address of the next instruction, and that value lands on the stack inside
   * the work RAM that is diffed against MAME. Keeping the PC as separate bookkeeping meant it
   * went stale the moment control entered a routine that did not maintain it
   * -- a review found the first real NMI pushing 0x02C5 while two calls deep
   * in 0x06xx code. Carrying it as an argument makes the stale case
   * unrepresentable rather than merely discouraged.
   */
  step(nextAddr, cycles) {
    this.pc = nextAddr;
    this.pcKnown = true;
    this.tick(cycles);
  }

  /**
   * Vector the vblank NMI, exactly as the Z80 would: push the current PC and
   * jump to 0x0066.
   *
   * THE PUSHED PC MATTERS AND IS NOT A FREE CHOICE. It lands on the stack at
   * the top of work RAM, inside the 5120 bytes diffed against MAME, so it
   * must be the value the ROM would have had there -- not a sentinel, not
   * zero. That is why translated code maintains `m.pc`.
   *
   * No reentrancy guard is needed, and deliberately so: the handler's first
   * real act is `xor a / ld (0x7d84),a`, clearing the NMI mask. The hardware
   * gate is the guard, so modelling it faithfully gets the mutual exclusion
   * for free rather than bolting on a JS flag that could disagree with it.
   */
  fireNmi() {
    if (!this.pcKnown) {
      throw new Error(
        `NMI accepted at cycle ${this.cycles} but the ROM PC is unknown: the ` +
          "routine executing here uses tick() rather than step(), so the " +
          "value pushed would be stale. The pushed PC lands in diffed work " +
          "RAM, so pushing a guess is worse than stopping. Convert that " +
          "routine to step().",
      );
    }
    this.nmiCount += 1;
    // THE Z80 SPENDS 11 T-STATES ACCEPTING AN NMI before the handler's first
    // byte is fetched: an acknowledge M1 cycle plus the PC push. Charging
    // nothing for it started the handler 11 cycles early on every interrupt.
    //
    // Found as a CONSTANT 11-cycle offset -- not jitter -- between our NMI
    // entry (202760) and MAME's (202771), and again at sub_0141's entry
    // (202908 vs 202919). A constant offset at two points inside the same
    // handler is a missing fixed cost, not instruction-boundary alignment.
    this.push16(this.pc);
    this.cycles += 11;
    entry_0066(this);
  }

  /**
   * Advance the T-state clock and capture a state dump whenever a frame
   * boundary is crossed. Translated instructions call this with their real
   * T-state cost, so boundaries land exactly where they do on hardware.
   *
   * The capture happens MID-INSTRUCTION-STREAM by design: state[N] is
   * whatever memory holds at the instant the boundary is crossed, which is
   * how MAME's frame notifier samples too.
   */
  tick(n) {
    this.cycles += n;

    // ORDER MATTERS AND IS NOT ARBITRARY. The state sample and the NMI
    // assertion happen at the SAME instant (cycle N * 50688), and sampling
    // is defined to occur BEFORE execution -- so state[N] must never contain
    // frame N's own NMI effects. Capturing first is what makes that true.
    // Drain BEFORE the boundary check, and the ORDERING is what makes this
    // safe -- not a margin. Row 223 is due at N*50688 + 50496, only 192
    // cycles before the frame ends, and the largest real tick is the
    // 3121-cycle DMA stall. So the margin is NEGATIVE by 16x and would drop
    // frames constantly if safety depended on it. It does not: entering the
    // boundary loop requires cycles >= (N+1)*50688 > row 223's due time, so
    // draining first paints every row regardless of tick size.
    //
    // (These numbers were 45888 and "4800 cycles early" while VBLANK_LINES
    // was mistakenly VBEND. A reader checking "is 3121 < 4800?" would have
    // concluded there was headroom. There is none; the ordering is the
    // guarantee.)
    this.drainRaster();

    while (this.cycles >= this.nextBoundary && this.frames.length < this.maxFrames) {
      this.applyInputs(this.frames.length); // assert inputs for frame N
      this.applyPokes(this.frames.length); // poke frame N before sampling state[N]
      this.frames.push(this.dumpState());
      // The frame the beam has just FINISHED painting is complete now, so
      // this is where it is published. videoFrames[N] is the image of frame
      // N -- composed row by row DURING frame N, not snapshotted at either
      // end of it. See renderRowRGB for why a snapshot is not sufficient.
      if (this.captureVideo) this.finishRasterFrame();
      this.nextBoundary += CYCLES_PER_FRAME;
    }

    this.drainRaster();

    // Stopping is bounded by CYCLES, not by frame count. Those are different
    // things and conflating them cost a real artifact: throwing the instant
    // the last frame was captured stopped execution at the frame boundary,
    // which is exactly one instant BEFORE the NMI is checked -- so a
    // 5-frame run produced a hardware write trace containing no NMI writes
    // at all. Frame capture is a sampling concern; how far to execute is not.
    if (this.cycles >= this.maxCycles) throw new FramesComplete();

    // Vblank is checked at an instruction boundary, which is where tick() is
    // called from -- the Z80 also only accepts an NMI between instructions,
    // which is where the measured 10-21 cycle entry jitter comes from.
    if (this.cycles >= this.nextNmi) {
      this.nextNmi += CYCLES_PER_FRAME;
      if (this.io.nmiMask) this.fireNmi();
    }

    // A bare tick() is an instruction whose successor address was never
    // recorded, so the PC is stale from here until the next step().
    // INVALIDATING AT THE END, after the NMI check, is what makes the guard
    // in fireNmi able to fire at all: it lets pcKnown return to false once a
    // step() has run. Not every routine maintains the PC (boot.js and nmi.js
    // still do not), so without this invalidation the guard would be inert.
    this.pcKnown = false;
  }

  /**
   * Run from reset, capturing `count` state frames.
   * frame 0 = power-on, sampled before a single instruction runs.
   */
  runFrames(count) {
    this.applyPokes(0); // frame-0 pokes (pre-boot) before sampling state[0]
    this.frames = [this.dumpState()]; // state[0], power-on
    this.videoFrames = [];
    this.droppedFrames = 0;
    // Frame 0 starts being PAINTED here; it is published when the boundary
    // into frame 1 is crossed. Nothing to snapshot -- the image of frame 0 is
    // not knowable until frame 0 has been executed.
    if (this.captureVideo) this.startRasterFrame(0);
    if (count <= 1) return this.frames; // nothing to execute

    this.maxFrames = count;
    // Run a little past the last sampled frame so per-frame side effects that
    // land just after a boundary -- the NMI is 11-30 cycles after it -- are
    // still executed and traced. Frames beyond `count` simply are not
    // captured.
    this.maxCycles = count * CYCLES_PER_FRAME + CYCLES_PER_FRAME;
    this.cycles = 0;
    this.nextBoundary = CYCLES_PER_FRAME;
    this.nextNmi = NMI_CYCLE_IN_FRAME;
    this.stoppedBy = null;
    try {
      this.reset();
    } catch (e) {
      if (e instanceof FramesComplete) {
        // Ran the full cycle budget -- the normal end of a bounded run.
      } else if (e instanceof NotImplemented) {
        // Translation ran out. The frames already captured are still valid,
        // so keep them and record WHY we stopped rather than discarding the
        // run or pretending it completed.
        this.stoppedBy = e.message;
      } else {
        throw e;
      }
    } finally {
      // Leave the Machine usable. Without this the frame limit stays armed
      // and every later tick throws.
      this.maxFrames = Infinity;
      this.maxCycles = Infinity;
      this.nextBoundary = Infinity;
    }
    return this.frames;
  }

  /**
   * Z80 reset: entry at PC=0x0000. Faithfully NEVER RETURNS -- boot falls
   * through into the main loop, which spins forever waiting on vblank. It
   * exits only via FramesComplete or a NotImplemented stub.
   */
  reset() {
    romReset(this);
    this.booted = true;
  }

  /** Reset through the end of boot only. See bootOnly() in ./translated/boot.js. */
  runBoot() {
    bootOnly(this);
    this.booted = true;
  }

  /**
   * THE STACK IS REAL MEMORY AND IT IS DIFFED.
   *
   * Control flow between translated routines is ordinary JS calling, but that
   * is not sufficient: the Z80 stack lives at the top of work RAM (`ld
   * sp,0x6c00` puts it at 0x6BFF downward), which is inside the 5120-byte
   * region diffed against MAME. If a translated `call` does not write its
   * return address to memory, our RAM differs from MAME's at addresses no
   * routine ever names.
   *
   * It also matters semantically: `rst 0x28` reads its own return address off
   * the stack to find an inline jump table, and the `pop hl / ret` idiom
   * returns past its caller. Those only work if the bytes are actually there.
   *
   * Note the Z80 does NOT clear popped bytes -- they stay in RAM after the
   * `ret`, which is why post-boot 0x6BFE/0x6BFF hold 0xB8/0x02 rather than
   * zero. So each translated `call NNNN` pushes its literal return address
   * (known at translation time) and the callee's `ret` pops it.
   */
  push16(value) {
    const { regs, mem } = this;
    regs.sp = (regs.sp - 2) & 0xffff;
    mem.write8(regs.sp, value & 0xff);
    mem.write8((regs.sp + 1) & 0xffff, (value >> 8) & 0xff);
  }

  pop16() {
    const { regs, mem } = this;
    const lo = mem.read8(regs.sp);
    const hi = mem.read8((regs.sp + 1) & 0xffff);
    regs.sp = (regs.sp + 2) & 0xffff;
    return lo | (hi << 8);
  }

  // RET: pop the return address and continue there. The popped value IS the
  // next PC, so it is what step() records -- which is why `ret` cannot just be
  // a JS `return`.
  ret(cycles = 10) {
    this.step(this.pop16(), cycles);
  }

  // LDIR at an arbitrary site: block-copy (DE)<-(HL), BC down, until BC==0.
  // `self` is the ROM address of the LDIR itself (charged 21 T-states per
  // iteration that repeats), `nextAddr` the instruction after it (16 on exit).
  ldirAt(self, nextAddr) {
    const { regs, mem } = this;
    for (;;) {
      mem.write8(regs.de, mem.read8(regs.hl));
      regs.hl = (regs.hl + 1) & 0xffff;
      regs.de = (regs.de + 1) & 0xffff;
      regs.bc = (regs.bc - 1) & 0xffff;
      if (regs.bc === 0) {
        this.step(nextAddr, 16);
        return;
      }
      this.step(self, 21);
    }
  }

  // The fixed-site LDIR at ROM 0x01CF.
  ldir(nextAddr) {
    return this.ldirAt(0x01cf, nextAddr);
  }

  /**
   * Render the current frame to 256x224 RGB888, per the frame-sampling contract.
   * Requires gfx1 and proms at construction.
   */
  renderFrame() {
    if (!this.video) throw new Error("renderFrame needs gfx1 and proms");
    return renderFrameRGB(
      this.mem.videoRam,
      this.video.tiles,
      this.video.charColour,
      this.video.palette,
      { gfxBank: 0, paletteBank: this.io.paletteBank, flip: this.io.flipScreen },
    );
  }

  /**
   * Paint every scanline the beam has passed since the last call, each from
   * video RAM AS IT STANDS AT THAT MOMENT. That is what makes a mid-frame
   * flip or a mid-frame VRAM rewrite come out as the composite the hardware
   * actually produces rather than as a snapshot of either side of it.
   *
   * GRANULARITY IS THE TICK, NOT THE SCANLINE. Rows are painted after an
   * instruction completes, using the flip and palette-bank state as of then,
   * so a tick spanning several lines paints them all with end-of-tick state.
   * Harmless for the 3121-cycle DMA stall (it targets sprite RAM at 0x7000,
   * touches neither videoRam nor flip), but it is an approximation and not a
   * scanline-exact model -- recorded so it is not mistaken for one.
   */
  drainRaster() {
    if (!this.captureVideo || this.rasterBuf === null) return;
    while (this.rasterRow < SCREEN_H && this.cycles >= this.nextRowCycle) {
      renderRowRGB(
        this.rasterBuf, this.rasterRow, this.mem.videoRam, this.video.tiles,
        this.video.charColour, this.video.palette,
        { gfxBank: 0, paletteBank: this.io.paletteBank, flip: this.io.flipScreen },
      );
      this.rasterRow++;
      this.nextRowCycle += CYCLES_PER_LINE;
    }
  }

  /**
   * Begin painting frame `n`. The first DISPLAYED scanline starts
   * VBLANK_LINES (40) in from the frame origin, which is the VBLANK POINT --
   * not VBEND (16), which numbers raster lines from a different zero.
   */
  startRasterFrame(n) {
    if (!this.video) throw new Error("raster capture needs gfx1 and proms");
    this.rasterBuf = new Uint8Array(256 * SCREEN_H * 3);
    this.rasterRow = 0;
    this.nextRowCycle = n * CYCLES_PER_FRAME + VBLANK_LINES * CYCLES_PER_LINE;
  }

  /**
   * Publish the frame just finished, and start the next.
   *
   * A frame whose scanlines were not all painted is DROPPED rather than
   * published half-black. The only way to reach here with rows outstanding is
   * a run that stopped mid-frame, and an incomplete frame that looks like a
   * real one is worse than a missing one -- it would diff as a rendering
   * fault rather than as the short run it is.
   */
  finishRasterFrame() {
    if (this.rasterBuf !== null && this.rasterRow === SCREEN_H) {
      // SPRITE POST-PASS. The tilemap scanlines are all painted; sprites are a
      // frame-level pass on top, from OUR sprite RAM at end-of-frame. This is
      // the end-to-end counterpart of rasterconf's stage-1 draw (which feeds
      // GOLDEN sprite RAM) -- here the sprite RAM is what our own CPU + DMA
      // produced, so a red now is translation-or-timing, never the draw model
      // (that was proven correct against golden). Sprite RAM is zero on the
      // pre-sprite frames, so drawSprites is a no-op there and the frames
      // 0-516 are byte-unchanged.
      if (this.video.sprites) {
        drawSprites(
          this.rasterBuf, this.mem.spriteRam, this.video.sprites,
          this.video.palette,
          {
            flip: this.io.flipScreen,
            paletteBank: this.io.paletteBank,
            spriteBank: this.io.spriteBank,
          },
        );
      }
      this.videoFrames.push(this.rasterBuf);
    } else if (this.rasterBuf !== null) {
      // NOT reachable on the run-stopped-mid-frame path, contrary to what
      // this said: that path THROWS and never returns here (measured -- a
      // 7-frame run stopping at 0x0763 leaves rasterRow at 6 and drops
      // nothing). With drainRaster() now running before the boundary, the
      // only way to arrive with rows outstanding is a tick longer than a
      // frame. Kept as a tripwire for exactly that, not as normal operation.
      this.droppedFrames += 1;
    }
    // The state for the boundary we are on has ALREADY been pushed, so
    // frames.length is N+1 when frame N is beginning. Passing frames.length
    // put nextRowCycle a whole frame ahead, no scanline ever came due, and
    // every frame was silently dropped as unfinished -- which the emitter's
    // count assertion caught rather than writing a one-frame file.
    this.startRasterFrame(this.frames.length - 1);
  }

  /** 5120-byte state dump: work + sprite + video, per the frame-sampling contract. */
  dumpState() {
    return this.mem.dumpState();
  }
}
