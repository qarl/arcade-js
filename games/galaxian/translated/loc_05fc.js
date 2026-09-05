// SPDX-License-Identifier: GPL-3.0-only

// loc_05fc  (ROM 0x05fc-0x0604) — sound-cue prologue: fires one command (D:E=0x0503) via loc_08f2, then
// jumps into loc_05e2 to fire the rest of the burst. Entered by jr c from loc_05a5.
export function loc_05fc(m) {
  const { regs } = m;

  regs.de = 0x0503;
  m.step(0x05ff, 10);

  m.push16(0x0602);
  m.step(0x08f2, 17); // call 0x08f2 -- sound command (D:E)
  m.call(0x08f2);

  m.step(0x05e2, 10); // jp 0x05e2 -- fire the remaining cues
  return m.call(0x05e2);
}
