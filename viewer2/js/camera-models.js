import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Observer hardware, deliberately neutral and smaller than combat silhouettes.
// Local -Z is the lens axis, matching the drone's optical quaternion.
export class CameraModels {
  constructor(root) {
    this.root = root;
    const parts = [];
    const box = (x,y,z,px,py,pz) => {
      const g = new THREE.BoxGeometry(x,y,z).toNonIndexed();
      g.translate(px,py,pz); parts.push(g);
    };
    box(1.9,1.25,2.2,0,0,0);
    box(1.1,.18,1.3,0,.95,.15);
    box(.16,.4,.18,-.47,.73,.65); box(.16,.4,.18,.47,.73,.65);
    box(2.5,.2,.65,0,-.85,.2);
    const barrel = new THREE.CylinderGeometry(.52,.65,.85,8).toNonIndexed();
    barrel.rotateX(Math.PI/2); barrel.translate(0,0,-1.45); parts.push(barrel);
    this.body = mergeGeometries(parts); parts.forEach(g=>g.dispose());
    this.lens = new THREE.CircleGeometry(.43,12); this.lens.rotateY(Math.PI); this.lens.translate(0,0,-1.89);
    this.bodyMaterial = new THREE.MeshStandardMaterial({color:0x81929c,roughness:.65,metalness:.35,fog:false,transparent:true,depthWrite:false});
    this.lensMaterial = new THREE.MeshBasicMaterial({color:0x8ca7b0,transparent:true,opacity:.65,depthWrite:false});
    this.guideMaterial = new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,
      uniforms:{color:{value:new THREE.Color(0x80959f)},highlight:{value:0},opacity:{value:1}},
      vertexShader:`attribute float along; varying float vAlong;
        void main(){vAlong=along;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform vec3 color; uniform float highlight; uniform float opacity; varying float vAlong;
        void main(){if(fract(vAlong*11.)>.48)discard;
          float fade=pow(1.-vAlong,2.5);gl_FragColor=vec4(mix(color,vec3(.75,.93,1.),highlight),(.32+.4*highlight)*fade*opacity);}`,
    });
    this.models=[]; this.projected=new THREE.Vector3();
    this.cameraPoint=new THREE.Vector3();this.shipPoint=new THREE.Vector3();
    this.guideStart=new THREE.Vector3();this.guideEnd=new THREE.Vector3();
  }
  make() {
    const group=new THREE.Group();
    const bodyMaterial=this.bodyMaterial.clone(),lensMaterial=this.lensMaterial.clone();
    group.add(new THREE.Mesh(this.body,bodyMaterial),new THREE.Mesh(this.lens,lensMaterial));
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(24),3));
    geometry.setAttribute('along',new THREE.BufferAttribute(new Float32Array([0,1,0,1,0,1,0,1]),1));
    const guideMaterial=this.guideMaterial.clone();
    const guide=new THREE.LineSegments(geometry,guideMaterial);
    // Bounds are updated with lens zoom; no expensive per-frame bounding sphere.
    guide.frustumCulled=false; group.add(guide); this.root.add(group);
    return {group,geometry,bodyMaterial,lensMaterial,guideMaterial};
  }
  update(engine,viewer,worldCamera,height,onAirRig=null,ships=[]) {
    if(!engine)return;
    const aspect=engine.viewport.width/Math.max(1,engine.viewport.height);
    for(let i=0;i<engine.drones.length;i++) {
      const d=engine.drones[i],m=this.models[i]??(this.models[i]=this.make());
      const distance=d.pos.distanceTo(worldCamera);
      const worldHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(viewer.fov/2));
      // About 18 CSS px tall, bounded near the lens; ships occupy 3–11% of height.
      const scale=Math.max(1,worldHeight*Math.min(.028,18/height)/2.1);
      const length=24, y=Math.tan(THREE.MathUtils.degToRad(d.fov/2))*length, x=y*aspect;
      // Cull the entire assembly, including the long POV rays. A centre-only
      // body check lets guides (or enlarged hardware) cross the near plane.
      const exclusion=Math.max(50,scale*Math.hypot(x,y,1.9+length)+viewer.near*2);
      // Hysteresis prevents a drone skimming this boundary from flickering.
      m.nearCamera=distance<=exclusion*(m.nearCamera?1.2:1);
      // Playback interpolates optics between simulation ticks. The rig that
      // supplied this shot must stay hidden even when its simulated pose differs.
      m.group.visible=i!==onAirRig&&!m.nearCamera;
      m.group.position.copy(d.pos); m.group.quaternion.copy(d.quat); m.group.scale.setScalar(scale);
      // The sustained editorial proposal is the incoming-camera cue. Do not
      // predict damage/outcomes or stall emergency coverage recoveries for it.
      const pending=engine.pendingCut;
      this.projected.copy(d.pos).add(this.root.position).project(viewer);
      const opacity=this.shipClearance(d,scale,x,y,length,viewer,ships);
      m.bodyMaterial.opacity=opacity;m.lensMaterial.opacity=.65*opacity;
      m.guideMaterial.uniforms.opacity.value=opacity;
      m.group.visible=m.group.visible&&opacity>0;
      const inView=m.group.visible&&Math.abs(this.projected.x)<.98&&Math.abs(this.projected.y)<.98&&Math.abs(this.projected.z)<1;
      const highlight=inView&&pending?.i===i?THREE.MathUtils.smoothstep(engine.current.t-pending.since,0,.25):0;
      m.bodyMaterial.emissive.setRGB(.035+.25*highlight,.045+.5*highlight,.05+.6*highlight);
      m.lensMaterial.color.setRGB(.55+.2*highlight,.65+.28*highlight,.69+.31*highlight);
      m.guideMaterial.uniforms.highlight.value=highlight;
      const p=m.geometry.attributes.position.array;
      for(let k=0;k<4;k++) {
        const at=k*6; p[at]=0;p[at+1]=0;p[at+2]=-1.9;
        p[at+3]=(k%2?1:-1)*x;p[at+4]=(k<2?1:-1)*y;p[at+5]=-1.9-length;
      }
      m.geometry.attributes.position.needsUpdate=true;
    }
  }
  // Work in optical coordinates so floating origins, zoom and manual orbit
  // all protect the actual ship silhouette, rather than a world-distance guess.
  shipClearance(drone,scale,x,y,length,viewer,ships) {
    const cameraPoint=(out,p)=>out.copy(p).add(this.root.position).applyMatrix4(viewer.matrixWorldInverse);
    const body=cameraPoint(this.cameraPoint,drone.pos),depth=-body.z;
    if(depth<=viewer.near)return 1;
    let opacity=1;
    for(const ship of ships) {
      const target=cameraPoint(this.shipPoint,ship.position),shipDepth=-target.z;
      if(shipDepth<=viewer.near)continue;
      // Enclose the rendered hull, not the much smaller simulation hull.
      const radius=16*ship.scale.x;
      const protectedRadius=radius/Math.max(viewer.near,shipDepth-radius);
      const sx=target.x/shipDepth,sy=target.y/shipDepth;
      const fade=(px,py,pz,extra=0)=>{
        if(pz<=viewer.near||pz>=shipDepth)return;
        const gap=Math.hypot(px-sx,py-sy)-protectedRadius-extra;
        // Fully absent before overlap; a generous spatial shoulder fades the
        // whole assembly smoothly as it approaches either ship's sightline.
        opacity=Math.min(opacity,THREE.MathUtils.smoothstep(gap,0,Math.max(.012,protectedRadius*.75)));
      };
      fade(body.x/depth,body.y/depth,depth,3*scale/Math.max(viewer.near,depth-3*scale));
      const start=this.guideStart.set(0,0,-1.9).multiplyScalar(scale).applyQuaternion(drone.quat).add(drone.pos);
      cameraPoint(start,start);
      for(let k=0;k<4;k++) {
        const end=this.guideEnd.set((k%2?1:-1)*x,(k<2?1:-1)*y,-1.9-length)
          .multiplyScalar(scale).applyQuaternion(drone.quat).add(drone.pos);
        cameraPoint(end,end);
        const az=-start.z,bz=-end.z;
        if(az<=viewer.near||bz<=viewer.near)continue; // proximity culling handles near-plane guides
        const ax=start.x/az,ay=start.y/az,bx=end.x/bz,by=end.y/bz;
        const dx=bx-ax,dy=by-ay;
        const f=THREE.MathUtils.clamp(((sx-ax)*dx+(sy-ay)*dy)/Math.max(1e-12,dx*dx+dy*dy),0,1);
        fade(ax+f*dx,ay+f*dy,1/((1-f)/az+f/bz),.003);
      }
    }
    return opacity;
  }
  dispose() {
    // Per-model clones and shared geometries are disposed by Scene's traversal.
    this.bodyMaterial.dispose();this.lensMaterial.dispose();this.guideMaterial.dispose();
  }
}
