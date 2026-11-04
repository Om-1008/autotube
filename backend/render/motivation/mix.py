# Apna Motivation soundtrack: voice lines + tanpura-style drone + soft drum pulse (ducked), lip-sync envelope.
# Usage: python3 mix.py plan.json out_dir   (plan: {total, lines:[{file,start}], chimes:[t]})
# voice placement + tanpura-style drone + soft drum pulse, ducked under speech; writes mix.wav + env.json
import json, sys, numpy as np, soundfile as sf
SR=48000; FPS=30
def add(buf,x,s):
    if s<0 or s>=len(buf): return
    e=min(len(buf),s+len(x)); buf[s:e]+=x[:e-s]
plan=json.load(open(sys.argv[1])); out=sys.argv[2]
total=plan['total']; n=int(total*SR)+SR
def load(p):
    a,sr=sf.read(p,dtype='float32')
    if a.ndim>1: a=a.mean(1)
    if sr!=SR: a=np.interp(np.linspace(0,len(a)-1,int(len(a)*SR/sr)),np.arange(len(a)),a).astype(np.float32)
    return a/(np.abs(a).max()+1e-6)*0.85
voice=np.zeros(n,np.float32); env=[0.0]*(int(total*FPS)+2)
for l in plan['lines']:
    a=load(l['file']); add(voice,a,int(l['start']*SR))
    hop=SR//FPS
    for f in range(len(a)//hop):
        gi=int(round(l['start']*FPS))+f
        if gi<len(env): env[gi]=round(min(1.0,float(np.sqrt(np.mean(a[f*hop:(f+1)*hop]**2)))*5),3)
t=np.arange(n)/SR
def pl(freq,dur,amp,dec=1.5,h=6):
    m=int(dur*SR); tt=np.arange(m)/SR
    w=sum(np.sin(2*np.pi*freq*k*tt+0.3*k)/(k**1.2) for k in range(1,h+1))
    return (w*np.exp(-tt*dec)*amp*np.clip(tt*30,0,1)).astype(np.float32)
mus=np.zeros(n,np.float32)
# tanpura cycle: Pa Sa' Sa' Sa (G3 C4 C4 C3), every 1.1s
seq=[196.0,261.63,261.63,130.81]
for i in range(int(total/1.1)+2):
    add(mus,pl(seq[i%4],3.5,0.09,1.0),int(i*1.1*SR))
# soft low pad
mus+=(np.sin(2*np.pi*65.4*t)*0.05+np.sin(2*np.pi*98*t)*0.025).astype(np.float32)*(0.6+0.4*np.sin(2*np.pi*t/9))
# gentle drum pulse (dha) every 2.2s, building
for i in range(int(total/0.55)+1):
    if i%4 in (0,3):
        s=int(i*0.55*SR); m=int(0.4*SR); tt=np.arange(m)/SR
        add(mus,(np.sin(2*np.pi*(90-60*tt)*tt)*np.exp(-tt*9)*0.22).astype(np.float32),s)
for c in plan.get('chimes',[]):
    add(mus,sum(pl(f,1.6,0.08,3,3) for f in [1046.5,1568.0]),int(c*SR))
fade=np.clip(t/1.5,0,1)*np.clip((total-t)/2.0,0,1)
sp=np.convolve(np.abs(voice),np.ones(2400)/2400,mode='same')
mix=voice+mus*fade.astype(np.float32)*(1-0.6*np.clip(sp*12,0,1)).astype(np.float32)
mix=mix[:int(total*SR)]; mix/=max(1.0,np.abs(mix).max()/0.95)
sf.write(out+'/mix.wav',mix,SR); json.dump(env,open(out+'/env.json','w'))
