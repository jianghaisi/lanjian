import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { archiveWave, archiveLift, structureSeparation, ease, progress, type ScreenRect } from './cinematic-timeline'
import { ArchiveOptics } from './archive-optics'
import { dossierTexture } from './dossier-material'
import { createArchiveCells, updateArchiveMatrices, DOSSIER_WIDTH as W, DOSSIER_HEIGHT as H } from './archive-instance-layout'
import type { ProjectSummary } from '../../../../contracts/index'

/** Original machined dossier; dense instanced field and one detailed assembly. */
export class ArchiveScene {
  readonly renderer:THREE.WebGLRenderer
  private optics=new ArchiveOptics()
  private scene=new THREE.Scene()
  private camera=new THREE.PerspectiveCamera(36,1,.1,220)
  private selected=new THREE.Group()
  private field=new THREE.Group()
  private cover=new THREE.Group()
  private core=new THREE.Group()
  private back=new THREE.Group()
  private instances:THREE.InstancedMesh[]=[]
  private cells=createArchiveCells()
  private instanceBuffers:THREE.TypedArray[]=[]
  private geometries=new Set<THREE.BufferGeometry>()
  private materials=new Set<THREE.Material>()
  private environment:THREE.WebGLRenderTarget
  private observer:ResizeObserver
  private width=1;private height=1;private disposed=false;private invalidated=true
  private fieldSettled=false
  private lastPaper='';private lastTime=-1;private lastWaveTime=-1;private lastDark:boolean|undefined;private slowFrames=0;private qualityReduced=false
  private project:ProjectSummary|undefined
  private texture:THREE.CanvasTexture|undefined
  private plate:THREE.MeshStandardMaterial
  private metal:THREE.MeshStandardMaterial
  private inset:THREE.MeshStandardMaterial
  private luminous:THREE.MeshStandardMaterial
  private face:THREE.MeshBasicMaterial
  private glass:THREE.MeshPhysicalMaterial
  private floorMaterial:THREE.MeshStandardMaterial
  private scan:THREE.Mesh
  private key=new THREE.DirectionalLight(0xfff9ee,3)
  private rim=new THREE.DirectionalLight(0xc5fff0,2)
  private fog=new THREE.FogExp2(0xe5e5dc,.021)

  private constructor(private canvas:HTMLCanvasElement,private onFailure:()=>void) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'})
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.87
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(this.renderer)
    this.environment=pmrem.fromScene(room,.035);pmrem.dispose();room.dispose()
    this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.65;this.scene.fog=this.fog
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x515c55,.7))
    this.key.position.set(-12,18,14);this.rim.position.set(10,10,-6);this.scene.add(this.key,this.rim)
    this.key.castShadow=true;this.key.shadow.mapSize.set(2048,2048)
    Object.assign(this.key.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:95})
    this.key.shadow.bias=-.0002;this.key.shadow.normalBias=.015
    this.plate=this.material(new THREE.MeshStandardMaterial({metalness:.45,roughness:.33}))
    this.metal=this.material(new THREE.MeshStandardMaterial({metalness:.9,roughness:.22}))
    this.inset=this.material(new THREE.MeshStandardMaterial({metalness:.35,roughness:.38}))
    this.luminous=this.material(new THREE.MeshStandardMaterial({color:0x91c3a9,emissive:0x66bb99,emissiveIntensity:.3,metalness:.65,roughness:.22}))
    this.face=this.material(new THREE.MeshBasicMaterial({toneMapped:false,transparent:true}))
    this.glass=this.material(new THREE.MeshPhysicalMaterial({color:0xe3eee7,roughness:.14,metalness:.05,transparent:true,opacity:.12,clearcoat:1,depthWrite:false}))
    this.floorMaterial=this.material(new THREE.MeshStandardMaterial({color:0xe1e1d9,roughness:.72,metalness:.12}))
    const floor=new THREE.Mesh(this.geometry(new THREE.PlaneGeometry(500,500)),this.floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.16;floor.receiveShadow=true;this.field.add(floor)
    this.scene.add(this.field,this.selected);this.selected.add(this.back,this.core,this.cover)
    this.buildArray()
    this.scan=new THREE.Mesh(this.geometry(new THREE.PlaneGeometry(55,.075)),this.material(new THREE.MeshBasicMaterial({color:0xd1f4e6,transparent:true,opacity:.55,depthWrite:false})))
    this.scan.rotation.set(-Math.PI/2,0,Math.atan2(.83,.56));this.scan.position.y=3.8;this.field.add(this.scan)
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas)
    canvas.addEventListener('webglcontextlost',this.contextLost);this.resize()
  }
  static async create(canvas:HTMLCanvasElement,onFailure:()=>void){
    const result=new ArchiveScene(canvas,onFailure)
    try {
      const model=await new GLTFLoader().loadAsync(new URL('boot/lanjian-dossier.glb',document.baseURI).href)
      result.prepareModel(model.scene)
      return result
    } catch(error){result.dispose();throw error}
  }
  private prepareModel(model:THREE.Group){
    const layers=['DossierBack','DossierCore','DossierCover'].map(name=>model.getObjectByName(name))
    if(layers.some(layer=>!layer))throw new Error('Dossier assembly is incomplete')
    this.selected.clear();this.selected.add(model)
    this.back=layers[0] as THREE.Group;this.core=layers[1] as THREE.Group;this.cover=layers[2] as THREE.Group
    const mapping:Record<string,THREE.Material>={Chassis:this.plate,BrushedMetal:this.metal,Inset:this.inset,Signal:this.luminous,ArchiveFace:this.face,OpticalGlass:this.glass}
    model.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return
      object.castShadow=true;object.receiveShadow=true
      this.geometries.add(object.geometry)
      const old=Array.isArray(object.material)?object.material:[object.material]
      old.forEach(m=>this.materials.add(m))
      object.material=old.map(m=>mapping[m.name]??m)
      if(old.some(m=>m.name==='OpticalGlass'||m.name==='ArchiveFace')){object.castShadow=false;object.receiveShadow=false}
      if(object.material.length===1)object.material=object.material[0]!
    })
  }
  setProject(project:ProjectSummary|undefined){if(this.project===project)return;this.project=project;this.lastDark=undefined;this.invalidated=true}
  async prepare(dark:boolean){
    this.palette(dark)
    // Compile during the prelude, before the first visible array frame needs these programs.
    await this.optics.prepare(this.renderer,this.scene,this.camera)
    // Allocate shadow maps, instance buffers and textures while the canvas is still covered.
    if(!this.disposed)this.render(12,dark)
  }
  private geometry<T extends THREE.BufferGeometry>(g:T):T{this.geometries.add(g);return g}
  private material<T extends THREE.Material>(m:T):T{this.materials.add(m);return m}
  private slab(w:number,h:number,depth:number){
    const s=new THREE.Shape(),x=w/2,y=h/2,b=.17
    s.moveTo(-x,-y);s.lineTo(x-b,-y);s.lineTo(x,-y+b);s.lineTo(x,y-b);s.lineTo(x-b,y);s.lineTo(-x,y);s.closePath()
    const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.025,bevelThickness:.018});g.translate(0,0,-depth/2);return this.geometry(g)
  }
  private buildArray(){
    // Only the central lanes are in focus; guard geometry covers the entire oblique frustum.
    const parts=[
      [this.slab(W,H,.22),this.plate],
      [this.geometry(new THREE.BoxGeometry(W-.17,.04,.17)),this.metal],
      [this.geometry(new THREE.BoxGeometry(.025,H-.24,.015)),this.luminous],
      [this.geometry(new THREE.CylinderGeometry(.07,.07,.018,10).rotateX(Math.PI/2)),this.metal]
    ] as const
    for(const [g,m] of parts){const mesh=new THREE.InstancedMesh(g,m,this.cells.length);mesh.castShadow=m===this.plate;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.instances.push(mesh);this.instanceBuffers.push(mesh.instanceMatrix.array);this.field.add(mesh)}
  }
  private contextLost=(e:Event)=>{e.preventDefault();this.onFailure()}
  private resize(){if(this.disposed)return;const b=this.canvas.getBoundingClientRect();this.width=Math.max(1,b.width);this.height=Math.max(1,b.height);this.renderer.setSize(this.width,this.height,false);this.optics.resize(Math.round(this.width*this.renderer.getPixelRatio()),Math.round(this.height*this.renderer.getPixelRatio()));this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();this.invalidated=true}
  invalidatePalette(){this.lastPaper='';this.invalidated=true}
  private palette(dark:boolean){
    if(this.lastDark===dark&&this.lastPaper)return
    const paper=getComputedStyle(this.canvas).getPropertyValue('--cinema-paper').trim()||(dark?'#202522':'#f3f0e8')
    if(this.lastDark===dark&&this.lastPaper===paper)return
    this.lastPaper=paper
    this.lastDark=dark;this.texture?.dispose();this.texture=dossierTexture(this.project);this.face.map=this.texture;this.face.needsUpdate=true
    this.plate.color.set(dark?0x1d302a:0xe6e7dc);this.metal.color.set(dark?0x536961:0xb8c4ba);this.inset.color.set(dark?0x111b16:0xb5bdb0)
    this.luminous.color.set(dark?0x8fd3bc:0xc4b37f);this.luminous.emissive.set(dark?0x3b9978:0x9c8150);this.luminous.emissiveIntensity=dark?.65:.12
    this.floorMaterial.color.set(paper);this.fog.color.set(paper)
    this.renderer.setClearColor(this.fog.color,1);this.scene.environmentIntensity=dark?.6:.65;this.key.intensity=dark?2.3:2.4;this.rim.intensity=dark?4:1.6
  }
  render(time:number,dark:boolean,waveTime=time){
    if(this.disposed||(!this.invalidated&&time===this.lastTime&&waveTime===this.lastWaveTime&&dark===this.lastDark))return
    const start=performance.now();this.lastTime=time;this.lastWaveTime=waveTime;this.invalidated=false;this.palette(dark)
    const lift=archiveLift(time),turn=ease(progress(time,30.5,32.5)),split=structureSeparation(time)
    const selectedScale=.85+.15*ease(progress(time,21.5,25))
    this.selected.scale.setScalar(selectedScale)
    this.selected.position.set(0,H*selectedScale/2+lift+archiveWave(0,0,waveTime)*.85*(1-ease(progress(time,20,21))),0)
    this.selected.rotation.set(0,-.1*Math.sin(Math.PI*progress(time,20,30.5))*(1-turn),0)
    this.cover.position.z=1.1*split;this.back.position.z=-.9*split
    this.core.rotation.z=.012*Math.sin(split*Math.PI);this.core.position.y=.12*split
    this.glass.opacity=.045+.07*split
    this.face.opacity=1-progress(time,32.7,32.9)
    this.selected.visible=time<32.95
    // The field is stationary during the material study; do not upload 17k matrices per frame.
    if(time<25||!this.fieldSettled){
    updateArchiveMatrices(this.cells,this.instanceBuffers,time,waveTime)
    this.instances.forEach(m=>m.instanceMatrix.needsUpdate=true)
    this.fieldSettled=time>=25
    }
    const scanAxis=-25+progress(waveTime,12.8,19.6)*50
    this.scan.position.set(scanAxis*.83,3.8,scanAxis*.56)
    ;(this.scan.material as THREE.MeshBasicMaterial).opacity=.4*ease(progress(waveTime,12.8,13.4))*(1-ease(progress(waveTime,19.2,20)))
    this.scan.visible=waveTime>=12.8&&waveTime<20
    const fieldMove=ease(progress(time,12,20))
    const position=new THREE.Vector3(-14+fieldMove*1.5,16-fieldMove*.6,20-fieldMove*.8),aim=new THREE.Vector3(0,1.3,-1)
    const extraction=ease(progress(time,20,25));position.lerp(new THREE.Vector3(6,9.3,13),extraction);aim.lerp(new THREE.Vector3(0,7,0),extraction)
    if(time>=25){
      const macro=ease(progress(time,25,26.8));position.lerp(new THREE.Vector3(4.6,8.8,6.2),macro);aim.lerp(new THREE.Vector3(1.8,7.6,.05),macro)
      const exploded=ease(progress(time,26.8,28.5));position.lerp(new THREE.Vector3(-6.7,10.2,10),exploded);aim.lerp(new THREE.Vector3(0,7,0),exploded)
      const half=Math.tan(THREE.MathUtils.degToRad(18)),z=Math.max(H/(.44*2*half),W/(.67*this.camera.aspect*2*half))
      position.lerp(new THREE.Vector3(0,7,z),turn);aim.lerp(new THREE.Vector3(0,7,0),turn)
    }
    this.camera.position.copy(position);this.camera.lookAt(aim);this.camera.updateMatrixWorld()
    this.field.position.y=-10*ease(progress(time,30.5,32.8))
    this.field.visible=time<32.85;this.fog.density=.027
    const materialSweep=ease(progress(time,25,30.5))
    this.rim.position.set(10-14*materialSweep,10,-6+8*materialSweep)
    const focusPoint=new THREE.Vector3(0,1.8,0).lerp(this.selected.position,extraction)
    const edgeFocus=ease(progress(time,25,26.8))*(1-ease(progress(time,26.8,28.5)))
    focusPoint.lerp(new THREE.Vector3(1.8,7.6,.15),edgeFocus)
    const focus=focusPoint.sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3()))
    const lensRadius=(14-6*extraction)*(1-ease(progress(time,30.7,32.3)))*this.renderer.getPixelRatio()
    this.optics.render(this.renderer,this.scene,this.camera,focus,lensRadius,extraction> .9?4.5:11)
    this.slowFrames=performance.now()-start>26?this.slowFrames+1:Math.max(0,this.slowFrames-1)
    if(this.slowFrames>35&&!this.qualityReduced){this.qualityReduced=true;this.renderer.setPixelRatio(1);this.resize()}
  }
  faceRect():ScreenRect{
    this.cover.updateWorldMatrix(true,false)
    const points=[[-W/2,H/2],[W/2,H/2],[W/2,-H/2],[-W/2,-H/2]].map(([x,y])=>new THREE.Vector3(x,y,.13).applyMatrix4(this.cover.matrixWorld).project(this.camera))
    const xs=points.map(p=>(p.x+1)*this.width/2),ys=points.map(p=>(1-p.y)*this.height/2)
    return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.texture?.dispose();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.instances.forEach(m=>m.dispose());this.key.shadow.dispose();this.optics.dispose();this.environment.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.scene.clear()}
}
