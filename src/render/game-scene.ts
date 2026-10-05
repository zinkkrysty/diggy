import * as THREE from 'three/webgpu';
import {terrainEdgeRadius,TERRAIN_FLOOR} from '../simulation/terrain';
import {SITE_ROAD,MACHINE_START} from '../simulation/site-layout';
import {finesFromGrain,type MaterialSettings} from '../simulation/material';
import {grainTexture,materialColor} from './material';
import {LabScene} from './scene';
import {ExcavatorView} from './objects/excavator';
import {chaseCameraFrame} from '../simulation/chase-camera';
import type {MachineBase,Excavator} from '../simulation/excavator';
export class GameScene extends LabScene {
  readonly machine=new ExcavatorView();
  private following=true;
  private vergeColors?:THREE.Float32BufferAttribute;
  private chaseDistance=9.8;
  private base:MachineBase={...MACHINE_START};
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
    // Overlap the material's outer samples with an irregular, color-blended
    // verge, rather than leaving an empty strip around a rectangular hole.
    const hole=new THREE.Path(),inner:THREE.Vector2[]=[],outer:THREE.Vector2[]=[];
    for(let i=0;i<64;i++){
      const a=-i*Math.PI*2/64,c=Math.cos(a),n=Math.sin(a),r=terrainEdgeRadius(-a);
      inner.push(new THREE.Vector2(c*(r-.35),n*(r-.35)));outer.push(new THREE.Vector2(c*(r+.55),n*(r+.55)));
      if(i===0)hole.moveTo(c*(r+.55),n*(r+.55));else hole.lineTo(c*(r+.55),n*(r+.55));
    }
    hole.closePath();meadow.holes.push(hole);
    const meadowTexture=grainTexture();meadowTexture.repeat.set(40,40);
    const grass=new THREE.Mesh(new THREE.ShapeGeometry(meadow),new THREE.MeshStandardMaterial({color:0x68765b,map:meadowTexture,roughness:1,side:THREE.DoubleSide}));grass.rotation.x=-Math.PI/2;grass.position.y=.53;grass.receiveShadow=true;this.scene.add(grass);
    const vertices:number[]=[],colors:number[]=[],indices:number[]=[];
    const dirtColor=new THREE.Color(0x88745e),grassColor=new THREE.Color(0x68765b);
    for(let i=0;i<64;i++){
      vertices.push(inner[i].x,.61,-inner[i].y,outer[i].x,.53,-outer[i].y);
      colors.push(dirtColor.r,dirtColor.g,dirtColor.b,grassColor.r,grassColor.g,grassColor.b);
      const j=(i+1)%64;indices.push(i*2,j*2,i*2+1,j*2,j*2+1,i*2+1);
    }
    const vergeGeometry=new THREE.BufferGeometry();vergeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.vergeColors=new THREE.Float32BufferAttribute(colors,3);vergeGeometry.setAttribute('color',this.vergeColors);vergeGeometry.setIndex(indices);vergeGeometry.computeVertexNormals();
    const verge=new THREE.Mesh(vergeGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));verge.receiveShadow=true;this.scene.add(verge);
    const bed=new THREE.Mesh(new THREE.BoxGeometry(24,.3,24),new THREE.MeshStandardMaterial({color:0x6e6552,roughness:1}));bed.position.y=TERRAIN_FLOOR-.15;bed.receiveShadow=true;this.scene.add(bed);
    // A rural two-way road runs alongside the west edge of the clearing.
    const roadTexture=grainTexture();roadTexture.repeat.set(3,60);
    const asphalt=new THREE.MeshStandardMaterial({color:0x454745,map:roadTexture,bumpMap:roadTexture,bumpScale:.015,roughness:.96});
    const gravel=new THREE.MeshStandardMaterial({color:0x918d80,roughness:1});
    const paint=new THREE.MeshStandardMaterial({color:0xc9c8b9,roughness:.96});
    const road=new THREE.Mesh(new THREE.BoxGeometry(SITE_ROAD.width,.04,SITE_ROAD.length),asphalt);
    road.position.set(SITE_ROAD.x,SITE_ROAD.height-.02,SITE_ROAD.z);road.receiveShadow=true;this.scene.add(road);
    for(const side of [-1,1]){
      const shoulder=new THREE.Mesh(new THREE.BoxGeometry(.65,.025,SITE_ROAD.length),gravel);
      shoulder.position.set(SITE_ROAD.x+side*(SITE_ROAD.width/2+.325),.542,0);shoulder.receiveShadow=true;this.scene.add(shoulder);
      const edge=new THREE.Mesh(new THREE.BoxGeometry(.065,.004,SITE_ROAD.length),paint);
      edge.position.set(SITE_ROAD.x+side*(SITE_ROAD.width/2-.18),.583,0);this.scene.add(edge);
    }
    for(let z=-43;z<44;z+=5){
      const dash=new THREE.Mesh(new THREE.BoxGeometry(.09,.004,2),paint);
      dash.position.set(SITE_ROAD.x,.583,z);this.scene.add(dash);
    }
    // Darker worn wheel paths interrupt the asphalt's uniform color.
    const worn=new THREE.MeshStandardMaterial({color:0x353936,transparent:true,opacity:.16,roughness:1});
    for(const offset of [-1.55,-.65,.65,1.55]){
      const strip=new THREE.Mesh(new THREE.PlaneGeometry(.22,SITE_ROAD.length),worn);
      strip.rotation.x=-Math.PI/2;strip.position.set(SITE_ROAD.x+offset,.581,0);this.scene.add(strip);
    }
    const stones=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),gravel,160),stone=new THREE.Object3D();
    for(let i=0;i<160;i++){
      stone.position.set(SITE_ROAD.x+(i%2?1:-1)*(2.28+(i*.137%.45)),.57,-42+(i*1.731%84));
      stone.scale.set(.035+(i%4)*.014,.024,.052);stone.rotation.set(i,.7*i,0);stone.updateMatrix();stones.setMatrixAt(i,stone.matrix);
    }
    stones.receiveShadow=true;this.scene.add(stones);
    const tufts=new THREE.InstancedMesh(new THREE.ConeGeometry(.075,.28,3),new THREE.MeshStandardMaterial({color:0x63734c,roughness:1}),600);
    for(let i=0;i<600;i++){
      const a=i*2.399,r=terrainEdgeRadius(a)+.75+(i*1.317%8),x=Math.cos(a)*r,z=Math.sin(a)*r;
      const onRoad=Math.abs(x-SITE_ROAD.x)<3.1;
      stone.position.set(x,onRoad?-2:.65,z);stone.scale.set(1,.65+(i%5)*.14,1);stone.rotation.set(0,i*.7,0);stone.updateMatrix();tufts.setMatrixAt(i,stone.matrix);
    }
    tufts.receiveShadow=true;this.scene.add(tufts);
    const orange=new THREE.MeshStandardMaterial({color:0xda7937,roughness:.85});
    for(const z of [-12.6,12.6])for(const x of [-2,2,5]){
      const rail=new THREE.Mesh(new THREE.BoxGeometry(1.8,.18,.12),orange);
      rail.position.set(x,1.1,z);rail.castShadow=true;this.scene.add(rail);
      for(const offset of [-.65,.65]){
        const leg=new THREE.Mesh(new THREE.BoxGeometry(.09,.65,.09),gravel);
        leg.position.set(x+offset,.85,z);leg.castShadow=true;this.scene.add(leg);
      }
    }
    const treeMat=new THREE.MeshStandardMaterial({color:0x596b4d,roughness:1}),trunkMat=new THREE.MeshStandardMaterial({color:0x6b6150,roughness:1});
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.23,2.2,6),trunkMat,28);
    const crowns=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,7),treeMat,84),dummy=new THREE.Object3D();
    for(let i=0;i<28;i++){
      const a=i*2.399,r=19+(i%6)*2.5,x=Math.cos(a)*r,z=Math.sin(a)*r;
      // Keep the road corridor clear of trees.
      const treeX=Math.abs(x-SITE_ROAD.x)<3.8?SITE_ROAD.x-4.5:x;
      dummy.position.set(treeX,1.6,z);dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      for(let crown=0;crown<3;crown++){
        const size=1.25+(i%3)*.15;dummy.position.set(treeX+Math.cos(crown*2.1+i)*.65,3.3+crown*.45,z+Math.sin(crown*2.1+i)*.65);dummy.scale.set(size,size*1.25,size);dummy.updateMatrix();crowns.setMatrixAt(i*3+crown,dummy.matrix);
        crowns.setColorAt(i*3+crown,new THREE.Color(0x526648).multiplyScalar(.88+(i%5)*.045));
      }
    }
    this.scene.add(trunks,crowns);
    // Small site markers bound the actual editable ground, without a laboratory cage.
    const white=new THREE.MeshStandardMaterial({color:0xd8d4bc,roughness:.9});
    for(const x of [-12.6,12.6])for(const z of [-12.6,12.6]){const post=new THREE.Mesh(new THREE.BoxGeometry(.09,.65,.09),white);post.position.set(x,.85,z);post.castShadow=true;this.scene.add(post);}
  }
  setGroundAppearance(settings:MaterialSettings){
    if(!this.vergeColors)return;
    const dirt=materialColor(settings.moisture,finesFromGrain(settings.grainMm)).multiplyScalar(.9);
    for(let i=0;i<this.vergeColors.count;i+=2)this.vergeColors.setXYZ(i,dirt.r,dirt.g,dirt.b);
    this.vergeColors.needsUpdate=true;
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
