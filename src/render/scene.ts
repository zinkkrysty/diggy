import * as THREE from 'three/webgpu';
import { storage, instanceIndex, vertexIndex, positionLocal, varying, transformNormalToView, select, color, mix, cameraWorldMatrix, vec4, uv, smoothstep, float } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BUCKET_PARTS, type Pose, type Collider } from '../simulation/bucket';
import { STATE_FLOATS, type Seed } from '../simulation/scenarios';
import {MaterialSurface,type SurfaceStats} from './surface';
import {soilMaterial} from './material';

export class LabScene {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(45,1,0.05,100);
  readonly renderer: THREE.WebGPURenderer;
  readonly controls: OrbitControls;
  private environment=new THREE.Group();
  private surfaceDirty=true;
  private bucket=new THREE.Group();
  private supports=new THREE.Group();
  private particles?: THREE.InstancedMesh;
  private surface?:MaterialSurface;
  private surfaceMesh?:THREE.Mesh;
  private grainMesh?:THREE.InstancedMesh;
  private detachedMesh?:THREE.InstancedMesh;
  private surfaceMap?:THREE.Texture;
  private detachedMap?:THREE.Texture;
  mode:'surface'|'points'='surface';
  detailEnabled=true;
  private proxyCompaction=true;
  constructor(canvas: HTMLCanvasElement,private device: GPUDevice) {
    this.renderer=new THREE.WebGPURenderer({canvas,device,antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.setClearColor(0xdde6de);
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.0;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.camera.position.set(7,5.5,7);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,0.9,0);this.controls.enableDamping=true;
    this.controls.minDistance=2;this.controls.maxDistance=15;this.controls.maxPolarAngle=Math.PI*0.49;
    this.scene.add(new THREE.HemisphereLight(0xf6fff2,0x667864,1.5));
    const sun=new THREE.DirectionalLight(0xffedd0,2.6);sun.position.set(4,7,3);sun.castShadow=true;
    sun.shadow.mapSize.set(768,768);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.camera.near=0.5;sun.shadow.camera.far=15;sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.008;
    this.scene.add(sun);
    const floor=new THREE.Mesh(new THREE.BoxGeometry(6,0.3,4),new THREE.MeshStandardMaterial({color:0x4f665f,roughness:1}));
    floor.receiveShadow=true;floor.position.y=0;this.environment.add(floor);
    const grid=new THREE.GridHelper(6,12,0x7e968b,0x6b8175);grid.scale.z=2/3;grid.position.y=0.153;this.environment.add(grid);
    const shell=new THREE.MeshStandardMaterial({color:0xdcae4d,roughness:0.5,metalness:0.3});
    for(const part of BUCKET_PARTS){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...part.half.map(v=>v*2) as [number,number,number]),shell);mesh.castShadow=true;mesh.receiveShadow=true;mesh.position.set(part.center[0],part.center[1],part.center[2]);this.bucket.add(mesh);}
    // Teeth are visual only; the continuous cutting edge is the collision proxy in this experiment.
    for(const z of [-0.4,-0.2,0,0.2,0.4]){const tooth=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.085,0.08),shell);tooth.castShadow=true;tooth.position.set(0.64,-0.34,z);this.bucket.add(tooth);}
    this.scene.add(this.bucket,this.supports);
    const rim=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6,4,4)),new THREE.LineBasicMaterial({color:0x8da196,transparent:true,opacity:0.2}));rim.position.y=2;this.environment.add(rim);this.scene.add(this.environment);
  }
  setGamePresentation():void {
    this.environment.visible=false;this.bucket.visible=false;
    this.controls.minDistance=3;this.controls.maxDistance=25;this.controls.enablePan=true;
    for(const light of this.scene.children)if(light instanceof THREE.DirectionalLight){light.position.set(-8,14,9);light.shadow.camera.left=-8;light.shadow.camera.right=8;light.shadow.camera.top=8;light.shadow.camera.bottom=-8;light.shadow.camera.far=40;light.shadow.camera.updateProjectionMatrix();}
  }
  async init():Promise<void>{await this.renderer.init();}
  async attachParticles(seed: Seed,buffer: GPUBuffer,state:GPUBuffer,terrain=false):Promise<void> {
    this.removeParticles();this.surfaceDirty=true;
    this.environment.scale.set(terrain?2:1,1,terrain?3:1);
    this.controls.maxDistance=terrain?30:15;
    if(terrain)this.camera.position.set(12,9,13);
    const attribute=new THREE.StorageInstancedBufferAttribute(seed.positions,4);
    attribute.name='Shared GPU soil positions';
    // Isolated Three.js backend bridge. Version is locked; no position readback per frame.
    const backend=this.renderer.backend as unknown as {get(attribute:unknown):{buffer?:GPUBuffer}};
    backend.get(attribute).buffer=buffer;

    const positions=storage(attribute,'vec4',seed.count);
    const colorData=new Float32Array(seed.count*4);
    for(let i=0;i<seed.count;i++) {
      const water=seed.states[i*STATE_FLOATS+28],fine=seed.states[i*STATE_FLOATS+29];
      const color=new THREE.Color(0xc4a574).lerp(new THREE.Color(0x564433),Math.min(0.85,water*0.8+fine*0.3));
      color.multiplyScalar(0.88+0.24*((i*16807%101)/101));colorData.set([color.r,color.g,color.b,1],i*4);
    }
    const colors=storage(new THREE.StorageInstancedBufferAttribute(colorData,4),'vec4',seed.count);
    const material=new THREE.MeshStandardNodeMaterial({roughness:0.92});
    const radius=Math.cbrt(seed.volume/seed.count)*0.52;
    material.positionNode=positionLocal.mul(radius).add(positions.element(instanceIndex).xyz);
    material.colorNode=colors.element(instanceIndex).xyz;
    const mesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),material,seed.count);
    mesh.frustumCulled=false;this.scene.add(mesh);this.particles=mesh;
    this.surface=new MaterialSurface(this.device,seed,buffer,state,terrain);this.surface.useProxyCompaction=this.proxyCompaction;await this.surface.init();
    const pos=new THREE.StorageBufferAttribute(this.surface.vertexCapacity,4);
    const normal=new THREE.StorageBufferAttribute(this.surface.vertexCapacity,4);
    const indirect=new THREE.IndirectStorageBufferAttribute(new Uint32Array(12),4);
    backend.get(pos).buffer=this.surface.vertices;backend.get(normal).buffer=this.surface.normals;backend.get(indirect).buffer=this.surface.indirect;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',pos);geometry.setAttribute('normal',normal);geometry.setIndirect(indirect);
    const positionBuffer=storage(pos,'vec4',this.surface.vertexCapacity);
    const normalBuffer=storage(normal,'vec4',this.surface.vertexCapacity);
    const shade=varying(positionBuffer.element(vertexIndex).w);
    const surfaceStyle=soilMaterial(shade);this.surfaceMap=surfaceStyle.map;
    surfaceStyle.material.positionNode=positionBuffer.element(vertexIndex).xyz;
    surfaceStyle.material.normalNode=transformNormalToView(varying(normalBuffer.element(vertexIndex).xyz));
    this.surfaceMesh=new THREE.Mesh(geometry,surfaceStyle.material);this.surfaceMesh.frustumCulled=false;this.surfaceMesh.castShadow=true;this.surfaceMesh.receiveShadow=true;this.scene.add(this.surfaceMesh);
    const grainAttribute=new THREE.StorageInstancedBufferAttribute(this.surface.grainCount*2,4);
    backend.get(grainAttribute).buffer=this.surface.grains;
    const grainBuffer=storage(grainAttribute,'vec4',this.surface.grainCount*2);
    const grain=grainBuffer.element(instanceIndex.mul(2)),grainVelocity=grainBuffer.element(instanceIndex.mul(2).add(1));
    const detached=grainBuffer.element(instanceIndex.add(this.surface.spillCount).mul(2));
    const detachedShade=grainBuffer.element(instanceIndex.add(this.surface.spillCount).mul(2).add(1)).w;
    const proxyStyle=soilMaterial(varying(detachedShade));
    const detachedMaterial=proxyStyle.material;
    // Same matte shading as bulk material, with exact reference-volume radius.
    detachedMaterial.positionNode=positionLocal.mul(detached.w).add(detached.xyz);
    this.detachedMap=proxyStyle.map;
    this.detachedMesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),detachedMaterial,seed.count);
    this.detachedMesh.geometry.setIndirect(indirect,16);
    this.detachedMesh.frustumCulled=false;this.detachedMesh.castShadow=true;this.detachedMesh.receiveShadow=true;this.scene.add(this.detachedMesh);
    const grainMaterial=new THREE.MeshBasicNodeMaterial({alphaTest:0.1,side:THREE.DoubleSide});
    grainMaterial.positionNode=cameraWorldMatrix.mul(vec4(positionLocal.mul(select(grain.w.greaterThan(0),1,0)),0)).xyz.add(grain.xyz);
    grainMaterial.opacityNode=float(1).sub(smoothstep(0.14,0.25,uv().sub(0.5).length().pow(2)));
    grainMaterial.colorNode=mix(color(0xc2b48f),color(0x5a4635),varying(grainVelocity.w));
    this.grainMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(0.007,0.007).toNonIndexed(),grainMaterial,this.surface.spillCount);
    this.grainMesh.geometry.setIndirect(indirect,32);
    this.grainMesh.frustumCulled=false;this.scene.add(this.grainMesh);this.setMode(this.mode);
  }
  private removeParticles():void {
    if(!this.particles)return;
    this.scene.remove(this.particles);this.particles.geometry.dispose();(this.particles.material as THREE.Material).dispose();this.particles.dispose();
    this.particles=undefined;
    for(const mesh of [this.surfaceMesh,this.grainMesh,this.detachedMesh]){
      if(!mesh)continue;this.scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();
      if(mesh instanceof THREE.InstancedMesh)mesh.dispose();
    }
    this.detachedMap?.dispose();this.detachedMesh=undefined;this.surfaceMap?.dispose();this.surface?.destroy();this.surface=undefined;this.surfaceMesh=undefined;this.grainMesh=undefined;
  }
  setMode(mode:'surface'|'points'):void {
    this.mode=mode;this.surfaceDirty=true;if(this.particles)this.particles.visible=mode==='points';
    if(this.surfaceMesh)this.surfaceMesh.visible=mode==='surface';if(this.grainMesh)this.grainMesh.visible=mode==='surface';if(this.detachedMesh)this.detachedMesh.visible=mode==='surface';
  }
  setProxyCompaction(enabled:boolean):void{this.proxyCompaction=enabled;if(this.surface)this.surface.useProxyCompaction=enabled;this.surfaceDirty=true;}
  setDetail(enabled:boolean):void{this.detailEnabled=enabled;this.surfaceDirty=true;this.setMode(this.mode);}
  updateMaterial(boxes:Collider[],dt:number):void {if(this.mode==='surface'&&(dt>0||this.surfaceDirty)){this.surface?.update(boxes,dt,this.detailEnabled);this.surfaceDirty=false;}}
  surfaceDiagnostics():Promise<SurfaceStats|null>{return this.mode==='surface'&&this.surface?this.surface.diagnostics():Promise.resolve(null);}
  get visualBufferBytes():number{return this.surface?.estimatedBytes??0;}
  setBucket(pose:Pose):void {this.bucket.position.set(pose.x,pose.y,pose.z);this.bucket.rotation.z=pose.angle;}
  setSupports(colliders:Collider[]):void {
    this.surfaceDirty=true;
    while(this.supports.children.length){const child=this.supports.children[0] as THREE.Mesh;this.supports.remove(child);child.geometry.dispose();(child.material as THREE.Material).dispose();}
    for(const box of colliders.filter(b=>!b.bucket)) {const mesh=new THREE.Mesh(new THREE.BoxGeometry(...box.half.map(v=>v*2) as [number,number,number]),new THREE.MeshStandardMaterial({color:0x859d95,roughness:0.85}));mesh.position.set(...box.center);this.supports.add(mesh);}
  }
  resize():void{const canvas=this.renderer.domElement;const width=canvas.clientWidth,height=canvas.clientHeight;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  render():void {this.controls.update();this.renderer.render(this.scene,this.camera);}
}
