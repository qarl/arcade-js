# SPDX-License-Identifier: GPL-3.0-only
import subprocess, os, sys, numpy as np
S=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(S)
WORK=os.path.join(ROOT,"out","movework"); os.makedirs(WORK,exist_ok=True); GW=172032
BPTR={2:0x74,3:0x76,4:0x78}
FIELD={0x01:"P1 Right",0x02:"P1 Left",0x04:"P1 Up",0x08:"P1 Down",0x10:"P1 Button 1"}
# (name, board, mario_x, mario_y, input_bits, hold_frames)
TESTS=[
 ("b1_walk_right",1,0x60,0x90,0x01,140),
 ("b1_walk_left", 1,0xa0,0x90,0x02,140),
 ("b1_climb_up",  1,0x60,0x90,0x04,140),
 ("b1_jump",      1,0x60,0xd0,0x10,140),
 ("b3_walk_right",3,0x60,0x90,0x01,140),
 ("b4_walk_right",4,0x60,0x90,0x01,140),
]
def lua(name,b,x,y,bits,hold):
    bp=""
    if b>1:
        p=BPTR[b]
        bp=f"  if f>=464 and f<=1463 then mem:write_u8(0x604A,0x{p:02x});mem:write_u8(0x604B,0x3A);mem:write_u8(0x6049,0x0{b});mem:write_u8(0x622A,0x{p:02x});mem:write_u8(0x622B,0x3A);mem:write_u8(0x6227,0x0{b});mem:write_u8(0x6229,0x0{b}) end\n"
    fld=FIELD[bits]
    t=f'''local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local inp=I0.fields["{fld}"]
assert(coin and start and inp,"fields")
local f=0
_G.__ts=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
{bp} if f>=1600 and f<=1601 then mem:write_u8(0x6203,0x{x:02x});mem:write_u8(0x6205,0x{y:02x}) end
 inp:set_value((f>=1600 and f<{1600+hold}) and 1 or 0)
end)'''
    path=f"{WORK}/test_{name}.lua"; open(path,"w").write(t); return path
def emit_cmd(out,b,x,y,bits,hold):
    c=["node","tools/emit.js","--frames-out",out,"--frames","1820",
       "--input","0x7d00=0x80@400:once","--input","0x7d00=0x04@460:once",
       "--input",f"0x7c00=0x{bits:02x}@1601:hold{hold}",
       "--poke",f"0x6203=0x{x:02x}@1601:hold2","--poke",f"0x6205=0x{y:02x}@1601:hold2"]
    if b>1:
        p=BPTR[b]
        for a,v in [(0x6049,b),(0x604a,p),(0x604b,0x3a),(0x622a,p),(0x622b,0x3a),(0x6227,b),(0x6229,b)]:
            c+=["--poke",f"0x{a:04x}=0x{v:02x}@465:hold1000"]
    return c
def diff(js,gd):
    jp=open(js,"rb");gp=open(gd,"rb");off=1
    N=min(os.path.getsize(js)//GW,os.path.getsize(gd)//GW-off)
    def fr(fp,i): fp.seek(i*GW);return np.frombuffer(fp.read(GW),dtype=np.uint8).reshape(-1,3)
    d=np.array([int(np.any(fr(jp,i)!=fr(gp,i+off),axis=1).sum()) for i in range(N)])
    mv=d[1600:]; return mv.max()*100/57344, int((mv>2867).sum()), N
print(f"{'test':16} {'emit':10} {'max%':>6} {'>5%':>4} {'verdict'}")
for name,b,x,y,bits,hold in TESTS:
    lp=lua(name,b,x,y,bits,hold)
    go=f"{WORK}/g_{name}"; eo=f"{WORK}/e_{name}"
    r=subprocess.run(["python3",f"{S}/mame_golden.py","--out",go,"--seconds","30","--tape",lp],capture_output=True,text=True,timeout=150)
    er=subprocess.run(emit_cmd(eo,b,x,y,bits,hold),cwd=ROOT,capture_output=True,text=True)
    stopped = "GAP" if "not impl" in (er.stdout+er.stderr).lower() else "ran"
    if stopped=="ran" and os.path.exists(f"{eo}/frames.rgb") and os.path.exists(f"{go}/frames.rgb"):
        mx,over,N=diff(f"{eo}/frames.rgb",f"{go}/frames.rgb")
        verdict="PASS" if (over==0 and mx<5) else "FAIL"
        print(f"{name:16} {'ran':10} {mx:6.2f} {over:4d} {verdict}")
    else:
        print(f"{name:16} {stopped:10} {'--':>6} {'--':>4} {'GAP-FOUND' if stopped=='GAP' else 'NO-FRAMES'}")
