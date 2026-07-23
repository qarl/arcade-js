// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0141 — hand-optimized rewrite of the translated routine at ROM 0x0141,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_0141 is a LEAF (it calls nothing), so there is no
 * `m.call` here at all; the only "imports" it would want are hardware-register
 * names, and those are board latches (NOT work RAM), so they live as local
 * consts here exactly like loc_0a8a's PALETTE_BANK — ram.js is work-RAM only.
 */

// ── i8257 DMA-controller programming registers (0x7800–0x780F) ──────────────
// Board hardware, not work RAM. Channel 0 is the SOURCE, channel 1 the
// DESTINATION (see boards/dkong/io.js I8257.setDrq). Each 16-bit register is
// written as TWO stores to the SAME address — the 8257 has an internal
// high/low byte flip-flop, so `ld (0x7800),a` twice sets ch0's addr lo then hi.
// Writing the mode register (0x08) resets that flip-flop, which is why it goes
// first.
const DMA_MODE = 0x7808; // mode/status register (0x53); also resets the flip-flop
const DMA_CH0_ADDR = 0x7800; // ch0 (source) address    → 0x6900 = SPRITE_BUFFER
const DMA_CH0_COUNT = 0x7801; // ch0 transfer count      → 0x4180 (holds n−1)
const DMA_CH1_ADDR = 0x7802; // ch1 (destination) addr  → 0x7000 = sprite RAM
const DMA_CH1_COUNT = 0x7803; // ch1 transfer count      → 0x8180 (holds n−1)

// DRQ request latch (0x7D85, ls259.6h) — a board control output, not work RAM.
// Pulsed 0→1→0; the RISING edge is what actually blits the sprite buffer.
const DMA_DRQ = 0x7d85;

/**
 * sub_0141 -- program the i8257 and kick the sprite blit.  [ROM 0x0141-0x017A]
 *
 * WHAT IT DOES. Runs once per vblank, unconditionally, from the NMI handler
 * entry_0066 (ROM 0x0141 is m.call'd at ROM 0x0080 with HL = 0x0138). It copies
 * the 9-byte i8257 setup block at ROM 0x0138-0x0140 into the DMA controller and
 * pulses DRQ, so the CPU-side sprite shadow buffer reaches sprite RAM every
 * frame. Straight-line, no data-dependent branch — one path:
 *   1. DRQ low (0x7D85 <- 0) before touching the controller.
 *   2. Nine bytes from (HL) -> the 8257 registers, in ROM order: mode (0x7808),
 *      then ch0 addr lo/hi, ch0 count lo/hi, ch1 addr lo/hi, ch1 count lo/hi
 *      (each 16-bit register = two stores to the same port via the flip-flop).
 *      The block decodes to: mode 0x53, ch0 src 0x6900 count 0x4180, ch1 dst
 *      0x7000 count 0x8180 = 385 transfers (n-1 form) = 96 sprites x 4 bytes + 1.
 *   3. DRQ rising edge (0x7D85 <- 1) -- THE BLIT. setDrq(1) runs the transfer
 *      synchronously (ch0 -> ch1, 0x6900 -> 0x7000) and records the cycles the
 *      8257 stole the bus for in m.io.dma.cyclesStolen.
 *   4. Charge those stolen cycles, then DRQ back low (0x7D85 <- 0).
 *
 * INPUTS: HL (points at the 0x0138 setup block); the bytes it reads are ROM
 *   constants. OUTPUTS: the i8257 registers + sprite RAM (0x7000..) via the DMA
 *   engine + the DRQ latch. HL ends 0x0140 (advanced over 8 of the 9 bytes; the
 *   last `ld a,(hl)` is not followed by an `inc hl`). A ends 0 (the final
 *   `xor a`); F ends 0x44 (Z,P/V of `xor a` — Z set, even parity of 0).
 *
 * FLAGS: nothing downstream consumes sub_0141's flags — its caller entry_0066
 *   reloads A and does `and a` (ROM 0x0083) right after the call, setting flags
 *   fresh. But the unit gate compares the whole register file incl. F, so the
 *   final `xor a` is kept verbatim: it is load-bearing for its VALUE (A=0 to the
 *   DRQ latch) and F=0x44 rides along and matches the oracle exactly.
 *
 * CYCLES -- ATOMIC, but NOT collapsed: kept PER-INSTRUCTION (this is the whole
 *   point of this routine). sub_0141 is atomic in the re-entrancy sense — its
 *   SOLE caller is the NMI handler entry_0066, which cleared the NMI mask on
 *   entry (ROM 0x0072), so the vblank NMI cannot fire inside it. Ordinarily that
 *   would license collapsing the cycle charges to one total per branch. It does
 *   NOT here, because EVERY store in this routine is a HARDWARE write: the ten
 *   i8257 programming writes (0x7800-0x7808) and the three DRQ pulses (0x7D85)
 *   are all recorded in the emit.js --writes trace with a write-bus-cycle column
 *   (= clock()+busOffset) that the RAM+regs equivalence gate CANNOT see. A
 *   collapse would silently shift those columns. So each `m.step` is kept at its
 *   oracle T-state so all twelve hardware writes land at the oracle's exact
 *   cumulative cycle (14/34/60/86/112/138/164/190/216/242/262 t, then the final
 *   DRQ-low at 262 + the store + cyclesStolen). The write-trace test proves the
 *   twelve columns identical and that a flattened variant is caught.
 *
 *   THE TOTAL IS STILL LOAD-BEARING (README §2): sub_0141 runs inside the NMI,
 *   whose total cost sets how long the main loop then spins = the PRNG entropy
 *   (SPIN_COUNT). The DMA's stolen cycles (m.io.dma.cyclesStolen, ~3121 t) are
 *   the bulk of it and MUST be charged — omitting them left the machine 3114 t
 *   fast per NMI (io.js). They are charged AFTER the blit store retires: MAME's
 *   Z80 grants BUSREQ at an instruction boundary (its ROP state), not
 *   mid-instruction, so the store completes first and the bus is stolen next.
 */
export function sub_0141(m) {
  const { regs, mem } = m;

  // ── DRQ low before programming the controller ──
  regs.xor(regs.a); // A = 0
  m.step(0x0142, 4);
  mem.write8(DMA_DRQ, regs.a, 10); // ld (0x7d85),a — DRQ low   [HW write @ +14t]
  m.step(0x0145, 13);

  // ── Nine bytes from the 0x0138 setup block -> the 8257 registers ──
  // Every store is a HARDWARE write, so the load/store/inc charges stay
  // per-instruction (7/13/6 t) to keep each write's bus cycle. The table gives
  // each store's ROM address and the following `inc hl`'s address (null on the
  // last byte, which has no inc — HL therefore ends 0x0140, not 0x0141).
  const DMA_REG_WRITES = [
    [DMA_MODE, 0x0146, 0x0149], // 0x7808  mode 0x53 (resets the byte flip-flop)
    [DMA_CH0_ADDR, 0x014b, 0x014e], // 0x7800  ch0 src addr lo
    [DMA_CH0_ADDR, 0x0150, 0x0153], // 0x7800  ch0 src addr hi  → 0x6900
    [DMA_CH0_COUNT, 0x0155, 0x0158], // 0x7801  ch0 count lo
    [DMA_CH0_COUNT, 0x015a, 0x015d], // 0x7801  ch0 count hi    → 0x4180 (n−1)
    [DMA_CH1_ADDR, 0x015f, 0x0162], // 0x7802  ch1 dst addr lo
    [DMA_CH1_ADDR, 0x0164, 0x0167], // 0x7802  ch1 dst addr hi  → 0x7000
    [DMA_CH1_COUNT, 0x0169, 0x016c], // 0x7803  ch1 count lo
    [DMA_CH1_COUNT, 0x016e, null], // 0x7803  ch1 count hi     → 0x8180 (n−1)
  ];
  for (const [port, storeAddr, incAddr] of DMA_REG_WRITES) {
    regs.a = mem.read8(regs.hl); // ld a,(hl)
    m.step(storeAddr, 7);
    mem.write8(port, regs.a, 10); // ld (port),a   [HW write @ store cum + 10t]
    m.step(incAddr === null ? 0x0171 : incAddr, 13);
    if (incAddr !== null) {
      regs.hl = (regs.hl + 1) & 0xffff; // inc hl
      m.step(incAddr + 1, 6);
    }
  }

  // ── DRQ rising edge = THE BLIT, then charge the stolen bus, then DRQ low ──
  regs.a = 0x01;
  m.step(0x0173, 7);
  mem.write8(DMA_DRQ, regs.a, 10); // ld (0x7d85),a — DRQ rising edge; sprite blit happens HERE
  m.step(0x0176, 13);

  // The 8257 halts the Z80 while it runs. MAME grants the bus at the NEXT
  // instruction boundary (its ROP/opcode-fetch state), so the store above
  // retires first and the stolen cycles are charged now, not mid-store.
  m.tick(m.io.dma.cyclesStolen);
  m.io.dma.cyclesStolen = 0;

  regs.xor(regs.a); // A = 0
  m.step(0x0177, 4);
  mem.write8(DMA_DRQ, regs.a, 10); // ld (0x7d85),a — DRQ back low   [HW write]
  m.step(0x017a, 13);

  m.ret();
}
