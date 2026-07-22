// SPDX-License-Identifier: GPL-3.0-only
/**
 * Translated vblank NMI handler.
 *
 * DK uses NMI (0x0066), not IM1 -- the bytes at 0x0038 are an ordinary
 * subroutine, not an ISR.
 *
 * TIMING: the NMI fires AT the frame boundary, not partway into it.
 * `NMI_CYCLE_IN_FRAME` is 0 because MAME's frame origin for this driver IS the
 * vblank point, so vblank begins at the boundary and the NMI fires there.
 * (Real NMI entries land at frame N.000x, e.g. 202771, 253451, 304141.)
 *
 * THE HANDLER IS ALSO THE WATCHDOG KICK. `ld a,(0x7d00)` at 0x0072 reads IN2,
 * and that READ resets the watchdog -- nothing ever writes a watchdog
 * register. So the dog is fed exactly once per vblank, as a side effect of
 * reading the inputs. A translation that stops running the NMI therefore also
 * stops feeding the watchdog, and MAME would reset while we sail on.
 */

import { NotImplemented } from "../../../boards/dkong/io.js";
import {
  handler_01c3, handler_0779, sub_004e, sub_0874, sub_0f56, sub_2441, sub_2ff0,
  sub_309f,
  guard_3110, guard_311b, guard_3126, guard_3131,
  entry_3e99, sub_28b0, sub_28e0, sub_2901, handler_1977, sub_2880,
  loc_07cb, loc_0ee8, entry_0f1b, loc_08b2, loc_08ba, loc_08f8,
  loc_06fe, loc_0986, loc_09ab, sub_09d6, sub_09fe, sub_0a1b,
  loc_0a37, loc_0a63, loc_0a76, loc_0bda, loc_0a8a, loc_0abf,
  loc_0ae8, loc_0b06, loc_0b68, loc_0bb3, loc_3069, loc_07c3,
  loc_084b, loc_127c, entry_128b, loc_12ac, loc_12de, loc_17b6,
  loc_1839, loc_186f, loc_1880, loc_18c6, loc_197a, loc_1615,
  loc_16a3, loc_16bb, sub_1654, sub_1670, sub_168a, sub_1732,
  sub_1757, sub_178e, sub_0d27, sub_0d43,
  loc_138f, loc_13aa, loc_13bb, loc_141e, sub_0d00,
  sub_1486, loc_196b, loc_12f2, loc_1344, loc_13a1,
} from "./state0.js";
import { sub_011c } from "./boot.js";
import { sub_0030 } from "./mainloop.js";


/**
 * loc_0038 / sub_003d -- ROM 0x0038-0x0043  (12 bytes, 8 instructions)
 *
 *   0038  11 04 00     ld   de,0x0004     ; the `rst 0x38` entry
 *   003b  06 0a        ld   b,0x0a
 *   003d  79           ld   a,c           ; sub_003d, the SECOND entry
 *   003e  86           add  a,(hl)
 *   003f  77           ld   (hl),a
 *   0040  19           add  hl,de
 *   0041  10 fa        djnz 0x003d
 *   0043  c9           ret
 *
 * ONE ROUTINE WITH TWO ENTRY POINTS, and it must be taken as one. 0x003D is not
 * a separate routine; it is where 0x0038 falls through to, and where three
 * `call 0x003d` sites enter directly with their own DE and B.
 *
 * WHAT IT DOES: adds C to each of B bytes starting at HL, stride DE. Entered
 * via `rst 0x38` it is fixed at 10 bytes, stride 4; entered at 0x003D the
 * caller chooses both.
 *
 * THE FALL-THROUGH IS NOT A CALL. 0x003B runs into 0x003D with nothing
 * pushed, so the single `ret` at 0x0043 serves both entries -- via the rst it
 * pops the address the rst pushed, via a direct call it pops that call's. A
 * translation that made 0x0038 CALL 0x003D would unbalance the stack, which
 * is the defect this project just found in the rst 0x28 dispatcher: there the
 * push was modelled and the matching pop was not.
 *
 * `add a,(hl)` is 8-bit and WRAPS -- C = 0xFC at the 0x0D89 site is -4, so
 * this decrements. The carry it produces is overwritten each pass.
 *
 * `add hl,de` writes H, N and C (S/Z/PV preserved). The carry out of the
 * FINAL one survives `djnz` and `ret` and reaches the caller, so regs.addHl
 * is required rather than a bare 16-bit add -- the same shape as sub_11d3 and
 * as the defect already fixed at mainloop.js:878.
 *
 * B is not checked for zero. `djnz` decrements then tests, so B = 0 would run
 * 256 passes; the rst entry hardcodes 0x0A and no direct call site passes 0.
 */
export function sub_003d(m) {
  const { regs, mem } = m;

  do {
    // The whole body is the loop -- `djnz` targets 0x003D, this entry point.
    regs.a = regs.c;
    m.step(0x003e, 4); // ld a,c
    regs.add(mem.read8(regs.hl)); // 8-bit, wraps; C = 0xFC is -4
    m.step(0x003f, 7); // add a,(hl)
    mem.write8(regs.hl, regs.a);
    m.step(0x0040, 7); // ld (hl),a
    regs.addHl(regs.de); // writes H, N, C -- the final carry escapes
    m.step(0x0041, 11); // add hl,de
    regs.djnz();
    m.step(regs.b !== 0 ? 0x003d : 0x0043, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 0043 -- serves BOTH entry points
}

/** The `rst 0x38` entry: fixes stride 4 and count 10, then FALLS THROUGH. */
export function loc_0038(m) {
  const { regs } = m;

  regs.de = 0x0004; // the stride
  m.step(0x003b, 10); // ld de,0x0004
  regs.b = 0x0a; // ten bytes
  m.step(0x003d, 7); // ld b,0x0a

  // FALL-THROUGH, not a call: nothing is pushed here, and sub_003d's `ret`
  // pops whatever the `rst 0x38` pushed at the call site.
  sub_003d(m);
}

/**
 * entry_0066 -- ROM 0x0066-0x00DF  (vblank NMI)
 *
 *   0066  f5           push af
 *   0067  c5           push bc
 *   0068  d5           push de
 *   0069  e5           push hl
 *   006a  dd e5        push ix
 *   006c  fd e5        push iy
 *   006e  af           xor  a
 *   006f  32 84 7d     ld   (0x7d84),a
 *   0072  3a 00 7d     ld   a,(0x7d00)
 *   0075  e6 01        and  0x01
 *   0077  c2 00 40     jp   nz,0x4000
 *   007a  21 38 01     ld   hl,0x0138
 *   007d  cd 41 01     call 0x0141
 *   0080  3a 07 60     ld   a,(0x6007)
 *   0083  a7           and  a
 *   0084  c2 b5 00     jp   nz,0x00b5
 *   0087  3a 26 60     ld   a,(0x6026)
 *   008a  a7           and  a
 *   008b  c2 98 00     jp   nz,0x0098
 *   008e  3a 0e 60     ld   a,(0x600e)
 *   0091  a7           and  a
 *   0092  3a 80 7c     ld   a,(0x7c80)
 *   0095  c2 9b 00     jp   nz,0x009b
 *   0098  3a 00 7c     ld   a,(0x7c00)       ; loc_0098
 *   009b  47           ld   b,a              ; loc_009b
 *   009c  e6 0f        and  0x0f
 *   009e  4f           ld   c,a
 *   009f  3a 11 60     ld   a,(0x6011)
 *   00a2  2f           cpl
 *   00a3  a0           and  b
 *   00a4  e6 10        and  0x10
 *   00a6  17           rla
 *   00a7  17           rla
 *   00a8  17           rla
 *   00a9  b1           or   c
 *   00aa  60           ld   h,b
 *   00ab  6f           ld   l,a
 *   00ac  22 10 60     ld   (0x6010),hl
 *   00af  78           ld   a,b
 *   00b0  cb 77        bit  6,a
 *   00b2  c2 00 00     jp   nz,0x0000
 *   00b5  21 1a 60     ld   hl,0x601a        ; loc_00b5
 *   00b8  35           dec  (hl)
 *   00b9  cd 57 00     call 0x0057
 *   00bc  cd 7b 01     call 0x017b
 *   00bf  cd e0 00     call 0x00e0
 *   00c2  21 d2 00     ld   hl,0x00d2
 *   00c5  e5           push hl
 *   00c6  3a 05 60     ld   a,(0x6005)
 *   00c9  ef           rst  0x28
 *   00ca  <4-entry jump table: 0x01c3 0x073c 0x08b2 0x06fe>
 *   00d2  fd e1        pop  iy               ; loc_00d2
 *   00d4  dd e1        pop  ix
 *   00d6  e1           pop  hl
 *   00d7  d1           pop  de
 *   00d8  c1           pop  bc
 *   00d9  3e 01        ld   a,0x01
 *   00db  32 84 7d     ld   (0x7d84),a
 *   00de  f1           pop  af
 *   00df  c9           ret
 *
 * Structure: acknowledge (clear the NMI mask), read inputs, blit sprites via
 * DMA, debounce/latch the controls into 0x6010/0x6011, decrement the frame
 * counter at 0x601A -- which is what releases the main loop's spin -- then
 * dispatch on game state 0x6005 through the 4-entry table at 0x00CA, and
 * restore.
 *
 * NOTE the counter at 0x601A is DECREMENTED here. The main loop increments a
 * DIFFERENT address (0x6019) and only compares 0x601A against its saved copy
 * at 0x6383, so the direction never mattered to the loop -- but getting it
 * backwards would corrupt every timer keyed off it.
 *
 * `ret` and not `retn`: DK gates interrupts with the 0x7D84 mask rather than
 * IFF, so the epilogue re-enables by writing the mask at 0x00DB. Note it
 * re-enables BEFORE `pop af`, so a pending NMI could in principle land
 * between the two.
 */
export function entry_0066(m) {
  const { regs, mem } = m;

  m.push16(regs.af);
  m.tick(11);
  m.push16(regs.bc);
  m.tick(11);
  m.push16(regs.de);
  m.tick(11);
  m.push16(regs.hl);
  m.tick(11);
  m.push16(regs.ix);
  m.tick(15);
  m.push16(regs.iy);
  m.tick(15);

  // Acknowledge: clearing the mask is the ack, and it also means a second
  // vblank cannot re-enter this handler until the epilogue re-enables it.
  regs.xor(regs.a);
  m.tick(4);
  mem.write8(0x7d84, regs.a, 10);
  m.tick(13);

  // Reading IN2 KICKS THE WATCHDOG -- the read is the kick.
  regs.a = mem.read8(0x7d00);
  m.tick(13);
  regs.and(0x01);
  m.tick(7);
  if (regs.fNZ) {
    m.tick(10);
    // SERVICE is out-of-policy input. 0x4000 is a diagnostic ROM base dkong
    // does not ship; MAME reads that region as 0x00 (a NOP slide), though our
    // AddressSpace throws there rather than modelling it. Throw rather than
    // model it -- this converts an unknown into a coverage assertion, and a
    // tape that reaches here is itself the bug.
    throw new NotImplemented(
      "SERVICE switch held: jp 0x4000 at ROM 0x0077 -- out-of-policy input, " +
        "no diagnostic ROM exists on this romset",
    );
  }
  m.tick(10);

  // Sprite DMA blit: HL points at the 9-byte i8257 setup block at 0x0138-0x0140.
  regs.hl = 0x0138;
  m.tick(10);
  m.push16(0x0080);
  m.tick(17);
  sub_0141(m);

  regs.a = mem.read8(0x6007);
  m.tick(13);
  regs.and(regs.a);
  m.tick(4);
  if (regs.fNZ) {
    m.tick(10); // jp nz,0x00b5 -- skip input handling entirely
    return perFrame(m);
  }
  m.tick(10);

  readControls(m);
  return perFrame(m);
}

/**
 * readControls -- ROM 0x0087-0x00B4
 *
 * Selects between IN1 (0x7C80) and IN0 (0x7C00) depending on 0x6026/0x600E
 * (two-player alternation), then debounces: 0x6011 holds the previous
 * reading, so `cpl / and b` keeps only bits that are newly set -- an
 * edge detector. The jump bit (0x10) is shifted up three places by the three
 * `rla`s and merged with the direction nibble, and the pair is stored to
 * 0x6010/0x6011 in one `ld (0x6010),hl`.
 */
function readControls(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6026);
  m.tick(13);
  regs.and(regs.a);
  m.tick(4);
  const twoPlayer = regs.fNZ;
  m.tick(10); // jp nz,0x0098

  if (!twoPlayer) {
    regs.a = mem.read8(0x600e);
    m.tick(13);
    regs.and(regs.a);
    m.tick(4);
    const alt = regs.fNZ;
    // NOTE: this read happens BETWEEN the flag-setting `and a` and the `jp nz`
    // that consumes it. `ld a,(nn)` does not affect flags, so the branch still
    // tests 0x600E -- but A now holds IN1. Translating these in the wrong
    // order would silently use the wrong port.
    regs.a = mem.read8(0x7c80); // IN1
    m.tick(13);
    m.tick(10); // jp nz,0x009b
    if (!alt) {
      regs.a = mem.read8(0x7c00); // loc_0098 -- IN0
      m.tick(13);
    }
  } else {
    regs.a = mem.read8(0x7c00); // loc_0098 -- IN0
    m.tick(13);
  }

  // loc_009b
  regs.b = regs.a;
  m.tick(4);
  regs.and(0x0f); // direction nibble
  m.tick(7);
  regs.c = regs.a;
  m.tick(4);
  regs.a = mem.read8(0x6011); // previous reading
  m.tick(13);
  regs.cpl();
  m.tick(4);
  regs.and(regs.b); // newly-set bits only (edge detect)
  m.tick(4);
  regs.and(0x10); // the jump bit
  m.tick(7);
  for (let i = 0; i < 3; i++) {
    regs.rla();
    m.tick(4);
  }
  regs.or(regs.c);
  m.tick(4);
  regs.h = regs.b;
  m.tick(4);
  regs.l = regs.a;
  m.tick(4);
  mem.write16(0x6010, regs.hl);
  m.tick(16);
  regs.a = regs.b;
  m.tick(4);
  const bit6 = regs.bit(6, regs.a);
  m.tick(8); // bit 6,a
  if (bit6) {
    m.tick(10);
    throw new NotImplemented(
      "input bit 6 set: jp 0x0000 at ROM 0x00B2 -- soft reset via input, " +
        "path not yet exercised",
    );
  }
  m.tick(10);
}

/**
 * perFrame -- ROM 0x00B5-0x00DF  (loc_00b5 through the epilogue)
 *
 * Decrementing 0x601A is what releases the main loop, which spins comparing
 * it against 0x6383.
 */
function perFrame(m) {
  const { regs, mem } = m;

  regs.hl = 0x601a;
  m.tick(10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl)
  m.tick(11);

  m.push16(0x00bc);
  m.tick(17);
  sub_0057(m);

  m.push16(0x00bf);
  m.tick(17);
  sub_017b(m);

  m.push16(0x00c2);
  m.tick(17);
  sub_00e0(m);

  // Push the epilogue address so the dispatched state handler's `ret` lands
  // on 0x00D2. This is the pattern that bounds the inline jump table exactly.
  regs.hl = 0x00d2;
  m.tick(10);
  m.push16(regs.hl);
  m.tick(11);
  regs.a = mem.read8(0x6005);
  m.tick(13);
  m.push16(0x00ca); // rst 0x28 pushes its return address = the table base
  m.tick(11);
  sub_0028(m);

  // loc_00d2 -- epilogue
  regs.iy = m.pop16();
  m.tick(14);
  regs.ix = m.pop16();
  m.tick(14);
  regs.hl = m.pop16();
  m.tick(10);
  regs.de = m.pop16();
  m.tick(10);
  regs.bc = m.pop16();
  m.tick(10);
  regs.a = 0x01;
  m.tick(7);
  mem.write8(0x7d84, regs.a, 10); // re-enable the NMI mask
  m.tick(13);
  regs.af = m.pop16();
  m.tick(10);
  // Was `m.pop16(); m.tick(10)`, which charged the cycles correctly but used
  // tick() and so discarded the PC. Safe -- tick() clears pcKnown, and
  // fireNmi refuses to push an unknown PC rather than guessing -- but it left
  // the machine unable to accept an NMI until the interrupted code's next
  // step(), for no reason. The popped value IS the return address.
  m.ret();
}

// -- not yet translated ---------------------------------------------------
// Throwing rather than returning silently keeps an unexercised path visible.
// Each names the call site that reaches it.

/**
 * sub_0141 -- ROM 0x0141-0x017A  "program the i8257 and kick the blit"
 *
 *   0141  af           xor  a
 *   0142  32 85 7d     ld   (0x7d85),a
 *   0145  7e           ld   a,(hl)
 *   0146  32 08 78     ld   (0x7808),a
 *   0149  23           inc  hl
 *   014a  7e           ld   a,(hl)
 *   014b  32 00 78     ld   (0x7800),a
 *   014e  23           inc  hl
 *   014f  7e           ld   a,(hl)
 *   0150  32 00 78     ld   (0x7800),a      <- SAME address again
 *   0153  23           inc  hl
 *   0154  7e           ld   a,(hl)
 *   0155  32 01 78     ld   (0x7801),a
 *   0158  23           inc  hl
 *   0159  7e           ld   a,(hl)
 *   015a  32 01 78     ld   (0x7801),a
 *   015d  23           inc  hl
 *   015e  7e           ld   a,(hl)
 *   015f  32 02 78     ld   (0x7802),a
 *   0162  23           inc  hl
 *   0163  7e           ld   a,(hl)
 *   0164  32 02 78     ld   (0x7802),a
 *   0167  23           inc  hl
 *   0168  7e           ld   a,(hl)
 *   0169  32 03 78     ld   (0x7803),a
 *   016c  23           inc  hl
 *   016d  7e           ld   a,(hl)
 *   016e  32 03 78     ld   (0x7803),a
 *   0171  3e 01        ld   a,0x01
 *   0173  32 85 7d     ld   (0x7d85),a
 *   0176  af           xor  a
 *   0177  32 85 7d     ld   (0x7d85),a
 *   017a  c9           ret
 *
 * Nine bytes are read from (HL) -- the block at ROM 0x0138-0x0140 -- and
 * written to the 8257. Note each 16-bit register is written by storing TWICE
 * to the same address: the 8257 has an internal high/low byte flip-flop, so
 * `ld (0x7800),a` twice sets the low then the high byte of channel 0's
 * address. Translating those as two different registers would be silently
 * wrong.
 *
 * The block decodes to: mode 0x53, ch0 addr 0x6900 count 0x4180,
 * ch1 addr 0x7000 count 0x8180 -- 385 transfers (the count holds n-1), which
 * covers 96 sprites x 4 bytes plus one.
 *
 * Then DRQ at 0x7D85 is pulsed 1 then 0. THE RISING EDGE IS THE BLIT: sprite
 * data reaches the screen through this, not through direct writes, so the
 * WHEN matters as much as the WHAT.
 */
function sub_0141(m) {
  const { regs, mem } = m;

  regs.xor(regs.a);
  m.step(0x0142, 4);
  mem.write8(0x7d85, regs.a, 10); // DRQ low before programming
  m.step(0x0145, 13);

  // The nine register writes, in ROM order. Each pair to the same address
  // is low-byte-then-high-byte via the 8257's internal flip-flop.
  const WRITES = [
    [0x7808, 0x0146, 0x0149], [0x7800, 0x014b, 0x014e],
    [0x7800, 0x0150, 0x0153], [0x7801, 0x0155, 0x0158],
    [0x7801, 0x015a, 0x015d], [0x7802, 0x015f, 0x0162],
    [0x7802, 0x0164, 0x0167], [0x7803, 0x0169, 0x016c],
    [0x7803, 0x016e, null],
  ];
  for (const [port, afterStore, afterInc] of WRITES) {
    regs.a = mem.read8(regs.hl);
    m.step(afterStore - 3, 7); // ld a,(hl)
    mem.write8(port, regs.a, 10); // ld (nn),a
    m.step(afterInc === null ? 0x0171 : afterStore, 13); // ld (nn),a
    if (afterInc !== null) {
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(afterInc, 6); // inc hl
    }
  }

  regs.a = 0x01;
  m.step(0x0173, 7);
  mem.write8(0x7d85, regs.a, 10); // DRQ rising edge -- THE BLIT HAPPENS HERE
  // ORDER: the store instruction COMPLETES first, then the bus is granted.
  // MAME's Z80 checks BUSREQ in its ROP (opcode-fetch) state, so the grant
  // happens at the next INSTRUCTION boundary -- not mid-instruction. Charging
  // the stolen cycles before the instruction's own time had the CPU halted
  // partway through a store, which is not what the hardware does.
  m.step(0x0176, 13);
  m.tick(m.io.dma.cyclesStolen);
  m.io.dma.cyclesStolen = 0;
  regs.xor(regs.a);
  m.step(0x0177, 4);
  mem.write8(0x7d85, regs.a, 10);
  m.step(0x017a, 13);

  m.ret();
}

/**
 * sub_0057 -- ROM 0x0057-0x0065
 *
 *   0057  3a 18 60     ld   a,(0x6018)
 *   005a  21 1a 60     ld   hl,0x601a
 *   005d  86           add  a,(hl)
 *   005e  21 19 60     ld   hl,0x6019
 *   0061  86           add  a,(hl)
 *   0062  32 18 60     ld   (0x6018),a
 *   0065  c9           ret
 *
 * Accumulates the two frame counters into 0x6018 -- a cheap pseudo-random
 * seed, stirred once per vblank from values that advance at different rates
 * (0x601A decremented by the NMI, 0x6019 incremented by the main loop).
 */
export function sub_0057(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(0x6018);
  m.step(0x005a, 13);
  regs.hl = 0x601a;
  m.step(0x005d, 10);
  regs.add(mem.read8(regs.hl));
  m.step(0x005e, 7);
  regs.hl = 0x6019;
  m.step(0x0061, 10);
  regs.add(mem.read8(regs.hl));
  m.step(0x0062, 7);
  mem.write8(0x6018, regs.a);
  m.step(0x0065, 13);
  m.ret();
}

/**
 * sub_017b -- ROM 0x017B-0x01B9  "coin input"
 *
 *   017b  3a 00 7d     ld   a,(0x7d00)
 *   017e  cb 7f        bit  7,a
 *   0180  21 03 60     ld   hl,0x6003
 *   0183  c2 89 01     jp   nz,0x0189
 *   0186  36 01        ld   (hl),0x01
 *   0188  c9           ret
 *   0189  7e           ld   a,(hl)
 *   018a  a7           and  a
 *   018b  c8           ret  z
 *   018c  e5           push hl
 *   018d  3a 05 60     ld   a,(0x6005)
 *   0190  fe 03        cp   0x03
 *   0192  ca 9d 01     jp   z,0x019d
 *   0195  cd 1c 01     call 0x011c
 *   0198  3e 03        ld   a,0x03
 *   019a  32 83 60     ld   (0x6083),a
 *   019d  e1           pop  hl
 *   019e  36 00        ld   (hl),0x00
 *   01a0  2b           dec  hl
 *   01a1  34           inc  (hl)
 *   01a2  11 24 60     ld   de,0x6024
 *   01a5  1a           ld   a,(de)
 *   01a6  96           sub  (hl)
 *   01a7  c0           ret  nz
 *   01a8  77           ld   (hl),a
 *   01a9  13           inc  de
 *   01aa  2b           dec  hl
 *   01ab  eb           ex   de,hl
 *   01ac  1a           ld   a,(de)
 *   01ad  fe 90        cp   0x90
 *   01af  d0           ret  nc
 *   01b0  86           add  a,(hl)
 *   01b1  27           daa
 *   01b2  12           ld   (de),a
 *   01b3  11 00 04     ld   de,0x0400
 *   01b6  cd 9f 30     call 0x309f
 *   01b9  c9           ret
 *
 * IN2 bit 7 is COIN1. 0x6003 is an edge latch: while no coin is present it
 * is held at 1, and a coin only counts when it finds the latch already set,
 * so holding the coin line does not repeat-credit.
 *
 * NOTE THIS READS 0x7D00 AGAIN -- a SECOND watchdog kick in the same vblank,
 * after the handler's own read at 0x0072. Harmless, but only
 * because the read is modelled as having the side effect at all.
 *
 * `daa` at 0x01B1 is the BCD credit count -- one of the places the score
 * arithmetic depends on exact DAA semantics.
 */
export function sub_017b(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x7d00); // kicks the watchdog again
  m.step(0x017e, 13);
  const coin = regs.bit(7, regs.a);
  m.step(0x0180, 8);
  regs.hl = 0x6003;
  m.step(0x0183, 10);

  if (!coin) {
    m.step(0x0186, 10); // jp nz not taken
    mem.write8(regs.hl, 0x01); // arm the edge latch
    m.step(0x0188, 10);
    m.ret();
    return;
  }
  m.step(0x0189, 10);

  regs.a = mem.read8(regs.hl);
  m.step(0x018a, 7);
  regs.and(regs.a);
  m.step(0x018b, 4);
  if (regs.fZ) {
    m.step(m.pop16(), 11); // ret z -- latch not armed, coin already counted
    return;
  }
  m.step(0x018c, 5); // ret z not taken -- the coin is accepted

  // -- coin-accepted path (0x018C-0x01B9): sound, clear latch, count pulses, credit in BCD --
  m.push16(regs.hl); // push hl -- save 0x6003
  m.step(0x018d, 11);
  regs.a = mem.read8(0x6005); // game state
  m.step(0x0190, 13); // ld a,(0x6005)
  regs.cp(0x03);
  m.step(0x0192, 7); // cp 0x03
  if (regs.fZ) {
    m.step(0x019d, 10); // jp z,0x019d (state 3 -> skip the coin sound)
  } else {
    m.step(0x0195, 10);
    m.push16(0x0198); m.step(0x011c, 17); sub_011c(m); // call 0x011c
    regs.a = 0x03;
    m.step(0x019a, 7); // ld a,0x03
    mem.write8(0x6083, regs.a); // sound trigger
    m.step(0x019d, 13);
  }
  // -- loc_019d --
  regs.hl = m.pop16(); // pop hl -- HL = 0x6003
  m.step(0x019e, 10);
  mem.write8(regs.hl, 0x00); // (0x6003) = 0 -- clear the edge latch
  m.step(0x01a0, 10);
  regs.hl = (regs.hl - 1) & 0xffff; // dec hl -> 0x6002
  m.step(0x01a1, 6);
  regs.incMem8(mem, regs.hl); // inc (0x6002) -- coin-pulse counter
  m.step(0x01a2, 11);
  regs.de = 0x6024;
  m.step(0x01a5, 10); // ld de,0x6024
  regs.a = mem.read8(regs.de); // (0x6024) = coins-per-credit
  m.step(0x01a6, 7); // ld a,(de)
  regs.sub(mem.read8(regs.hl)); // sub (0x6002)
  m.step(0x01a7, 7);
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- not enough coin pulses yet
  m.step(0x01a8, 5);
  mem.write8(regs.hl, regs.a); // (0x6002) = 0 -- reset the pulse counter (A == 0)
  m.step(0x01a9, 7);
  regs.de = (regs.de + 1) & 0xffff; // inc de -> 0x6025
  m.step(0x01aa, 6);
  regs.hl = (regs.hl - 1) & 0xffff; // dec hl -> 0x6001
  m.step(0x01ab, 6);
  regs.exDeHl(); // ex de,hl -- HL = 0x6025, DE = 0x6001
  m.step(0x01ac, 4);
  regs.a = mem.read8(regs.de); // (0x6001) = credit count
  m.step(0x01ad, 7); // ld a,(de)
  regs.cp(0x90);
  m.step(0x01af, 7); // cp 0x90
  if (regs.fNC) { m.ret(11); return; } // ret nc -- credits already at the 0x90 max
  m.step(0x01b0, 5);
  regs.add(mem.read8(regs.hl)); // add a,(0x6025) -- credits-per-coin
  m.step(0x01b1, 7);
  regs.daa(); // daa -- BCD adjust
  m.step(0x01b2, 4);
  mem.write8(regs.de, regs.a); // (0x6001) = new BCD credit count
  m.step(0x01b3, 7);
  regs.de = 0x0400;
  m.step(0x01b6, 10); // ld de,0x0400
  m.push16(0x01b9); m.step(0x309f, 17); sub_309f(m); // call 0x309f
  m.ret(); // ret (0x01B9)
}

/**
 * sub_00e0 -- ROM 0x00E0-0x011B  "sound driver tick"
 *
 *   00e0  21 80 60     ld   hl,0x6080
 *   00e3  11 00 7d     ld   de,0x7d00
 *   00e6  3a 07 60     ld   a,(0x6007)
 *   00e9  a7           and  a
 *   00ea  c0           ret  nz
 *   00eb  06 08        ld   b,0x08
 *   00ed  7e           ld   a,(hl)          ; loop
 *   00ee  a7           and  a
 *   00ef  ca f5 00     jp   z,0x00f5
 *   00f2  35           dec  (hl)
 *   00f3  3e 01        ld   a,0x01
 *   00f5  12           ld   (de),a
 *   00f6  1c           inc  e
 *   00f7  2c           inc  l
 *   00f8  10 f3        djnz 0x00ed
 *   00fa  21 8b 60     ld   hl,0x608b
 *   00fd  7e           ld   a,(hl)
 *   00fe  a7           and  a
 *   00ff  c2 08 01     jp   nz,0x0108
 *   0102  2d           dec  l
 *   0103  2d           dec  l
 *   0104  7e           ld   a,(hl)
 *   0105  c3 0b 01     jp   0x010b
 *   0108  35           dec  (hl)            ; loc_0108
 *   0109  2d           dec  l
 *   010a  7e           ld   a,(hl)
 *   010b  32 00 7c     ld   (0x7c00),a      ; loc_010b
 *   010e  21 88 60     ld   hl,0x6088
 *   0111  af           xor  a
 *   0112  be           cp   (hl)
 *   0113  ca 18 01     jp   z,0x0118
 *   0116  35           dec  (hl)
 *   0117  3c           inc  a               ; loc_0117
 *   0118  32 80 7d     ld   (0x7d80),a
 *   011b  c9           ret
 *
 * Walks the eight shadow bytes at 0x6080-0x6087 in step with the eight
 * ls259.6h latch addresses 0x7D00-0x7D07: each non-zero shadow is decremented
 * and its latch bit driven to 1, so a shadow byte is a countdown holding a
 * sound trigger asserted for N frames. This is why sub_011c zeroes both the
 * latch and the shadows -- the shadows are the readable copy of a write-only
 * device, and they land in the state dump.
 *
 * Note `inc e` / `inc l` (8-bit) walk DE and HL in lockstep; the high bytes
 * are fixed at 0x7D and 0x60.
 *
 * The tail drives the ls175.3d latch (0x7C00) from 0x6089/0x608B and the
 * audio IRQ (0x7D80) from 0x6088.
 */
function sub_00e0(m) {
  const { regs, mem } = m;

  regs.hl = 0x6080;
  m.step(0x00e3, 10);
  regs.de = 0x7d00;
  m.step(0x00e6, 10);
  regs.a = mem.read8(0x6007);
  m.step(0x00e9, 13);
  regs.and(regs.a);
  m.step(0x00ea, 4);
  if (regs.fNZ) {
    m.step(m.pop16(), 11); // ret nz
    return;
  }
  m.step(0x00eb, 5);

  regs.b = 0x08;
  m.step(0x00ed, 7);
  do {
    regs.a = mem.read8(regs.hl);
    m.step(0x00ee, 7);
    regs.and(regs.a);
    m.step(0x00ef, 4);
    if (regs.fZ) {
      m.step(0x00f5, 10); // jp z taken -- shadow already 0, drive latch 0
    } else {
      m.step(0x00f2, 10);
      mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
      m.step(0x00f3, 11);
      regs.a = 0x01;
      m.step(0x00f5, 7);
    }
    mem.write8(regs.de, regs.a, 4); // ls259.6h bit, ld (de),a
    m.step(0x00f6, 7);
    regs.e = (regs.e + 1) & 0xff;
    m.step(0x00f7, 4);
    regs.l = (regs.l + 1) & 0xff;
    m.step(0x00f8, 4);
    regs.b = (regs.b - 1) & 0xff; // djnz -- no flags
    m.step(regs.b !== 0 ? 0x00ed : 0x00fa, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  regs.hl = 0x608b;
  m.step(0x00fd, 10);
  regs.a = mem.read8(regs.hl);
  m.step(0x00fe, 7);
  regs.and(regs.a);
  m.step(0x00ff, 4);
  if (regs.fNZ) {
    m.step(0x0108, 10); // jp nz -> loc_0108
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
    m.step(0x0109, 11);
    regs.l = (regs.l - 1) & 0xff;
    m.step(0x010a, 4);
    regs.a = mem.read8(regs.hl);
    m.step(0x010b, 7);
  } else {
    m.step(0x0102, 10);
    regs.l = (regs.l - 1) & 0xff;
    m.step(0x0103, 4);
    regs.l = (regs.l - 1) & 0xff;
    m.step(0x0104, 4);
    regs.a = mem.read8(regs.hl);
    m.step(0x0105, 7);
    m.step(0x010b, 10); // jp 0x010b
  }

  // loc_010b
  mem.write8(0x7c00, regs.a, 10); // ls175.3d sound latch
  m.step(0x010e, 13);
  regs.hl = 0x6088;
  m.step(0x0111, 10);
  regs.xor(regs.a);
  m.step(0x0112, 4);
  regs.cp(mem.read8(regs.hl));
  m.step(0x0113, 7);
  if (regs.fZ) {
    m.step(0x0118, 10); // jp z taken
  } else {
    m.step(0x0116, 10);
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)));
    m.step(0x0117, 11);
    regs.a = regs.inc8(regs.a);
    m.step(0x0118, 4);
  }
  mem.write8(0x7d80, regs.a, 10); // audio IRQ
  m.step(0x011b, 13);
  m.ret();
}

/**
 * handler_073c -- ROM 0x073C-0x0762  (game state 1)
 *
 *   073c  21 0a 60     ld   hl,0x600a
 *   073f  3a 01 60     ld   a,(0x6001)
 *   0742  a7           and  a
 *   0743  c2 5c 07     jp   nz,0x075c
 *   0746  7e           ld   a,(hl)
 *   0747  ef           rst  0x28
 *   0748  <10-entry table: 0779 0763 123c 1977 127c 07c3 07cb 084b 0000 0000>
 *   075c  36 00        ld   (hl),0x00        ; loc_075c
 *   075e  21 05 60     ld   hl,0x6005
 *   0761  34           inc  (hl)
 *   0762  c9           ret
 *
 * The SECOND inline-jump-table dispatch site in the ROM, and it works the
 * same way as the NMI's at 0x00C9: `rst 0x28` pops its own return address to
 * find the table, so the ten words at 0x0748 are DATA and control never
 * resumes there. The tracer bounded this table at 0x075C independently,
 * from the `jp nz` target -- which is also the continuation this routine
 * falls to when it does NOT dispatch.
 *
 * Two entries are 0x0000, i.e. unused sub-state slots. Entries 2, 3 and 4
 * point into 0x12xx/0x19xx, regions nothing has reached yet.
 *
 * When 0x6001 is non-zero the dispatch is skipped entirely and the routine
 * clears 0x600A and ADVANCES THE GAME STATE by incrementing 0x6005 -- so
 * this is the state that steps the machine on to the next one.
 */
function handler_073c(m) {
  const { regs, mem } = m;

  regs.hl = 0x600a;
  m.step(0x073f, 10);
  regs.a = mem.read8(0x6001);
  m.step(0x0742, 13);
  regs.and(regs.a);
  m.step(0x0743, 4);

  if (regs.fNZ) {
    // loc_075c -- skip the sub-state dispatch and advance the game state.
    m.step(0x075c, 10);
    mem.write8(regs.hl, 0x00);
    m.step(0x075e, 10);
    regs.hl = 0x6005;
    m.step(0x0761, 10);
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
    m.step(0x0762, 11);
    m.ret();
    return;
  }
  m.step(0x0746, 10);

  regs.a = mem.read8(regs.hl); // sub-state from 0x600A
  m.step(0x0747, 7);
  m.push16(0x0748); // rst 0x28 pushes the table base
  m.step(0x0028, 11);
  sub_0028(m, SUBSTATE_TABLE_073C);
}

/** Handlers reached from the 0x0748 table; two slots are unused (0x0000). */
const SUBSTATE_TABLE_073C = "0x0748 (game state 1 sub-state)";

/**
 * sub_0028 -- ROM 0x0028-0x0037  (the inline-jump-table trampoline)
 *
 *   0028  87           add  a,a
 *   0029  e1           pop  hl
 *   002a  5f           ld   e,a
 *   002b  16 00        ld   d,0x00
 *   002d  c3 32 00     jp   0x0032
 *   0032  19           add  hl,de            ; loc_0032
 *   0033  5e           ld   e,(hl)
 *   0034  23           inc  hl
 *   0035  56           ld   d,(hl)
 *   0036  eb           ex   de,hl
 *   0037  e9           jp   (hl)
 *
 * TRANSLATED RATHER THAN SHORT-CIRCUITED, for three reasons a review caught:
 *
 *  1. `pop hl` consumes the pushed return address, and the Z80 does not clear
 *     popped bytes -- so 0x00CA's two bytes stay resident below SP, inside
 *     the work RAM that gets diffed against MAME. Skipping the push/pop pair
 *     leaves those bytes stale and produces a divergence at an address no
 *     routine ever names.
 *  2. The body is 74 T-states, and it runs every frame. Charging only the
 *     `rst`'s own 11 would drift every subsequent frame boundary.
 *  3. It CLOBBERS REGISTERS the handlers then see: on entry to a state
 *     handler the hardware has A = state*2, DE = the target address, HL = the
 *     target too (after `ex de,hl`), and flags from `add a,a` / `add hl,de`.
 *
 * The table is read from ROM through the normal memory path rather than from
 * a JS array, so it stays the ROM's data rather than a transcription of it.
 */
export function sub_0028(m, site = "0x00CA (NMI game state)") {
  const { regs, mem } = m;

  regs.add(regs.a); // add a,a -- index * 2
  m.tick(4);
  regs.hl = m.pop16(); // pop hl -- the table base, 0x00CA
  m.tick(10);
  regs.e = regs.a;
  m.tick(4);
  regs.d = 0x00;
  m.tick(7);
  m.tick(10); // jp 0x0032
  regs.addHl(regs.de); // add hl,de -- &table[index]
  m.tick(11);
  regs.e = mem.read8(regs.hl);
  m.tick(7);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.tick(6);
  regs.d = mem.read8(regs.hl);
  m.tick(7);
  regs.exDeHl(); // ex de,hl -- HL = target
  m.tick(4);
  m.tick(4); // jp (hl)

  // RETURN the target's value, do not drop it. rst 0x28 is a call LAYER, and a
  // call layer that swallows a skip-capable target's boolean loses the skip
  // exactly like the 216d plain-call defect -- one level deeper. The 5 existing
  // dispatchGameState arms already `return handler(m)`, and the two current
  // sub_0028 callers (entry_0066 / the 0x0748 substate dispatch) ignore the value,
  // so this is INERT today. It becomes load-bearing for skip-capable dispatch
  // targets (the 0x3110 guard family, reached via sub_30fa). Lead-ratified
  // convention: a caller dispatching a skip-capable target consumes and
  // propagates the boolean.
  return dispatchGameState(m, regs.hl, site);
}

/**
 * sub_0018 -- ROM 0x0018-0x001F  (the `rst 0x18` skip helper)
 *
 *   0018  21 09 60     ld   hl,0x6009
 *   001b  35           dec  (hl)
 *   001c  c8           ret  z
 *   001d  33           inc  sp
 *   001e  33           inc  sp
 *   001f  c9           ret
 *
 * Decrement the counter at 0x6009. On ZERO return normally; otherwise
 * discard this routine's own return address with the two `inc sp` and return
 * to the CALLER'S CALLER, skipping whatever followed the `rst`.
 *
 * Note the polarity: the caller's remainder runs only when the counter
 * EXPIRES. This is a "do it every Nth time" gate, not a "do it while
 * counting" one, and reading it the other way inverts the whole routine.
 *
 * @returns {boolean} true when control returns to the instruction after the
 *   `rst`; false when it skipped, so the caller must return immediately.
 */
export function sub_0018(m) {
  const { regs, mem } = m;
  regs.hl = 0x6009;
  m.step(0x001b, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
  m.step(0x001c, 11);
  if (regs.fZ) {
    m.ret(11); // ret z taken -- normal return
    return true;
  }
  m.step(0x001d, 5);
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x001e, 6);
  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x001f, 6);
  m.ret(); // returns to the caller's CALLER
  return false;
}

/**
 * sub_0020 -- ROM 0x0020-0x0027  (the `rst 0x20` skip helper)
 *
 *   0020  21 08 60     ld   hl,0x6008
 *   0023  35           dec  (hl)
 *   0024  28 f2        jr   z,0x0018
 *   0026  e1           pop  hl               ; loc_0026
 *   0027  c9           ret
 *
 * A TWO-LEVEL COUNTDOWN, and the second level is reached by JUMPING INTO
 * sub_0018 rather than calling it. Decrement 0x6008; while it is non-zero,
 * `pop hl / ret` discards this routine's return address and returns to the
 * caller's caller -- the skip. When it EXPIRES, control falls into 0x0018,
 * which decrements 0x6009 and applies the same test one level up.
 *
 * So the caller's remainder runs only when BOTH counters expire together.
 * Two prescalers in series, expressed as a jump between two `rst` handlers
 * that share a return convention -- which is why they must share a
 * translation convention too, both returning "did control come back".
 *
 * The `jr z` lands on sub_0018's FIRST instruction, so it is a genuine tail
 * jump: 0x0018's `ret` returns on 0x0020's behalf, and 0x0020 never reaches
 * a `ret` of its own. That is exactly the shape the tracer misclassifies as
 * non-returning.
 *
 * @returns {boolean} true when control returns after the `rst`, else false.
 */
export function sub_0020(m) {
  const { regs, mem } = m;
  regs.hl = 0x6008;
  m.step(0x0023, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
  m.step(0x0024, 11);
  if (regs.fZ) {
    m.step(0x0018, 12); // jr z taken -- TAIL jump into sub_0018
    return sub_0018(m);
  }
  m.step(0x0026, 7); // jr z not taken
  regs.hl = m.pop16(); // pop hl -- discards this routine's return address
  m.step(0x0027, 10);
  m.ret(); // returns to the caller's CALLER
  return false;
}

/**
 * handler_0763 -- ROM 0x0763-0x0778  (0x0748 table, game state 1 sub-state)
 *
 *   0763  e7           rst  0x20
 *   0764  af           xor  a
 *   0765  32 92 63     ld   (0x6392),a
 *   0768  32 a0 63     ld   (0x63a0),a
 *   076b  3e 01        ld   a,0x01
 *   076d  32 27 62     ld   (0x6227),a
 *   0770  32 29 62     ld   (0x6229),a
 *   0773  32 28 62     ld   (0x6228),a
 *   0776  c3 92 0c     jp   0x0c92
 *
 * Gated on `rst 0x20`, so the body runs only when both prescalers expire --
 * this is the timed advance out of the sub-state, not a per-frame action.
 *
 * Ends in a TAIL JUMP to 0x0C92, so 0x0C92's `ret` returns to this handler's
 * caller and this handler has no `ret` of its own.
 */
function handler_0763(m) {
  const { regs, mem } = m;

  m.push16(0x0764);
  m.step(0x0020, 11); // rst 0x20
  if (!sub_0020(m)) return; // skipped: control never came back here

  regs.xor(regs.a);
  m.step(0x0765, 4);
  mem.write8(0x6392, regs.a);
  m.step(0x0768, 13);
  mem.write8(0x63a0, regs.a);
  m.step(0x076b, 13);
  regs.a = 0x01;
  m.step(0x076d, 7);
  mem.write8(0x6227, regs.a);
  m.step(0x0770, 13);
  mem.write8(0x6229, regs.a);
  m.step(0x0773, 13);
  mem.write8(0x6228, regs.a);
  m.step(0x0776, 13);

  m.step(0x0c92, 10); // jp 0x0c92 -- TAIL jump, no return address pushed
  loc_0c92(m);
}

/**
 * handler_123c -- ROM 0x123C-0x127B  (0x0748 table entry 2, game state 1)
 *
 *   123c  df           rst  0x18
 *   123d  3a 27 62     ld   a,(0x6227)
 *   1240  fe 03        cp   0x03
 *   1242  01 16 e0     ld   bc,0xe016
 *   1245  ca 4b 12     jp   z,0x124b
 *   1248  01 3f f0     ld   bc,0xf03f
 *   124b  dd 21 00 62  ld   ix,0x6200     ; loc_124b, the jp z target
 *   124f  21 4c 69     ld   hl,0x694c
 *   1252  dd 36 00 01  ld   (ix+0x00),0x01
 *   1256  dd 71 03     ld   (ix+0x03),c
 *   1259  71           ld   (hl),c
 *   125a  2c           inc  l
 *   125b  dd 36 07 80  ld   (ix+0x07),0x80
 *   125f  36 80        ld   (hl),0x80
 *   1261  2c           inc  l
 *   1262  dd 36 08 02  ld   (ix+0x08),0x02
 *   1266  36 02        ld   (hl),0x02
 *   1268  2c           inc  l
 *   1269  dd 70 05     ld   (ix+0x05),b
 *   126c  70           ld   (hl),b
 *   126d  dd 36 0f 01  ld   (ix+0x0f),0x01
 *   1271  21 0a 60     ld   hl,0x600a
 *   1274  34           inc  (hl)
 *   1275  11 01 06     ld   de,0x0601
 *   1278  cd 9f 30     call 0x309f
 *   127b  c9           ret
 *
 * FIRST SUB-STATE OF GAME STATE 1, reached from the 0x0748 table at index 2.
 * It seeds a sprite record at IX = 0x6200 and a mirror at HL = 0x694C, then
 * advances the sub-state counter (0x600A) and enqueues task (D=0x06, E=0x01).
 *
 * `rst 0x18` AT 0x123C CAN SKIP THE WHOLE HANDLER. sub_0018 decrements the
 * counter at 0x6009 and, while it is still counting down, returns to THIS
 * handler's caller rather than to 0x123D -- so the body runs only on the frame
 * the counter expires. Modelled as an early return, its `false` result.
 *
 * BC IS SET TO ONE OF TWO CONSTANTS BY (0x6227), then B and C are stored into
 * DIFFERENT fields: C to (ix+0x03) and the mirror, B to (ix+0x05) and its
 * mirror. So the two halves of BC carry two independent field values, and
 * naming the register by either field names it wrong for the other. 0xE016 vs
 * 0xF03F is a full BC swap on the (0x6227)==3 branch.
 *
 * THE IX WRITES ARE PAIRED WITH HL MIRROR WRITES and the offsets are not
 * contiguous -- +00,+03,+07,+08,+05,+0F on IX against a walking `inc l` on HL.
 * The order is load-bearing for the write trace exactly as in sub_11fa; left
 * in ROM order.
 *
 * `ld (ix+d),r` (dd 70/71) is the register-source indexed store, 19 T --
 * confirmed against mame0288 z80.lst, identical microcode to `ld (ix+d),a`.
 * The immediate form `ld (ix+d),n` (dd 36) is also 19 T, already precedented.
 */
function handler_123c(m) {
  const { regs, mem } = m;

  m.push16(0x123d);
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter still ticking -- skipped this frame

  regs.a = mem.read8(0x6227);
  m.step(0x1240, 13); // ld a,(0x6227)
  regs.cp(0x03);
  m.step(0x1242, 7); // cp 0x03
  regs.bc = 0xe016;
  m.step(0x1245, 10); // ld bc,0xe016
  if (regs.fZ) {
    m.step(0x124b, 10); // jp z,0x124b taken
  } else {
    m.step(0x1248, 10); // jp z not taken
    regs.bc = 0xf03f;
    m.step(0x124b, 10); // ld bc,0xf03f
  }

  regs.ix = 0x6200;
  m.step(0x124f, 14); // ld ix,0x6200
  regs.hl = 0x694c;
  m.step(0x1252, 10); // ld hl,0x694c

  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x1256, 19); // ld (ix+0x00),0x01
  mem.write8((regs.ix + 0x03) & 0xffff, regs.c);
  m.step(0x1259, 19); // ld (ix+0x03),c
  mem.write8(regs.hl, regs.c);
  m.step(0x125a, 7); // ld (hl),c
  regs.l = regs.inc8(regs.l);
  m.step(0x125b, 4); // inc l

  mem.write8((regs.ix + 0x07) & 0xffff, 0x80);
  m.step(0x125f, 19); // ld (ix+0x07),0x80
  mem.write8(regs.hl, 0x80);
  m.step(0x1261, 10); // ld (hl),0x80
  regs.l = regs.inc8(regs.l);
  m.step(0x1262, 4); // inc l

  mem.write8((regs.ix + 0x08) & 0xffff, 0x02);
  m.step(0x1266, 19); // ld (ix+0x08),0x02
  mem.write8(regs.hl, 0x02);
  m.step(0x1268, 10); // ld (hl),0x02
  regs.l = regs.inc8(regs.l);
  m.step(0x1269, 4); // inc l

  mem.write8((regs.ix + 0x05) & 0xffff, regs.b);
  m.step(0x126c, 19); // ld (ix+0x05),b
  mem.write8(regs.hl, regs.b);
  m.step(0x126d, 7); // ld (hl),b
  mem.write8((regs.ix + 0x0f) & 0xffff, 0x01);
  m.step(0x1271, 19); // ld (ix+0x0f),0x01

  regs.hl = 0x600a;
  m.step(0x1274, 10); // ld hl,0x600a
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)), 8); // inc (hl)
  m.step(0x1275, 11);
  regs.de = 0x0601;
  m.step(0x1278, 10); // ld de,0x0601

  m.push16(0x127b);
  m.step(0x309f, 17); // call 0x309f -- enqueue task (D=0x06, E=0x01)
  sub_309f(m);

  m.ret(); // 127b
}

/*
 * A rst 0x18 countdown gate that FALLS THROUGH into the existing loc_0c92
 * (0x0C92) -- so it is a SECOND, GATED entry point into that body. loc_0c91 is
 * the 0x0702 table's index-10 target.
 *
 * rst 0x18 (sub_0018) is the single-level countdown skip: it runs loc_0c92 only
 * when 0x6009 expires, else skips (control returns to loc_0c91's caller's caller
 * and loc_0c92 never runs). Void return on skip -- same convention as loc_084b /
 * handler_0763. sub_0018's `ret z` lands pc at 0x0C92, so loc_0c92 falls through
 * directly (no explicit fall-through step needed).
 */
/**
 * loc_0c91 -- ROM 0x0C91  (rst 0x18 gate; second, gated entry into loc_0c92)
 *
 *   0c91  df           rst  0x18        ; skip loc_0c92 unless 0x6009 expires
 *   0c92  ...          (falls through into the existing loc_0c92 body)
 */
export function loc_0c91(m) {
  m.push16(0x0c92); // rst 0x18 pushes its return address = 0x0C92 (the fall-through)
  m.step(0x0018, 11); // rst 0x18
  if (!sub_0018(m)) return; // counter still ticking -- skipped; loc_0c92 does not run

  return loc_0c92(m); // pc is already 0x0C92 (sub_0018's ret z); its ret returns for us
}

/**
 * loc_0c92 -- ROM 0x0C92-0x0CB8  (reached only by tail jump from 0x0763)
 *
 *   0c92  cd 74 08     call 0x0874
 *   0c95  af           xor  a
 *   0c96  32 8c 63     ld   (0x638c),a
 *   0c99  11 01 05     ld   de,0x0501
 *   0c9c  cd 9f 30     call 0x309f
 *   0c9f  21 86 7d     ld   hl,0x7d86
 *   0ca2  36 00        ld   (hl),0x00
 *   0ca4  23           inc  hl
 *   0ca5  36 01        ld   (hl),0x01
 *   0ca7  3a 27 62     ld   a,(0x6227)
 *   0caa  3d           dec  a
 *   0cab  ca d4 0c     jp   z,0x0cd4
 *   0cae  3d           dec  a
 *   0caf  ca df 0c     jp   z,0x0cdf
 *   0cb2  3d           dec  a
 *   0cb3  ca f2 0c     jp   z,0x0cf2
 *   0cb6  cd 43 0d     call 0x0d43
 *
 * THE FIRST WRITE OF 0x7D87 = 1 IN THE WHOLE RUN. The two palette-bank bits
 * are walked with `inc hl` again (0x7D86 then 0x7D87), and this sets bit 1
 * while clearing bit 0 -- so the palette bank becomes 2, having been 0 for
 * every frame up to here. The latch audit showed 0x7D87 as never varying
 * on the short capture and varying on the long one; this is the site.
 *
 * A CASCADE OF `dec a / jp z`, not a jump table: A is 0x6227 and each `dec`
 * tests the next value in turn, so the arms are 1, 2, 3, and fall-through.
 * handler_0763 sets 0x6227 = 1 immediately before tail-jumping here, so ONLY
 * THE FIRST ARM IS EXERCISED on this path. The other three are left
 * untranslated deliberately -- translating them would be unexercised code
 * written to spec, which is what coverage-as-to-do-list exists to prevent.
 */
function loc_0c92(m) {
  const { regs, mem } = m;

  m.push16(0x0c95);
  m.step(0x0874, 17);
  sub_0874(m);

  regs.xor(regs.a);
  m.step(0x0c96, 4);
  mem.write8(0x638c, regs.a);
  m.step(0x0c99, 13);
  regs.de = 0x0501;
  m.step(0x0c9c, 10);

  m.push16(0x0c9f);
  m.step(0x309f, 17);
  sub_309f(m);

  regs.hl = 0x7d86;
  m.step(0x0ca2, 10);
  mem.write8(regs.hl, 0x00, 7); // ld (hl),n -- bus cycle at +7
  m.step(0x0ca4, 10);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0ca5, 6);
  mem.write8(regs.hl, 0x01, 7); // 0x7D87 = 1 -- palette bank bit 1
  m.step(0x0ca7, 10);

  regs.a = mem.read8(0x6227);
  m.step(0x0caa, 13);
  regs.a = regs.dec8(regs.a);
  m.step(0x0cab, 4);
  if (regs.fZ) {
    m.step(0x0cd4, 10); // jp z taken -- the only arm this path reaches
    return loc_0cd4(m);
  }
  m.step(0x0cae, 10); // jp z,0x0cd4 NOT taken (board 1)

  regs.a = regs.dec8(regs.a);
  m.step(0x0caf, 4); // dec a (board 2 check)
  if (regs.fZ) {
    m.step(0x0cdf, 10); // jp z,0x0cdf taken -- board 2 (50m conveyor)
    return loc_0cdf(m);
  }
  m.step(0x0cb2, 10); // jp z,0x0cdf NOT taken

  regs.a = regs.dec8(regs.a);
  m.step(0x0cb3, 4); // dec a (board 3 check)
  if (regs.fZ) {
    m.step(0x0cf2, 10); // jp z,0x0cf2 taken -- board 3 (75m elevator)
    return loc_0cf2(m);
  }
  m.step(0x0cb6, 10); // jp z,0x0cf2 NOT taken -- board 4 (0x6227==4, 100m rivet)

  // loc_0cb6 (0x0CB6-0x0CC5): board-4 rivet setup, FALLS INTO loc_0cc6 (no jp/ret).
  // Reachable -- 100m rivet is level-1's 2nd board (seq 0x3A73 has id 04).
  m.push16(0x0cb9);
  m.step(0x0d43, 17); // call 0x0d43 -- sprite-row clear
  sub_0d43(m);
  regs.hl = 0x7d86;
  m.step(0x0cbc, 10); // ld hl,0x7d86
  mem.write8(regs.hl, 0x01, 7);
  m.step(0x0cbe, 10); // ld (hl),0x01 -- (0x7D86)=1
  regs.a = 0x0b;
  m.step(0x0cc0, 7); // ld a,0x0b
  mem.write8(0x6089, regs.a);
  m.step(0x0cc3, 13); // ld (0x6089),a -- rivet board mode 0x0B
  regs.de = 0x3c8b;
  m.step(0x0cc6, 10); // ld de,0x3c8b -- rivet layout ptr (live-out); FALL INTO loc_0cc6
  return loc_0cc6(m);
}

/** loc_0cdf -- ROM 0x0CDF-0x0CF1. Board 2 (50m conveyor) setup: DE=layout ptr,
 *  latches, (0x6089)=9 mode; tail-jumps to the shared draw tail loc_0cc6 (DE live-out). */
function loc_0cdf(m) {
  const { regs, mem } = m;
  regs.de = 0x3b5d;
  m.step(0x0ce2, 10); // ld de,0x3b5d -- conveyor layout ptr (live-out)
  regs.hl = 0x7d86;
  m.step(0x0ce5, 10); // ld hl,0x7d86
  mem.write8(regs.hl, 0x01, 7);
  m.step(0x0ce7, 10); // ld (hl),0x01 -- (0x7D86)=1
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0ce8, 6); // inc hl
  mem.write8(regs.hl, 0x00, 7);
  m.step(0x0cea, 10); // ld (hl),0x00 -- (0x7D87)=0
  regs.a = 0x09;
  m.step(0x0cec, 7); // ld a,0x09
  mem.write8(0x6089, regs.a);
  m.step(0x0cef, 13); // ld (0x6089),a -- board mode 9
  m.step(0x0cc6, 10); // jp 0x0cc6 -- TAIL into the shared draw tail
  return loc_0cc6(m);
}

/** loc_0cf2 -- ROM 0x0CF2-0x0CFF. Board 3 (75m elevator) setup: clear a sprite row,
 *  (0x6089)=0x0A mode, DE=layout ptr; tail-jumps to loc_0cc6 (DE live-out). */
function loc_0cf2(m) {
  const { regs, mem } = m;
  m.push16(0x0cf5);
  m.step(0x0d27, 17); // call 0x0d27 -- sprite-row clear
  sub_0d27(m);
  regs.a = 0x0a;
  m.step(0x0cf7, 7); // ld a,0x0a
  mem.write8(0x6089, regs.a);
  m.step(0x0cfa, 13); // ld (0x6089),a -- board mode 0x0A
  regs.de = 0x3be5;
  m.step(0x0cfd, 10); // ld de,0x3be5 -- elevator layout ptr (live-out, set last)
  m.step(0x0cc6, 10); // jp 0x0cc6 -- TAIL
  return loc_0cc6(m);
}

/**
 * loc_0cd4 -- ROM 0x0CD4-0x0CDE
 *
 *   0cd4  11 e4 3a     ld   de,0x3ae4
 *   0cd7  3e 08        ld   a,0x08
 *   0cd9  32 89 60     ld   (0x6089),a
 *   0cdc  c3 c6 0c     jp   0x0cc6
 *
 * DE points at ROM 0x3AE4 -- a data address, handed to 0x0DA7 which reads it
 * with `ld a,(de)` and terminates on 0xAA. So this arm selects WHICH table
 * the shared tail walks.
 *
 * THE OTHER THREE ARMS ARE NOT POINTER VARIANTS OF THIS ONE. An earlier
 * version of this comment said they "differ only in that pointer and the
 * value stashed at 0x6089", which is wrong and would have told the next
 * session they were trivial. Decoded from ROM:
 *
 *   0x0CDF  ld de,0x3b5d / ld hl,0x7d86 / ld (hl),0x01 / inc hl /
 *           ld (hl),0x00 / ld a,0x09 / ld (0x6089),a / jp 0x0cc6
 *           -- rewrites BOTH palette-bank latches to bank 1. This arm does
 *              not touch 0x7D86 at all.
 *   0x0CF2  call 0x0d27 / ld a,0x0a / ld (0x6089),a / ld de,0x3be5 / jp 0x0cc6
 *           -- an extra subroutine call.
 *   0x0CB6  call 0x0d43 / ld hl,0x7d86 / ld (hl),0x01 / ld a,0x0b /
 *           ld (0x6089),a / ld de,0x3c8b
 *           -- an extra call AND writes 0x7D86 = 1 while deliberately
 *              leaving 0x7D87 alone (no `inc hl`).
 *
 * Two of the three write the very latch this routine exists to document, so
 * they are separate translations, not parameterisations of this one.
 *
 * 0x6089 IS ALREADY DOCUMENTED IN THIS FILE (see the perFrame notes): it is
 * a source for the ls175.3d sound latch at 0x7C00, and boot zeroes
 * 0x6088-0x608B as its own block. So `ld a,0x08 / ld (0x6089),a` is QUEUEING
 * A SOUND, and each arm queues a different one -- 0x08, 0x09, 0x0A, 0x0B.
 */
function loc_0cd4(m) {
  const { regs, mem } = m;

  regs.de = 0x3ae4;
  m.step(0x0cd7, 10);
  regs.a = 0x08;
  m.step(0x0cd9, 7);
  mem.write8(0x6089, regs.a);
  m.step(0x0cdc, 13);
  // ONE step for one `jp`. A first version of this change appended a second
  // copy instead of replacing the `throw` that used to follow, charging 10
  // phantom T-states to every instruction downstream -- and it was invisible
  // because this path first executes in frame 518, after all 517 compared
  // images are complete. Second time in this file that an edit added a step
  // beside the throw rather than in place of it.
  m.step(0x0cc6, 10); // jp 0x0cc6 -- the shared tail of all four arms
  loc_0cc6(m);
}

/**
 * loc_0cc6 -- ROM 0x0CC6-0x0CD3
 *
 *   0cc6  cd a7 0d     call 0x0da7
 *   0cc9  3a 27 62     ld   a,(0x6227)
 *   0ccc  fe 04        cp   0x04
 *   0cce  cc 00 0d     call z,0x0d00
 *   0cd1  c3 a0 3f     jp   0x3fa0
 *
 * The tail every dispatch arm converges on. DE still points at whichever
 * table its arm selected, and 0x0DA7 walks it.
 *
 * `call z,0x0D00` fires only when 0x6227 is 4.
 *
 * SCOPE, because this routine is shared by all four dispatch arms and the
 * justification is not: on the arm we reach (0x0CD4, entered when 0x6227 is
 * 1) it can never fire. But the FALL-THROUGH arm at 0x0CB6 is entered when
 * 0x6227 is not in {1,2,3} -- which includes exactly 4. So the one arm where
 * this CAN legitimately fire is the one the original note did not cover, and
 * a future session translating 0x0CB6 would be told the state machine had
 * diverged when it had not.
 *
 * Left as a throw rather than a silent skip because on this path reaching it
 * does mean divergence. Traces show 0x0D00 executed by no tape on hand -- a
 * dynamic claim, distinct from its being statically reachable, which it is.
 */
function loc_0cc6(m) {
  const { regs, mem } = m;

  m.push16(0x0cc9);
  m.step(0x0da7, 17);
  sub_0da7(m);

  regs.a = mem.read8(0x6227);
  m.step(0x0ccc, 13);
  regs.cp(0x04);
  m.step(0x0cce, 7);
  if (regs.fZ) {
    m.push16(0x0cd1); // call z,0x0d00 taken (0x6227==4, board 4 rivet)
    m.step(0x0d00, 17);
    sub_0d00(m);
  } else {
    m.step(0x0cd1, 10); // call z,0x0d00 not taken
  }

  m.step(0x3fa0, 10); // jp -- TAIL jump, no return address pushed
  loc_3fa0(m);
}

/**
 * loc_3fa0 -- ROM 0x3FA0-0x3FA5
 *
 *   3fa0  cd a6 3f     call 0x3fa6
 *   3fa3  c3 5f 0d     jp   0x0d5f
 *
 * A call then a tail jump, so 0x0D5F's eventual `ret` returns to whoever
 * called into 0x3FA0 -- which is loc_0cc6's caller, not loc_0cc6.
 */
function loc_3fa0(m) {
  m.push16(0x3fa3);
  m.step(0x3fa6, 17);
  sub_3fa6(m);
  m.step(0x0d5f, 10); // jp -- TAIL jump
  loc_0d5f(m);
}

/**
 * loc_0d5f -- ROM 0x0D5F onward
 *
 *   0d5f  cd 56 0f     call 0x0f56
 *   0d62  cd 41 24     call 0x2441       ; entry_0d62
 *   0d65  21 09 60     ld   hl,0x6009    ; entry_0d65
 *   ...
 *
 * THREE ROUTINES MEET HERE: 0x0F56, 0x2441 and (at 0x0D6F) 0x004E.
 *
 * Note that 0x0F56 contains no `ret`, so whether control reaches 0x0D62 at all
 * was a question. It does -- see the note at sub_0f56's tail. The `rst 0x28`
 * consumes its own pushed continuation, not this call's.
 */
function loc_0d5f(m) {
  const { regs, mem } = m;

  m.push16(0x0d62);
  m.step(0x0f56, 17);
  sub_0f56(m);

  m.push16(0x0d65);
  m.step(0x2441, 17);
  sub_2441(m);

  regs.hl = 0x6009;
  m.step(0x0d68, 10); // ld hl,0x6009
  mem.write8(regs.hl, 0x40);
  m.step(0x0d6a, 10); // ld (hl),0x40
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0d6b, 6); // inc hl
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  m.step(0x0d6c, 11); // inc (hl) -- read-modify-write, and it SETS FLAGS
  regs.hl = 0x385c;
  m.step(0x0d6f, 10); // ld hl,0x385c

  m.push16(0x0d72);
  m.step(0x004e, 17);
  sub_004e(m);

  // HL IS LIVE ACROSS THAT CALL. sub_004e copies 0x28 bytes from the HL it
  // was handed and leaves HL at 0x385C + 0x28 = 0x3884, which is the source
  // the ldir below consumes -- only DE and BC are reloaded here. Hoisting or
  // re-deriving HL would be wrong, and nothing in this block says so locally.
  regs.de = 0x6900;
  m.step(0x0d75, 10); // ld de,0x6900
  regs.bc = 0x0008;
  m.step(0x0d78, 10); // ld bc,0x0008
  m.ldirAt(0x0d78, 0x0d7a);

  regs.a = mem.read8(0x6227);
  m.step(0x0d7d, 13); // ld a,(0x6227)
  regs.cp(0x04);
  m.step(0x0d7f, 7); // cp 0x04

  if (regs.fZ) {
    // 0x6227 == 4 -- the 100m RIVETS board setup arm (0x0D8B-0x0DA6). Transcribed
    // to make board 4 reachable. sub_003d / loc_0038
    // already exist; validated downstream by playing board 4 vs MAME.
    //   0d8b  21 08 69   ld hl,0x6908    0d8e  0e 44   ld c,0x44
    //   0d90  ff  rst 0x38               0d91  11 04 00 ld de,0x0004
    //   0d94  01 10 02   ld bc,0x0210    0d97  21 00 69 ld hl,0x6900
    //   0d9a  cd 3d 00   call 0x003d     0d9d  01 f8 02 ld bc,0x02f8
    //   0da0  21 03 69   ld hl,0x6903    0da3  cd 3d 00 call 0x003d   0da6  c9 ret
    m.step(0x0d8b, 12); // jr z,0x0d8b taken

    regs.hl = 0x6908;
    m.step(0x0d8e, 10); // ld hl,0x6908
    regs.c = 0x44;
    m.step(0x0d90, 7); // ld c,0x44
    m.push16(0x0d91);
    m.step(0x0038, 11); // rst 0x38
    loc_0038(m);

    regs.de = 0x0004;
    m.step(0x0d94, 10); // ld de,0x0004
    regs.bc = 0x0210;
    m.step(0x0d97, 10); // ld bc,0x0210
    regs.hl = 0x6900;
    m.step(0x0d9a, 10); // ld hl,0x6900
    m.push16(0x0d9d);
    m.step(0x003d, 17); // call 0x003d
    sub_003d(m);

    regs.bc = 0x02f8;
    m.step(0x0da0, 10); // ld bc,0x02f8
    regs.hl = 0x6903;
    m.step(0x0da3, 10); // ld hl,0x6903
    m.push16(0x0da6);
    m.step(0x003d, 17); // call 0x003d
    sub_003d(m);

    m.ret(); // 0x0da6 -- returns to loc_0d5f's caller
    return;
  }

  m.step(0x0d81, 7); // jr z NOT taken -- 7 T, against 12 for the taken arm

  // TESTS BIT 1 OF A by rotating it into carry, the same idiom as the rst 0x30
  // handler at 0x0044 -- there the rotate count comes from memory, here it is a
  // fixed two.
  regs.rrca();
  m.step(0x0d82, 4); // rrca
  regs.rrca();
  m.step(0x0d83, 4); // rrca
  if (regs.fC) {
    m.ret(11); // ret c taken -- bit 1 of (0x6227) was set
    return;
  }
  m.step(0x0d84, 5); // ret c not taken

  regs.hl = 0x690b; // field +3 of the sprite record at 0x6908
  m.step(0x0d87, 10); // ld hl,0x690b
  regs.c = 0xfc; // -4 as a signed byte
  m.step(0x0d89, 7); // ld c,0xfc

  // `rst 0x38` is an 11 T call to 0x0038, and it pushes 0x0D8A like any call.
  // Modelled as a real push whose matching pop is sub_003d's `ret` -- stated
  // because the rst 0x28 dispatcher modelled the push and dropped the pop,
  // and that defect stayed invisible until a dispatched target first reached
  // a `ret`.
  m.push16(0x0d8a);
  m.step(0x0038, 11); // rst 0x38
  loc_0038(m);

  m.ret(); // 0d8a
}

/**
 * sub_3fa6 -- ROM 0x3FA6-0x3FB9
 *
 *   3fa6  3e 02        ld   a,0x02
 *   3fa8  f7           rst  0x30
 *   3fa9  06 02        ld   b,0x02
 *   3fab  21 6c 77     ld   hl,0x776c
 *   3fae  36 10        ld   (hl),0x10       ; loop target
 *   3fb0  23           inc  hl
 *   3fb1  23           inc  hl
 *   3fb2  36 c0        ld   (hl),0xc0
 *   3fb4  21 8c 74     ld   hl,0x748c
 *   3fb7  10 f5        djnz 0x3fae
 *   3fb9  c9           ret
 *
 * `ld hl,0x748c` AT 0x3FB4 IS INSIDE THE LOOP. The `djnz` at 0x3FB7 jumps
 * back to 0x3FAE, so HL is reloaded every iteration and the two passes write
 * to DIFFERENT places: pass 1 uses the 0x776C set before the loop, pass 2
 * uses the 0x748C set at the end of pass 1. Four cells in total --
 * 0x776C/0x776E and 0x748C/0x748E.
 *
 * Hoisting that load out "because it is loop-invariant" would make both
 * passes write the same pair and lose two of the four writes. This is the
 * same in-loop/out-of-loop trap that cost a 7-cycle error in sub_0874, and
 * it is why the loop body is written out rather than parameterised.
 *
 * Two `inc hl` rather than one `inc hl` twice-over: the cells are two apart
 * because tilemap columns are 2 bytes apart in this address layout.
 */
function sub_3fa6(m) {
  const { regs, mem } = m;

  regs.a = 0x02;
  m.step(0x3fa8, 7);
  m.push16(0x3fa9);
  m.step(0x0030, 11); // rst 0x30
  if (!sub_0030(m)) return; // skipped: control never came back here

  regs.b = 0x02;
  m.step(0x3fab, 7);
  regs.hl = 0x776c;
  m.step(0x3fae, 10);
  do {
    mem.write8(regs.hl, 0x10);
    m.step(0x3fb0, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x3fb1, 6);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x3fb2, 6);
    mem.write8(regs.hl, 0xc0);
    m.step(0x3fb4, 10);
    regs.hl = 0x748c; // IN the loop -- see the note above
    m.step(0x3fb7, 10);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x3fae : 0x3fb9, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret();
}

/**
 * sub_0da7 -- ROM 0x0DA7-0x0DD1, continuing at loc_0dd3
 *
 *   0da7  1a           ld   a,(de)
 *   0da8  32 b3 63     ld   (0x63b3),a
 *   0dab  fe aa        cp   0xaa
 *   0dad  c8           ret  z
 *   0dae  13           inc  de
 *   0daf  1a           ld   a,(de)
 *   0db0  67           ld   h,a
 *   0db1  44           ld   b,h
 *   0db2  13           inc  de
 *   0db3  1a           ld   a,(de)
 *   0db4  6f           ld   l,a
 *   0db5  4d           ld   c,l
 *   0db6  d5           push de
 *   0db7  cd f0 2f     call 0x2ff0
 *   0dba  d1           pop  de
 *   0dbb  22 ab 63     ld   (0x63ab),hl
 *   0dbe  78           ld   a,b
 *   0dbf  e6 07        and  0x07
 *   0dc1  32 b4 63     ld   (0x63b4),a
 *   0dc4  79           ld   a,c
 *   0dc5  e6 07        and  0x07
 *   0dc7  32 af 63     ld   (0x63af),a
 *   0dca  13           inc  de
 *   0dcb  1a           ld   a,(de)
 *   0dcc  67           ld   h,a
 *   0dcd  90           sub  b
 *   0dce  d2 d3 0d     jp   nc,0x0dd3
 *   0dd1  ed 44        neg
 *
 * Walks a table pointed at by DE, AT LEAST FIVE bytes per record, terminated
 * by a leading 0xAA. Record layout as the code uses it:
 *
 *   +0  kind / terminator   -> stashed at 0x63B3, 0xAA ends the walk
 *   +1  y in pixels         -> H and B
 *   +2  x in pixels         -> L and C
 *   +3  a second y          -> H, then A = |(+3) - y|
 *   +4  a second x          -> read at 0x0DD6, paired with +3, x&7 to 0x63B0
 *
 * The +4 byte is read by the continuation at loc_0dd3, which is why this
 * said "four bytes per record" until review: the count was taken from the
 * instructions translated so far rather than from the record. So the pair
 * (+3,+4) is a SECOND point, and this routine is converting two corners.
 *
 * `push de / call 0x2FF0 / pop de` preserves the table pointer across the
 * address conversion, which clobbers HL. The converted VRAM address is
 * stashed whole at 0x63AB with `ld (nn),hl`.
 *
 * THE `and 0x07` PAIR IS THE SUB-TILE REMAINDER. sub_2ff0 divides both
 * coordinates by 8 to get a tile address and discards the low three bits;
 * this saves those bits separately -- y&7 at 0x63B4, x&7 at 0x63AF. So the
 * caller keeps both the tile the point falls in AND its offset within that
 * tile, from one conversion.
 *
 * `sub b / jp nc / neg` is an ABSOLUTE DIFFERENCE: A = |(+3) - y|. The `neg`
 * runs only on the borrow path, so the result is unsigned either way -- a
 * length or extent, not a signed delta.
 */
export function sub_0da7(m) {
  const { regs, mem } = m;

  // A LOOP, because the chain closes: loc_0e4b ends `inc de / jp 0x0da7`,
  // returning here for the next record. Translating that tail jump as a JS
  // call would recurse once per table entry and grow a frame per record for
  // a walk the ROM does with flat stack depth.
  for (;;) {
  regs.a = mem.read8(regs.de);
  m.step(0x0da8, 7);
  mem.write8(0x63b3, regs.a);
  m.step(0x0dab, 13);
  regs.cp(0xaa);
  m.step(0x0dad, 7);
  if (regs.fZ) {
    m.ret(11); // ret z taken -- 0xAA terminator, walk ends
    return;
  }
  m.step(0x0dae, 5);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0daf, 6);
  regs.a = mem.read8(regs.de);
  m.step(0x0db0, 7);
  regs.h = regs.a;
  m.step(0x0db1, 4);
  regs.b = regs.h;
  m.step(0x0db2, 4);
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0db3, 6);
  regs.a = mem.read8(regs.de);
  m.step(0x0db4, 7);
  regs.l = regs.a;
  m.step(0x0db5, 4);
  regs.c = regs.l;
  m.step(0x0db6, 4);

  m.push16(regs.de);
  m.step(0x0db7, 11);
  m.push16(0x0dba);
  m.step(0x2ff0, 17);
  sub_2ff0(m);
  regs.de = m.pop16();
  m.step(0x0dbb, 10);

  mem.write16(0x63ab, regs.hl);
  m.step(0x0dbe, 16);
  regs.a = regs.b;
  m.step(0x0dbf, 4);
  regs.and(0x07);
  m.step(0x0dc1, 7);
  mem.write8(0x63b4, regs.a);
  m.step(0x0dc4, 13);
  regs.a = regs.c;
  m.step(0x0dc5, 4);
  regs.and(0x07);
  m.step(0x0dc7, 7);
  mem.write8(0x63af, regs.a);
  m.step(0x0dca, 13);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0dcb, 6);
  regs.a = mem.read8(regs.de);
  m.step(0x0dcc, 7);
  regs.h = regs.a;
  m.step(0x0dcd, 4);
  regs.sub(regs.b);
  m.step(0x0dce, 4);
  if (regs.fNC) {
    m.step(0x0dd3, 10); // jp nc taken
  } else {
    m.step(0x0dd1, 10); // jp nc not taken -- `jp cc` is 10 either way
    regs.neg();
    m.step(0x0dd3, 8); // neg is ED-prefixed
  }

  loc_0dd3(m); // returns having reached loc_0e4b's `jp 0x0da7`
  }
}

/**
 * loc_0dd3 -- ROM 0x0DD3-0x0E18, falling into loc_0e19
 *
 *   0dd3  32 b1 63     ld   (0x63b1),a
 *   0dd6  13           inc  de
 *   0dd7  1a           ld   a,(de)
 *   0dd8  6f           ld   l,a
 *   0dd9  91           sub  c
 *   0dda  32 b2 63     ld   (0x63b2),a
 *   0ddd  1a           ld   a,(de)
 *   0dde  e6 07        and  0x07
 *   0de0  32 b0 63     ld   (0x63b0),a
 *   0de3  d5           push de
 *   0de4  cd f0 2f     call 0x2ff0
 *   0de7  d1           pop  de
 *   0de8  22 ad 63     ld   (0x63ad),hl
 *   0deb  3a b3 63     ld   a,(0x63b3)
 *   0dee  fe 02        cp   0x02
 *   0df0  f2 4f 0e     jp   p,0x0e4f
 *   0df3  3a b2 63     ld   a,(0x63b2)
 *   0df6  d6 10        sub  0x10
 *   0df8  47           ld   b,a
 *   0df9  3a af 63     ld   a,(0x63af)
 *   0dfc  80           add  a,b
 *   0dfd  32 b2 63     ld   (0x63b2),a
 *   0e00  3a af 63     ld   a,(0x63af)
 *   0e03  c6 f0        add  a,0xf0
 *   0e05  2a ab 63     ld   hl,(0x63ab)
 *   0e08  77           ld   (hl),a
 *   0e09  2c           inc  l
 *   0e0a  d6 30        sub  0x30
 *   0e0c  77           ld   (hl),a
 *   0e0d  3a b3 63     ld   a,(0x63b3)
 *   0e10  fe 01        cp   0x01
 *   0e12  c2 19 0e     jp   nz,0x0e19
 *   0e15  af           xor  a
 *   0e16  32 b2 63     ld   (0x63b2),a
 *
 * THE RECORD IS A SEGMENT BETWEEN TWO POINTS. sub_0da7 converted (+1,+2) as
 * (y,x); this converts (+3,+4) as (y2,x2) -- H still holds y2 from 0x0DCC
 * and L is loaded here -- and calls the same converter. So one record yields
 * two tile addresses, 0x63AB and 0x63AD, and the deltas between them:
 *
 *   0x63B1 = |y2 - y|      (computed by the caller's sub/neg pair)
 *   0x63B2 = x2 - x        (signed here, adjusted below)
 *   0x63B0 = x2 & 7        sub-tile x of the second point
 *   0x63AD = tile address of (y2, x2)
 *
 * That is a line-segment primitive, which is what a playfield of girders and
 * ladders is built from.
 *
 * `jp p,0x0e4f` TESTS BIT 7 OF (A - 2) AND NOTHING ELSE.
 *
 * An earlier version of this comment said it "takes the branch when the
 * record kind is >= 2 (the subtraction not going negative)". That is FALSE,
 * and it is false in the specific way the same paragraph warned against:
 * "the subtraction not going negative" describes BORROW, which is the `jp nc`
 * condition, so the comment stated the misreading it was cautioning about.
 *
 * Enumerated over all 256 values of A:
 *
 *     jp p taken  <=>  0x02 <= A <= 0x81      (128 values)
 *     "A >= 2" disagrees on A = 0x82..0xFF    (126 values)
 *
 * For A in 0x82..0xFF the result lands in 0x80..0xFD, S is set, and the
 * branch is NOT taken even though A is >= 2 unsigned. `jp p` and `jp nc`
 * agree on 130 values and differ on 126 -- they DIVERGE, they do not invert,
 * which the old wording also got wrong.
 *
 * Nor is it a signed comparison: signed `A >= 2` is `S xor PV`, and at
 * A = 0x80 (-128) the `cp` sets PV, so signed semantics say no-branch while
 * `jp p` branches.
 *
 * WHY IT NEVERTHELESS BEHAVES LIKE "kind >= 2" ON LIVE DATA: the dispatch
 * chain downstream compares 0x63B3 against 0x02, 0x03, 0x04, 0x05 and 0x07,
 * and 0xAA was rejected as the terminator back at 0x0DAB -- so real kinds are
 * small and stay inside the range where the two readings coincide. That is a
 * property of the DATA, not of the instruction, and 0x0F1B uses the same
 * `cp n / jp p` idiom where a session generalising from the old wording would
 * get it wrong.
 *
 * The 0xF0 / 0x30 pair at 0x0E03 and 0x0E0A writes TWO tiles at consecutive
 * addresses: A then A-0x30 at the following cell. Those are tile codes, so
 * the -0x30 is selecting a different glyph for the second cell rather than
 * doing arithmetic on a coordinate.
 */
function loc_0dd3(m) {
  const { regs, mem } = m;

  mem.write8(0x63b1, regs.a);
  m.step(0x0dd6, 13);
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0dd7, 6);
  regs.a = mem.read8(regs.de);
  m.step(0x0dd8, 7);
  regs.l = regs.a;
  m.step(0x0dd9, 4);
  regs.sub(regs.c);
  m.step(0x0dda, 4);
  mem.write8(0x63b2, regs.a);
  m.step(0x0ddd, 13);
  regs.a = mem.read8(regs.de);
  m.step(0x0dde, 7);
  regs.and(0x07);
  m.step(0x0de0, 7);
  mem.write8(0x63b0, regs.a);
  m.step(0x0de3, 13);

  m.push16(regs.de);
  m.step(0x0de4, 11);
  m.push16(0x0de7);
  m.step(0x2ff0, 17);
  sub_2ff0(m);
  regs.de = m.pop16();
  m.step(0x0de8, 10);
  mem.write16(0x63ad, regs.hl);
  m.step(0x0deb, 16);

  regs.a = mem.read8(0x63b3);
  m.step(0x0dee, 13);
  regs.cp(0x02);
  m.step(0x0df0, 7);
  if (regs.fP) {
    m.step(0x0e4f, 10); // jp p taken -- record kind >= 2
    return loc_0e4f(m);
  }
  m.step(0x0df3, 10);

  regs.a = mem.read8(0x63b2);
  m.step(0x0df6, 13);
  regs.sub(0x10);
  m.step(0x0df8, 7);
  regs.b = regs.a;
  m.step(0x0df9, 4);
  regs.a = mem.read8(0x63af);
  m.step(0x0dfc, 13);
  regs.add(regs.b);
  m.step(0x0dfd, 4);
  mem.write8(0x63b2, regs.a);
  m.step(0x0e00, 13);

  regs.a = mem.read8(0x63af);
  m.step(0x0e03, 13);
  regs.add(0xf0);
  m.step(0x0e05, 7);
  regs.hl = mem.read16(0x63ab);
  m.step(0x0e08, 16);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e09, 7);
  regs.l = regs.inc8(regs.l); // `inc l`, NOT `inc hl` -- wraps within the page
  m.step(0x0e0a, 4);
  regs.sub(0x30);
  m.step(0x0e0c, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e0d, 7);

  regs.a = mem.read8(0x63b3);
  m.step(0x0e10, 13);
  regs.cp(0x01);
  m.step(0x0e12, 7);
  if (regs.fNZ) {
    m.step(0x0e19, 10); // jp nz taken
  } else {
    m.step(0x0e15, 10);
    regs.xor(regs.a);
    m.step(0x0e16, 4);
    mem.write8(0x63b2, regs.a);
    m.step(0x0e19, 13);
  }

  loc_0e19(m);
}

/**
 * loc_0e19 -- ROM 0x0E19-0x0E29
 *
 *   0e19  3a b2 63     ld   a,(0x63b2)
 *   0e1c  d6 08        sub  0x08
 *   0e1e  32 b2 63     ld   (0x63b2),a
 *   0e21  da 2a 0e     jp   c,0x0e2a
 *   0e24  2c           inc  l
 *   0e25  36 c0        ld   (hl),0xc0
 *   0e27  c3 19 0e     jp   0x0e19
 *
 * DRAWS THE SPAN. 0x63B2 holds the x-extent computed by loc_0dd3; this walks
 * it down 8 pixels -- one tile -- at a time, laying tile 0xC0 in each cell,
 * until the subtraction borrows. So a record's second point defines how far
 * the girder runs and this is the fill.
 *
 * The loop counter LIVES IN MEMORY, not a register: every iteration reloads
 * 0x63B2, subtracts, and stores it back. Hoisting it into a JS local would
 * be correct arithmetically and wrong observably -- 0x63B2 is inside the
 * diffed work RAM, so its intermediate values are visible to the state gate.
 */
function loc_0e19(m) {
  const { regs, mem } = m;

  for (;;) {
    regs.a = mem.read8(0x63b2);
    m.step(0x0e1c, 13);
    regs.sub(0x08);
    m.step(0x0e1e, 7);
    mem.write8(0x63b2, regs.a);
    m.step(0x0e21, 13);
    if (regs.fC) {
      m.step(0x0e2a, 10); // jp c taken -- the span is exhausted
      break;
    }
    m.step(0x0e24, 10);
    regs.l = regs.inc8(regs.l); // `inc l` -- wraps within the page
    m.step(0x0e25, 4);
    mem.write8(regs.hl, 0xc0);
    m.step(0x0e27, 10);
    m.step(0x0e19, 10); // jp 0x0e19
  }

  loc_0e2a(m);
}

/**
 * loc_0e2a -- ROM 0x0E2A-0x0E4E, through loc_0e3f and loc_0e4b
 *
 *   0e2a  3a b0 63     ld   a,(0x63b0)
 *   0e2d  c6 d0        add  a,0xd0
 *   0e2f  2a ad 63     ld   hl,(0x63ad)
 *   0e32  77           ld   (hl),a
 *   0e33  3a b3 63     ld   a,(0x63b3)
 *   0e36  fe 01        cp   0x01
 *   0e38  c2 3f 0e     jp   nz,0x0e3f
 *   0e3b  2d           dec  l
 *   0e3c  36 c0        ld   (hl),0xc0
 *   0e3e  2c           inc  l
 *   0e3f  3a b0 63     ld   a,(0x63b0)      ; loc_0e3f
 *   0e42  fe 00        cp   0x00
 *   0e44  ca 4b 0e     jp   z,0x0e4b
 *   0e47  c6 e0        add  a,0xe0
 *   0e49  2c           inc  l
 *   0e4a  77           ld   (hl),a
 *   0e4b  13           inc  de              ; loc_0e4b
 *   0e4c  c3 a7 0d     jp   0x0da7
 *
 * THE END CAP. loc_0e19 filled the span with 0xC0; this reloads HL from
 * 0x63AD -- the SECOND point's tile address -- and writes a tile derived
 * from that point's sub-tile x. So the run gets a distinct glyph at its far
 * end, and for kind 1 a second one written BACKWARDS via `dec l`.
 *
 * `cp 0x00` rather than `and a` or `or a`: all three set Z from A, and the
 * ROM spends 7 T-states where 4 would do. Transcribed as written -- the
 * three extra cycles are real and land in the write trace.
 *
 * CLOSES THE RECORD LOOP: `inc de / jp 0x0da7` steps the table pointer past
 * the record and re-enters the walk. Returns here so sub_0da7's `for(;;)`
 * continues rather than recursing.
 */
function loc_0e2a(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x63b0);
  m.step(0x0e2d, 13);
  regs.add(0xd0);
  m.step(0x0e2f, 7);
  regs.hl = mem.read16(0x63ad);
  m.step(0x0e32, 16);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e33, 7);
  regs.a = mem.read8(0x63b3);
  m.step(0x0e36, 13);
  regs.cp(0x01);
  m.step(0x0e38, 7);
  if (regs.fNZ) {
    m.step(0x0e3f, 10); // jp nz taken
  } else {
    m.step(0x0e3b, 10);
    regs.l = regs.dec8(regs.l); // `dec l` -- backwards one cell
    m.step(0x0e3c, 4);
    mem.write8(regs.hl, 0xc0);
    m.step(0x0e3e, 10);
    regs.l = regs.inc8(regs.l);
    m.step(0x0e3f, 4);
  }

  // loc_0e3f
  regs.a = mem.read8(0x63b0);
  m.step(0x0e42, 13);
  regs.cp(0x00);
  m.step(0x0e44, 7);
  if (regs.fZ) {
    m.step(0x0e4b, 10); // jp z taken -- no sub-tile remainder, no extra cell
  } else {
    m.step(0x0e47, 10);
    regs.add(0xe0);
    m.step(0x0e49, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x0e4a, 4);
    mem.write8(regs.hl, regs.a);
    m.step(0x0e4b, 7);
  }

  // loc_0e4b -- steps past the record and re-enters the walk
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0e4c, 6);
  m.step(0x0da7, 10); // jp 0x0da7 -- TAIL jump, no push
}

/**
 * Targets of the rst 0x28 table at ROM 0x00CA, reached via `jp (hl)`:
 *   0 -> 0x01c3   1 -> 0x073c   2 -> 0x08b2   3 -> 0x06fe
 * Bounds are exact -- the pushed continuation 0x00D2 is the first byte after
 * the table.
 */
function dispatchGameState(m, target, site = "0x00CA (NMI game state)") {
  if (target === 0x01c3) return handler_01c3(m);
  if (target === 0x073c) return handler_073c(m);
  if (target === 0x0779) return handler_0779(m);
  if (target === 0x0763) return handler_0763(m);
  if (target === 0x08b2) return loc_08b2(m); // game state 2 (GAMEPLAY) entry
  if (target === 0x08ba) return loc_08ba(m); // 0x08B6 table[0] (0x600A==0)
  if (target === 0x08f8) return loc_08f8(m); // 0x08B6 table[1] (0x600A==1)
  if (target === 0x06fe) return loc_06fe(m); // game state 3, 0x0702 table by 0x600A
  if (target === 0x0986) return loc_0986(m); // 0x0702 table entries (0x600A index)
  if (target === 0x09ab) return loc_09ab(m);
  if (target === 0x09d6) return sub_09d6(m);
  if (target === 0x09fe) return sub_09fe(m);
  if (target === 0x0a1b) return sub_0a1b(m);
  if (target === 0x0a37) return loc_0a37(m);
  if (target === 0x0a63) return loc_0a63(m);
  if (target === 0x0a76) return loc_0a76(m);
  if (target === 0x0bda) return loc_0bda(m);
  if (target === 0x0a8a) return loc_0a8a(m); // 0x0A7A table (0x6385 seq)
  if (target === 0x0abf) return loc_0abf(m);
  if (target === 0x0ae8) return loc_0ae8(m);
  if (target === 0x0b06) return loc_0b06(m);
  if (target === 0x0b68) return loc_0b68(m);
  if (target === 0x0bb3) return loc_0bb3(m);
  if (target === 0x3069) return loc_3069(m); // shared rate-limiter (0x0A7A idx3/5)
  // -- full dispatch-table wiring (0x0748 state-1 sub, 0x0702 idx10+, 0x1283, 0x2874, 0x1648) --
  if (target === 0x07c3) return loc_07c3(m);
  if (target === 0x07cb) return loc_07cb(m);
  if (target === 0x084b) return loc_084b(m);
  if (target === 0x0c91) return loc_0c91(m); // nmi-local
  if (target === 0x127c) return loc_127c(m);
  if (target === 0x128b) return entry_128b(m);
  if (target === 0x12ac) return loc_12ac(m);
  if (target === 0x12de) return loc_12de(m);
  if (target === 0x17b6) return loc_17b6(m);
  if (target === 0x1839) return loc_1839(m);
  if (target === 0x186f) return loc_186f(m);
  if (target === 0x1880) return loc_1880(m);
  if (target === 0x18c6) return loc_18c6(m);
  if (target === 0x2880) return sub_2880(m);
  if (target === 0x28b0) return sub_28b0(m);
  if (target === 0x28e0) return sub_28e0(m);
  if (target === 0x2901) return sub_2901(m);
  // -- L2 board-advance: loc_1615 + its 0x1623/0x1637 sub-tables --
  if (target === 0x1615) return loc_1615(m); // 0x0702 table idx 0x16 (0x600A=0x16)
  if (target === 0x1654) return sub_1654(m);
  if (target === 0x1670) return sub_1670(m);
  if (target === 0x168a) return sub_168a(m);
  if (target === 0x1732) return sub_1732(m);
  if (target === 0x1757) return sub_1757(m);
  if (target === 0x178e) return sub_178e(m);
  if (target === 0x16a3) return loc_16a3(m);
  if (target === 0x16bb) return loc_16bb(m);
  if (target === 0x123c) return handler_123c(m);
  if (target === 0x1977) return handler_1977(m); // game state 1 sub-state (0x0748 table) -- THE FINALE reach-mover
  if (target === 0x197a) return loc_197a(m); // game state 3 gameplay (0x0702 table @0x600A) enters the cascade at 0x197A (skips handler_1977's 0x1977 sub_21ee call)
  if (target === 0x07cb) return loc_07cb(m); // 0x0748 task table (dw 0x07cb @0x0754)
  // The 0x3110 guard family -- SKIP-CAPABLE targets reached via sub_30fa's
  // rst 0x28. These return a boolean ("should the dispatch caller continue?"),
  // which sub_0028 now propagates. Adding them relies on nothing new: the arms
  // above already `return`.
  if (target === 0x3110) return guard_3110(m);
  if (target === 0x311b) return guard_311b(m);
  if (target === 0x3126) return guard_3126(m);
  if (target === 0x3131) return guard_3131(m);
  // entry_3e88's rst 0x28 table (base 0x3E8D). Reached ONLY through that
  // dispatcher, which is untranslated (called from 0x286B), so these arms never
  // fire on the live NMI/substate/sub_30fa paths.
  if (target === 0x3e99) return entry_3e99(m);
  if (target === 0x28b0) return sub_28b0(m);
  if (target === 0x28e0) return sub_28e0(m);
  if (target === 0x2901) return sub_2901(m);
  if (target === 0x2880) return sub_2880(m); // sub_286f's 0x2874 collision table (0x6227)
  if (target === 0x138f) return loc_138f(m); // 0x0702 table idx16
  if (target === 0x13a1) return loc_13a1(m); // 0x0702 table idx17 -- twin of 138f (table-audit)
  if (target === 0x13aa) return loc_13aa(m); // 0x0702 table idx18
  if (target === 0x13bb) return loc_13bb(m); // 0x0702 table idx19
  if (target === 0x141e) return loc_141e(m); // 0x0702 table idx20
  if (target === 0x1486) return sub_1486(m); // 0x0702 table idx21 -- bonus-item phase handler
  if (target === 0x196b) return loc_196b(m); // 0x0702 table idx23 -- computed phase transition
  if (target === 0x12f2) return loc_12f2(m); // 0x0702 table idx14 -- counter-gated state setup (reached at play start)
  if (target === 0x1344) return loc_1344(m); // 0x0702 table idx15 -- twin of loc_12f2
  throw new NotImplemented(
    `handler at ROM 0x${target.toString(16).padStart(4, "0")} ` +
      `(reached via rst 0x28 table at ${site})`,
  );
}

/**
 * loc_0e4f and the {0E62 0E78 0EA0 0EC9 0ED3 0EE5} group -- ROM 0x0E4F-0x0ED2
 *
 * THE LADDER DRAWER. Kind-2 records take this path instead of the flat
 * girder fill at loc_0e19. Where that walked ACROSS laying one tile, this
 * walks DOWN -- HL advances a whole row per step (`inc hl` then `add hl,bc`
 * with BC=0x1F, so +0x20) -- and pays out the height counter at 0x63B1 eight
 * pixels at a time. The tile code in 0x63B5 is nudged by +/-1 as it descends,
 * which is how the run slants: the sign of the x-delta at 0x63B2 picks
 * increment (0x0EB7) or decrement (0x0ED3).
 *
 * NOT MUTUAL RECURSION, DESPITE THE SHAPE. Every transfer between these six
 * blocks is a `jp`; there is no `call`, `rst` or `ret` anywhere in the group,
 * so the ROM runs it at flat stack depth. Translated as a state machine over
 * one loop for exactly that reason -- six mutually-calling JS functions would
 * be shape-faithful and would grow a frame per row of every ladder on screen.
 * The tracer reports it as a strongly-connected component because it follows
 * jump edges, which is correct about the graph and misleading about the cost.
 *
 * FOUR EXITS, and they are not symmetric:
 *   0x0E81 / 0x0EA9  height exhausted -> loc_0ecf -> `inc de / jp 0x0da7`
 *   0x0ECC           L back at a row boundary -> loc_0ecf, same
 *   0x0E54           kind != 2 -> 0x0EE8, still untranslated
 *
 * `and 0x1f` ON L, three times (0x0E68, 0x0E95, 0x0ECA), is a ROW-BOUNDARY
 * TEST: the tilemap is 32 cells wide, so L wrapping past a multiple of 32
 * means the write ran off the end of a row. Each site handles it by skipping
 * the paired second tile rather than by clamping.
 *
 * `jp p` at 0x0EDC is the same sign test as loc_0dd3's -- bit 7 of
 * (0x63B5 - 0xF0), NOT an unsigned comparison. See that routine's note.
 */
function loc_0e4f(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x63b3);
  m.step(0x0e52, 13);
  regs.cp(0x02);
  m.step(0x0e54, 7);
  if (regs.fNZ) {
    m.step(0x0ee8, 10); // jp nz -- kind 3 or more
    return loc_0ee8(m); // kind 3 -> strip drawer; kind 4+ -> entry_0f1b (tail via loc_0ee8)
  }
  m.step(0x0e57, 10);

  regs.a = mem.read8(0x63af);
  m.step(0x0e5a, 13);
  regs.add(0xf0);
  m.step(0x0e5c, 7);
  mem.write8(0x63b5, regs.a);
  m.step(0x0e5f, 13);
  regs.hl = mem.read16(0x63ab);
  m.step(0x0e62, 16);

  // The state machine. `at` names the ROM block about to run; every
  // assignment to it corresponds to a `jp` in the listing.
  let at = 0x0e62;
  for (;;) {
    if (at === 0x0e62) {
      regs.a = mem.read8(0x63b5);
      m.step(0x0e65, 13);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e66, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0e67, 6);
      regs.a = regs.l;
      m.step(0x0e68, 4);
      regs.and(0x1f);
      m.step(0x0e6a, 7);
      if (regs.fZ) { m.step(0x0e78, 10); at = 0x0e78; continue; }
      m.step(0x0e6d, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e70, 13);
      regs.cp(0xf0);
      m.step(0x0e72, 7);
      if (regs.fZ) { m.step(0x0e78, 10); at = 0x0e78; continue; }
      m.step(0x0e75, 10);
      regs.sub(0x10);
      m.step(0x0e77, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e78, 7);
      at = 0x0e78;
      continue;
    }

    if (at === 0x0e78) {
      regs.bc = 0x001f;
      m.step(0x0e7b, 10);
      regs.addHl(regs.bc);
      m.step(0x0e7c, 11);
      regs.a = mem.read8(0x63b1);
      m.step(0x0e7f, 13);
      regs.sub(0x08);
      m.step(0x0e81, 7);
      if (regs.fC) { m.step(0x0ecf, 10); at = 0x0ecf; continue; }
      m.step(0x0e84, 10);
      mem.write8(0x63b1, regs.a);
      m.step(0x0e87, 13);
      regs.a = mem.read8(0x63b2);
      m.step(0x0e8a, 13);
      regs.cp(0x00);
      m.step(0x0e8c, 7);
      if (regs.fZ) { m.step(0x0e62, 10); at = 0x0e62; continue; }
      m.step(0x0e8f, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e92, 13);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e93, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0e94, 6);
      regs.a = regs.l;
      m.step(0x0e95, 4);
      regs.and(0x1f);
      m.step(0x0e97, 7);
      if (regs.fZ) { m.step(0x0ea0, 10); at = 0x0ea0; continue; }
      m.step(0x0e9a, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e9d, 13);
      regs.sub(0x10);
      m.step(0x0e9f, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x0ea0, 7);
      at = 0x0ea0;
      continue;
    }

    if (at === 0x0ea0) {
      regs.bc = 0x001f;
      m.step(0x0ea3, 10);
      regs.addHl(regs.bc);
      m.step(0x0ea4, 11);
      regs.a = mem.read8(0x63b1);
      m.step(0x0ea7, 13);
      regs.sub(0x08);
      m.step(0x0ea9, 7);
      if (regs.fC) { m.step(0x0ecf, 10); at = 0x0ecf; continue; }
      m.step(0x0eac, 10);
      mem.write8(0x63b1, regs.a);
      m.step(0x0eaf, 13);
      regs.a = mem.read8(0x63b2);
      m.step(0x0eb2, 13);
      const neg = regs.bit(7, regs.a); // x-delta negative -> slant the other way
      m.step(0x0eb4, 8);
      if (neg) { m.step(0x0ed3, 10); at = 0x0ed3; continue; }
      m.step(0x0eb7, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0eba, 13);
      regs.a = regs.inc8(regs.a);
      m.step(0x0ebb, 4);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ebe, 13);
      regs.cp(0xf8);
      m.step(0x0ec0, 7);
      if (regs.fNZ) { m.step(0x0ec9, 10); at = 0x0ec9; continue; }
      m.step(0x0ec3, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0ec4, 6);
      regs.a = 0xf0;
      m.step(0x0ec6, 7);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ec9, 13);
      at = 0x0ec9;
      continue;
    }

    if (at === 0x0ec9) {
      regs.a = regs.l;
      m.step(0x0eca, 4);
      regs.and(0x1f);
      m.step(0x0ecc, 7);
      if (regs.fNZ) { m.step(0x0e62, 10); at = 0x0e62; continue; }
      m.step(0x0ecf, 10);
      at = 0x0ecf;
      continue;
    }

    if (at === 0x0ed3) {
      regs.a = mem.read8(0x63b5);
      m.step(0x0ed6, 13);
      regs.a = regs.dec8(regs.a);
      m.step(0x0ed7, 4);
      mem.write8(0x63b5, regs.a);
      m.step(0x0eda, 13);
      regs.cp(0xf0);
      m.step(0x0edc, 7);
      if (regs.fP) { m.step(0x0ee5, 10); at = 0x0ee5; continue; }
      m.step(0x0edf, 10);
      regs.hl = (regs.hl - 1) & 0xffff;
      m.step(0x0ee0, 6);
      regs.a = 0xf7;
      m.step(0x0ee2, 7);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ee5, 13);
      at = 0x0ee5;
      continue;
    }

    if (at === 0x0ee5) {
      m.step(0x0e62, 10); // jp 0x0e62
      at = 0x0e62;
      continue;
    }

    // loc_0ecf -- steps past the record and re-enters the walk
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0ed0, 6);
    m.step(0x0da7, 10); // jp 0x0da7 -- TAIL jump, no push
    return;
  }
}

