-- Movement test: coin+start, poke Mario to a mid-board slope position, hold RIGHT.
-- Validates the 0x2AB4 slope-collision translation vs MAME. (offset: emit N == MAME N-1)
local mach=manager.machine
local mem=mach.devices[":maincpu"].spaces["program"]
local IN2=mach.ioport.ports[":IN2"]; local IN0=mach.ioport.ports[":IN0"]
local coin=IN2.fields["Coin 1"]; local start=IN2.fields["1 Player Start"]
local right=IN0.fields["P1 Right"]
assert(coin and start and right,"fields")
local f=0
_G.__mv_sub=emu.add_machine_frame_notifier(function()
  f=f+1
  coin:set_value((f>=399 and f<400) and 1 or 0)
  start:set_value((f>=459 and f<460) and 1 or 0)
  if f>=1600 and f<=1601 then mem:write_u8(0x6203,0x60); mem:write_u8(0x6205,0x90) end
  right:set_value((f>=1600 and f<1740) and 1 or 0)
end)
