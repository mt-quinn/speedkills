// Physical effects need their own lens depth, just like the hull. Faint/black
// additive fragments must not leave invisible depth silhouettes as they fade.
export function effectDepth(material) {
  material.depthWrite = true;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      if (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) * diffuseColor.a < .015) discard;
    `);
  };
  material.customProgramCacheKey = () => 'physical-effect-depth-v1';
  return material;
}
