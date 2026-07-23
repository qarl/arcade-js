// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_03a2 — hand-optimized rewrite of the translated routine at ROM 0x03A2,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three callees (0x0030, 0x0010, 0x03F2) are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle or to a future optimized rewrite — never imported.
 * No RAM name from ram.js applies here: every address this routine touches
 * directly (0x6350, 0x62B8, 0x62B9, 0x62BA, 0x63A0, 0x66A0+9/+A, 0x6A29) is on
 * ram.js's "deliberately unnamed" list (engine/board-object scratch examined and
 * left hex), so they stay hex here too, with comments — inventing none.
 */

/**
 * sub_03a2 -- the main loop's once-per-serviced-frame periodic-event service.
 * [ROM 0x03A2-0x03F1; callee sub_03f2 at 0x03F2-0x03FA is reached via m.call]
 *
 *   03a2  3e 03        ld   a,0x03          ; A = mask 0b00000011
 *   03a4  f7           rst  0x30            ; bit-select A by (BOARD): true only on boards 1-2
 *   03a5  d7           rst  0x10            ; proceed only if MARIO_ACTIVE bit0 set
 *   03a6  3a 50 63     ld   a,(0x6350)
 *   03a9  0f           rrca                 ; bit0 of (0x6350) -> carry
 *   03aa  d8           ret  c               ; that scratch flag set -> bail
 *   03ab  21 b8 62     ld   hl,0x62b8
 *   03ae  35           dec  (hl)            ; /4 prescaler at 0x62B8
 *   03af  c0           ret  nz              ; not this pass -> bail
 *   03b0  36 04        ld   (hl),0x04       ; reload the prescaler
 *   03b2  3a b9 62     ld   a,(0x62b9)
 *   03b5  0f           rrca                 ; bit0 of (0x62B9) -> carry
 *   03b6  d0           ret  nc              ; feature disabled -> bail
 *   03b7  21 29 6a     ld   hl,0x6a29
 *   03ba  06 40        ld   b,0x40
 *   03bc  dd 21 a0 66  ld   ix,0x66a0
 *   03c0  0f           rrca                 ; NEXT bit (bit1) of (0x62B9), still in A -> carry
 *   03c1  d2 e4 03     jp   nc,0x03e4       ; the two-way split
 *   03c4  dd 36 09 02  ld   (ix+0x09),0x02  ; --- arm B (bit1 set) ---
 *   03c8  dd 36 0a 02  ld   (ix+0x0a),0x02
 *   03cc  04           inc  b
 *   03cd  04           inc  b               ; B = 0x42
 *   03ce  cd f2 03     call 0x03f2          ; store B (+maybe 1) at (0x6A29)
 *   03d1  21 ba 62     ld   hl,0x62ba
 *   03d4  35           dec  (hl)            ; countdown at 0x62BA
 *   03d5  c0           ret  nz              ; not yet zero -> bail
 *   03d6  3e 01        ld   a,0x01
 *   03d8  32 b9 62     ld   (0x62b9),a      ; on underflow: (0x62B9) := 1
 *   03db  32 a0 63     ld   (0x63a0),a      ;               (0x63A0) := 1
 *   03de  3e 10        ld   a,0x10          ; loc_03de -- both arms converge
 *   03e0  32 ba 62     ld   (0x62ba),a      ; reload 0x62BA to 0x10
 *   03e3  c9           ret
 *   03e4  dd 36 09 02  ld   (ix+0x09),0x02  ; --- arm A (bit1 clear), loc_03e4 ---
 *   03e8  dd 36 0a 00  ld   (ix+0x0a),0x00
 *   03ec  cd f2 03     call 0x03f2
 *   03ef  c3 de 03     jp   0x03de          ; -> converge
 *
 * WHAT IT DOES. Called unconditionally from mainLoop (ROM 0x02DE) once per
 * serviced frame, this drives a periodic board element gated four deep:
 *
 *   1. rst 0x30 (sub_0030) bit-selects A=0x03 by the rotate count (BOARD, 0x6227):
 *      the carry ends as bit(BOARD) of 0b00000011, so it proceeds on boards 1-2
 *      (25m/50m) and SKIPS the whole routine on boards 3-4 (75m/100m). The skip is
 *      the rst stack idiom — sub_0030's `pop hl` discards this routine's return
 *      address so control returns straight to mainLoop; modelled as the boolean
 *      `if (!m.call(0x0030)) return;`.
 *   2. rst 0x10 (sub_0010) proceeds only when bit0 of MARIO_ACTIVE (0x6200) is
 *      set — same boolean-skip idiom.
 *   3. bit0 of scratch (0x6350) must be clear (`ret c`).
 *   4. a /4 prescaler at 0x62B8 (dec, reload 4): the body runs one pass in four.
 *
 * Past the gates it reads a two-bit control at 0x62B9: bit0 must be set (else
 * `ret nc`), and bit1 chooses between two arms that differ ONLY in the value
 * written to (ix+0x0A) at object base IX=0x66A0 (0x02 on arm B / 0x00 on arm A)
 * and in B handed to sub_03f2 (0x42 arm B after two `inc b` / 0x40 arm A).
 * sub_03f2 stores B at (0x6A29), then — unless bit0 of SPIN_COUNT (0x6019) is set —
 * increments B and stores AGAIN at the same address (a write only the trace sees).
 * Arm B additionally counts down 0x62BA and, on underflow, sets (0x62B9)=1 and
 * (0x63A0)=1. Both arms converge at loc_03de, reloading 0x62BA to 0x10.
 *
 * INPUTS  (read): A is loaded 0x03; (BOARD) via rst 0x30; (MARIO_ACTIVE) via rst
 *   0x10; (0x6350), (0x62B8), (0x62B9), (0x62BA); (0x6019) inside sub_03f2.
 * OUTPUTS (written): 0x62B8 (dec + reload 4), (ix+0x09)=0x02 and (ix+0x0A)=0x00/0x02
 *   at 0x66A9/0x66AA, (0x6A29) via sub_03f2, 0x62BA (dec then reload 0x10), and on
 *   arm-B underflow 0x62B9=1 + 0x63A0=1. Registers end: A=0x10 (converged exit) or
 *   the rotated value / 0x01 on an early exit; B=0x40/0x42(+1); HL/IX as loaded;
 *   F/SP per the last executed instruction and any rst-skip pop.
 *
 * NOTABLE IDIOM. The 0x03C0 `rrca` re-tests the SAME (0x62B9) still sitting in A:
 * 0x03B5 rotated bit0 into carry and exited on `nc`, so the value is one position
 * further along and 0x03C0 rotates bit1 up. There is NO second RAM read — it is
 * the same byte, walked bit by bit.
 *
 * CYCLES — KEPT PER-INSTRUCTION (NOT collapsed). sub_03a2 is reached mask-ENABLED:
 * its ONLY caller is the main loop (ROM 0x02DE), on the per-frame-work path where
 * the vblank NMI is armed. On that call path the NMI CAN land between this
 * routine's instructions; collapsing the per-instruction m.step charges to one
 * per-branch total would move where the NMI lands inside the routine and push a
 * different PC into the diffed stack RAM — the exact divergence that reverted
 * sub_0008/0010/0018 and keeps sub_0030/loc_197a per-instruction. A short attract
 * run happening not to interrupt it is NOT proof (README §"ATOMICITY IS PER-CALL-
 * PATH"; when unsure, per-instruction is always correct). So every m.step charge
 * is kept byte-for-byte at the oracle's cycle. No HARDWARE latch (0x7Dxx) is
 * written — every store is work RAM — so there is no bus-cycle write to protect;
 * the win here is structure + this documentation, not de-scaffolding.
 *
 * FLAGS. The caller (mainLoop) consumes NOTHING sub_03a2 returns — it `m.call`s
 * and falls through to the vblank spin with no branch on A or F. Within the
 * routine each `rrca`/`dec (hl)` is consumed by the immediately following
 * conditional, so no flag lives across an idiomatic restructure. Even so, the unit
 * gate diffs the WHOLE register file (A, F, B, HL, IX, SP, PC), so every register
 * operation is reproduced verbatim and nothing is dropped.
 */
export function sub_03a2(m) {
  const { regs, mem } = m;

  // ld a,0x03 -- the mask the rst-0x30 bit select works on.
  regs.a = 0x03;
  m.step(0x03a4, 7);

  // rst 0x30 -- bit-select A by (BOARD): true only on boards 1-2, else skip us.
  m.push16(0x03a5);
  m.step(0x0030, 11);
  if (!m.call(0x0030)) return;

  // rst 0x10 -- proceed only while MARIO_ACTIVE (0x6200) bit0 is set.
  m.push16(0x03a6);
  m.step(0x0010, 11);
  if (!m.call(0x0010)) return;

  // ld a,(0x6350) / rrca / ret c -- bail if bit0 of the scratch flag is set.
  regs.a = mem.read8(0x6350);
  m.step(0x03a9, 13);
  regs.rrca();
  m.step(0x03aa, 4);
  if (regs.fC) {
    m.ret(11);
    return;
  }
  m.step(0x03ab, 5); // ret c not taken

  // ld hl,0x62b8 / dec (hl) / ret nz -- /4 prescaler: run one pass in four.
  regs.hl = 0x62b8;
  m.step(0x03ae, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
  m.step(0x03af, 11);
  if (regs.fNZ) {
    m.ret(11);
    return;
  }
  m.step(0x03b0, 5); // ret nz not taken

  // ld (hl),0x04 -- reload the prescaler.
  mem.write8(regs.hl, 0x04);
  m.step(0x03b2, 10);

  // ld a,(0x62b9) / rrca / ret nc -- feature enable = bit0 of the 0x62B9 control.
  regs.a = mem.read8(0x62b9);
  m.step(0x03b5, 13);
  regs.rrca();
  m.step(0x03b6, 4);
  if (regs.fNC) {
    m.ret(11);
    return;
  }
  m.step(0x03b7, 5); // ret nc not taken

  // Set up the object write: HL=0x6A29 (sub_03f2's target), B=0x40, IX=0x66A0.
  regs.hl = 0x6a29;
  m.step(0x03ba, 10);
  regs.b = 0x40;
  m.step(0x03bc, 7);
  regs.ix = 0x66a0;
  m.step(0x03c0, 14);

  // rrca -- the NEXT bit (bit1) of (0x62B9), still in A, into carry: the arm split.
  regs.rrca();
  m.step(0x03c1, 4);

  if (regs.fNC) {
    // jp nc,0x03e4 taken -- ARM A (bit1 clear): (ix+0x0A) := 0x00, B stays 0x40.
    m.step(0x03e4, 10);
    mem.write8((regs.ix + 0x09) & 0xffff, 0x02);
    m.step(0x03e8, 19);
    mem.write8((regs.ix + 0x0a) & 0xffff, 0x00);
    m.step(0x03ec, 19);
    m.push16(0x03ef);
    m.step(0x03f2, 17);
    m.call(0x03f2);
    m.step(0x03de, 10); // jp 0x03de -> converge
  } else {
    // jp nc not taken -- ARM B (bit1 set): (ix+0x0A) := 0x02, B := 0x42.
    m.step(0x03c4, 10);
    mem.write8((regs.ix + 0x09) & 0xffff, 0x02);
    m.step(0x03c8, 19);
    mem.write8((regs.ix + 0x0a) & 0xffff, 0x02);
    m.step(0x03cc, 19);
    regs.b = regs.inc8(regs.b);
    m.step(0x03cd, 4);
    regs.b = regs.inc8(regs.b);
    m.step(0x03ce, 4);
    m.push16(0x03d1);
    m.step(0x03f2, 17);
    m.call(0x03f2);

    // ld hl,0x62ba / dec (hl) / ret nz -- arm-B countdown; bail until it underflows.
    regs.hl = 0x62ba;
    m.step(0x03d4, 10);
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl)
    m.step(0x03d5, 11);
    if (regs.fNZ) {
      m.ret(11);
      return;
    }
    m.step(0x03d6, 5); // ret nz not taken

    // On underflow: (0x62B9) := 1 and (0x63A0) := 1, then converge.
    regs.a = 0x01;
    m.step(0x03d8, 7);
    mem.write8(0x62b9, regs.a);
    m.step(0x03db, 13);
    mem.write8(0x63a0, regs.a);
    m.step(0x03de, 13);
  }

  // loc_03de -- both arms converge: reload 0x62BA to 0x10 and return.
  regs.a = 0x10;
  m.step(0x03e0, 7);
  mem.write8(0x62ba, regs.a);
  m.step(0x03e3, 13);
  m.ret();
}
