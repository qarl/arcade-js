// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_309f — hand-optimized rewrite of the translated routine at ROM 0x309F,
 * proven equal to its oracle by the equivalence harness. It touches only the task-queue
 * work RAM (head pointer 0x60B0, ring buffer 0x60C0-0x60FF), which lacks settled ram.js
 * names, so those stay hex with descriptive comments.
 */

/**
 * sub_309f -- enqueue a 2-byte message (D,E) into the task ring buffer.  [ROM 0x309F-0x30BC]
 *
 * The shared "post a task" primitive (31 optimized callers so far). The ring lives at
 * 0x60C0-0x60FF; 0x60B0 holds the low byte of the write head (HL's page is fixed at 0x60).
 *   - Load the head into L; if the target slot's high bit is CLEAR the ring is full at that
 *     slot, so the task is DROPPED (restore HL, ret).
 *   - Otherwise write D then E into the slot and its successor, advance the head by 2, and
 *     wrap it back to 0xC0 if it fell below 0xC0 (i.e. ran past 0xFF within the page).
 *   - Store the new head at 0x60B0, restore HL, ret.
 *
 * HL is PRESERVED (push/pop); the L increments are byte-wide (`inc l`, D's page fixed).
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. A widely-shared utility whose 31 call paths are
 * not all provably mask-cleared, so the charges are kept verbatim; the push/pop that
 * preserve HL are modelled explicitly.
 */
export function sub_309f(m) {
  const { regs, mem } = m;

  m.push16(regs.hl);
  m.step(0x30a0, 11);
  regs.hl = 0x60c0; // ring buffer base (page fixed at 0x60)
  m.step(0x30a3, 10);
  regs.a = mem.read8(0x60b0); // the write head (low byte)
  m.step(0x30a6, 13);
  regs.l = regs.a;
  m.step(0x30a7, 4);

  const free = regs.bit(7, mem.read8(regs.hl));
  m.step(0x30a9, 12); // bit 7,(hl)
  if (!free) {
    m.step(0x30bb, 10); // jp z -- slot occupied, drop the task
    regs.hl = m.pop16();
    m.step(0x30bc, 10);
    m.ret();
    return;
  }
  m.step(0x30ac, 10);

  mem.write8(regs.hl, regs.d);
  m.step(0x30ad, 7);
  regs.l = (regs.l + 1) & 0xff; // inc l
  m.step(0x30ae, 4);
  mem.write8(regs.hl, regs.e);
  m.step(0x30af, 7);
  regs.l = (regs.l + 1) & 0xff;
  m.step(0x30b0, 4);
  regs.a = regs.l;
  m.step(0x30b1, 4);
  regs.cp(0xc0);
  m.step(0x30b3, 7);
  if (regs.fC) {
    m.step(0x30b6, 10); // jp nc not taken -- head ran below 0xC0, wrap it back up
    regs.a = 0xc0;
    m.step(0x30b8, 7);
  } else {
    m.step(0x30b8, 10);
  }
  mem.write8(0x60b0, regs.a); // store the advanced head
  m.step(0x30bb, 13);
  regs.hl = m.pop16();
  m.step(0x30bc, 10);
  m.ret();
}
