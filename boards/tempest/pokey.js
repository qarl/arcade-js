// SPDX-License-Identifier: GPL-3.0-only
// POKEY as Tempest uses it (6502-visible model): the POT/ALLPOT ADC input path (spinner + buttons + dips
// are 1-bit "paddles" read through the pots), the RANDOM poly RNG (Tempest's protection check reads it), the
// SKCTL master-reset gate, and register state. Sound synthesis is §5 (writes are recorded via onWrite, not
// synthesised here). 1 POKEY clock == 1 CPU cycle (both MASTER_CLOCK/8 = 1.512MHz), so poly/pot state is
// advanced by the CPU-cycle delta at each access. Source: MAME src/devices/sound/pokey.cpp; spec in
// scratchpad/tempest/spec_pokey_io.md. Line refs are pokey.cpp.

// poly17: RANDOM byte per index = (lfsr>>8)&0xff, 0x1ffff entries; poly9: lfsr&0xff, 0x1ff. Seed all-ones.
let POLY17 = null, POLY9 = null;
function poly17Table() {
  if (POLY17) return POLY17;
  const n = 0x1ffff, t = new Uint8Array(n);
  let lfsr = n;
  for (let i = 0; i < n; i++) {
    const in8 = (((lfsr >> 8) & 1) ^ ((lfsr >> 13) & 1)) & 1;
    const in0 = lfsr & 1;
    lfsr = lfsr >>> 1;
    lfsr = (lfsr & 0xff7f) | (in8 << 7);
    lfsr = ((in0 << 16) | lfsr) >>> 0;
    t[i] = (lfsr >> 8) & 0xff;
  }
  return (POLY17 = t);
}
function poly9Table() {
  if (POLY9) return POLY9;
  const n = 0x1ff, t = new Uint8Array(n);
  let lfsr = n;
  for (let i = 0; i < n; i++) {
    const in0 = ((lfsr & 1) ^ ((lfsr >> 5) & 1)) & 1;
    lfsr = ((in0 << 8) | (lfsr >>> 1)) & 0x1ff;
    t[i] = lfsr & 0xff;
  }
  return (POLY9 = t);
}

const SK_RESET = 0x03, SK_PADDLE = 0x04;
const AUDCTL_POLY9 = 0x80, AUDCTL_CLK15 = 0x01;
const DIV_15 = 114;

export class Pokey {
  // potBits() -> a 0..255 mask: bit n set => pot line n "active" (reads 0, ALLPOT done instantly);
  //   clear => inactive (ramps to 228). onWrite(reg,val,cycle) records sound-register writes for §5.
  constructor(potBits, onWrite) {
    this.potBits = potBits || (() => 0);
    this.onWrite = onWrite || null;
    this.audf = new Uint8Array(4);
    this.audc = new Uint8Array(4).fill(0xb0);
    this.audctl = 0;
    this.skctl = 0;
    this.skstat = 0;
    this.irqst = 0x08;
    this.irqen = 0;
    this.kbcode = 0x09;
    this.allpot = 0; // internal done-mask (bit set = conversion done)
    this.pot = new Uint8Array(8); // latched ADC value per pot
    this.potCounter = 0;
    this.p9 = 0;
    this.p17 = 0;
    this.clk114 = 0; // CLK_114 prescaler accumulator (for the pot ramp)
    this.lastCycle = 0;
  }

  // Advance poly indices + the pot ADC ramp by (cycle - lastCycle) POKEY clocks, gated by SK_RESET.
  _advance(cycle) {
    let d = (cycle - this.lastCycle) | 0;
    this.lastCycle = cycle;
    if (d <= 0) return;
    if (!(this.skctl & SK_RESET)) return; // master reset: polys + ramp frozen (indices already 0)
    this.p9 = (this.p9 + d) % 0x1ff;
    this.p17 = (this.p17 + d) % 0x1ffff;
    if (this.potCounter < 228) {
      let steps;
      if (this.skctl & SK_PADDLE) {
        steps = d; // fast paddle: ramp every clock
      } else {
        this.clk114 += d;
        steps = (this.clk114 / DIV_15) | 0;
        this.clk114 -= steps * DIV_15;
      }
      if (steps > 0) {
        this.potCounter = Math.min(228, this.potCounter + steps);
        // set ALLPOT done bits: a 228-line completes when potCounter reaches 228 (POTx<counter or ==228)
        for (let p = 0; p < 8; p++) {
          if (this.pot[p] < this.potCounter || this.potCounter === 228) this.allpot |= (1 << p);
        }
      }
    }
  }

  // Clock-free RNG tick: advance ONLY the poly RNG indices by `steps` (leaving the pot ADC ramp untouched).
  // The idiomatic layer charges no CPU cycles, so read(reg,cycle) with a frozen cycle never advances the LFSR
  // and RANDOM would stick at poly index 0 (0xff). The machine calls this per IRQ in clock-free mode so the
  // RNG free-runs on game-time; the cycle-driven path advances the same indices via _advance(cycle) instead.
  advanceRngPolys(steps) {
    if (!(this.skctl & SK_RESET)) return; // polys frozen under master reset (same gate as _advance)
    this.p9 = (this.p9 + steps) % 0x1ff;
    this.p17 = (this.p17 + steps) % 0x1ffff;
  }

  _potgo() {
    if (!(this.skctl & SK_RESET)) return; // POTGO no-op unless gated on
    this.allpot = 0;
    this.potCounter = 0;
    this.clk114 = 0;
    const bits = this.potBits() & 0xff;
    for (let p = 0; p < 8; p++) {
      const r = (bits & (1 << p)) ? 0 : 228; // Tempest: active bit -> 0 (instant), inactive -> 228 (ramps)
      this.pot[p] = r;
      if (r === 0) this.allpot |= (1 << p);
    }
  }

  read(reg, cycle) {
    this._advance(cycle);
    reg &= 0x0f;
    if (reg < 8) {
      return (this.allpot & (1 << reg)) ? this.pot[reg] : (this.potCounter & 0xff);
    }
    switch (reg) {
      case 0x8: // ALLPOT
        return (this.skctl & SK_RESET) ? (this.allpot ^ 0xff) & 0xff : this.allpot & 0xff;
      case 0x9: return this.kbcode; // 0x09
      case 0xa: // RANDOM
        return (this.audctl & AUDCTL_POLY9) ? poly9Table()[this.p9] : poly17Table()[this.p17];
      case 0xe: return (this.irqst ^ 0xff) & 0xff; // IRQST active-low
      case 0xf: return (this.skstat ^ 0xff) & 0xff; // SKSTAT active-low
      default: return 0xff;
    }
  }

  write(reg, val, cycle) {
    this._advance(cycle);
    reg &= 0x0f;
    val &= 0xff;
    if (reg < 8) {
      if (reg & 1) this.audc[reg >> 1] = val;
      else this.audf[reg >> 1] = val;
      if (this.onWrite) this.onWrite(reg, val, cycle);
      return;
    }
    switch (reg) {
      case 0x8: this.audctl = val; if (this.onWrite) this.onWrite(reg, val, cycle); return; // AUDCTL
      case 0x9: if (this.onWrite) this.onWrite(reg, val, cycle); return; // STIMER (sound reset; §5)
      case 0xa: this.skstat &= ~(0x80 | 0x40 | 0x20); return; // SKREST
      case 0xb: this._potgo(); return; // POTGO
      case 0xe: this.irqen = val; this.irqst &= (0x08 | val); return; // IRQEN
      case 0xf: { // SKCTL master gate
        const wasReset = (this.skctl & SK_RESET) !== 0;
        this.skctl = val;
        if (!(val & SK_RESET) && wasReset) { // entering master reset: zero polys + ramp
          this.p9 = 0; this.p17 = 0; this.clk114 = 0; this.irqen = 0;
        }
        return;
      }
      default: return;
    }
  }

  // A machine clone passes its own io's pot inputs and sound seam; the defaults keep the source's.
  clone(potBits = this.potBits, onWrite = this.onWrite) {
    const p = new Pokey(potBits, onWrite);
    p.audf.set(this.audf); p.audc.set(this.audc); p.pot.set(this.pot);
    p.audctl = this.audctl; p.skctl = this.skctl; p.skstat = this.skstat;
    p.irqst = this.irqst; p.irqen = this.irqen; p.kbcode = this.kbcode;
    p.allpot = this.allpot; p.potCounter = this.potCounter;
    p.p9 = this.p9; p.p17 = this.p17; p.clk114 = this.clk114; p.lastCycle = this.lastCycle;
    return p;
  }
}
