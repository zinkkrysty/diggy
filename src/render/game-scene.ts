import * as THREE from 'three/webgpu';
import {LabScene} from './scene';
import {ExcavatorView} from './objects/excavator';
import {chaseCameraFrame} from '../simulation/chase-camera';
import type {MachineBase,Excavator} from '../simulation/excavator';
export class GameScene extends LabScene {
  readonly machine=new ExcavatorView();
  private following=true;
  private chaseDistance=9.8;
  private base:MachineBase={x:-3.7,y:1,z:0,yaw:0};
  private wantedPosition=new THREE.Vector3();private wantedTarget=new THREE.Vector3();
  get follow(){return this.following;}
  set follow(value:boolean){this.following=value;this.controls.enableRotate=!value;this.controls.enablePan=!value;this.controls.enableZoom=!value;}

  constructor(canvas:HTMLCanvasElement,device:GPUDevice){
    super(canvas,device);this.setGamePresentation();this.scene.add(this.machine.root);this.follow=true;
    canvas.addEventListener('wheel',event=>{
      if(!this.follow)return;event.preventDefault();this.chaseDistance=Math.max(4,Math.min(18,this.chaseDistance*Math.exp(event.deltaY*.001)));
    },{passive:false});
    this.scene.background=new THREE.Color(0xcadce0);this.scene.fog=new THREE.Fog(0xcadce0,25,90);
    const meadow=new THREE.Shape();meadow.moveTo(-70,-70);meadow.lineTo(70,-70);meadow.lineTo(70,70);meadow.lineTo(-70,70);meadow.closePath();
    const hole=new THREE.Path();hole.moveTo(-6,-6);hole.lineTo(-6,6);hole.lineTo(6,6);hole.lineTo(6,-6);hole.closePath();meadow.holes.push(hole);
    const grass=new THREE.Mesh(new THREE.ShapeGeometry(meadow),new THREE.MeshStandardMaterial({color:0x7c8864,roughness:1,side:THREE.DoubleSide}));grass.rotation.x=-Math.PI/2;grass.position.y=.53;grass.receiveShadow=true;this.scene.add(grass);
    const bed=new THREE.Mesh(new THREE.BoxGeometry(12,.3,12),new THREE.MeshStandardMaterial({color:0x6e6552,roughness:1}));bed.receiveShadow=true;this.scene.add(bed);
    const treeMat=new THREE.MeshStandardMaterial({color:0x596b4d,roughness:1}),trunkMat=new THREE.MeshStandardMaterial({color:0x6b6150,roughness:1});
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.23,2.2,6),trunkMat,28);
    const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),treeMat,28),dummy=new THREE.Object3D();
    for(let i=0;i<28;i++){
      const a=i*2.399,r=19+(i%6)*2.5,x=Math.cos(a)*r,z=Math.sin(a)*r;
      dummy.position.set(x,1.6,z);dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      const size=1.8+(i%3)*.2;dummy.position.set(x,3.5,z);dummy.scale.set(size,size*1.2,size);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);
    }
    this.scene.add(trunks,crowns);
    // Small site markers bound the actual editable ground, without a laboratory cage.
    const white=new THREE.MeshStandardMaterial({color:0xd8d4bc,roughness:.9});
    for(const x of [-6.3,6.3])for(const z of [-6.3,6.3]){const post=new THREE.Mesh(new THREE.BoxGeometry(.09,.65,.09),white);post.position.set(x,.85,z);post.castShadow=true;this.scene.add(post);}
  }
  home(){
    if(!this.follow)return;
    this.chaseDistance=9.8;const frame=chaseCameraFrame(this.base,this.chaseDistance);
    this.camera.position.set(frame.position.x,frame.position.y,frame.position.z);this.controls.target.set(frame.target.x,frame.target.y,frame.target.z);this.controls.update();
  }
  updateMachine(machine:Excavator,travel:number|readonly[number,number],dt=1/60){
    this.machine.update(machine,travel);this.base={...machine.base};
    if(this.follow){
      const frame=chaseCameraFrame(this.base,this.chaseDistance),blend=1-Math.exp(-8*dt);
      this.wantedPosition.set(frame.position.x,frame.position.y,frame.position.z);this.wantedTarget.set(frame.target.x,frame.target.y,frame.target.z);
      this.camera.position.lerp(this.wantedPosition,blend);this.controls.target.lerp(this.wantedTarget,blend);
    }
  }
  cameraReport(){return {mode:this.follow?'third-person':'orbit',position:this.camera.position.toArray(),target:this.controls.target.toArray()};}
}
