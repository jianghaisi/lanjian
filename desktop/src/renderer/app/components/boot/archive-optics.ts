import * as THREE from 'three'

/** Depth-aware lens pass. UI text stays outside the WebGL image and remains sharp. */
export class ArchiveOptics {
  private target = new THREE.WebGLRenderTarget(1,1,{
    type:THREE.HalfFloatType, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
    depthTexture:new THREE.DepthTexture(1,1,THREE.UnsignedIntType), samples:2,
  })
  private camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1)
  private scene = new THREE.Scene()
  private material = new THREE.ShaderMaterial({
    depthTest:false, depthWrite:false,
    uniforms:{
      colour:{value:this.target.texture}, depth:{value:this.target.depthTexture},
      resolution:{value:new THREE.Vector2(1,1)}, near:{value:.1}, far:{value:220},
      focus:{value:30}, radius:{value:14}, range:{value:9},
    },
    vertexShader:`varying vec2 uvLens;
      void main(){uvLens=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      #include <packing>
      varying vec2 uvLens;
      uniform sampler2D colour, depth;
      uniform vec2 resolution;
      uniform float near, far, focus, radius, range;
      void main(){
        float z=-perspectiveDepthToViewZ(texture2D(depth,uvLens).x,near,far);
        float coc=smoothstep(1.6,range,abs(z-focus));
        float periphery=smoothstep(.29,.69,length((uvLens-.5)*vec2(1.,1.15)));
        float blur=radius*max(coc,periphery*.72);
        vec3 sum=texture2D(colour,uvLens).rgb*2.;float total=2.;
        for(int i=0;i<24;i++){
          float n=float(i)+.5;
          float a=n*2.39996323;
          vec2 offset=vec2(cos(a),sin(a))*sqrt(n/24.)*blur/resolution;
          vec2 sampleUv=clamp(uvLens+offset,vec2(.001),vec2(.999));
          float sz=-perspectiveDepthToViewZ(texture2D(depth,sampleUv).x,near,far);
          // Keep sharply focused foreground text from bleeding into distant scenery.
          float weight=mix(1.,.12,step(2.,z-sz)*(1.-coc));
          sum+=texture2D(colour,sampleUv).rgb*weight;total+=weight;
        }
        gl_FragColor=vec4(sum/total,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  private geometry=new THREE.PlaneGeometry(2,2)
  constructor(){this.scene.add(new THREE.Mesh(this.geometry,this.material))}
  async prepare(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera){
    // Match the actual render target's colour space when compiling the scene programs.
    renderer.setRenderTarget(this.target)
    try{await renderer.compileAsync(scene,camera)}finally{renderer.setRenderTarget(null)}
    await renderer.compileAsync(this.scene,this.camera)
  }
  resize(width:number,height:number){this.target.setSize(width,height);this.material.uniforms.resolution!.value.set(width,height)}
  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,focus:number,radius:number,range:number){
    this.material.uniforms.focus!.value=focus
    this.material.uniforms.radius!.value=radius
    this.material.uniforms.range!.value=range
    this.material.uniforms.near!.value=camera.near
    this.material.uniforms.far!.value=camera.far
    renderer.setRenderTarget(this.target);renderer.render(scene,camera)
    renderer.setRenderTarget(null);renderer.render(this.scene,this.camera)
  }
  dispose(){this.target.depthTexture?.dispose();this.target.dispose();this.geometry.dispose();this.material.dispose();this.scene.clear()}
}
