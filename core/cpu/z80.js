/**
 * Z80 register file and ALU semantics.
 *
 * THIS IS NOT AN EMULATOR. There is no fetch-decode-execute loop and the ROM
 * bytes are never interpreted. What lives here is the *meaning* of the
 * arithmetic: translated routines are plain JS functions, but when the ROM
 * branches on a flag we have to produce the same flag the hardware would, so
 * the flag rules are modelled once here rather than open-coded (and subtly
 * varied) at every translated site.
 *
 * Registers are shared state rather than JS locals because on hardware they
 * carry values ACROSS calls -- `ld a,(0x6005)` then `rst 0x28` passes A to
 * the dispatcher, and sub_0057 returns its result in A. Making the register
 * file explicit keeps that data flow identical to the original.
 *
 * Semantics preserved deliberately (the ROM depends on all of these):
 *   - 8-bit and 16-bit wraparound
 *   - the flags the code actually branches on
 *   - DAA / BCD, which the score arithmetic uses
 */

// F register bit positions.
export const F_C = 0x01; // carry
export const F_N = 0x02; // add/subtract (DAA needs it)
export const F_PV = 0x04; // parity / overflow
export const F_F3 = 0x08; // undocumented, copy of result bit 3
export const F_H = 0x10; // half carry (DAA needs it)
export const F_F5 = 0x20; // undocumented, copy of result bit 5
export const F_Z = 0x40; // zero
export const F_S = 0x80; // sign

function parity8(v) {
  let p = v ^ (v >> 4);
  p ^= p >> 2;
  p ^= p >> 1;
  return p & 1 ? 0 : F_PV; // even parity sets the flag
}

/** S, Z and the two undocumented bits, from an 8-bit result. */
function sz8(v) {
  return (v & 0x80 ? F_S : 0) | (v === 0 ? F_Z : 0) | (v & (F_F3 | F_F5));
}

export class Regs {
  /**
   * Power-on register state, MEASURED from MAME at t=0 before a single
   * instruction (QA, with a control read of ROM 0x0000 = 0x3E):
   *
   *   AF = 0x0040   BC = DE = HL = 0x0000
   *   IX = IY = 0xFFFF          SP = 0x0000
   *   AF' BC' DE' HL' = 0x0000  I = R = IM = 0
   *
   * THIS MATTERS BECAUSE THE NMI PUSHES IT. IX and IY are the only registers
   * the ROM does not write before the first interrupt, so they are the only
   * power-on values that survive to reach the stack -- which lives inside the
   * work RAM the state diff compares. That is why state[5] diverged in
   * exactly four bytes and not fourteen.
   *
   * NOT SET TO 0xFFFF ACROSS THE BOARD, which was my prediction from the
   * diff and was wrong. Only IX and IY are 0xFFFF; AF is 0x0040 and SP is
   * 0x0000. Applying the guess would have set AF and SP incorrectly and
   * NEITHER WOULD HAVE SHOWN -- the ROM writes AF immediately and does
   * `ld sp,0x6c00` at 0x02B2 before anything reads them. Two latent bugs
   * behind a green diff.
   *
   * AF = 0x0040 IS ALSO MAME'S CHOICE, and the mechanism is named. VERIFIED
   * against the pinned tree at `~/src/mame0288` (tag mame0288, the build that
   * produced our golden), `src/devices/cpu/z80/z80.cpp`:
   *
   *   643  void z80_device::device_start()
   *   720      IX = IY = 0xffff; // IX and IY are FFFF after a reset!
   *   721      m_f.z_val = 0;    // Zero flag is set
   *
   * F bit 6 is Z = 0x40 and A is 0, hence 0x0040. A decision MAME made, not
   * a documented Z80 power-on state -- same standing as the RAM zeros.
   *
   * AND THE COMMENT ON LINE 720 IS FALSE ABOUT ITS OWN SCOPE. It says "after
   * a reset"; the assignment is in device_START, and `device_reset()`
   * mentions neither register -- verified, the grep count is zero. So the
   * value is right and the scope is wrong, on the same line. A comment is a
   * claim that ships beside tested code, inherits its authority, and never
   * executes. When one states a SCOPE, that scope is checkable in one grep.
   *
   * WHAT THIS BLOCK IS NOT: a blanket 0xFFFF. That was my prediction from
   * seeing 0xFFFF in the diff, and it was wrong for AF and SP. The diff
   * ITSELF refuted it and I did not notice: only FOUR bytes differed. Had
   * every register reset to 0xFFFF, the AF/BC/DE/HL slots at 0x6BF6-0x6BFD
   * would have differed too, making it fourteen. The count was in hand before
   * the prediction was made.
   *
   * IX/IY = 0xFFFF IS MAME'S CONVENTION, NOT A HARDWARE FACT. A real Z80's
   * IX/IY after reset are genuinely undefined; MAME picks 0xFFFF. We match it
   * because the CHARTER makes MAME ground truth -- the same deliberate choice
   * as power-on RAM zeros. Do not read this as silicon behaviour.
   *
   * AND IT IS A POWER-ON VALUE THAT PERSISTS ACROSS RESET. The assignment
   * lives in MAME's z80.cpp device_start(), not device_reset() -- despite the
   * source comment saying "after a reset". device_reset() clears only PC, WZ,
   * I, R, R2, IFF1/2 and the service-attention flags, leaving IX/IY holding
   * whatever they held at runtime. So if the WATCHDOG ever fires mid-run,
   * IX/IY will NOT return to 0xFFFF. Any reset path we add must not
   * re-establish power-on state wholesale.
   */
  constructor() {
    this.a = 0x00;
    this.f = 0x40; // Z set -- measured, mechanism named below [lead-verified]
    this.b = 0;
    this.c = 0;
    this.d = 0;
    this.e = 0;
    this.h = 0;
    this.l = 0;
    this.ix = 0xffff;
    this.iy = 0xffff;
    this.sp = 0;
    // Alternate set, for EX AF,AF' / EXX.
    this.a_ = 0;
    this.f_ = 0;
    this.b_ = 0;
    this.c_ = 0;
    this.d_ = 0;
    this.e_ = 0;
    this.h_ = 0;
    this.l_ = 0;
  }

  get bc() {
    return (this.b << 8) | this.c;
  }
  set bc(v) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }

  get de() {
    return (this.d << 8) | this.e;
  }
  set de(v) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }

  get hl() {
    return (this.h << 8) | this.l;
  }
  set hl(v) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  get af() {
    return (this.a << 8) | this.f;
  }
  set af(v) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xff;
  }

  // -- flag tests, named as the ROM's condition codes -------------------
  get fZ() {
    return (this.f & F_Z) !== 0;
  }
  get fNZ() {
    return (this.f & F_Z) === 0;
  }
  get fC() {
    return (this.f & F_C) !== 0;
  }
  get fNC() {
    return (this.f & F_C) === 0;
  }
  get fM() {
    return (this.f & F_S) !== 0; // minus
  }
  get fP() {
    return (this.f & F_S) === 0; // plus
  }
  get fPE() {
    return (this.f & F_PV) !== 0; // parity even / overflow
  }
  get fPO() {
    return (this.f & F_PV) === 0;
  }

  exAf() {
    let t = this.a;
    this.a = this.a_;
    this.a_ = t;
    t = this.f;
    this.f = this.f_;
    this.f_ = t;
  }

  exx() {
    let t;
    t = this.b; this.b = this.b_; this.b_ = t;
    t = this.c; this.c = this.c_; this.c_ = t;
    t = this.d; this.d = this.d_; this.d_ = t;
    t = this.e; this.e = this.e_; this.e_ = t;
    t = this.h; this.h = this.h_; this.h_ = t;
    t = this.l; this.l = this.l_; this.l_ = t;
  }

  exDeHl() {
    const t = this.de;
    this.de = this.hl;
    this.hl = t;
  }

  /**
   * DJNZ -- decrement B and branch while non-zero. It affects NO FLAGS, which
   * is why it is NOT `dec8(b)`: that would clobber S/Z/H/PV/N and silently
   * corrupt a later conditional. B is decremented with 8-bit wraparound; the
   * new value is written back to B and also returned, so callers may branch on
   * it. Hoisted from the DK translated units (boot/mainloop/nmi/state0), which
   * each kept a byte-identical local copy (nmi's was named `djnzNmi`).
   */
  djnz() {
    this.b = (this.b - 1) & 0xff;
    return this.b;
  }

  // -- 8-bit ALU. Each sets A and F exactly as the Z80 does. -------------

  add(v, carryIn = 0) {
    const a = this.a;
    const r = a + v + carryIn;
    const res = r & 0xff;
    this.f =
      sz8(res) |
      (r > 0xff ? F_C : 0) |
      (((a ^ v ^ res) & 0x10) ? F_H : 0) |
      ((~(a ^ v) & (a ^ res) & 0x80) ? F_PV : 0);
    this.a = res;
  }

  adc(v) {
    this.add(v, this.f & F_C ? 1 : 0);
  }

  sub(v, carryIn = 0) {
    const a = this.a;
    const r = a - v - carryIn;
    const res = r & 0xff;
    this.f =
      sz8(res) |
      F_N |
      (r < 0 ? F_C : 0) |
      (((a ^ v ^ res) & 0x10) ? F_H : 0) |
      (((a ^ v) & (a ^ res) & 0x80) ? F_PV : 0);
    this.a = res;
  }

  sbc(v) {
    this.sub(v, this.f & F_C ? 1 : 0);
  }

  /** CP: like SUB but discards the result, keeping only flags. Note the
   *  undocumented F3/F5 come from the OPERAND, not the result. */
  cp(v) {
    const a = this.a;
    const r = a - v;
    const res = r & 0xff;
    this.f =
      (res & 0x80 ? F_S : 0) |
      (res === 0 ? F_Z : 0) |
      (v & (F_F3 | F_F5)) |
      F_N |
      (r < 0 ? F_C : 0) |
      (((a ^ v ^ res) & 0x10) ? F_H : 0) |
      (((a ^ v) & (a ^ res) & 0x80) ? F_PV : 0);
  }

  and(v) {
    this.a = (this.a & v) & 0xff;
    this.f = sz8(this.a) | F_H | parity8(this.a);
  }

  or(v) {
    this.a = (this.a | v) & 0xff;
    this.f = sz8(this.a) | parity8(this.a);
  }

  xor(v) {
    this.a = (this.a ^ v) & 0xff;
    this.f = sz8(this.a) | parity8(this.a);
  }

  /** INC r -- note it does NOT affect carry. */
  inc8(v) {
    const res = (v + 1) & 0xff;
    this.f =
      (this.f & F_C) |
      sz8(res) |
      ((res & 0x0f) === 0 ? F_H : 0) |
      (res === 0x80 ? F_PV : 0);
    return res;
  }

  /** DEC r -- also leaves carry alone. */
  dec8(v) {
    const res = (v - 1) & 0xff;
    this.f =
      (this.f & F_C) |
      sz8(res) |
      F_N |
      ((res & 0x0f) === 0x0f ? F_H : 0) |
      (res === 0x7f ? F_PV : 0);
    return res;
  }

  /**
   * INC (addr) / DEC (addr) -- the MEMORY read-modify-write forms of inc/dec.
   * Read the byte, apply the full inc8/dec8 flag semantics (S, Z, H, PV set;
   * carry preserved -- Z80 inc/dec never touch C), write the result back, and
   * return it.
   *
   * WHY THESE EXIST, and why they are methods rather than an inline mask. The
   * natural open-coding `mem.write8(addr, (mem.read8(addr) + 1) & 0xff)`
   * produces the correct VALUE and silently DROPS every flag -- and consumers
   * depend on them. sub_32d6 does `dec (ix+0x1c)` then `jp nz` on that exact
   * Z flag, and this RMW recurs in every object routine (~90 sites across the
   * 0x32xx/0x33xx object handlers). Routing all of them through inc8/dec8 keeps
   * the flag semantics stated in ONE place -- the sub_0593 lesson (a shared
   * primitive's job is to make the correct behaviour the only behaviour) applied
   * to the RMW that would otherwise be hand-written dozens of times.
   *
   * Works for any addressing mode -- `(hl)`, `(ix+d)`, `(iy+d)`, `(nn)`:
   *   regs.decMem8(mem, (regs.ix + 0x1c) & 0xffff);  // dec (ix+0x1c)
   *   regs.incMem8(mem, regs.hl);                    // inc (hl)
   * The caller computes the effective address (and still charges T-states via
   * m.step, as with every other operation -- these are pure value+flag+memory).
   *
   * @param busOffset optional write-timing offset for the write trace; matters
   *   ONLY for hardware addresses (inert for work/sprite/video RAM, where every
   *   object (ix+d) write lands). Defaults to write8's own default.
   * @returns {number} the modified byte
   */
  incMem8(mem, addr, busOffset) {
    const v = this.inc8(mem.read8(addr));
    mem.write8(addr, v, busOffset);
    return v;
  }

  decMem8(mem, addr, busOffset) {
    const v = this.dec8(mem.read8(addr));
    mem.write8(addr, v, busOffset);
    return v;
  }

  /**
   * BIT n,r -- tests a bit and sets flags; it does NOT change the operand.
   * Z = !bit, PV = Z (parity is set to the same value), H = 1, N = 0,
   * S = bit 7 only when testing bit 7, C preserved.
   *
   * Exists because open-coding `(reg & mask) !== 0` at each site silently
   * skips the flag effects, and those sites are only harmless until the next
   * instruction added between the test and its flag consumer.
   *
   * THE UNDOCUMENTED F3/F5 SOURCE DIFFERS BY ADDRESSING MODE, and MAME 0.288
   * has three separate functions for it (z80.cpp:531/543/555):
   *   bit n,r        yx_val = value              -- the operand, the default
   *   bit n,(ix+d)   yx_val = (ix+d) >> 8        -- the address high byte
   *   bit n,(hl)     yx_val = WZ_H               -- the WZ high byte
   * The register form is what every current caller uses and is correct. The
   * indexed form is reachable by passing `yxFrom` = the effective-address high
   * byte; entry_2913's `bit n,(ix+d)` is the first such use and the reason the
   * parameter exists. The (hl) form is NOT expressible here -- this core does
   * not model WZ -- so `bit n,(hl)` (state0.js:624) takes F3/F5 from the value,
   * which is wrong in exactly those two bits and latent because nothing reads
   * them after it. Flagged rather than silently "fixed": a correct fix needs
   * WZ, which is a much larger change than this bit test.
   *
   * @param {number} yxFrom byte supplying F3/F5; defaults to the operand
   *   value (the register form). Pass the EA high byte for the indexed form.
   */
  bit(n, value, yxFrom = value) {
    const set = (value & (1 << n)) !== 0;
    this.f =
      (this.f & F_C) |
      F_H |
      (set ? 0 : F_Z | F_PV) |
      (n === 7 && set ? F_S : 0) |
      (yxFrom & (F_F3 | F_F5));
    return set;
  }

  /**
   * RES n,r -- CB 0x80-0xBF. Clears bit n of the operand and returns it.
   * SET n,r -- CB 0xC0-0xFF. Sets bit n of the operand and returns it.
   *
   * BOTH LEAVE EVERY FLAG UNCHANGED. That is the whole reason they are methods
   * rather than open-coded masks: `regs.d & ~(1 << 2)` is the correct VALUE and
   * silently drops nothing, so it looks safe -- but it invites the reader to
   * treat res/set as flag-affecting-by-analogy-with-bit, and it separates the
   * "this touches no flags" guarantee from the operation. `bit n,r` was made a
   * method for the opposite reason (it DOES set flags a mask would miss); res
   * and set are made methods so the flag-PRESERVATION is stated in one place.
   *
   * This matters concretely at entry_3009: `res 2,d` at 0x3043 is immediately
   * followed by `dec d`, and the exit test reads `dec d`'s flags. A res that
   * clobbered a flag would corrupt that test while leaving D correct -- the
   * §29 compensating-error shape, invisible in a memory diff.
   *
   * Matches MAME 0.288 z80.cpp:567 `res` / :575 `set`, which are `value &
   * ~(1<<bit)` and `value | (1<<bit)` with no m_f access whatsoever.
   *
   * @returns {number} the modified value; the caller assigns it. Flags: none.
   */
  res(n, value) {
    return value & ~(1 << n) & 0xff;
  }

  set(n, value) {
    return (value | (1 << n)) & 0xff;
  }

  /**
   * ADD rr,rr -- the shared arithmetic behind ADD HL,rr and ADD IX,rr.
   * Affects only H, N and C; S, Z and PV are preserved.
   *
   * Factored rather than written twice. Duplicating flag semantics is how
   * `bit n,r` ended up open-coded as a bare mask and silently skipping its
   * flag effects -- the second copy is always the one that drifts.
   *
   * @returns {number} the 16-bit result; the caller assigns it
   */
  add16(cur, v) {
    const r = cur + v;
    this.f =
      (this.f & (F_S | F_Z | F_PV)) |
      (r > 0xffff ? F_C : 0) |
      (((cur ^ v ^ (r & 0xffff)) & 0x1000) ? F_H : 0) |
      ((r >> 8) & (F_F3 | F_F5));
    return r & 0xffff;
  }

  /** ADD HL,rr -- affects only H, N and C. */
  addHl(v) {
    this.hl = this.add16(this.hl, v);
  }

  /**
   * ADC HL,rr -- ED 4A/5A/6A/7A. HL = HL + rr + carry.
   *
   * NOT a variant of addHl: `add hl,rr` PRESERVES S, Z and PV, while `adc hl,rr`
   * SETS all of them. That difference is the whole reason this exists --
   * sub_342c does `xor a / ld bc,0 / adc hl,bc` purely as a 16-bit ZERO TEST on
   * HL and branches on the resulting Z, which `add hl,bc` would never produce.
   *
   * Pinned against MAME 0.288's `adc_hl` macro (z80.lst:361):
   *   res = HL + rr + c        (32-bit, so bit 16 is the carry out)
   *   s_val = z_val = ((res & 0x8000) >> 8) | (u16(res) != 0)
   *       -> S = bit 15 of the 16-bit result; Z = (16-bit result == 0)
   *   yx_val = res >> 8        -> F3/F5 from the HIGH byte of the result
   *   h_val  = (HL ^ res ^ rr) >> 8, flag = bit 4  -> carry out of bit 11
   *   pv_val = !((rr ^ HL ^ 0x8000) & (rr ^ res) & 0x8000)
   *   n = 0 ; c = res & 0x10000
   *
   * On pv: MAME's `pv()` (z80.h:196) is a PARITY FOLD returning `~val & 0x04`,
   * so pv_val = 0 yields PV SET and pv_val = 1 yields PV CLEAR -- i.e. the `!`
   * plus the fold give PV = OVERFLOW, the standard rule. MAME's condition
   * (operands same-signed AND result differs from them) is algebraically the
   * same as the documented `(HL ^ res) & (rr ^ res) & 0x8000`: when HL and rr
   * differ in sign, overflow is impossible under both forms. Written in the
   * documented form here, having checked they agree.
   *
   * @returns {void} HL is updated in place.
   */
  adcHl(v) {
    const hl = this.hl;
    const r = hl + v + (this.f & F_C ? 1 : 0);
    const res = r & 0xffff;
    this.f =
      (res & 0x8000 ? F_S : 0) |
      (res === 0 ? F_Z : 0) |
      (((hl ^ res ^ v) >> 8) & F_H) |
      (((hl ^ res) & (v ^ res) & 0x8000) ? F_PV : 0) |
      (r > 0xffff ? F_C : 0) |
      ((res >> 8) & (F_F3 | F_F5));
    this.hl = res;
  }

  /**
   * SBC HL,rr -- ED 42/52/62/72. 16-bit subtract with carry. 15 T.
   *
   * Authored by qa (qa/drafts/primitives-cpir-sbc16.md), pinned to mame0288
   * z80.lst:394 `sbc_hl`. I re-read the macro before merging: n=1 and the
   * overflow term both confirmed against the source, not taken on trust.
   *
   * NOT A SIGN-FLIPPED adcHl, and that is the trap:
   *   N        adc_hl:372 n=0        sbc_hl:405 n=1   <- SBC SETS IT
   *   overflow (dd^HL^0x8000)&(dd^res)  (dd^HL)&(HL^res)
   *            same-sign operands        DIFFERENT-sign operands
   * Both macros store pv_val with a leading `!` -- that is MAME's uniform
   * internal convention (its pv() parity-fold inverts it back), NOT a semantic
   * difference between them. Reading the `!` as a difference would invert PV.
   *
   * F3/F5 from the RESULT HIGH BYTE (sbc_hl:402 yx_val = res >> 8).
   */
  sbcHl(v) {
    const hl = this.hl;
    const r = hl - v - (this.f & F_C ? 1 : 0);
    const res = r & 0xffff;
    this.f =
      (res & 0x8000 ? F_S : 0) |
      (res === 0 ? F_Z : 0) |
      (((hl ^ res ^ v) >> 8) & F_H) |
      ((hl ^ v) & (hl ^ res) & 0x8000 ? F_PV : 0) |
      F_N |
      (r < 0 ? F_C : 0) |
      ((res >> 8) & (F_F3 | F_F5));
    this.hl = res;
  }

  /**
   * CPI -- compare A with (HL), HL++, BC--. One iteration. 16 T.
   * Pinned to mame0288 z80.lst:457 `cpi` (re-read before merging).
   *
   * THREE THINGS THAT ARE WRONG IF COPIED FROM THE OBVIOUS SIBLING:
   *  1. C IS PRESERVED -- z80.lst:467 is literally `// keep C`. It is a compare,
   *     and the carry it does not touch is often one the caller holds across the
   *     whole block operation.
   *  2. F3/F5 COME FROM AN H-ADJUSTED RESULT (z80.lst:469-472): h_val is computed,
   *     then `if (h()) res -= 1`, and ONLY THEN yx_val = (res << 4) | (res & 0x0f)
   *     -- so F5 is bit 1 and F3 is bit 3 of the ADJUSTED value.
   *  3. S and Z come from the UNADJUSTED result (line 468, before that decrement).
   *     "F3/F5 from the result" is therefore wrong twice over.
   *
   * PV = (BC != 0) after the decrement (line 473, same inverted storage), N = 1.
   *
   * @returns {number} the raw (unadjusted) result; 0 means A == (HL)
   */
  cpi(mem) {
    const a = this.a;
    const v = mem.read8(this.hl);
    const res = (a - v) & 0xff;
    const h = (a ^ v ^ res) & F_H;
    this.hl = (this.hl + 1) & 0xffff;
    this.bc = (this.bc - 1) & 0xffff;
    const yx = h ? (res - 1) & 0xff : res;
    this.f =
      (this.f & F_C) |
      (res & 0x80 ? F_S : 0) |
      (res === 0 ? F_Z : 0) |
      h |
      (this.bc !== 0 ? F_PV : 0) |
      F_N |
      (((yx << 4) | (yx & 0x0f)) & (F_F3 | F_F5));
    return res;
  }

  /**
   * CPIR -- repeat CPI until BC == 0 or A == (HL). z80.lst:749 `cpir`.
   *
   * CYCLES ARE THE CALLER'S TO CHARGE: 21 T per repeating iteration, 16 T for the
   * terminating one -- `21 * (n - 1) + 16` for the returned n. Nothing here
   * verifies the caller does that (the §72 targets-not-values gap; this does not
   * close it).
   *
   * BC == 0 on entry means 65536 iterations, because BC-- wraps before the test.
   * That is the real Z80 behaviour and is reproduced rather than guarded.
   *
   * NOT MODELLED, DELIBERATELY (qa's finding, stated not hidden): while CPIR
   * repeats, MAME sets F3/F5 from the PC high byte (cpir:752-755). A translated
   * routine has no PC. Omitting it is CORRECT because the next iteration's cpi
   * overwrites those bits before anything can read them -- after a completed
   * CPIR, F3/F5 are the last cpi's adjusted result, exactly as modelled. They are
   * observable only to an interrupt landing between iterations, and the NMI
   * pushes AF.
   *
   * @returns {number} n, the iterations performed (always >= 1)
   */
  cpir(mem) {
    let n = 0;
    for (;;) {
      const res = this.cpi(mem);
      n++;
      if (this.bc === 0 || res === 0) return n;
    }
  }

  /** ADD IX,rr -- identical semantics on the IX index register. */
  addIx(v) {
    this.ix = this.add16(this.ix, v);
  }

  /**
   * ADD IY,rr -- 15 T. Sibling of addIx (mame0288 z80.lst:4321 fd09, the
   * IDENTICAL @add16 macro dd09 uses for IX; only the destination differs).
   *
   * WHY DRAIN #20'S TWIN HAZARD DOES NOT APPLY (qa stated it explicitly and it
   * is worth keeping): this re-implements nothing. It delegates to the SAME
   * add16 helper that addIx and addHl already use, so the flag semantics -- S/Z/PV
   * preserved, N cleared, C from the carry-out, F3/F5 from the result high byte
   * -- CANNOT drift from its sibling. It is safe because it SHARES THE PATH, not
   * because it looks similar. Had it inlined the flags, #20 would apply in full.
   * The one real hazard is the destination register, which is what its test
   * mutation attacks.
   */
  addIy(v) {
    this.iy = this.add16(this.iy, v);
  }

  // -- rotates on A. These set carry from the bit rotated out. ----------

  rlca() {
    const c = (this.a >> 7) & 1;
    this.a = ((this.a << 1) | c) & 0xff;
    this.f = (this.f & (F_S | F_Z | F_PV)) | c | (this.a & (F_F3 | F_F5));
  }

  rrca() {
    const c = this.a & 1;
    this.a = ((this.a >> 1) | (c << 7)) & 0xff;
    this.f = (this.f & (F_S | F_Z | F_PV)) | c | (this.a & (F_F3 | F_F5));
  }

  rla() {
    const c = (this.a >> 7) & 1;
    this.a = ((this.a << 1) | (this.f & F_C ? 1 : 0)) & 0xff;
    this.f = (this.f & (F_S | F_Z | F_PV)) | c | (this.a & (F_F3 | F_F5));
  }

  rra() {
    const c = this.a & 1;
    this.a = ((this.a >> 1) | (this.f & F_C ? 0x80 : 0)) & 0xff;
    this.f = (this.f & (F_S | F_Z | F_PV)) | c | (this.a & (F_F3 | F_F5));
  }

  /**
   * RL r -- CB-prefixed rotate left through carry, on any 8-bit register.
   *
   * NOT the same instruction as `rla`, and the difference is the flags.
   * `rla` (0x17) affects only H, N and C and PRESERVES S/Z/PV; `rl r`
   * (CB 0x10-0x17) sets the FULL set including S, Z and parity. The two look
   * interchangeable and are not. `sub_2ff0` uses `rl e` and `rla` in
   * alternation to build a 16-bit shift; there the difference happens to be
   * invisible, because `add a,0x74` overwrites the whole flag set before any
   * conditional reads it. The distinction is still real and is modelled here
   * rather than at the call site -- but do NOT cite that routine as evidence
   * for it, which an earlier version of this comment did.
   *
   * @returns {number} the rotated value; the caller assigns it
   */
  rl(v) {
    const c = (v >> 7) & 1;
    const r = ((v << 1) | (this.f & F_C ? 1 : 0)) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /**
   * RLC r -- CB 0x00-0x07. Rotate left CIRCULAR: bit 7 wraps to bit 0 AND to
   * carry. The CB-prefixed counterpart of `rlca`, and it differs the same way
   * `rl` differs from `rla` -- this sets the FULL flag set (S, Z, parity,
   * H=0, N=0, C), where `rlca` preserves S/Z/PV. `rlc a` (CB 0x07) is a
   * DIFFERENT instruction from `rlca` (0x07) despite the shared final byte.
   *
   * Matches MAME 0.288 z80.cpp:403 `rlc`: res = (v << 1) | (v >> 7),
   * C = v & 0x80, H = N = 0, S/Z/PV/F3/F5 from the result.
   *
   * @returns {number} the rotated value; the caller assigns it
   */
  rlc(v) {
    const c = (v >> 7) & 1;
    const r = ((v << 1) | (v >> 7)) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /**
   * RR r -- CB 0x18-0x1F. Rotate right THROUGH carry: bit 0 becomes the new
   * carry, the old carry becomes bit 7. The through-carry counterpart of
   * `rrca`, and it differs the same way `rl` differs from `rla`: this sets the
   * FULL flag set (S, Z, parity, H=0, N=0, C), where `rra` preserves S/Z/PV.
   *
   * Matches MAME 0.288 z80.cpp:451 `rr`: res = (v >> 1) | (c << 7),
   * C = v & 0x01, H = N = 0, S/Z/PV/F3/F5 from the result.
   *
   * @returns {number} the rotated value; the caller assigns it
   */
  rr(v) {
    const c = v & 1;
    const r = ((v >> 1) | (this.f & F_C ? 0x80 : 0)) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /**
   * SLA r -- CB 0x20-0x27. Arithmetic shift left: bit 7 out to carry, a 0
   * shifted into bit 0. Identical to `sll` except sll shifts in a 1; sll is an
   * undocumented opcode and is NOT provided, so a `cb 30-37` byte would decode
   * to nothing rather than silently reuse this.
   *
   * Matches MAME 0.288 z80.cpp:467 `sla`: res = (v << 1) & 0xff,
   * C = v & 0x80, H = N = 0, S/Z/PV/F3/F5 from the result.
   *
   * @returns {number} the shifted value; the caller assigns it
   */
  sla(v) {
    const c = (v >> 7) & 1;
    const r = (v << 1) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /**
   * SRA r -- CB 0x28-0x2F. Arithmetic shift right: bit 0 out to carry, bit 7
   * PRESERVED (sign-extending). This is what makes it "arithmetic" and
   * distinct from `srl`, which shifts in a 0 -- the two differ only on a
   * negative input and are easy to swap.
   *
   * Matches MAME 0.288 z80.cpp:483 `sra`: res = (v >> 1) | (v & 0x80),
   * C = v & 0x01, H = N = 0, S/Z/PV/F3/F5 from the result.
   *
   * @returns {number} the shifted value; the caller assigns it
   */
  sra(v) {
    const c = v & 1;
    const r = ((v >> 1) | (v & 0x80)) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /**
   * SRL r -- CB 0x38-0x3F. Logical shift right: bit 0 out to carry, a 0 into
   * bit 7. The zero-fill counterpart of `sra`; a divide-by-two for unsigned
   * bytes.
   *
   * Matches MAME 0.288 z80.cpp:515 `srl`: res = (v >> 1) & 0xff,
   * C = v & 0x01, H = N = 0, S/Z/PV/F3/F5 from the result.
   *
   * @returns {number} the shifted value; the caller assigns it
   */
  srl(v) {
    const c = v & 1;
    const r = (v >> 1) & 0xff;
    this.f = sz8(r) | parity8(r) | c;
    return r;
  }

  /** NEG -- A = 0 - A, as a subtract from zero so the flags fall out. */
  neg() {
    const a = this.a;
    this.a = 0;
    this.sub(a);
  }

  cpl() {
    this.a = ~this.a & 0xff;
    this.f = (this.f & (F_S | F_Z | F_PV | F_C)) | F_H | F_N | (this.a & (F_F3 | F_F5));
  }

  scf() {
    this.f = (this.f & (F_S | F_Z | F_PV)) | F_C | (this.a & (F_F3 | F_F5));
  }

  ccf() {
    const c = this.f & F_C;
    this.f =
      (this.f & (F_S | F_Z | F_PV)) |
      (c ? F_H : 0) |
      (c ? 0 : F_C) |
      (this.a & (F_F3 | F_F5));
  }

  /**
   * DAA -- BCD correction after an add or subtract. The score arithmetic
   * depends on this, so it is modelled exactly rather than approximated:
   * the correction depends on H and N, not just on A's nibbles.
   */
  daa() {
    let correction = 0;
    let carry = this.f & F_C ? 1 : 0;
    const a = this.a;

    if (this.f & F_H || (a & 0x0f) > 9) correction |= 0x06;
    if (carry || a > 0x99) {
      correction |= 0x60;
      carry = 1;
    }

    const res = this.f & F_N ? (a - correction) & 0xff : (a + correction) & 0xff;

    this.f =
      sz8(res) |
      parity8(res) |
      (this.f & F_N) |
      (carry ? F_C : 0) |
      ((this.f & F_N
        ? (this.f & F_H) && (a & 0x0f) < 6
        : (a & 0x0f) > 9)
        ? F_H
        : 0);
    this.a = res;
  }
}

