// Observer-only flight and sports camera operation. All positions are world metres.
// Fixed simulation steps make late joins, seeking, audit and live playback agree.
import * as THREE from 'three';
const V = () => new THREE.Vector3();
const D = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
export const CAMERA_DEFAULTS = Object.freeze({
  hz: 30, acceleration: 620, speed: 3400, bodyTurn: 110, gimbalTurn: 95,
  gimbalAcceleration: 240, zoomRate: 11, focusRate: 4.8,
  minimumShot: 7, safetyMargin: .78, focusStrength: .72,
  cutScoreMargin: 18, cutAngle: 30, cutScaleRatio: 1.7, cutSustain: .65,
});
export const CAMERA_RIGS = Object.freeze([
  { id: '01', name: 'OVERVIEW', role: 'wide', elevation: 57, fov: 46, near: 31, far: 86, aperture: 0 },
  { id: '02', name: 'RINGSIDE', role: 'pair', elevation: 16, fov: 29, near: 19, far: 72, aperture: .24 },
  { id: '03', name: 'TRACK A', role: 'track', ship: 0, elevation: 25, fov: 37, near: 24, far: 78, aperture: .75 },
  { id: '04', name: 'TRACK B', role: 'track', ship: 1, elevation: 25, fov: 37, near: 24, far: 78, aperture: .75 },
  { id: '05', name: 'HIGH ANGLE', role: 'reserve', elevation: 82, fov: 55, near: 32, far: 105, aperture: 0 },
]);

export function circleOfConfusion(depth, focus, aperture, fov = 35) {
  // Broadcast optics in a kilometre-scale, icon-enhanced world: bounded pixel radius.
  // A broad in-focus zone protects ordinary tracking; foreground racks remain legible.
  const error = Math.abs(1 - focus / Math.max(5, depth));
  return clamp((error - .12) * aperture * (35 / fov) ** 2 * 10, 0, 9);
}

export function shotContrast(a,b,subject,tuning=CAMERA_DEFAULTS) {
  // Compare actual observer locations, not rig names or lens settings. Two drones
  // that drift into the same viewpoint must not masquerade as different angles.
  const av=a.pos.clone().sub(subject),bv=b.pos.clone().sub(subject);
  const angle=av.angleTo(bv)/D;
  const scaleRatio=Math.max(a.sizePx,b.sizePx)/Math.max(1,Math.min(a.sizePx,b.sizePx));
  return{angle,scaleRatio,distinct:angle>=tuning.cutAngle||scaleRatio>=tuning.cutScaleRatio};
}

export class CameraDrones {
  constructor(match, up, viewport = { width: 1600, height: 900 }, tuning = {}, instrument = false) {
    this.match = match; this.up = up.clone(); this.viewport = viewport;
    this.tuning = { ...CAMERA_DEFAULTS, ...tuning }; this.instrument = instrument;
    this.probe = new THREE.PerspectiveCamera(46, viewport.width / viewport.height, 2, 200000);
    this.reset();
  }
  reset() {
    this.tick = -1; this.current = null; this.previous = null; this.active = 0;
    this.since = 0; this.shotPhase = 'approach'; this.lockUntil = 0; this.lastDecision = -1;
    this.pendingCut=null;
    this.cuts = []; this.samples = []; this.decisions = []; this.focusEvents = [];
    this.metrics = { frames: 0, covered: 0, pairFrames: 0, pairCovered: 0, focusError: 0, flightLimited: 0, focusPulls: 0, safetyCuts: 0, roleFrames: CAMERA_RIGS.map(()=>0), maxFocusError: 0, onAirFocusPulls: 0 };
    const a = this.match.ship(0, 0), b = this.match.ship(0, 1);
    this.axis = b.pos.clone().sub(a.pos).normalize();
    this.axis.addScaledVector(this.up, -this.axis.dot(this.up)).normalize();
    this.side = this.axis.clone().cross(this.up).normalize();
    this.lastRailCount = 0;
    this.drones = CAMERA_RIGS.map((rig, i) => ({
      rig, pos: V(), vel: a.vel.clone().add(b.vel).multiplyScalar(.5), acc: V(),
      body: this.side.clone(), quat: new THREE.Quaternion(), fov: rig.fov,
      focus: 3000, focusWanted: 3000, focusKey: 'pair', focusAge: 0, target: V(),
      aimRate: 0, angularVelocity: V(), zoomStableAge: 0, safeAge: 0, ready: false, flightLimit: false, bodyError: 0, aimError: 0,
      sizeScale: 1, aperture: 0, score: 0, reasons: [], purpose: 'establish', required: [],
    }));
  }
  configure(viewport) { this.viewport = viewport; }
  state(t) { return { ships: [this.match.ship(t, 0), this.match.ship(t, 1)] }; }
  context(t, st) {
    const [a, b] = st.ships, mid = a.pos.clone().add(b.pos).multiplyScalar(.5);
    const vel = a.vel.clone().add(b.vel).multiplyScalar(.5);
    const acc = a.acc.clone().add(b.acc).multiplyScalar(.5);
    const separation = a.pos.distanceTo(b.pos);
    const rel = b.vel.clone().sub(a.vel), delta = b.pos.clone().sub(a.pos);
    const closing = -rel.dot(delta) / Math.max(1, separation);
    const torps = this.match.objects(t, 'tp');
    const threats = [];
    for (const tp of torps) {
      if (tp.extra != null) continue;
      const ship = 1 - tp.owner, to = st.ships[ship].pos.clone().sub(tp.pos);
      const speed = tp.vel.clone().sub(st.ships[ship].vel).dot(to.clone().normalize());
      const eta = to.length() / Math.max(1, speed);
      if (speed > 0 && eta < 6 && to.length() < 4200) threats.push({ ...tp, ship, eta, distance: to.length() });
    }
    threats.sort((x, y) => x.eta - y.eta);
    const slugs = this.match.objects(t, 'sl');
    const recentRail = (this.match.byKind?.rail_fire || []).some(e=>e.t<=t && e.t>t-1.2);
    const preparingRail = (this.match.byKind?.rail_fire || []).some(e=>e.t>t && e.t<t+2.2);
    const rail = st.ships.some(s => s.raw.rail[0] > .8);
    const gunPlay = recentRail || preparingRail || st.ships.some(s=>s.raw.alive && s.raw.rail[0]>.60 && s.raw.rail[3]>0);
    const hard = st.ships.reduce((best, s, i) => s.raw.g > st.ships[best].raw.g ? i : best, 0);
    return { mid, vel, acc, separation, closing, threats, rail, hard,
      slugs, gunPlay, merge: separation < 1400 || (closing > 100 && separation / closing < 3.5),
      phase: separation < 1400 ? 'close exchange' : closing < -90 ? 'separating' : closing > 90 ? 'closing' : 'reset', ended: t >= this.match.duration };
  }
  basis() {
    this.side.copy(this.axis).cross(this.up).normalize();
    return this.side;
  }
  assignment(drone, t, st, c) {
    const r = drone.rig, portrait = this.viewport.width / this.viewport.height < 1;
    const side = this.basis().clone();
    const axis = this.axis;
    let target = c.mid.clone().addScaledVector(c.vel, .14);
    let required = [st.ships[0].pos, st.ships[1].pos];
    let focusTarget = c.mid, focusKey = 'pair', purpose = c.merge ? 'crossing' : 'exchange';
    let radius = Math.max(2200, c.separation * (portrait ? 2.0 : 1.75));
    let elevation = r.elevation + (portrait ? 16 : 0), aperture = r.aperture;
    let aimLead = .17;
    if (r.role === 'reserve') { radius = Math.max(6500, c.separation*2.6); aperture=0; purpose='overhead coverage'; }
    if (r.role === 'wide') { radius = Math.max(3500, c.separation * (portrait ? 2.4 : 2.0)); aperture = 0; purpose = c.ended ? 'aftermath' : c.merge ? 'merge coverage' : 'geography'; }
    if (r.role === 'track') {
      const ship = st.ships[r.ship];
      const threat = c.threats.find(x => x.ship === r.ship && `torpedo:${x.id}` === drone.focusKey) || c.threats.find(x => x.ship === r.ship);
      target.copy(ship.pos).addScaledVector(ship.vel, .20);
      focusTarget = ship.pos.clone().addScaledVector(ship.vel, .10); focusKey = `ship:${r.ship}`;
      radius = portrait ? 1750 : 1450;
      required = [ship.pos]; purpose = ship.raw.g >= 7 ? 'hard burn' : 'pursuit';
      // Defense: hold the defender and incoming corridor, initially focused on the ship.
      // Pull to the approaching foreground subject after an acquisition delay. Every
      // incoming torpedo qualifies, regardless of its eventual hit or miss.
      if (threat) {
        target.lerp(threat.pos, .32); required.push(threat.pos); purpose = threat.eta < 4.5 ? 'defense' : 'preparing defense';
        radius = Math.max(radius, threat.distance * .72);
        if (threat.eta < 2.8 && threat.distance > 180) {
          focusTarget = threat.pos.clone().addScaledVector(threat.vel, .10);
          focusKey = `torpedo:${threat.id}`; aperture = .95;
        }
        aimLead = .08;
      }
    }
    if (r.role === 'pair' && c.threats.length) required.push(c.threats[0].pos);
    if (r.role === 'wide') for (const tp of c.threats.slice(0, 2)) required.push(tp.pos);
    // Adjacent vantage points stay on one broadcast hemisphere. Repositioning is real
    // flight; the camera never orbits instantly when the ship axis reverses at a pass.
    const longitudinal = portrait ? (r.role === 'wide' ? 1.3 : 1.05) : r.role === 'track' ? (r.ship === 0 ? -.48 : .48) : r.role === 'pair' ? -.20 : .12;
    const offset = side.multiplyScalar(Math.cos(elevation * D) * (portrait ? .35 : 1))
      .addScaledVector(this.up, Math.sin(elevation * D)).addScaledVector(axis, longitudinal).normalize();
    if (r.role === 'track') {
      const threat = c.threats.find(x => x.ship === r.ship);
      const corridor = (threat?.pos || st.ships[1-r.ship].pos).clone().sub(st.ships[r.ship].pos).normalize();
      // The operator prepares on the forward quarter before a launch, rather than
      // trying to cross the engagement only once the torpedo arrives.
      offset.lerp(corridor.addScaledVector(this.up, .55).addScaledVector(this.side, .45).normalize(), .65).normalize();
    }
    const ahead = this.match.ship(Math.min(this.match.duration, t + (r.role === 'wide' ? 1.5 : .65)), r.ship ?? 0);
    const anticipation = r.role === 'track' ? ahead.pos.clone().sub(st.ships[r.ship].pos) : c.vel.clone().multiplyScalar(.65);
    const positionTarget = target.clone().add(anticipation).addScaledVector(offset, radius);
    return { positionTarget, target, required, focusTarget, focusKey, purpose, aperture, aimLead };
  }
  flight(d, goal, c, dt) {
    const cfg = this.tuning;
    const force = goal.clone().sub(d.pos).multiplyScalar(.65)
      .add(c.vel.clone().sub(d.vel).multiplyScalar(1.5)).add(c.acc);
    const magnitude = Math.min(force.length(), cfg.acceleration);
    if (force.lengthSq() > .01) {
      const direction = force.clone().normalize(), angle = d.body.angleTo(direction);
      const k = angle > 1e-8 ? Math.min(1, cfg.bodyTurn * D * dt / angle) : 1;
      const q = new THREE.Quaternion().setFromUnitVectors(d.body, direction);
      d.body.applyQuaternion(new THREE.Quaternion().slerp(q, k)).normalize();
      d.bodyError = angle / D;
    }
    d.acc.copy(d.body).multiplyScalar(magnitude);
    d.flightLimit = force.length() > cfg.acceleration || d.bodyError > cfg.bodyTurn * dt;
    d.vel.addScaledVector(d.acc, dt).clampLength(0, cfg.speed);
    d.pos.addScaledVector(d.vel, dt);
  }
  optics(d, a, t, dt) {
    const cfg = this.tuning;
    const matrix = new THREE.Matrix4().lookAt(d.pos, a.target, this.up);
    const desired = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const error=desired.clone().multiply(d.quat.clone().invert());
    if(error.w<0){error.x=-error.x;error.y=-error.y;error.z=-error.z;error.w=-error.w;}
    const angle=2*Math.acos(clamp(error.w,-1,1));
    const axis=new THREE.Vector3(error.x,error.y,error.z);
    if(axis.lengthSq()>1e-12)axis.normalize();else axis.set(0,0,0);
    // A vector angular controller limits changes in pan direction as well as
    // speed. Scalar slew limits alone can reverse the camera instantly.
    const torque=axis.multiplyScalar(angle*25).addScaledVector(d.angularVelocity,-10)
      .clampLength(0,cfg.gimbalAcceleration*D);
    d.angularVelocity.addScaledVector(torque,dt).clampLength(0,cfg.gimbalTurn*D);
    d.aimRate=d.angularVelocity.length();
    if(d.aimRate>1e-8)d.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(d.angularVelocity.clone().normalize(),d.aimRate*dt)).normalize();
    d.aimError = d.quat.angleTo(desired) / D;
    d.goal = a.positionTarget.clone(); d.focusPoint = a.focusTarget.clone();
    d.target.copy(a.target); d.required = a.required; d.purpose = a.purpose;
    // Lens chooses an opening composition and then keeps it. Widening to protect an
    // edge is quick; tightening only when off-air avoids constant magnification pumping.
    this.prepareProbe(d);
    let tangent = Math.tan(d.rig.near * D / 2);
    const margin = cfg.safetyMargin;
    const v = this.viewport, stage = v.stage || { left: 0, right: v.width, top: 0, bottom: v.height };
    const sx = Math.max(.15, (stage.right - stage.left) / v.width);
    const sy = Math.max(.15, (stage.bottom - stage.top) / v.height);
    const inverse = d.quat.clone().invert();
    const fitPoints = [...a.required];
    // A sports operator leads the next half-second of movement. Current subjects
    // still remain required: prediction cannot sacrifice the present shot.
    if (d.rig.role !== 'track') for (let i=0;i<2;i++) fitPoints.push(this.match.ship(Math.min(this.match.duration, t + .6), i).pos);
    else fitPoints.push(this.match.ship(Math.min(this.match.duration, t + .5), d.rig.ship).pos);
    for (const p of fitPoints) {
      const local = p.clone().sub(d.pos).applyQuaternion(inverse);
      const z = Math.max(5, -local.z);
      tangent = Math.max(tangent, Math.abs(local.x) / (z * this.probe.aspect * sx * margin), Math.abs(local.y) / (z * sy * margin));
    }
    const fit = clamp(2 * Math.atan(tangent) / D + 3, d.rig.near, d.rig.far);
    const onAir = this.active === this.drones.indexOf(d);
    d.zoomStableAge = fit < d.fov - 12 ? d.zoomStableAge + dt : 0;
    // A sustained loose composition permits one gentle correction, rather than
    // remaining at an emergency wide lens for the rest of the shot.
    const desiredFov = onAir && d.zoomStableAge < 3.5 ? Math.max(d.fov, fit) : fit;
    d.fov += clamp(desiredFov - d.fov, -cfg.zoomRate * .5 * dt, cfg.zoomRate * dt);
    // Lens focus is distance along the optical axis, not slant range. Using
    // Euclidean range leaves an off-centre tracked target systematically soft.
    const wanted = Math.max(8, -a.focusTarget.clone().sub(d.pos).applyQuaternion(d.quat.clone().invert()).z);
    if (d.focusKey !== a.focusKey) {
      if (this.instrument) this.focusEvents.push({ t, rig: d.rig.id, from: d.focusKey, to: a.focusKey, distance: wanted });
      d.focusKey = a.focusKey; d.focusAge = 0; this.metrics.focusPulls++; if(this.active===this.drones.indexOf(d))this.metrics.onAirFocusPulls++;
    }
    d.focusAge += dt; d.focusWanted = wanted;
    // Operator acquisition delay, then fast but finite logarithmic travel. There is
    // no artificial focus loss on a burn; distance motion can outrun the mechanism.
    if (d.focusAge > .16) d.focus *= Math.exp(clamp(Math.log(wanted / d.focus), -cfg.focusRate * dt, cfg.focusRate * dt) * .36);
    d.aperture += ((a.aperture * cfg.focusStrength) - d.aperture) * (1 - Math.exp(-dt * 4));
  }
  prepareProbe(d) {
    const p = this.probe, v = this.viewport;
    p.aspect = v.width / v.height; p.fov = d.fov; p.position.copy(d.pos); p.quaternion.copy(d.quat);
    const s = v.stage || { left: 0, top: 0, right: v.width, bottom: v.height };
    p.setViewOffset(v.width, v.height, v.width / 2 - (s.left + s.right) / 2, v.height / 2 - (s.top + s.bottom) / 2, v.width, v.height);
    p.updateProjectionMatrix(); p.updateMatrixWorld(true);
    return p;
  }
  projection(d, position) {
    const p = position.clone().project(this.probe), v = this.viewport;
    return { x: (p.x + 1) * v.width / 2, y: (1 - p.y) * v.height / 2, z: p.z };
  }
  evaluate(d, st, c) {
    this.prepareProbe(d);
    const v = this.viewport, stage = v.stage || { left: 0, top: 0, right: v.width, bottom: v.height };
    const inset = 26, visible = p => p.z > -1 && p.z < 1 && p.x > stage.left + inset && p.x < stage.right - inset && p.y > stage.top + inset && p.y < stage.bottom - inset;
    const ships = st.ships.map(s => this.projection(d, s.pos));
    const needed = d.required.map(p => this.projection(d, p));
    const all = needed.every(visible), both = ships.every(visible);
    const separationPx = Math.hypot(ships[0].x - ships[1].x, ships[0].y - ships[1].y);
    const reasons = [];
    if (!all) reasons.push('subject outside clear stage');
    if (d.rig.role === 'track' && !both) {
      const other=st.ships[1-d.rig.ship].raw;
      const guns = c.gunPlay;
      const otherThreat=c.threats.some(x=>x.ship!==d.rig.ship);
      if(guns || otherThreat || d.safeAge<1.2) reasons.push('simultaneous action needs both ships');
    }
    if (d.rig.role !== 'track' && separationPx < 25 && c.separation > 600) reasons.push('ships overlap');
    const projected = d.pos.distanceTo(d.target);
    const sizePx = Math.max(v.height * .028, 24 * d.sizeScale / (2 * projected * Math.tan(d.fov * D / 2)) * v.height);
    if (sizePx < 12) reasons.push('subject too small');
    d.ready = reasons.length === 0;
    let score = d.rig.role === 'wide' ? 44 : d.rig.role === 'reserve' ? 39 : d.rig.role === 'pair' ? 52 : 28;
    if (c.merge) score += d.rig.role === 'pair' ? 23 : d.rig.role === 'wide' ? 12 : 0;
    if (c.rail) score += d.rig.role === 'pair' ? 12 : 0;
    if(c.phase==='separating' && !c.merge) score += d.rig.role==='wide'?35:d.rig.role==='pair'?-5:0;
    if(c.phase==='closing' && c.separation>3500) score += d.rig.role==='wide'?20:0;
    if (d.purpose === 'defense') score += 55;
    if (c.threats.some(x=>x.ship===0) && c.threats.some(x=>x.ship===1)) score += d.rig.role === 'pair' ? 28 : d.rig.role === 'track' ? -15 : 12;
    if (d.rig.ship === c.hard && st.ships[c.hard].raw.g >= 7 && !c.merge && !c.rail) score += 37;
    if (c.ended) score += d.rig.role === 'wide' ? 80 : -30;
    score -= d.aimError * 2;
    if (!d.ready) score -= 150;
    d.score = score; d.reasons = reasons; d.both = both; d.separationPx = separationPx; d.sizePx = sizePx;
    return { rig: d.rig.id, score, ready: d.ready, reasons, both, separationPx, sizePx, purpose: d.purpose };
  }
  choose(t, st, c) {
    const candidates = this.drones.map(d => this.evaluate(d, st, c));
    const active = this.drones[this.active], age = t - this.since;
    let chosen = this.active, reason = 'hold shot';
    const best = this.drones.reduce((a, d, i) => d.ready && (!this.drones[a].ready || d.score > this.drones[a].score) ? i : a, 0);
    if (!active.ready && this.drones[best].ready) {
      const reserve=this.drones.findIndex(d=>d.rig.role==='reserve'&&d.ready);
      chosen=reserve>=0&&reserve!==this.active?reserve:best; reason='coverage recovery';
    }
    // A score advantage alone is not an edit. Require a genuinely different view
    // of the present action and a stable, explicit reason to leave good coverage.
    const eligible=[];
    for(let i=0;i<this.drones.length;i++){
      const d=this.drones[i],contrast=shotContrast(active,d,c.mid,this.tuning);
      const gain=d.score-active.score;
      const urgent=d.purpose==='defense'&&active.purpose!=='defense'&&!c.rail&&c.threats.some(x=>x.ship===d.rig.ship&&x.eta>1&&x.eta<3.8);
      const motive=c.ended&&d.rig.role==='wide'?'aftermath':urgent?'incoming threat':
        d.rig.role==='pair'&&c.merge?'close engagement':d.rig.role==='pair'&&c.rail?'rail exchange':
        d.rig.role==='wide'&&c.phase==='separating'?'separation geography':
        d.rig.role==='wide'&&c.phase==='closing'&&c.separation>3500?'approach geography':
        d.rig.role==='track'&&d.rig.ship===c.hard&&st.ships[c.hard].raw.g>=7?'hard burn detail':null;
      const blocked=i===this.active?'on air':!d.ready?'not framed':!contrast.distinct?'similar view':
        gain<this.tuning.cutScoreMargin?'hold quality shot':!motive?'no editorial reason':
        t<this.lockUntil?'action hold':age<(urgent?3.5:this.tuning.minimumShot)?'minimum hold':null;
      d.editReason=blocked||motive;
      candidates[i].editorial={...contrast,gain,reason:d.editReason};
      if(!blocked)eligible.push({i,d,motive,contrast,gain});
    }
    const proposal=eligible.sort((a,b)=>b.gain-a.gain)[0];
    if(proposal){
      if(this.pendingCut?.i!==proposal.i||this.pendingCut.motive!==proposal.motive)this.pendingCut={i:proposal.i,motive:proposal.motive,since:t};
      if(chosen===this.active&&t-this.pendingCut.since>=this.tuning.cutSustain){chosen=proposal.i;reason=proposal.motive;}
    }else this.pendingCut=null;
    if (chosen !== this.active) {
      const incoming = this.drones[chosen];
      const cut = { t, from: active.rig.id, to: incoming.rig.id, reason, previousDuration: age, purpose: incoming.purpose, score: incoming.score,
        contrast:shotContrast(active,incoming,c.mid,this.tuning),scoreGain:incoming.score-active.score,outgoingReady:active.ready,outgoingReasons:[...active.reasons],proposalDuration:reason==='coverage recovery'?0:t-(this.pendingCut?.since??t) };
      this.cuts.push(cut); if (reason === 'coverage recovery') this.metrics.safetyCuts++;
      this.active = chosen; this.since = t; this.shotPhase = c.phase; incoming.zoomStableAge = 0;
      this.pendingCut=null;
      // Stay with the threat through its predicted arrival, hit or miss. An emergency
      // coverage failure still overrides this editorial lock.
      this.lockUntil = incoming.purpose === 'defense' ? t + Math.min(4.5, (c.threats.find(x => x.ship === incoming.rig.ship)?.eta || 1) + .8) : t + 1.2;
    }
    if (this.instrument) this.decisions.push({ t, active: this.drones[this.active].rig.id, reason, lockUntil: this.lockUntil, pendingCut:this.pendingCut?{...this.pendingCut}:null, candidates });
    return candidates;
  }
  snapshot(t) {
    const d = this.drones[this.active];
    return { t, rig: this.active, pos: d.pos.clone(), quat: d.quat.clone(), fov: d.fov, focus: d.focus,
      aperture: d.aperture, sizeScale: d.sizeScale, target: d.target.clone(), purpose: d.purpose,
      focusKey: d.focusKey, aimError: d.aimError, focusError: Math.abs(d.focus - d.focusWanted) / Math.max(1, d.focusWanted), cut: this.cuts.length };
  }
  step(t, dt) {
    const st = this.state(t), c = this.context(t, st);
    // The fleet slowly changes its coverage hemisphere; it does not chase every pass.
    let wantedAxis = st.ships[1].pos.clone().sub(st.ships[0].pos);
    wantedAxis.addScaledVector(this.up, -wantedAxis.dot(this.up));
    if (wantedAxis.lengthSq() > 10000) {
      wantedAxis.normalize(); if (wantedAxis.dot(this.axis) < 0) wantedAxis.negate();
      this.axis.lerp(wantedAxis, 1 - Math.exp(-dt * .10)).normalize();
    }
    for (const d of this.drones) {
      const a = this.assignment(d, t, st, c);
      if (this.tick === 0) {
        d.pos.copy(a.positionTarget); d.target.copy(a.target);
        d.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(d.pos, d.target, this.up));
        d.focus = a.focusTarget.distanceTo(d.pos); d.focusKey = a.focusKey;
        // Fixed scale for each rig: ships retain perspective during a shot. A modest
        // icon enhancement keeps long-distance coverage readable without pumping.
        d.sizeScale = d.rig.role === 'wide' || d.rig.role === 'reserve' ? 13 : d.rig.role === 'pair' ? 9 : 6;
      } else this.flight(d, a.positionTarget, c, dt);
      if(d.rig.role==='track') {
        const unsafe=c.gunPlay||c.threats.some(x=>x.ship!==d.rig.ship);
        d.safeAge=unsafe?0:d.safeAge+dt;
      }
      this.optics(d, a, t, dt);
    }
    this.drones.forEach(d=>this.evaluate(d, st, c));
    if (this.tick % 6 === 0 || this.tick === 0 || !this.drones[this.active].ready) this.choose(t, st, c);
    const d = this.drones[this.active];
    this.metrics.frames++; this.metrics.roleFrames[this.active]++;
    this.metrics.maxFocusError = Math.max(this.metrics.maxFocusError, Math.abs(d.focus-d.focusWanted)/Math.max(1,d.focusWanted)); if (d.ready) this.metrics.covered++;
    if (d.rig.role !== 'track') { this.metrics.pairFrames++; if (d.both) this.metrics.pairCovered++; }
    this.metrics.focusError += Math.abs(d.focus - d.focusWanted) / Math.max(1, d.focusWanted);
    if (d.flightLimit) this.metrics.flightLimited++;
    if (this.instrument && this.tick % 6 === 0) this.samples.push({ t, active: d.rig.id, separation: c.separation, closing: c.closing, drones: this.drones.map(x => ({
      id: x.rig.id, position: x.pos.toArray(), velocity: x.vel.toArray(), acceleration: x.acc.length(), accelerationVector: x.acc.toArray(), body: x.body.toArray(), quaternion: x.quat.toArray(), target: x.target.toArray(), goal: x.goal?.toArray(), focusPoint: x.focusPoint?.toArray(), positionError: x.goal?.distanceTo(x.pos), bodyError: x.bodyError,
      angularVelocity: x.angularVelocity.toArray(), aimError: x.aimError, aimRate: x.aimRate / D, fov: x.fov, focus: x.focus, focusWanted: x.focusWanted,
      focusKey: x.focusKey, aperture: x.aperture, ready: x.ready, limited: x.flightLimit, sizePx: x.sizePx, score: x.score,
    })) });
    return this.snapshot(t);
  }
  at(t) {
    const dt = 1 / this.tuning.hz, wanted = Math.floor((Math.max(0, t) + 1e-8) / dt);
    if (wanted < this.tick - 1) this.reset();
    while (this.tick < wanted + 1) {
      this.tick++; this.previous = this.current; this.current = this.step(this.tick * dt, dt);
    }
    const a = this.previous || this.current, b = this.current;
    const f = clamp((t - a.t) / dt, 0, 1);
    // A cut is a cut, never an interpolated flight between drones.
    if (a.rig !== b.rig) return { ...a, t };
    return { ...a, t, pos: a.pos.clone().lerp(b.pos, f), quat: a.quat.clone().slerp(b.quat, f),
      fov: THREE.MathUtils.lerp(a.fov, b.fov, f), focus: THREE.MathUtils.lerp(a.focus, b.focus, f), aperture: THREE.MathUtils.lerp(a.aperture, b.aperture, f) };
  }
  report() {
    const m = this.metrics, n = Math.max(1, m.frames), duration = Math.max(1, this.current?.t || 1);
    return { coverage: m.covered / n, pairCoverage: m.pairCovered / Math.max(1, m.pairFrames), cuts: this.cuts.length,
      cutsPerMinute: this.cuts.length * 60 / duration, safetyCuts: m.safetyCuts,
      focusPulls: m.focusPulls, onAirFocusPulls: m.onAirFocusPulls, maxFocusError: m.maxFocusError, shotShares: Object.fromEntries(CAMERA_RIGS.map((r,i)=>[r.name,m.roleFrames[i]/n])), meanFocusError: m.focusError / n, limitedShare: m.flightLimited / n,
      roles: Object.fromEntries(CAMERA_RIGS.map((r, i) => [r.name, this.cuts.filter(c => c.to === r.id).length + (i === 0 ? 1 : 0)])) };
  }
  export() { return { version: 'drone-broadcast-v1', rigs: CAMERA_RIGS, match: {seed:this.match.raw?.seed,duration:this.match.duration,ships:this.match.ships?.map(s=>({name:s.name,style:s.style})),parameters:this.match.params}, tuning: this.tuning, viewport: this.viewport, report: this.report(), cuts: this.cuts, decisions: this.decisions, samples: this.samples, focusEvents: this.focusEvents }; }
}
