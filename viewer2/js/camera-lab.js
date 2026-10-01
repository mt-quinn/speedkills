// Opt-in production-room instrumentation: ?studio=1&cameraLab=1. No backend writes.
import { CameraDrones, CAMERA_DEFAULTS, CAMERA_RIGS, circleOfConfusion } from './camera-drones.js';
const round = n => Number.isFinite(n) ? n.toFixed(1) : '—';
export class CameraLab {
  constructor(app) {
    this.app = app; this.last = -99; this.renderSamples=[];
    this.el = document.createElement('aside'); this.el.className = 'camera-lab';
    this.el.innerHTML = `<header><b>CAMERA CONTROL</b><button data-do="collapse">−</button></header>
      <div class="cl-body"><canvas width="720" height="360" aria-label="Drone positions and shot timeline"></canvas>
      <div class="cl-readout"></div><div class="cl-candidates"></div>
      <div class="cl-actions"><button data-do="record">Record full fight</button><button data-do="play">Play / pause</button><button data-do="export">Export trace</button><button data-do="audit">Full fight audit</button><button data-do="previous">Previous cut</button><button data-do="next">Next cut</button></div>
      <label>Match time <input type="number" min="0" step="0.1" data-control="time" value="0"><button data-do="seek">Go</button></label><label>Monitor <select data-control="rig"><option value="">DIRECTOR</option>${CAMERA_RIGS.map((r,i)=>`<option value="${i}">${r.id} ${r.name}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-control="focus" checked> Depth of field</label>
      <details><summary>Operator tuning</summary>${[
        ['acceleration',100,1200,20,'Drone acceleration · m/s²'],['bodyTurn',30,240,5,'Body turn · °/s'],
        ['gimbalTurn',20,180,5,'Camera pan · °/s'],['gimbalAcceleration',40,480,10,'Pan acceleration · °/s²'],
        ['zoomRate',2,25,1,'Zoom · °/s'],['focusRate',1,12,.2,'Focus tracking'],
        ['minimumShot',3.5,15,.5,'Minimum shot · s'],['cutScoreMargin',10,40,1,'Cut quality gain'],
        ['cutAngle',15,60,1,'Minimum angle change · °'],['cutScaleRatio',1.3,2.5,.1,'Minimum scale change'],
        ['cutSustain',.2,1.5,.05,'Stable cut proposal · s'],
        ['focusStrength',0,1,.05,'Depth of field strength'],
      ].map(([key,min,max,step,label])=>`<label>${label}<output>${CAMERA_DEFAULTS[key]}</output><input type="range" data-tune="${key}" min="${min}" max="${max}" step="${step}" value="${window.__cameraTuning?.[key]??CAMERA_DEFAULTS[key]}"></label>`).join('')}</details>
      <a class="cl-recording" hidden>Download recording</a><pre class="cl-audit"></pre></div>`;
    document.body.append(this.el); this.canvas = this.el.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.click = e => {
      const action = e.target.dataset.do;
      if (action === 'record') this.record();
      if (action === 'seek') this.app.seek(+this.el.querySelector('[data-control=time]').value);
      if (action === 'play') window.__act('play');
      if (action === 'collapse') this.el.classList.toggle('collapsed');
      if (action === 'export') this.download();
      if (action === 'audit') this.audit();
      if (action === 'next' || action === 'previous') {
        const engine = this.fullEngine || this.engine, t = this.app.t;
        const cut = action === 'next' ? engine.cuts.find(c=>c.t>t+.1) : engine.cuts.filter(c=>c.t<t-.1).at(-1);
        if (cut) this.app.seek(cut.t);
      }
    };
    this.change = e => {
      if (e.target.dataset.tune) {
        window.__cameraTuning ||= {}; window.__cameraTuning[e.target.dataset.tune] = +e.target.value;
        e.target.parentElement.querySelector('output').textContent = e.target.value;
        this.fullEngine = null; this.app.seek(this.app.t);
      }
      if (e.target.dataset.control === 'time') this.app.seek(+e.target.value);
      if (e.target.dataset.control === 'rig') window.__cameraMonitor = e.target.value === '' ? null : +e.target.value;
      if (e.target.dataset.control === 'focus') window.__cameraFocusOff = !e.target.checked;
    };
    this.el.addEventListener('pointerup',e=>e.stopPropagation());
    this.el.addEventListener('keydown',e=>e.stopPropagation());
    this.el.addEventListener('click',this.click); this.el.addEventListener('change',this.change);
    this.canvas.addEventListener('click',e=>{const r=this.canvas.getBoundingClientRect();if((e.clientY-r.top)/r.height>.86)this.app.seek((e.clientX-r.left)/r.width*this.app.m.duration);});
    window.__cameraLab = this;
  }
  get engine() { return this.app.dir.engine; }
  update(t, force=false) {
    if (!force && Math.abs(t-this.last)<.15) return; this.last=t;
    const timeInput=this.el.querySelector('[data-control=time]');
    if(document.activeElement!==timeInput)timeInput.value=t.toFixed(1);
    const engine=this.engine, shot=this.app.scene.shot, d=engine.drones[shot?.rig??0], report=engine.report();
    this.el.querySelector('.cl-readout').textContent = `${round(t)}s · CAM ${d.rig.id} ${d.purpose}\n${round(d.vel.length())} m/s · ${round(d.acc.length()/9.81)} g ${d.flightLimit?'LIMIT':''}\nBody error ${round(d.bodyError)}° · pan ${round(d.aimRate*180/Math.PI)}°/s · aim error ${round(d.aimError)}°\nLens ${round(d.fov)}° · focus ${Math.round(d.focus)} → ${Math.round(d.focusWanted)}m · ${d.focusKey}\nFocus error ${round(Math.abs(d.focus-d.focusWanted)/d.focusWanted*100)}% · blur ${round(circleOfConfusion(d.focusWanted,d.focus,d.aperture,d.fov))}px\nCoverage ${round(report.coverage*100)}% · ${report.cuts} cuts (${round(report.cutsPerMinute)}/min) · ${report.safetyCuts} recoveries\nRender ${round(this.app.scene.renderStats?.fps)} fps · ${round(this.app.scene.renderStats?.cpuMs)}ms CPU · ${this.app.scene.renderStats?.calls??0} draw calls`;
    this.el.querySelector('.cl-candidates').textContent=engine.drones.map(x=>`${x.rig.id} ${x===d?'ON AIR':'      '} ${Math.round(x.score)} · ${x.ready?x.editReason||'READY':x.reasons.join(', ')}`).join('\n');
    const st=engine.state(t), cam=this.app.scene.camera;
    this.renderSamples.push({t,rig:shot?.id,viewport:engine.viewport,render:{...this.app.scene.renderStats},position:cam.position.clone().add(this.app.scene.mid).toArray(),quaternion:cam.quaternion.toArray(),fov:cam.fov,focus:shot?.focus,aperture:shot?.aperture,
      tags:this.app.hud.tagRects?.map(r=>({...r})),layout:this.app.hud.layoutTelemetry,subjects:st.ships.map((s,i)=>{
        const p=s.pos.clone().sub(this.app.scene.mid).project(cam);
        return{ship:i,x:(p.x+1)*engine.viewport.width/2,y:(1-p.y)*engine.viewport.height/2,z:p.z,scale:this.app.scene.ships[i].scale.x};
      })});
    if(this.renderSamples.length>12000)this.renderSamples.shift();
    this.draw(t,engine);
    if(this.recorder?.state==='recording' && t>=this.app.m.duration+1) this.recorder.stop();
  }
  draw(t,engine) {
    const ctx=this.ctx,W=720,H=360; ctx.fillStyle='#0a1019';ctx.fillRect(0,0,W,H);
    const st=engine.state(t),mid=st.ships[0].pos.clone().add(st.ships[1].pos).multiplyScalar(.5);
    const axis=engine.axis,side=engine.side;
    let radius=1500;for(const d of engine.drones)radius=Math.max(radius,d.pos.distanceTo(mid)*1.15);
    const xy=p=>{const delta=p.clone().sub(mid);return[W/2+delta.dot(axis)/radius*310,125+delta.dot(side)/radius*95];};
    ctx.strokeStyle='#263345';ctx.lineWidth=1;
    for(const r of [.33,.66,1]){ctx.beginPath();ctx.ellipse(W/2,125,310*r,95*r,0,0,Math.PI*2);ctx.stroke();}
    ctx.font='16px monospace';ctx.fillStyle='#7890a8';ctx.fillText(`PLAN VIEW · ${Math.round(radius)}m`,12,23);
    st.ships.forEach((s,i)=>{const [x,y]=xy(s.pos);ctx.fillStyle=i?'#4f8dff':'#f5a623';ctx.beginPath();ctx.arc(x,y,6,0,7);ctx.fill();ctx.fillText(i?'B':'A',x+10,y+4);});
    engine.drones.forEach((d,i)=>{const [x,y]=xy(d.pos),[tx,ty]=xy(d.target);ctx.strokeStyle=i===engine.active?'#e4f0de':'#355069';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();ctx.fillStyle=i===engine.active?'#e4f0de':'#7d9ab5';ctx.fillRect(x-4,y-4,8,8);ctx.fillText(d.rig.id,x+8,y-8);});
    const live=engine.drones[this.app.scene.shot?.rig??engine.active];
    const objects=[...st.ships.map((s,i)=>({pos:s.pos,label:i?'B':'A',color:i?'#4f8dff':'#f5a623'})),...engine.match.objects(t,'tp').slice(0,8).map(p=>({pos:p.pos,label:'T',color:'#ff3b5c'}))];
    const inv=live.quat.clone().invert();objects.forEach(o=>o.depth=-o.pos.clone().sub(live.pos).applyQuaternion(inv).z);
    const maxDepth=Math.max(2000,live.focus*1.7,...objects.filter(o=>o.depth>0).map(o=>o.depth));
    ctx.fillStyle='#1d2938';ctx.fillRect(12,257,W-24,23);
    const depthX=z=>12+Math.max(0,Math.min(1,z/maxDepth))*(W-24);
    ctx.fillStyle='#b8c9d8';ctx.fillRect(depthX(live.focus)-1,250,2,37);
    ctx.font='13px monospace';for(const o of objects)if(o.depth>0){ctx.fillStyle=o.color;ctx.fillRect(depthX(o.depth)-2,259,4,12);ctx.fillText(o.label,depthX(o.depth)+3,271);}
    ctx.fillStyle='#9aaec6';ctx.fillText(`FOCUS ${Math.round(live.focus)}m · depth → ${Math.round(maxDepth)}m`,12,245);
    const cuts=this.fullEngine?.cuts||engine.cuts,colors=['#526b8c','#b88b45','#578fb9','#6b9b75','#9c7ca5'];
    const sequence=[{t:0,to:'01'},...cuts];
    sequence.forEach((c,i)=>{const end=sequence[i+1]?.t??this.app.m.duration;ctx.fillStyle=colors[+c.to-1];ctx.fillRect(c.t/this.app.m.duration*W,316,(end-c.t)/this.app.m.duration*W,22);});
    ctx.fillStyle='#fafafa';ctx.fillRect(t/this.app.m.duration*W,306,2,38);ctx.fillStyle='#a5b8cd';ctx.fillText('SHOT TIMELINE · click to seek',12,298);
  }
  audit() {
    const start=performance.now(); const engine=new CameraDrones(this.app.m,this.app.scene.up,this.app.dir.viewport(),window.__cameraTuning,true);
    engine.at(this.app.m.duration);this.fullEngine=engine;
    const report=engine.report(); this.el.querySelector('.cl-audit').textContent=JSON.stringify({...report,auditMs:Math.round(performance.now()-start)},null,2);
    this.update(this.app.t,true);return engine.export();
  }
  record() {
    if(this.recorder?.state==='recording'){this.recorder.stop();return;}
    if(typeof MediaRecorder==='undefined' || !this.app.scene.renderer.domElement.captureStream){this.el.querySelector('.cl-audit').textContent='Recording is unavailable in this browser.';return;}
    if(this.recordingURL)URL.revokeObjectURL(this.recordingURL);
    this.recordingURL=null;this.el.querySelector('.cl-recording').hidden=true;
    this.renderSamples=[];this.fullEngine=null;
    const canvas=this.app.scene.renderer.domElement,stream=canvas.captureStream(30);
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime){this.el.querySelector('.cl-audit').textContent='Recording is unavailable in this browser.';stream.getTracks().forEach(t=>t.stop());return;}
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000}),chunks=[];this.recorder=recorder;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const a=this.el.querySelector('.cl-recording');this.recordingURL=URL.createObjectURL(new Blob(chunks,{type:mime}));
      a.href=this.recordingURL;a.download=`camera-review-${this.app.m.raw.seed??'fight'}.webm`;a.hidden=false;
      this.el.querySelector('[data-do=record]').textContent='Record full fight';
      recorder.ondataavailable=null;recorder.onstop=null;this.recorder=null;
    };
    this.app.startCameraRecording();recorder.start();this.el.querySelector('[data-do=record]').textContent='Stop recording';
  }
  download() {
    const data={...(this.fullEngine||this.engine).export(),renderSamples:this.renderSamples}; const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`camera-${this.app.m.raw.seed??'fight'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  dispose() { if(this.recorder?.state==='recording'){this.recorder.onstop=null;this.recorder.stream.getTracks().forEach(t=>t.stop());this.recorder.stop();} if(this.recordingURL)URL.revokeObjectURL(this.recordingURL);this.el.remove();if(window.__cameraLab===this)delete window.__cameraLab; }
}
