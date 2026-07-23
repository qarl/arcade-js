// SPDX-License-Identifier: GPL-3.0-only
/**
 * Donkey Kong Z80 address space.
 *
 * Authoritative map from MAME's src/mame/nintendo/dkong.cpp. Do not
 * re-derive it from observation.
 *
 *   0x0000-0x3FFF  ROM (region is 0x0000-0x4FFF; base dkong populates 16KB)
 *   0x6000-0x6BFF  work RAM        <- note the bound: 0x6BFF, not 0x6FFF
 *   0x7000-0x73FF  sprite RAM      (reaches the screen via 8257 DMA)
 *   0x7400-0x77FF  video RAM       (tilemap)
 *   0x7800-0x780F  i8257 DMA
 *   0x7C00   R: IN0    W: ls175.3d sound latch
 *   0x7C80   R: IN1    W: grid color (radarscp only)
 *   0x7D00   R: IN2    W: 0x7D00-0x7D07 ls259.6h latch, bit0_w = sound triggers
 *   0x7D80   R: DSW0   W: audio IRQ
 *   0x7D81 grid enable | 0x7D82 flipscreen | 0x7D83 sprite bank
 *   0x7D84 NMI mask    | 0x7D85 8257 DRQ   | 0x7D86-87 palette bank (2 bits)
 *
 * THREE THINGS THIS MODEL EXISTS TO GET RIGHT:
 *
 * 1. A READ AND A WRITE AT THE SAME ADDRESS ARE DIFFERENT DEVICES. 0x7C00
 *    reads IN0 but writes the sound latch. Backing that address with a single
 *    array cell is silently wrong, so reads and writes route through separate
 *    functions and never share storage.
 *
 * 2. A READ IS NOT NECESSARILY A PURE FUNCTION. Reading 0x7D00 kicks the
 *    watchdog (dkong_in2_r calls watchdog_reset()). The NMI reads it every
 *    frame, so the watchdog is fed as an ISR side effect. Model it as a pure
 *    value read and the kick is silently dropped -- MAME eventually
 *    watchdog-resets and we don't, producing a divergence hundreds of frames
 *    downstream of its cause.
 *
 * 3. UNMAPPED ACCESS THROWS LOUDLY. A loud stub is a coverage signal; a silent
 *    one is a bug found 400 frames later. In particular 0x6C00-0x6FFF is NOT
 *    RAM despite sitting between mapped regions.
 *
 * State lives at its real address: 0x6A31 is workRam[0x0A31],
 * never a JS field named after what it holds. Named accessors elsewhere are a
 * *view* over these arrays; the arrays are the source of truth, because they
 * are what gets diffed against MAME.
 */

export const ROM_BASE = 0x0000;
export const ROM_END = 0x3fff;

export const WORK_RAM_BASE = 0x6000;
export const WORK_RAM_SIZE = 0x0c00; // 0x6000-0x6BFF, 3072 bytes

export const SPRITE_RAM_BASE = 0x7000;
export const SPRITE_RAM_SIZE = 0x0400; // 0x7000-0x73FF, 1024 bytes

export const VIDEO_RAM_BASE = 0x7400;
export const VIDEO_RAM_SIZE = 0x0400; // 0x7400-0x77FF, 1024 bytes

export const DMA_BASE = 0x7800;
export const DMA_END = 0x780f;

/**
 * 0x6C00-0x6FFF is NOT RAM, but boot writes to it anyway.
 *
 * The reset path's RAM clear at 0x0266 is `ld b,0x10 / ld hl,0x6000` with an
 * inner loop of 256 -- 16 x 256 = 4096 bytes, clearing 0x6000-0x6FFF. Work
 * RAM is only 3072 bytes, so the clear over-runs it by 0x400. That the ROM
 * clears a round 4KB when only 3KB exists is ordinary; the 0x6BFF bound is
 * confirmed twice over (MAME's map, and `ld sp,0x6c00` at 0x02b2 putting the
 * stack top at 0x6BFF).
 *
 * MAME silently discards writes to unmapped space, so we must too or boot
 * dies five instructions in. But discarding silently would hide a real
 * address bug later, so writes here are COUNTED: anything other than exactly
 * 1024 from this loop is a signal worth chasing. Reads still throw -- nothing
 * legitimately reads back from here.
 */
export const DISCARD_BASE = 0x6c00;
export const DISCARD_END = 0x6fff;

// The state-diff contract: work, sprite, video concatenated in this order.
export const STATE_DUMP_SIZE = WORK_RAM_SIZE + SPRITE_RAM_SIZE + VIDEO_RAM_SIZE; // 5120

export class UnmappedAccess extends Error {
  constructor(kind, addr, pc) {
    const at = pc === undefined ? "" : ` (pc=0x${hex4(pc)})`;
    super(`unmapped ${kind} at 0x${hex4(addr)}${at}`);
    this.name = "UnmappedAccess";
    this.addr = addr;
    this.pc = pc;
  }
}

function hex4(v) {
  return (v & 0xffff).toString(16).padStart(4, "0");
}

export class AddressSpace {
  /**
   * @param {Uint8Array} rom  16KB maincpu image (0x0000-0x3FFF)
   * @param {object} io       I/O device model (see ./io.js)
   */
  constructor(rom, io) {
    if (rom.length !== ROM_END + 1) {
      throw new Error(`expected a ${ROM_END + 1}-byte ROM, got ${rom.length}`);
    }
    this.rom = rom;
    this.io = io;
    // The DMA moves data through THIS address space, not around it, so its
    // writes land in the same arrays the state diff reads.
    if (io && io.dma) io.dma.mem = this;

    // Contiguous and dumpable, deliberately.
    this.workRam = new Uint8Array(WORK_RAM_SIZE);
    this.spriteRam = new Uint8Array(SPRITE_RAM_SIZE);
    this.videoRam = new Uint8Array(VIDEO_RAM_SIZE);

    // Optional: translated routines may set this so an unmapped access names
    // the ROM address that made it. Not wired up yet -- errors just omit it.
    this.pc = undefined;

    // Writes into 0x6C00-0x6FFF (see DISCARD_BASE). Counted, not hidden.
    this.discardedWrites = 0;

    // Hardware write trace, in EXECUTION ORDER. Order is part of the
    // contract, not an implementation detail: boot's latch sequence is
    // `xor a` / three stores / `inc a` / one store, so the first three carry
    // A=0 and the fourth A=1. A set comparison would call a reordered trace
    // equivalent, and it is not.
    this.writeTrace = null; // set to [] to start recording
    this.clock = null; // () => cycles, for the optional cycle column
  }

  /** True for the device addresses the write-diff contract covers. */
  static isHardwareWrite(addr) {
    return (
      (addr >= 0x7800 && addr <= 0x780f) || // i8257 programming
      addr === 0x7c00 || // ls175.3d sound latch
      addr === 0x7c80 || // grid colour
      (addr >= 0x7d00 && addr <= 0x7d07) || // ls259.6h sound triggers
      (addr >= 0x7d80 && addr <= 0x7d87) // flipscreen/banks/NMI mask/DRQ
    );
  }

  /**
   * Record a hardware write at the cycle its WRITE BUS CYCLE occurs.
   *
   * Lead ruling: adopt MAME's convention, since MAME is the reference and
   * the reference defines the units. The offset is a property of the
   * INSTRUCTION, not a constant: `ld (nn),a` is 13 T structured
   * 4 fetch + 3 lo + 3 hi + 3 write, so its bus cycle begins 10 T in, while
   * `ld (hl),a` and `ld (de),a` are 7 T = 4 fetch + 3 write and begin at 4.
   * A blanket 10 would be right for the control writes and wrong for all
   * sixteen sound-trigger writes.
   *
   * An untagged hardware write THROWS rather than defaulting. A default
   * would be silently wrong at exactly the sites nobody remembered to tag,
   * which is the failure mode this project keeps rediscovering.
   */
  _trace(addr, value, busOffset) {
    if (this.writeTrace === null) return;
    if (busOffset === undefined) {
      throw new Error(
        `hardware write to 0x${hex4(addr)} has no write-bus-cycle offset. ` +
          "Pass one from the instruction's T-state structure (ld (nn),a = 10, " +
          "ld (hl),a / ld (de),a = 4); guessing would put it in the wrong " +
          "place in the trace.",
      );
    }
    this.writeTrace.push({
      cycle: this.clock ? this.clock() + busOffset : null,
      addr,
      value,
    });
  }

  read8(addr) {
    addr &= 0xffff;

    if (addr <= ROM_END) return this.rom[addr];

    if (addr >= WORK_RAM_BASE && addr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      return this.workRam[addr - WORK_RAM_BASE];
    }
    if (addr >= SPRITE_RAM_BASE && addr < SPRITE_RAM_BASE + SPRITE_RAM_SIZE) {
      return this.spriteRam[addr - SPRITE_RAM_BASE];
    }
    if (addr >= VIDEO_RAM_BASE && addr < VIDEO_RAM_BASE + VIDEO_RAM_SIZE) {
      return this.videoRam[addr - VIDEO_RAM_BASE];
    }

    // Input ports. Deliberately NOT falling through to any array: these
    // addresses write to entirely different devices.
    switch (addr) {
      case 0x7c00:
        return this.io.readIn0();
      case 0x7c80:
        return this.io.readIn1();
      case 0x7d00:
        return this.io.readIn2(); // kicks the watchdog -- see header
      case 0x7d80:
        return this.io.readDsw0();
    }

    if (addr >= DMA_BASE && addr <= DMA_END) {
      return this.io.dma.read(addr - DMA_BASE);
    }

    throw new UnmappedAccess("read", addr, this.pc);
  }

  write8(addr, value, busOffset) {
    addr &= 0xffff;
    value &= 0xff;
    if (this.writeTrace !== null && AddressSpace.isHardwareWrite(addr)) {
      this._trace(addr, value, busOffset);
    }

    if (addr <= ROM_END) {
      // Writing to ROM is a no-op on real hardware, but in a translation it
      // means we got an address wrong. Fail loudly rather than absorb it.
      throw new UnmappedAccess("write to ROM", addr, this.pc);
    }

    if (addr >= WORK_RAM_BASE && addr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      this.workRam[addr - WORK_RAM_BASE] = value;
      return;
    }
    if (addr >= SPRITE_RAM_BASE && addr < SPRITE_RAM_BASE + SPRITE_RAM_SIZE) {
      this.spriteRam[addr - SPRITE_RAM_BASE] = value;
      return;
    }
    if (addr >= VIDEO_RAM_BASE && addr < VIDEO_RAM_BASE + VIDEO_RAM_SIZE) {
      this.videoRam[addr - VIDEO_RAM_BASE] = value;
      return;
    }

    // Not RAM -- boot's 4KB clear over-runs into here. Dropped, but counted.
    if (addr >= DISCARD_BASE && addr <= DISCARD_END) {
      this.discardedWrites += 1;
      return;
    }

    if (addr >= DMA_BASE && addr <= DMA_END) {
      this.io.dma.write(addr - DMA_BASE, value);
      return;
    }

    // ls259.6h addressable latch: one address per bit, data on bit 0.
    if (addr >= 0x7d00 && addr <= 0x7d07) {
      this.io.writeSoundLatch6h(addr - 0x7d00, value & 1);
      return;
    }

    switch (addr) {
      case 0x7c00:
        this.io.writeSoundLatch3d(value);
        return;
      case 0x7c80:
        this.io.writeGridColor(value); // radarscp only
        return;
      case 0x7d80:
        this.io.writeAudioIrq(value & 1);
        return;
      case 0x7d81:
        this.io.writeGridEnable(value & 1);
        return;
      case 0x7d82:
        this.io.writeFlipScreen(value & 1);
        return;
      case 0x7d83:
        this.io.writeSpriteBank(value & 1);
        return;
      case 0x7d84:
        this.io.writeNmiMask(value & 1);
        return;
      case 0x7d85:
        this.io.writeDmaDrq(value & 1);
        return;
      case 0x7d86:
      case 0x7d87:
        this.io.writePaletteBank(addr - 0x7d86, value & 1);
        return;
    }

    throw new UnmappedAccess("write", addr, this.pc);
  }

  read16(addr) {
    return this.read8(addr) | (this.read8((addr + 1) & 0xffff) << 8);
  }

  write16(addr, value) {
    this.write8(addr, value & 0xff);
    this.write8((addr + 1) & 0xffff, (value >> 8) & 0xff);
  }

  /**
   * State-diff artifact: work, sprite, video concatenated, 5120 bytes.
   * Sampled at the frame boundary BEFORE that frame's CPU execution, so
   * state[0] is power-on state before a single instruction runs.
   */
  dumpState() {
    const out = new Uint8Array(STATE_DUMP_SIZE);
    out.set(this.workRam, 0);
    out.set(this.spriteRam, WORK_RAM_SIZE);
    out.set(this.videoRam, WORK_RAM_SIZE + SPRITE_RAM_SIZE);
    return out;
  }

  /**
   * Inverse of dumpState()'s layout: map a byte offset in the 5120-byte dump
   * back to the RAM address it came from. The dump is work(0x6000..) +
   * sprite(0x7000..) + video(0x7400..) concatenated in that order, so the board
   * -- which defines that concatenation -- owns the reverse map too. The
   * equivalence engine uses it to name the address a state diff diverges at,
   * without hardcoding the region bases.
   */
  stateOffsetToAddr(off) {
    if (off < WORK_RAM_SIZE) return WORK_RAM_BASE + off;
    if (off < WORK_RAM_SIZE + SPRITE_RAM_SIZE) {
      return SPRITE_RAM_BASE + (off - WORK_RAM_SIZE);
    }
    return VIDEO_RAM_BASE + (off - WORK_RAM_SIZE - SPRITE_RAM_SIZE);
  }
}
