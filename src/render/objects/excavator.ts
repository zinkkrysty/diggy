import * as THREE from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BUCKET_PARTS} from '../../simulation/bucket';
import {Excavator} from '../../simulation/excavator';
/** Procedural prototype asset, sized in metres. Every link is driven by machine state. */
export class ExcavatorView {
  readonly root=new THREE.Group();
  private upper=new THREE.Group();private bucket=new THREE.Group();
  private boom:THREE.Mesh;private stick:THREE.Mesh;
  private hydraulics:Array<[THREE.Mesh,THREE.Mesh]>=[];
  private lastTravel:[number,number]=[Infinity,Infinity];
  private treads:THREE.InstancedMesh[]=[];
  private xAxis=new THREE.Vector3(1,0,0);private yAxis=new THREE.Vector3(0,1,0);
  private dummy=new THREE.Object3D();private a=new THREE.Vector3();private b=new THREE.Vector3();private direction=new THREE.Vector3();
  constructor(){
    const paint=new THREE.MeshStandardMaterial({color:0xe9b332,roughness:.62,metalness:.25});
    const dark=new THREE.MeshStandardMaterial({color:0x303b3b,roughness:.8,metalness:.35});
    const steel=new THREE.MeshStandardMaterial({color:0x687374,roughness:.32,metalness:.8});
    const rubber=new THREE.MeshStandardMaterial({color:0x252b2a,roughness:.95});
    const glass=new THREE.MeshStandardMaterial({color:0x466b78,roughness:.16,metalness:.3});
    const box=(parent:THREE.Group,size:number[],position:number[],mat:THREE.Material)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...size as [number,number,number]),mat);m.position.set(...position as [number,number,number]);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    box(this.root,[2.6,.32,1.85],[0,.1,0],dark);
    const turntable=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,.2,24),steel);turntable.position.y=.33;this.root.add(turntable);
    for(const z of [-.92,.92]){
      box(this.root,[3.15,.48,.6],[0,-.2,z],rubber);
      for(const x of [-1.1,-.6,0,.6,1.1]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(x===-1.1||x===1.1?.25:.18,x===-1.1||x===1.1?.25:.18,.62,12),dark);wheel.rotation.x=Math.PI/2;wheel.position.set(x,-.2,z);this.root.add(wheel);}
      const tread=new THREE.InstancedMesh(new THREE.BoxGeometry(.14,.075,.64),dark,52);tread.castShadow=true;tread.receiveShadow=true;tread.userData.z=z;this.root.add(tread);this.treads.push(tread);
    }
    this.root.add(this.upper);
    box(this.upper,[2.7,.55,1.75],[-.15,.62,0],paint);
    box(this.upper,[.55,.75,1.9],[-1.24,.72,0],paint);
    box(this.upper,[1.05,1.5,1.02],[-.48,1.45,-.58],dark);
    box(this.upper,[.9,1.16,.92],[-.45,1.54,-.58],glass);
    box(this.upper,[1.15,.13,1.08],[-.48,2.25,-.58],paint);
    for(const x of [-.98,.02])box(this.upper,[.06,1.5,1.04],[x,1.47,-.58],paint);
    box(this.upper,[1.04,.07,.08],[-.48,1.42,-1.09],dark);
    box(this.upper,[.08,1.5,.08],[-.48,1.47,-1.09],dark);
    box(this.upper,[1.0,.05,.3],[-.48,.7,-1.24],steel);
    box(this.upper,[.62,.07,.3],[-.48,.45,-1.24],steel);
    box(this.upper,[.09,.5,.09],[-.6,1.05,.64],dark);
    for(let i=0;i<8;i++)box(this.upper,[.035,.35,.02],[-1.0+i*.09,.72,.887],dark);
    this.boom=box(this.upper,[1,.34,.42],[0,0,0],paint);this.stick=box(this.upper,[1,.26,.34],[0,0,0],paint);
    for(let i=0;i<3;i++){
      const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,1,12),paint),rod=new THREE.Mesh(new THREE.CylinderGeometry(.038,.038,1,10),steel);barrel.castShadow=true;rod.castShadow=true;this.upper.add(barrel,rod);this.hydraulics.push([barrel,rod]);
    }
    this.upper.add(this.bucket);
    for(const p of BUCKET_PARTS)box(this.bucket,p.half.map(v=>v*2),[...p.center],dark);
    for(const z of [-.44,-.22,0,.22,.44])box(this.bucket,[.23,.09,.09],[.66,-.34,z],steel);
    // Bucket ears and a visible pin sit at the actual hinge.
    for(const z of [-.18,.18])box(this.bucket,[.3,.22,.06],[-.45,.3,z],steel);
    const keep=new Set<THREE.Object3D>([this.boom,this.stick,...this.hydraulics.flat(),...this.treads]);
    for(const group of [this.root,this.upper,this.bucket]){
      const batches=new Map<THREE.Material,THREE.Mesh[]>();
      for(const child of group.children)if(child instanceof THREE.Mesh&&!keep.has(child)){
        const material=child.material as THREE.Material;batches.set(material,[...(batches.get(material)??[]),child]);
      }
      for(const [material,meshes]of batches){
        const geometries=meshes.map(m=>{m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});
        const merged=mergeGeometries(geometries);if(!merged)throw new Error('Excavator mesh batch failed');
        geometries.forEach(g=>g.dispose());meshes.forEach(m=>{group.remove(m);m.geometry.dispose();});group.add(new THREE.Mesh(merged,material));
      }
    }
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  }
  private beam(mesh:THREE.Mesh,from:number[],to:number[],axis:'x'|'y'){
    this.a.set(...from as [number,number,number]);this.b.set(...to as [number,number,number]);this.direction.subVectors(this.b,this.a);const length=this.direction.length();
    mesh.position.copy(this.a).add(this.b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(axis==='x'?this.xAxis:this.yAxis,this.direction.normalize());mesh.scale[axis]=length;
  }
  private cylinder(index:number,from:number[],to:number[]){
    const mid=from.map((v,i)=>v+(to[i]-v)*.58);this.beam(this.hydraulics[index][0],from,mid,'y');this.beam(this.hydraulics[index][1],mid,to,'y');
  }
  update(machine:Excavator,travel:number|readonly[number,number]=0){
    const base=machine.base;this.root.position.set(base.x,base.y,base.z);if(base.rotation)this.root.quaternion.set(base.rotation.x,base.rotation.y,base.rotation.z,base.rotation.w);else this.root.rotation.set(0,base.yaw,0);this.upper.rotation.y=machine.joints[3];
    const {pivot,elbow,tip}=machine.points();this.beam(this.boom,pivot,elbow,'x');this.beam(this.stick,elbow,tip,'x');
    const angle=machine.joints[0]+machine.joints[1]+machine.joints[2];this.bucket.position.set(tip[0]+.45*Math.cos(angle)+.32*Math.sin(angle),tip[1]+.45*Math.sin(angle)-.32*Math.cos(angle),0);this.bucket.rotation.z=angle;
    this.cylinder(0,[.15,.6,.27],pivot.map((v,i)=>i===2?.27:v+(elbow[i]-v)*.6));
    this.cylinder(1,elbow.map((v,i)=>i===2?.25:v+(pivot[i]-v)*.45),elbow.map((v,i)=>i===2?.25:v+(tip[i]-v)*.45));
    this.cylinder(2,tip.map((v,i)=>i===2?.23:v+(elbow[i]-v)*.45),[tip[0]+.15*Math.cos(angle+.6),tip[1]+.15*Math.sin(angle+.6),.23]);
    const distances=typeof travel==='number'?[travel,travel]:travel;
    if(distances.every((v,i)=>Math.abs(v-this.lastTravel[i])<.005))return;this.lastTravel=[distances[0],distances[1]];
    const perimeter=4.4+2*Math.PI*.29;
    for(const [track,mesh]of this.treads.entries()){for(let i=0;i<52;i++){
      const d=((i/52*perimeter-distances[track])%perimeter+perimeter)%perimeter;let x:number,y:number,angle:number;
      if(d<2.2){x=-1.1+d;y=-.49;angle=0;}
      else if(d<2.2+Math.PI*.29){const a=-Math.PI/2+(d-2.2)/.29;x=1.1+.29*Math.cos(a);y=-.2+.29*Math.sin(a);angle=a+Math.PI/2;}
      else if(d<4.4+Math.PI*.29){x=1.1-(d-2.2-Math.PI*.29);y=.09;angle=Math.PI;}
      else{const a=Math.PI/2+(d-4.4-Math.PI*.29)/.29;x=-1.1+.29*Math.cos(a);y=-.2+.29*Math.sin(a);angle=a+Math.PI/2;}
      this.dummy.position.set(x,y,mesh.userData.z);this.dummy.rotation.set(0,0,angle);this.dummy.updateMatrix();mesh.setMatrixAt(i,this.dummy.matrix);
    }mesh.instanceMatrix.needsUpdate=true;}
  }
}
