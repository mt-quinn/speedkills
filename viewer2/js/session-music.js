// One streaming player owned by the league shell, independent of fight frames.
export class SessionMusic {
  constructor(host) {
    this.host=host;this.visible=false;this.enabled=true;this.starting=null;
    // Versioned URL bypasses the previous track's day-long CDN/browser cache.
    this.media=new window.Audio('/sfx/bgm.opus?v=20261001-477');
    this.media.loop=true;this.media.preload='auto';
    this.media.id='hb-session-music';this.media.hidden=true;
    document.body.append(this.media);
    this.media.addEventListener('error',()=>{
      if(this.fallback)return;this.fallback=true;this.media.src='/sfx/bgm.m4a?v=20261001-477';this.start();
    });
  }
  start() {
    const ctx=this.host.getContext();if(!ctx)return;
    if(!this.source){
      this.source=ctx.createMediaElementSource(this.media);
      this.gate=ctx.createGain();this.gate.gain.value=0;
      this.source.connect(this.gate).connect(ctx.destination);
    }
    this.updateGate();
    if(!this.media.paused||this.starting)return this.starting;
    this.starting=this.media.play().catch(()=>{}).finally(()=>{this.starting=null;});
    return this.starting;
  }
  setVisible(visible){this.visible=visible;this.updateGate();}
  setEnabled(enabled){this.enabled=enabled;this.updateGate();}
  updateGate(){
    const level=this.visible&&this.enabled&&!this.host.muted ? .28 : 0;
    this.media.dataset.level=String(level);
    if(this.gate)this.gate.gain.setTargetAtTime(level,this.host.context.currentTime,.15);
  }
  get playing(){return !this.media.paused&&this.host.context?.state==='running'&&this.visible&&this.enabled&&!this.host.muted;}
}
export function sessionMusic(host){return host.music ||= new SessionMusic(host);}
