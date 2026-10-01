// Two depth-aware lens passes; HUD stays outside the compositor and remains sharp.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader = `
#include <packing>
varying vec2 vUv;
uniform sampler2D tColor, tDepth, tSharp;
uniform vec2 direction;
uniform float cameraNear, cameraFar, focusDistance, aperture, focalScale, pixelRatio, firstPass;
float depthAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth,uv).x,cameraNear,cameraFar); }
float coc(float z) { return clamp((abs(1.-focusDistance/max(5.,z))-.12)*aperture*focalScale*10.,0.,9.)*pixelRatio; }
void main(){
 float z=depthAt(vUv), centerCoc=coc(z), radius=centerCoc;
 // Dilate defocused foreground coverage: a small soft torpedo must spread into
 // neighbouring pixels, rather than simply fading inside a sharp silhouette.
 for(int j=-3;j<=3;j++){
   float offset=float(j)*3.*pixelRatio;
   vec2 q=clamp(vUv+direction*offset,vec2(.001),vec2(.999));
   float sampleZ=depthAt(q), sampleCoc=coc(sampleZ);
   if(sampleZ<z && sampleCoc>abs(offset))radius=max(radius,sampleCoc);
 }
 vec4 center=firstPass>.5?texture2D(tColor,vUv):texture2D(tSharp,vUv);
 if(radius<.25){gl_FragColor=center;return;}
 vec4 sum=center;float total=1.;
 for(int i=-6;i<=6;i++){
   if(i==0)continue;
   float f=float(i)/6.;vec2 uv=clamp(vUv+direction*f*radius,vec2(.001),vec2(.999));
   float sampleZ=depthAt(uv), sampleCoc=coc(sampleZ);
   // A sharply focused foreground edge cannot smear into a defocused background.
   float compatible=1.;
   if(sampleZ<z*.95)compatible=smoothstep(abs(f*radius)-pixelRatio,abs(f*radius)+pixelRatio,sampleCoc);
   else if(sampleZ>z*1.05)compatible=smoothstep(.2,.8,centerCoc);
   float weight=exp(-f*f*2.)*compatible;
   sum+=texture2D(tColor,uv)*weight;total+=weight;
 }
 gl_FragColor=mix(center,sum/total,smoothstep(.25*pixelRatio,pixelRatio,radius));
}`;
export class CameraFocusPass extends Pass {
  constructor(camera) {
    super(); this.camera = camera; this.enabled = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
    this.material = new THREE.ShaderMaterial({ uniforms: {
      tColor: { value: null }, tSharp: { value: null }, firstPass: { value: 1 }, tDepth: { value: null }, direction: { value: new THREE.Vector2() },
      cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
      pixelRatio: { value: 1 }, focusDistance: { value: 1000 }, aperture: { value: 0 }, focalScale: { value: 1 },
    }, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material); this.width = 1; this.height = 1;
  }
  setSize(w, h) { this.width = w; this.height = h; this.target.setSize(Math.max(1,Math.ceil(w/2)), Math.max(1,Math.ceil(h/2))); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.firstPass.value = 1; u.tSharp.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture; u.tColor.value = readBuffer.texture;
    u.pixelRatio.value = renderer.getPixelRatio();
    u.cameraNear.value = this.camera.near; u.cameraFar.value = this.camera.far;
    u.focalScale.value = (35 / this.camera.fov) ** 2;
    u.direction.value.set(1 / this.width, 0);
    renderer.setRenderTarget(this.target); this.quad.render(renderer);
    u.firstPass.value = 0;
    u.tColor.value = this.target.texture; u.direction.value.set(0, 1 / this.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.material.dispose(); this.quad.dispose(); }
}
