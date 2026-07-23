// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0207 — hand-optimized rewrite of the translated routine at ROM 0x0207,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. This routine is a LEAF: it calls nothing, so there are
 * no `m.call` sites here. Only RAM *names* are imported (from ram.js); the DSW0
 * hardware port (0x7D80) is a board read, not work RAM, so it stays a local hex
 * constant (like handler_01c3's FLIPSCREEN latch).
 */

import {
  DIP_LIVES,
  DIP_BONUS_LIFE,
  DIP_COINS_FOR_1P,
  DIP_COINS_FOR_2P,
  DIP_COINS_PER_CREDIT,
  DIP_CREDITS_PER_COIN,
  DIP_UPRIGHT,
} from "./ram.js";

// DSW0 read port (dkong board input latch, NOT work RAM — side-effect-free,
// unlike IN2 @0x7D00 which kicks the watchdog). Read twice by this routine.
const DSW0 = 0x7d80;

/**
 * sub_0207 -- "decode the DIP switches (DSW0)".  [ROM 0x0207-0x0265]
 *
 * Unpacks the single DSW0 byte into the settings block at 0x6020-0x6026, then
 * block-copies a 170-byte ROM table (0x3565) into work RAM at 0x6100:
 *
 *   bits 0-1  lives         -> DIP_LIVES        (0x6020) = bits + 3      (3..6)
 *   bits 2-3  bonus-life     -> DIP_BONUS_LIFE   (0x6021), packed BCD:
 *                               0 -> 0x07, else `add 0x05 / daa` repeated N times
 *                               giving 0x07 / 0x10 / 0x15 / 0x20 (7/10/15/20k)
 *   bits 4-6  coinage        -> DIP_COINS_FOR_1P/_FOR_2P/_PER_CREDIT/_CREDITS_PER_COIN
 *                               (0x6022-0x6025), four related counters
 *   bit 7     (re-read)      -> DIP_UPRIGHT      (0x6026): 1 upright / 0 cocktail
 *
 * INPUTS   : DSW0 (hardware port 0x7D80), read twice.
 * OUTPUTS  : work RAM 0x6020-0x6026 (the seven DIP_* fields) and 0x6100-0x61A9
 *            (the ROM 0x3565 table, `ldir`'d in). Registers at exit: A = the
 *            upright value, HL/DE/BC left by the closing `ldir` (0x360F/0x61AA/0),
 *            B/C/D/E = the ldir setup, F = the flags the `ldir` leaves.
 * CALLERS  : sub_01c3 / handler_01c3 only (game-state-0 power-on init), inside
 *            the NMI. No other call site (grep `m.call(0x0207)`).
 *
 * IDIOMS PRESERVED VERBATIM (flag-exact, register-exact — the unit gate compares
 * the whole register file incl. F, and the bonus threshold is genuine BCD):
 *   - the bonus branch reads the Z flag left by `and 0x03` (the two `ld`s after
 *     it are flag-neutral); reproduced as an `=== 0` test on the same value.
 *   - the coinage branch reads Z (from `and 0x70`) and C (from `rla` x4, = DSW0
 *     bit 4); RLA leaves S/Z/PV untouched, so Z survives the four rotates.
 *   - `add 0x05 / daa`, `rrca`, `rla`, `rlca`, `inc8`, `dec8`, `add a,a` are the
 *     oracle's exact ALU ops in the exact order, so A and F match at every join.
 * DROPPED (provably-dead register churn, both flag-neutral and overwritten before
 * exit, and unobservable because the routine is atomic — see below):
 *   - `ld c,a` staging of DSW0 into C: its only readers are the two `ld a,c`
 *     re-reads, replaced by the `dsw0` local; C is overwritten by `ld bc,0x0101`
 *     before any coinage arm touches it.
 *   - the HL pointer-walk (`ld hl,0x6020` + seven `inc hl`): 16-bit inc/ld are
 *     flag-neutral, so writing the named addresses directly and re-loading HL for
 *     the `ldir` leaves identical state.
 *
 * LADDER STATUS -- idiomatic, cycles COLLAPSED to one charge per straight-line
 * segment + one per branch arm. sub_0207 is ATOMIC on its only call path: its
 * sole caller (handler_01c3) runs inside the NMI dispatch with the mask CLEARED,
 * so the vblank NMI cannot re-fire inside it, and it makes no interruptible call.
 * The internal cycle DISTRIBUTION is therefore free; the per-path TOTAL is still
 * load-bearing (it is part of the NMI's total, which sets the main-loop spin
 * count / PRNG entropy, README §2) so each segment/arm charge is the exact SUM of
 * the oracle's per-instruction T-states along it, preserving every path's total:
 *   seg A 54, seg B 30, bonus{jpz 10 | loop 24N+12}, seg C 60,
 *   coin{jpz 10 | jpc 43 | else 42}, seg D 52, seg E 24, up{jpc 10 | else 14},
 *   seg F 37, then the `ldir` (charged by m.ldirAt). Default DSW0=0x80 path totals
 *   3862 t (287 t of instructions + the 3565-t ldir + the 10-t ret). Harness-verified EQUAL whole-machine + unit;
 *   every non-default branch's total is checked in the synthesised branch tests.
 * There are NO hardware writes here (only work-RAM stores + a side-effect-free
 * DSW0 read), so no write-trace concern and no partial-collapse is required.
 */
export function sub_0207(m) {
  const { regs, mem } = m;

  const dsw0 = mem.read8(DSW0); // ld a,(0x7d80): the raw DSW0 byte

  // -- lives: DSW0 bits 0-1, + 3  ->  3..6 -----------------------------------
  regs.a = dsw0;
  regs.and(0x03);
  regs.add(0x03);
  mem.write8(DIP_LIVES, regs.a); // 0x6020
  m.step(0x0214, 54); // seg A: 0x0207..0x0213

  // -- bonus-life threshold: DSW0 bits 2-3 -----------------------------------
  regs.a = dsw0;
  regs.rrca();
  regs.rrca();
  regs.and(0x03); // A = bits 2-3 (0..3); Z set iff 0
  const bonusSel = regs.a;
  regs.b = bonusSel; // ld b,a -- BCD loop counter (ends 0 either way)
  regs.a = 0x07; // default threshold: BCD 0x07 (= 7000)
  m.step(0x021c, 30); // seg B: 0x0214..0x021b

  if (bonusSel === 0) {
    m.step(0x0226, 10); // jp z taken: threshold stays 0x07
  } else {
    // `add 0x05 / daa`, bonusSel times: 0x10 / 0x15 / 0x20 (10/15/20k)
    regs.a = 0x05;
    do {
      regs.add(0x05);
      regs.daa(); // genuine BCD -- exact DAA semantics matter
      regs.djnz();
    } while (regs.b !== 0);
    m.step(0x0226, 24 * bonusSel + 12); // whole not-taken arm total
  }
  mem.write8(DIP_BONUS_LIFE, regs.a); // ld (hl),a at 0x0226

  // -- coinage: DSW0 bits 4-6 ------------------------------------------------
  // Defaults sit in BC/DE; the two non-zero arms overwrite selected bytes.
  regs.a = dsw0;
  regs.bc = 0x0101;
  regs.de = 0x0102;
  regs.and(0x70); // isolate bits 4-6; clears C, sets Z iff all clear
  regs.rla();
  regs.rla();
  regs.rla();
  regs.rla(); // C now = DSW0 bit 4; Z unchanged (RLA leaves S/Z/PV)
  m.step(0x0235, 60); // seg C: 0x0226..0x0234

  if (regs.fZ) {
    m.step(0x0247, 10); // jp z: bits 4-6 == 0, defaults stand
  } else if (regs.fC) {
    // bit 4 set (0x0241 arm)
    regs.add(0x02);
    regs.b = regs.a; // ld b,a
    regs.d = regs.a; // ld d,a
    regs.add(regs.a); // add a,a
    regs.e = regs.a; // ld e,a
    m.step(0x0247, 43);
  } else {
    // bit 4 clear, bits 5/6 set (0x023b arm)
    regs.a = regs.inc8(regs.a); // inc a
    regs.c = regs.a; // ld c,a
    regs.e = regs.d; // ld e,d
    m.step(0x0247, 42);
  }

  // loc_0247: store D,E,B,C into 0x6022-0x6025 (four coinage counters)
  mem.write8(DIP_COINS_FOR_1P, regs.d); // 0x6022
  mem.write8(DIP_COINS_FOR_2P, regs.e); // 0x6023
  mem.write8(DIP_COINS_PER_CREDIT, regs.b); // 0x6024
  mem.write8(DIP_CREDITS_PER_COIN, regs.c); // 0x6025
  m.step(0x024f, 52); // seg D

  // -- cabinet: DSW0 bit 7 (re-read) -> upright(1) / cocktail(0) --------------
  regs.a = mem.read8(DSW0);
  regs.rlca(); // bit 7 -> carry
  regs.a = 0x01;
  m.step(0x0255, 24); // seg E: 0x024f..0x0254

  if (regs.fC) {
    m.step(0x0259, 10); // jp c taken: A stays 1 (upright)
  } else {
    regs.a = regs.dec8(regs.a); // A = 0 (cocktail)
    m.step(0x0259, 14);
  }
  mem.write8(DIP_UPRIGHT, regs.a); // 0x6026

  // -- copy the 170-byte ROM table 0x3565 -> 0x6100 --------------------------
  regs.hl = 0x3565; // ROM data table (0x3565..0x360E)
  regs.de = 0x6100; // dest work RAM (examined + left hex in ram.js)
  regs.bc = 0x00aa; // 170 bytes
  m.step(0x0263, 37); // seg F: 0x0259..0x0262
  m.ldirAt(0x0263, 0x0265);

  m.ret();
}
