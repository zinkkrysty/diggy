import {TERRAIN_FLOOR} from '../simulation/terrain';
import {SITE_ROAD,MACHINE_START} from '../simulation/site-layout';
import RAPIER from '@dimforge/rapier3d-compat';
import {type MachineBase} from '../simulation/excavator';
import {quaternionBasis,transform,cross} from '../simulation/rigid-transform';
import {GroundSupportCache} from '../simulation/ground-support';
import type {Collider} from '../simulation/bucket';
/** Tracked rigid body on a coarse support surface; volumetric soil remains the source of truth. */
export class Chassis {
  readonly world=new RAPIER.World({x:0,y:-9.81,z:0});
  readonly body:RAPIER.RigidBody;
  private ground?:RAPIER.Collider;
  private support=new Float32Array(49*49).fill(.55);
  private accumulator=0;
  private supportCache=new GroundSupportCache();
  travel=0;
  trackTravel:[number,number]=[0,0];
  private floor:RAPIER.Collider;
  private road:RAPIER.Collider;
  private tracks:RAPIER.Collider[]=[];
  constructor(){
    this.body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(MACHINE_START.x,MACHINE_START.y,MACHINE_START.z).setAdditionalMassProperties(12000,{x:0,y:.35,z:0},{x:18000,y:25000,z:18000},{x:0,y:0,z:0,w:1}).setLinearDamping(.9).setAngularDamping(2));
    // Rounded belt ends can roll onto a slope; rectangular noses caught on it.
    const vertices:number[]=[];
    for(const end of [-1.1,1.1])for(let i=0;i<16;i++)for(const side of [-.28,.28]){
      const angle=i*Math.PI/8;vertices.push(end+Math.cos(angle)*.25,-.2+Math.sin(angle)*.25,side);
    }
    for(const z of [-.92,.92]){
      const desc=RAPIER.ColliderDesc.convexHull(Float32Array.from(vertices));if(!desc)throw new Error('Track hull failed');
      this.tracks.push(this.world.createCollider(desc.setTranslation(0,0,z).setDensity(0).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),this.body));
    }
    this.floor=this.world.createCollider(RAPIER.ColliderDesc.cuboid(40,.15,40).setTranslation(0,TERRAIN_FLOOR-.15,0).setFriction(.9));
    // The road and surrounding meadow support travel beyond the soil domain.
    this.road=this.world.createCollider(RAPIER.ColliderDesc.cuboid(SITE_ROAD.width/2,.215,SITE_ROAD.length/2).setTranslation(SITE_ROAD.x,SITE_ROAD.height-.215,SITE_ROAD.z).setFriction(.9));
    // Grass surrounds the excavation opening without filling dug-out soil.
    for(const [x,z,hx,hz] of [[-41,0,29,70],[41,0,29,70],[0,-41,12,29],[0,41,12,29]])
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx,.19,hz).setTranslation(x,.34,z).setFriction(.9));
  }
  static async init(){await RAPIER.init();}
  updateGround(positions:Float32Array,indices?:Uint32Array){
    const heights=this.supportCache.update(positions,indices);
    let change=0;for(let i=0;i<heights.length;i++)change=Math.max(change,Math.abs(heights[i]-this.support[i]));
    if(!this.ground||change>.015){if(this.ground)this.world.removeCollider(this.ground,true);this.support=heights.slice();this.ground=this.world.createCollider(RAPIER.ColliderDesc.heightfield(48,48,heights,{x:24,y:1,z:24}).setFriction(.9));}
  }
  get base():MachineBase{const p=this.body.translation(),q=this.body.rotation(),basis=quaternionBasis(q);return {x:p.x,y:p.y,z:p.z,yaw:Math.atan2(-basis[2],basis[0]),rotation:{...q},basis};}
  step(dt:number,forward:number,turn:number,bucket: {x:number;y:number;z:number}){
    this.accumulator+=dt;const h=1/60;
    while(this.accumulator>=h){
      this.accumulator-=h;const b=this.base,v=this.body.linvel(),w=this.body.angvel(),basis=b.basis!;
      const driveAxis=[basis[0],basis[1],basis[2]];
      this.body.resetForces(true);this.body.resetTorques(true);
      const requested=forward*.65;
      // Bucket reach must not disable
      // propulsion when chassis roll carries the arm outside its work volume.
      const moving=Math.abs(forward)+Math.abs(turn)>0;
      for(const track of this.tracks)track.setFriction(moving?0:.8); // Released controls engage the belt brakes.
      const patches=[-.92,.92].map(z=>{
        const hits:Array<{point:{x:number;y:number;z:number};normal:{x:number;y:number;z:number}}>=[];
        for(const along of [-1.1,0,1.1])for(const across of [-.24,0,.24]){
          const origin=transform(basis,[along,.6,z+across]);
          const ray=new RAPIER.Ray({x:b.x+origin[0],y:b.y+origin[1],z:b.z+origin[2]},{x:-basis[3],y:-basis[4],z:-basis[5]});
          const reach=1.13;
          const hit=this.world.castRayAndGetNormal(ray,reach,true,undefined,undefined,undefined,this.body,c=>!this.tracks.includes(c));
          if(hit&&hit.normal.y>0)hits.push({point:{x:ray.origin.x+ray.dir.x*hit.toi,y:ray.origin.y+ray.dir.y*hit.toi,z:ray.origin.z+ray.dir.z*hit.toi},normal:hit.normal});
        }
        return {z,hits};
      });
      const supported=patches.filter(p=>p.hits.length).length;
      for(const [index,patch]of patches.entries()){
        const delta=transform(basis,[0,-.45,patch.z]),rotating=cross([w.x,w.y,w.z],delta);
        const trackVelocity=[v.x+rotating[0],v.y+rotating[1],v.z+rotating[2]];
        if(!patch.hits.length)continue;
        const normal=[0,0,0],point=[0,0,0];
        for(const hit of patch.hits){normal[0]+=hit.normal.x;normal[1]+=hit.normal.y;normal[2]+=hit.normal.z;point[0]+=hit.point.x;point[1]+=hit.point.y;point[2]+=hit.point.z;}
        const nLength=Math.hypot(...normal);normal.forEach((_,i)=>{normal[i]/=nLength;point[i]/=patch.hits.length;});
        const dot=driveAxis.reduce((sum,n,i)=>sum+n*normal[i],0),tangent=driveAxis.map((n,i)=>n-dot*normal[i]);
        const tLength=Math.hypot(...tangent);if(tLength<1e-5)continue;tangent.forEach((_,i)=>tangent[i]/=tLength);
        const side=cross(tangent,normal),trackSpeed=trackVelocity.reduce((sum,n,i)=>sum+n*tangent[i],0),lateral=trackVelocity.reduce((sum,n,i)=>sum+n*side[i],0);
        // The supported belts share the weight; a short contact patch carries
        // more load rather than making two-thirds of the machine weight vanish.
        const normalLoad=this.body.mass()*9.81*normal[1]/supported,tractionLimit=.8*normalLoad;
        const target=requested+turn*.22*patch.z;
        let longitudinal=120000*(target-trackSpeed)-.06*normalLoad*Math.tanh(trackSpeed/.08),transverse=-32000*lateral;
        const force=Math.hypot(longitudinal,transverse),scale=force>tractionLimit?tractionLimit/force:1;longitudinal*=scale;transverse*=scale;
        this.body.addForceAtPoint({x:longitudinal*tangent[0]+transverse*side[0],y:longitudinal*tangent[1]+transverse*side[1],z:longitudinal*tangent[2]+transverse*side[2]},{x:point[0],y:point[1],z:point[2]},true);
        this.trackTravel[index]+=trackSpeed*h;
      }
      this.world.timestep=h;this.world.step();this.travel+=(v.x*driveAxis[0]+v.y*driveAxis[1]+v.z*driveAxis[2])*h;
    }
  }
  contact(impulse:[number,number,number],point:{x:number;y:number;z:number}){this.body.applyImpulseAtPoint({x:impulse[0],y:impulse[1],z:impulse[2]},point,true);}
  colliders():Collider[]{const b=this.base,v=this.body.linvel(),w=this.body.angvel();return [-.92,.92].map(z=>{
    const delta=transform(b.basis!,[0,-.2,z]),rotating=cross([w.x,w.y,w.z],delta);
    return {center:[b.x+delta[0],b.y+delta[1],b.z+delta[2]],half:[1.35,.25,.28],angle:0,yaw:b.yaw,yawOmega:w.y,omega:0,basis:b.basis,angularVelocity:[w.x,w.y,w.z],velocity:[v.x+rotating[0],v.y+rotating[1],v.z+rotating[2]],bucket:false};
  });}
  destroy(){this.world.free();}
}
