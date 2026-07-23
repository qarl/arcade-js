// SPDX-License-Identifier: GPL-3.0-only
/**
 * Donkey Kong I/O devices: input ports, the ls259.6h / ls175.3d latches,
 * the discrete control writes at 0x7D80-0x7D87, the watchdog, and the i8257
 * DMA controller.
 *
 * Bit maps are from MAME's src/mame/nintendo/dkong.cpp.
 *
 * Every stub here THROWS rather than silently accepting, because an
 * unimplemented device that quietly returns 0 is indistinguishable from a
 * correct one until a pixel diff fails 400 frames later. Throwing turns
 * "not yet implemented" into a coverage signal that names itself.
 */

/**
 * Z80 clocks the i8257 steals per byte of a memory-to-memory transfer:
 * two bus cycles (ch0 read into the latch, ch1 write out), 4 clocks each.
 *
 * VERIFIED from MAME's i8257.cpp: execute_run() is
 * `do { switch (m_state) {...} m_icount--; } while (m_icount > 0)`, so
 * `m_icount--` sits OUTSIDE the switch and every state costs exactly one
 * device clock. A bus cycle is S1->S2->S3->S4 = 4. Memory-to-memory needs
 * two channel operations per byte. The device runs at CLOCK_1H = 3,072,000
 * Hz, identical to the Z80, so device clocks ARE T-states 1:1.
 */
export const CYCLES_PER_DMA_BYTE = 8;

/**
 * Per-burst device states outside the transfer loop.
 *
 * VERIFIED: S0 (which does set_hreq(1) then suspends) and the final SI
 * transition after the last S4. Crucially S4 branches back to S1, NOT S0 --
 * so the handshake is paid ONCE PER BURST, never per byte. That is what
 * proves the remaining residual cannot be hiding inside the transfer loop.
 */
export const DMA_BURST_STATES = 2;

/**
 * DMA_BUS_ACQUISITION -- FALSIFIED. THE QUANTITY IT NAMES DOES NOT EXIST.
 *
 * Kept at 39 and labelled rather than removed or re-fitted, because the model
 * needs *a* number here and a labelled wrong one is safer than a plausible
 * unlabelled one. The state gate is 6/6 green with this error present.
 *
 * WHAT IS SUPPORTED (600 bursts, two byte-identical runs):
 *   - The burst does not take a fixed TIME. It COMPLETES at a fixed PHASE.
 *     sub_0141's return lands on only three cycle-in-frame values (3534 n=161,
 *     3580 n=437, 3585 n=2) while its start varies over thirteen. Constant
 *     end, varying duration -- the opposite signature from a fixed cost.
 *   - So "acquisition overhead" was an artifact of measuring duration from a
 *     jittering start (NMI entry lands wherever the CPU was) to a fixed end.
 *   - The anomalies are DETERMINISTIC, not noise: identical bursts at
 *     identical indices across independent runs.
 *   - All variance is inside the DRQ-high..DRQ-low window; the eleven
 *     programming write offsets are bit-identical across every burst.
 *
 * WHAT IS NOT SUPPORTED, and was claimed at various points before being
 * retracted: no period, no lattice, no excluded clock domains. Two populated
 * completion points permit a 46-cycle spacing; they do not evidence a period,
 * and the third observed point contradicts one.
 *
 * WHY WE STOPPED, so this is not re-opened by accident: THE QUESTION IS NOT
 * IDENTIFIABLE FROM THIS ROM. DK emits its DRQ writes across a 15-cycle
 * window (phase 420-435), so no amount of further capture can reveal
 * quantization points outside that neighbourhood -- the ROM does not produce
 * the variation required to probe it. Same argument as the 385-byte
 * transfers, where a fixed cost and a per-byte rate error were
 * indistinguishable because every transfer was the same size.
 *
 * MODEL NOW MEASURED (see README): completion is the first lattice point
 * >= assert_phase + 3099, with the lattice at 25 (mod 46). 719 of 721 bursts;
 * every other step in 20..119 scores exactly the always-guess-the-mode
 * baseline. The floor is DERIVED (385x8 + 2 states + 17 CPU cycles) and the
 * step is MEASURED; only the phase is fitted. The MECHANISM for 46 is still
 * unknown, and two outliers remain unexplained -- so this stays a labelled
 * wrong number rather than becoming a hardcoded right-looking one.
 *
 * RE-OPEN CONDITION MET -- THIS IS NOW BLOCKING. It causes a real write-trace
 * divergence at write 54, and 721 golden bursts show SEVENTEEN distinct
 * durations landing on only THREE completion phases (3521, 3567, 3572). The
 * burst is quantised to a completion phase; a fixed cost cannot express that,
 * which is why our first burst matches with 39 and the second needs 3. The
 * derivable floor is 3083 stall / 3100 duration. See README.
 *
 * If it turns out to be a MAME scheduling artifact rather than emulated
 * hardware, it gets reproduced and labelled as an artifact -- never allowed
 * to become silently load-bearing.
 */
export const DMA_BUS_ACQUISITION = 39; // FALSIFIED -- see above and README

export class NotImplemented extends Error {
  constructor(what) {
    super(`not implemented: ${what}`);
    this.name = "NotImplemented";
  }
}

/**
 * The watchdog. Reading IN2 (0x7D00) resets it -- the READ is the kick;
 * nothing ever writes to a watchdog register. DK's NMI reads 0x7D00 every
 * frame, so in normal operation it is fed once per vblank.
 *
 * MAME's watchdog for dkong expires after a fixed number of vblanks with no
 * kick and resets the machine. We count the same way so that a translation
 * bug which stops the NMI running produces the same reset MAME produces,
 * rather than the two silently diverging.
 *
 * UNVERIFIED: timeoutFrames = 16 is a PLACEHOLDER, not a fact. The kick
 * mechanism is understood but no count has been confirmed, and nothing calls
 * tickFrame() yet. Get the real value out of dkong.cpp before
 * this becomes load-bearing -- an invented constant that happens to work is
 * exactly the hazard this guards against.
 */
export class Watchdog {
  constructor(timeoutFrames = 16) {
    this.timeoutFrames = timeoutFrames;
    this.framesSinceKick = 0;
    this.enabled = true;
  }

  kick() {
    this.framesSinceKick = 0;
  }

  /** Call once per completed frame. Returns true if the machine should reset. */
  tickFrame() {
    if (!this.enabled) return false;
    this.framesSinceKick += 1;
    return this.framesSinceKick > this.timeoutFrames;
  }
}

/** IN2 bit assignments (0x7D00). b1/b4/b5 are unknown -- read as 0. */
export const IN2_SERVICE = 1 << 0;
export const IN2_START1 = 1 << 2;
export const IN2_START2 = 1 << 3;
export const IN2_CUSTOM = 1 << 6;
export const IN2_COIN1 = 1 << 7;

/**
 * i8257 DMA controller. Sprites reach the screen through this, not through
 * direct writes: sprite RAM at 0x7000-0x73FF is blitted when the code kicks
 * DRQ at 0x7D85. Modelling sprite RAM as "the thing the renderer reads" gets
 * the WHEN wrong even when the WHAT is right.
 *
 * Registers are stubbed until the boot path actually touches them, so the
 * first access tells us exactly which routine drives it.
 */
export class I8257 {
  /**
   * @param {AddressSpace} mem  set by AddressSpace's constructor; the DMA
   *   moves data through the SAME address space the CPU sees, so writes land
   *   in the real arrays and show up in the state diff.
   */
  constructor() {
    // Four channels, each a 16-bit address and a 16-bit count register.
    // Both are written as two successive 8-bit writes to the SAME address,
    // selected by an internal high/low flip-flop -- which is why sub_0141
    // writes 0x7800 twice in a row rather than 0x7800 then 0x7801.
    this.addr = new Uint16Array(4);
    this.count = new Uint16Array(4);
    this.flipFlop = 0; // 0 = next write is the low byte
    this.mode = 0;
    this.drq = 0;
    this.transfers = 0;
    this.bytesMoved = 0;
    this.mem = null;
    // Defensive init: only setDrq's rising-edge branch assigns this, so a
    // cycle-charge read before the first rising DRQ would otherwise be
    // undefined and silently NaN-poison the clock. Behavior-neutral today.
    this.cyclesStolen = 0;
  }

  read(offset) {
    throw new NotImplemented(`i8257 register read 0x${offset.toString(16)}`);
  }

  write(offset, value) {
    if (offset === 0x08) {
      this.mode = value;
      // Writing the mode register resets the byte pointer flip-flop.
      this.flipFlop = 0;
      return;
    }
    if (offset > 0x07) {
      throw new NotImplemented(`i8257 register write 0x${offset.toString(16)}`);
    }
    const ch = offset >> 1;
    const isCount = (offset & 1) === 1;
    const reg = isCount ? this.count : this.addr;
    if (this.flipFlop === 0) {
      reg[ch] = (reg[ch] & 0xff00) | value;
    } else {
      reg[ch] = (reg[ch] & 0x00ff) | (value << 8);
    }
    this.flipFlop ^= 1;
  }

  /**
   * DRQ at 0x7D85. The rising edge is what actually moves sprite data --
   * modelling sprite RAM as "the thing the renderer reads" gets the WHEN
   * wrong even when the WHAT is right.
   *
   * DIRECTION: channel 0 is the SOURCE, channel 1 the DESTINATION.
   *
   * Derived from the ROM rather than from the 8257 datasheet's count-register
   * mode bits, which read the opposite way and which DK's hardware does not
   * use conventionally (the 8257 has no memory-to-memory mode; the board
   * wires DRQ so one channel reads while the other writes). The ROM settles
   * it: traced code stores into 0x69xx at 55 sites and builds sprite records
   * there (`ld hl,0x690b`, `ld hl,0x6908`, ...), while 0x7000 is referenced
   * exactly ONCE -- boot's clear loop. Nothing fills sprite RAM directly, so
   * 0x6900 must be the source.
   *
   * PENDING CROSS-CHECK against MAME's driver. Both regions
   * are inside the diffed 5120 bytes, so a reversed direction does not fail
   * safe -- it writes plausible data into both and would read as a bug in
   * whatever routine ran last.
   */
  setDrq(bit) {
    const rising = bit && !this.drq;
    this.drq = bit;
    if (!rising) return;
    if (!this.mem) throw new NotImplemented("i8257 has no address space bound");

    // The count register holds n-1 in its low 14 bits.
    const n = (this.count[0] & 0x3fff) + 1;

    // THE TRANSFER COSTS THE CPU TIME. The 8257 takes the bus while it runs,
    // so the Z80 is halted -- modelling the transfer's EFFECT (right bytes,
    // right place) without its COST left us 3,114 cycles fast per NMI, which
    // showed up as arriving at sub_037f 3,114 cycles early.
    //
    // DERIVED, not fitted: a memory-to-memory byte is TWO bus cycles (read
    // into the latch on ch0, write out on ch1) and an 8257 bus cycle is 4
    // clocks (S1-S4), so 8 clocks per byte.
    //
    // 385 * 8 = 3080 transfer, + 2 burst states, + 32 bus acquisition = 3114,
    // which is the measured cost. Each term is stated separately because they
    // are different KINDS of fact -- see the constants above.
    this.cyclesStolen =
      n * CYCLES_PER_DMA_BYTE + DMA_BURST_STATES + DMA_BUS_ACQUISITION;
    let src = this.addr[0];
    let dst = this.addr[1];
    for (let i = 0; i < n; i++) {
      this.mem.write8(dst, this.mem.read8(src));
      src = (src + 1) & 0xffff;
      dst = (dst + 1) & 0xffff;
    }
    this.addr[0] = src;
    this.addr[1] = dst;
    this.transfers += 1;
    this.bytesMoved += n;
  }
}

export class IO {
  /**
   * @param {object} opts
   * @param {object} opts.inputs  live input state (see Inputs below)
   */
  constructor({ inputs } = {}) {
    this.inputs = inputs ?? new Inputs();
    this.watchdog = new Watchdog();
    this.dma = new I8257();

    // ls259.6h latch, one bit per address 0x7D00-0x7D07.
    this.latch6h = new Uint8Array(8);

    // Discrete control bits.
    this.nmiMask = 0;
    this.flipScreen = 0;
    this.spriteBank = 0;
    this.paletteBank = 0;
    this.gridEnable = 0;
    this.audioIrq = 0;

    this.soundLatch3d = 0;
    this.soundWrites = 0;

    /**
     * OPTIONAL SOUND-WRITE TAP -- null unless something outside the emulation
     * asks for it. `(addr, value) => void`, called AFTER the latch has been
     * updated, for writes to the two sound-command surfaces only:
     *
     *   0x7C00        ls175.3d tune latch  (value as written by the Z80)
     *   0x7D00-0x7D07 ls259.6h trigger bit (value already masked to 0/1)
     *
     * WHY IT IS A PLAIN NULLABLE FIELD, AND WHY THAT IS ZERO-COST WHEN UNSET.
     * Both call sites already were function calls reached only by those exact
     * addresses (memory.js routes them here), so the tap adds no dispatch and
     * no branch anywhere else on the write path -- an ordinary RAM, VRAM or
     * control-latch write never even loads this field. When it is null the
     * added work is one monomorphic field load and one `!== null` compare, per
     * sound write; DK makes about ten of those per frame out of 50688 cycles.
     * Nothing is allocated, here or in the caller.
     *
     * It CANNOT change emulation. It runs after the store, its return value is
     * discarded, and it is handed only values the machine already committed --
     * so the only way it could perturb a frame is by throwing, which is why the
     * contract is that a listener must not throw. Audio lives strictly above
     * the emulation (see core/audio.js); this is the one wire down to it, and
     * the pixel gates (move_suite/prize_suite) are what prove it inert.
     *
     * 0x7D80 (the I8035 IRQ line -- "death") is deliberately NOT tapped: it
     * shares its address range with flipscreen/NMI-mask/DRQ, and no recorder
     * phase captures it, so there is no sample it could ever play.
     */
    this.onSoundWrite = null;

    // {port: bits} asserted this frame by emit.js --input; null = none.
    this.inputAssert = null;
  }

  // -- reads --------------------------------------------------------------
  // These are input ports. Note that WRITING these same addresses hits
  // entirely different devices; see ./memory.js.

  // inputAssert (set by Machine.applyInputs from emit.js --input) ORs asserted
  // bits onto a port for the frames a tape entry covers -- coin/start/joystick
  // injection so the ROM's own credit/start logic drives gameplay.
  readIn0() {
    return (this.inputs.in0() | (this.inputAssert ? this.inputAssert[0x7c00] || 0 : 0)) & 0xff;
  }

  readIn1() {
    return (this.inputs.in1() | (this.inputAssert ? this.inputAssert[0x7c80] || 0 : 0)) & 0xff;
  }

  /**
   * IN2 (0x7D00). THE READ KICKS THE WATCHDOG -- this is the whole reason
   * reads route through a function instead of an array.
   */
  readIn2() {
    this.watchdog.kick();
    let r = this.inputs.in2();
    // MAME ORs SERVICE1 into bit 7: service counts as a coin.
    if (this.inputs.service1) r |= IN2_COIN1;
    if (this.inputAssert) r |= this.inputAssert[0x7d00] || 0;
    return r & 0xff;
  }

  readDsw0() {
    return this.inputs.dsw0();
  }

  // -- writes -------------------------------------------------------------

  /**
   * Sound latches. These are STORED rather than thrown on, because boot
   * legitimately writes them: sub_011c (ROM 0x011C, called at 0x02B5) zeroes
   * all eight ls259.6h bits and the ls175.3d latch to silence the machine
   * before enabling interrupts.
   *
   * Storing without driving a sound CPU is sufficient and not a shortcut:
   * the frame contract is video only (256x224 RGB), and the sound CPU is a
   * separate MB8884 that cannot affect maincpu-visible state -- the latches
   * are write-only from the Z80's side. If that ever stops being true we
   * will see it as a state diff, not as silence.
   */
  writeSoundLatch3d(value) {
    this.soundLatch3d = value;
    this.soundWrites += 1;
    if (this.onSoundWrite !== null) this.onSoundWrite(0x7c00, value);
  }

  writeSoundLatch6h(bit, value) {
    this.latch6h[bit] = value;
    this.soundWrites += 1;
    if (this.onSoundWrite !== null) this.onSoundWrite(0x7d00 + bit, value);
  }

  writeGridColor(value) {
    throw new NotImplemented(`grid color write 0x${value.toString(16)} (radarscp)`);
  }

  writeGridEnable(value) {
    throw new NotImplemented(`grid enable = ${value} (radarscp)`);
  }

  /** 0x7D80 -- also written by sub_011c during boot, so it stores. */
  writeAudioIrq(value) {
    this.audioIrq = value;
  }

  /**
   * 0x7D84 -- the vblank NMI mask. Boot clears it (interrupts off during
   * setup); the NMI handler clears it on entry and the epilogue at 0x00D2
   * sets it back to 1 before returning.
   */
  writeNmiMask(value) {
    this.nmiMask = value;
  }

  writeFlipScreen(value) {
    this.flipScreen = value;
  }

  writeSpriteBank(value) {
    this.spriteBank = value;
  }

  writePaletteBank(bit, value) {
    this.paletteBank =
      (this.paletteBank & ~(1 << bit)) | (value << bit);
  }

  writeDmaDrq(value) {
    this.dma.setDrq(value);
  }

  /**
   * Copy the i8257 / latch / input / watchdog VALUE-state from another IO of the
   * same board into this one -- the observable IO state a machine clone must
   * carry. This lives on IO because IO owns the field set (nmiMask, spriteBank,
   * latch6h, the DMA registers, the input mirror, the watchdog counters); a
   * cloner should not have to enumerate them.
   *
   * Deliberately does NOT touch dma.mem: the destination IO's AddressSpace
   * already bound its own dma.mem, and rebinding it to the source's address
   * space would make the clone's DMA write into the wrong RAM.
   */
  loadStateFrom(src) {
    this.nmiMask = src.nmiMask;
    this.flipScreen = src.flipScreen;
    this.spriteBank = src.spriteBank;
    this.paletteBank = src.paletteBank;
    this.gridEnable = src.gridEnable;
    this.audioIrq = src.audioIrq;
    this.soundLatch3d = src.soundLatch3d;
    this.soundWrites = src.soundWrites;
    this.latch6h.set(src.latch6h);
    this.inputAssert = src.inputAssert ? { ...src.inputAssert } : null;

    this.inputs.service1 = src.inputs.service1;
    this.inputs._in0 = src.inputs._in0;
    this.inputs._in1 = src.inputs._in1;
    this.inputs._in2 = src.inputs._in2;
    this.inputs._dsw0 = src.inputs._dsw0;

    this.watchdog.timeoutFrames = src.watchdog.timeoutFrames;
    this.watchdog.framesSinceKick = src.watchdog.framesSinceKick;
    this.watchdog.enabled = src.watchdog.enabled;

    this.dma.addr.set(src.dma.addr);
    this.dma.count.set(src.dma.count);
    this.dma.flipFlop = src.dma.flipFlop;
    this.dma.mode = src.dma.mode;
    this.dma.drq = src.dma.drq;
    this.dma.transfers = src.dma.transfers;
    this.dma.bytesMoved = src.dma.bytesMoved;
    this.dma.cyclesStolen = src.dma.cyclesStolen;
  }
}

/**
 * Input state. Defaults are the idle attract-mode state: nothing pressed.
 *
 * Active-high/active-low per port matters and is not guessed here -- these
 * defaults are "no input", and the validation harness's tapes drive the rest.
 *
 * SERVICE is deliberately absent from the API surface beyond this flag:
 * this is out-of-policy input. Holding it jumps to 0x4000, a
 * diagnostic ROM base dkong does not ship.
 */
export class Inputs {
  constructor() {
    this.service1 = false;
    this._in0 = 0x00;
    this._in1 = 0x00;
    this._in2 = 0x00;
    // DSW0 default is 0x80, NOT zero -- a stated harness-contract value from
    // MAME's dkong.cpp: Lives 0x03/default 0, Bonus_Life 0x0c/default 0,
    // Coinage 0x70/default 0, Cabinet 0x80/DEFAULT 0x80. Cabinet is the only
    // bit that defaults set, and it is the dangerous one: clearing it selects
    // cocktail mode, which FLIPS THE SCREEN via 0x7D82 -- a latch nothing can
    // currently observe. An unpinned input feeding an
    // unobservable output, so it is pinned here rather than defaulted to 0.
    this._dsw0 = 0x80;
  }

  in0() {
    return this._in0 & 0xff;
  }

  in1() {
    return this._in1 & 0xff;
  }

  in2() {
    return this._in2 & 0xff;
  }

  dsw0() {
    return this._dsw0 & 0xff;
  }
}
