import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// A docked rendering of the standard delta ship. Static until the viewer moves the camera.
export class HangarScene {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.className='dock-canvas';
    this.canvas.setAttribute('role','img'); this.canvas.setAttribute('aria-label','Your ship berth in the league hangar');
    this.renderer = new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#101b20');this.scene.fog=new THREE.Fog('#101b20',55,110);
    this.camera=new THREE.PerspectiveCamera(38,1,.1,160);this.camera.position.set(31,25,37);
    this.controls=new OrbitControls(this.camera,this.canvas);this.controls.target.set(0,-.8,0);
    this.controls.enablePan=false;this.controls.enableZoom=false;this.controls.minPolarAngle=.55;this.controls.maxPolarAngle=1.25;
    this.controls.minAzimuthAngle=.25;this.controls.maxAzimuthAngle=1.3;
    this.controls.addEventListener('change',()=>this.draw());
    this.scene.add(new THREE.HemisphereLight('#bed0d7','#182222',2.2));
    const key=new THREE.DirectionalLight('#e9dbc0',3.8);key.position.set(-18,30,18);this.scene.add(key);
    const rim=new THREE.DirectionalLight('#9fc5d5',2.8);rim.position.set(20,12,-28);this.scene.add(rim);
    this.materials={steel:this.mat('#34434a',.65,.7),dark:this.mat('#182830',.68,.6),hull:this.mat('#8a969a',.62,.62),plate:this.mat('#bbc1bc',.54,.64),bronze:this.mat('#9e8257',.6,.7),black:this.mat('#0b161d',.3,.8),stripe:this.mat('#d6ab5f',.1,.7)};
    this.lamp = new THREE.MeshBasicMaterial({color:'#d6e2ce'});this.amber = new THREE.MeshBasicMaterial({color:'#deb671'});
    this.dock();this.vessel=this.ship();this.scene.add(this.vessel);
    this.observer=new ResizeObserver(()=>this.resize());this.occupied=false;
  }
  mat(color,metalness,roughness) { return new THREE.MeshStandardMaterial({color,metalness,roughness}); }
  mesh(geo,mat,x=0,y=0,z=0,parent=this.scene) { const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m; }
  box(w,h,d,mat,x=0,y=0,z=0,parent=this.scene) { return this.mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent); }
  cylinder(r1,r2,h,mat,x,y,z,parent=this.scene) { return this.mesh(new THREE.CylinderGeometry(r1,r2,h,16),mat,x,y,z,parent); }
  dock() {
    const m=this.materials;
    this.box(92,1,92,m.dark,0,-6,0);
    // Recessed maintenance platform and its docking clamps.
    this.box(26,.5,34,m.steel,0,-5.4,0);this.box(23,.06,31,m.dark,0,-5.1,0);
    for(const x of [-14,14]) {
      this.box(.22,.07,35,m.stripe,x,-5.46,0);
      for(const z of [-12,10]) { this.box(3,2.8,4,m.steel,x,-3.9,z);this.box(4,.8,1.7,m.bronze,x*.88,-2.4,z);this.box(2.2,.12,.2,this.lamp,x,-2.4,z+2.02); }
    }
    const grid=new THREE.GridHelper(90,30,'#45535a','#283a42');grid.position.y=-5.48;this.scene.add(grid);
    for(let z=-27;z<=30;z+=4) { this.box(.55,.025,1.6,m.stripe,-21,-5.46,z);this.box(.55,.025,1.6,m.stripe,21,-5.46,z); }
    // Structural ribs, gantries and light strips frame the berth rather than a decorative portal.
    for(const z of [-32,-18]) {
      for(const x of [-27,27]) { this.box(2.3,27,2.3,m.steel,x,7.5,z);this.box(3,.8,3,m.bronze,x,-2.5,z);this.box(.12,15,.2,this.lamp,x+(x<0?1.17:-1.17),7,z); }
      this.box(56,1.9,2.5,m.steel,0,21,z);this.box(35,.1,.25,this.lamp,0,19.99,z);
      for(const x of [-22,-12,0,12,22])this.box(.3,4,.3,m.dark,x,18,z);
    }
    this.box(70,34,1.5,m.dark,0,10,-39);
    for(const x of [-24,-12,0,12,24]) {this.box(10,21,.25,m.steel,x,4,-38);this.box(8.7,19,.3,m.dark,x,4,-37.7);}
    this.box(18,11,.4,m.black,0,5,-37.5);this.box(.15,9,.1,this.amber,-8,5,-37.2);this.box(.15,9,.1,this.amber,8,5,-37.2);
    for(const x of [-32,32]) for(let z=-20;z<25;z+=7){this.box(3,3,4,m.steel,x,-4,z);this.box(2.8,.2,3.8,m.bronze,x,-2.4,z);}
    // Contact shadow is baked into a flat texture: no expensive dynamic shadow passes.
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(64,64,8,64,64,64);g.addColorStop(0,'rgba(0,0,0,.7)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
    this.shadowTexture=new THREE.CanvasTexture(c);const shadow=new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false});
    this.shadow=this.mesh(new THREE.PlaneGeometry(31,34),shadow,0,-5.05,0);this.shadow.rotation.x=-Math.PI/2;
  }
  ship() {
    const group=new THREE.Group(),m=this.materials;
    // Six vertices preserve the broadcast dart's nose, wing tips, ridge and keel.
    const vertices=[[0,0,15],[-8,0,-10],[8,0,-10],[0,0,-5],[0,3.6,-5],[0,-1.5,-5]];
    const faces=[[0,1,4],[0,4,2],[1,3,4],[4,3,2],[0,5,1],[0,2,5],[1,5,3],[5,2,3]];
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(f=>f.flatMap(i=>vertices[i])),3));geo.computeVertexNormals();this.mesh(geo,m.hull,0,0,0,group);
    // Armour panels follow the actual sloping deck, with small seams between them.
    for(const side of [-1,1]) {
      for(let row=0;row<5;row++) {
        const z=-8+row*3.6,w=5.5-row*.9;
        const plate=this.box(w,.19,3.25,row%2?m.hull:m.plate,side*(w*.51+.25),1.1+(4-row)*.39,z,group);plate.rotation.z=-side*.22;plate.rotation.x=.1;
      }
      this.box(1.2,.25,8,m.bronze,side*3.8,1.65,-4,group).rotation.z=-side*.22;
      const drive=this.cylinder(1.4,1.65,5.5,m.steel,side*3.8,-.2,-9,group);drive.rotation.x=Math.PI/2;
      const bell=this.cylinder(1.65,1.05,2,m.black,side*3.8,-.2,-12.3,group);bell.rotation.x=Math.PI/2;
      const inner=this.cylinder(.95,.95,.2,m.bronze,side*3.8,-.2,-13.35,group);inner.rotation.x=Math.PI/2;
      const launcher=this.box(1.4,.8,5.8,m.dark,side*5.4,.7,-6.6,group);launcher.rotation.z=-side*.18;
      for(let k=0;k<4;k++)this.box(.9,.2,.8,m.plate,side*5.4,1.25,-8.5+k*1.2,group);
      const turret=this.cylinder(.7,.9,.8,m.steel,side*6.4,.7,-8.3,group);
      this.box(.2,.2,1.8,m.black,side*6.4,1.2,-7.5,group);
    }
    this.box(1.6,.7,14,m.dark,0,2.6,-1.2,group);this.box(.6,.25,14,m.bronze,0,3.03,-1.2,group);
    this.box(.32,.32,7,m.plate,0,2.6,9,group);this.box(.7,.65,1,m.black,0,2.6,12.5,group);
    const reactor=this.cylinder(1.1,1.1,.5,m.dark,0,3.9,-5.7,group);for(let k=0;k<8;k++){const a=k*Math.PI/4;this.box(.2,.18,.7,m.bronze,Math.sin(a)*.9,4.15,-5.7+Math.cos(a)*.9,group).rotation.y=a;}
    this.box(1.3,.55,2.5,m.black,0,1.15,7.5,group);this.box(.85,.12,1.2,this.lamp,0,1.45,7.5,group);
    this.cylinder(.65,.9,.8,m.steel,0,4.1,-9,group);this.box(.2,.2,1.8,m.black,0,4.5,-8.2,group);
    const hullEdges=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:'#ccd0c2',transparent:true,opacity:.3}));group.add(hullEdges);
    group.rotation.y=-.12;group.position.y=-.5;return group;
  }
  mount(element,occupied) { this.occupied=occupied;this.vessel.visible=occupied;this.shadow.visible=occupied;this.observer.disconnect();element.append(this.canvas);this.observer.observe(element);this.resize(); }
  resize() { const r=this.canvas.parentElement?.getBoundingClientRect();if(!r?.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.position.set(r.width/r.height<1.2?32:31,25,r.width/r.height<1.2?44:37);this.camera.updateProjectionMatrix();this.controls.update();this.draw(); }
  draw() { if(this.canvas.isConnected)this.renderer.render(this.scene,this.camera); }
  dispose() { this.observer.disconnect();this.controls.dispose();const geometries=new Set(),materials=new Set();this.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.shadowTexture.dispose();this.renderer.dispose(); }
}
