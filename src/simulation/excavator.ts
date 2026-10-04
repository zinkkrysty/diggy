import {yawPitchBasis,multiplyBasis,transform,cross,type Basis} from './rigid-transform';
import type {ContactFeedback} from './actuator';
import {BUCKET_PARTS,type Collider,type Pose} from './bucket';
export interface MachineBase {x:number;y:number;z:number;yaw:number;rotation?:{x:number;y:number;z:number;w:number};basis?:Basis}
export interface ExcavatorCommand {boom:number;stick:number;curl:number;swing:number}
export const BOOM_LENGTH=2.6,STICK_LENGTH=1.8;
export const JOINT_LIMITS=[[.12,1.32],[-2.55,-.2],[-.8,3.05],[-Infinity,Infinity]] as const;
const INITIAL=[.9,-2.3,1.4,0];
const inertia=[12000,3500,1100,22000],limits=[100000,65000,22000,40000],flow=[.3,.42,.65,.32];
export function rotateYaw(x:number,z:number,yaw:number):[number,number]{return [Math.cos(yaw)*x+Math.sin(yaw)*z,-Math.sin(yaw)*x+Math.cos(yaw)*z];}
/** Reduced-coordinate hydraulic arm. State is independent of the render graph. */
export class Excavator {
  joints=[...INITIAL];target=[...INITIAL];velocity=[0,0,0,0];effort=[0,0,0,0];reaction=[0,0,0,0];carriedMass=0;
  base:MachineBase={x:-3.7,y:1,z:0,yaw:0};
  reset(){this.joints=[...INITIAL];this.target=[...INITIAL];this.velocity.fill(0);this.effort.fill(0);this.reaction.fill(0);this.carriedMass=0;}
  get yaw(){return this.base.yaw+this.joints[3];}
  points(){
    const [boom,stick]=this.joints,a=boom+stick;
    const pivot=[.5,.85,0],elbow=[pivot[0]+BOOM_LENGTH*Math.cos(boom),pivot[1]+BOOM_LENGTH*Math.sin(boom),0];
    const tip=[elbow[0]+STICK_LENGTH*Math.cos(a),elbow[1]+STICK_LENGTH*Math.sin(a),0];
    return {pivot,elbow,tip};
  }
  pose():Pose {
    const {tip}=this.points(),angle=this.joints[0]+this.joints[1]+this.joints[2];
    // Bucket hinge is on the back lip; the collision center is below/forward of it.
    const x=tip[0]+.45*Math.cos(angle)+.32*Math.sin(angle),y=tip[1]+.45*Math.sin(angle)-.32*Math.cos(angle);
    const upper=multiplyBasis(this.base.basis??yawPitchBasis(this.base.yaw),yawPitchBasis(this.joints[3]));
    const [dx,dy,dz]=transform(upper,[x,y,0]),basis=multiplyBasis(upper,yawPitchBasis(0,angle));
    return {x:this.base.x+dx,y:this.base.y+dy,z:this.base.z+dz,angle,yaw:this.yaw,basis};
  }
  private gravity(){
    const [a,b]=this.joints,c=a+b;
    const upper=multiplyBasis(this.base.basis??yawPitchBasis(this.base.yaw),yawPitchBasis(this.joints[3]));
    const lever=(length:number,angle:number)=>length*(upper[4]*Math.cos(angle)-upper[1]*Math.sin(angle));
    const stickLever=lever(STICK_LENGTH*.5,c),bucketLever=lever(STICK_LENGTH,c);
    return [-9.81*(900*lever(BOOM_LENGTH*.5,a)+500*(lever(BOOM_LENGTH,a)+stickLever)+450*(lever(BOOM_LENGTH,a)+bucketLever)),-9.81*(500*stickLever+450*bucketLever),-9.81*450*(lever(.45,a+b+this.joints[2])+lever(.32,a+b+this.joints[2]-Math.PI/2)),0];
  }
  step(dt:number,command:ExcavatorCommand){
    const before=this.pose(),commands=[command.boom,command.stick,command.curl,command.swing];
    for(let i=0;i<4;i++)this.target[i]=Math.max(JOINT_LIMITS[i][0],Math.min(JOINT_LIMITS[i][1],Math.max(this.joints[i]-.08,Math.min(this.joints[i]+.08,this.target[i]+commands[i]*flow[i]*dt))));
    const steps=Math.ceil(dt/.002),h=dt/steps;
    for(let n=0;n<steps;n++){
      const gravity=this.gravity();
      for(let i=0;i<4;i++){
        const k=[380000,260000,160000,320000][i],damping=2*Math.sqrt(k*inertia[i]);
        const torque=Math.max(-limits[i],Math.min(limits[i],k*(this.target[i]-this.joints[i])-damping*this.velocity[i]-gravity[i]));this.effort[i]=torque;
        this.velocity[i]+=(torque+gravity[i])*h/inertia[i];this.velocity[i]=Math.max(-flow[i],Math.min(flow[i],this.velocity[i]));
        const previous=this.joints[i],beforeJoint=this.pose();
        this.joints[i]+=this.velocity[i]*h;
        if(this.joints[i]<JOINT_LIMITS[i][0]||this.joints[i]>JOINT_LIMITS[i][1]){this.joints[i]=Math.max(JOINT_LIMITS[i][0],Math.min(JOINT_LIMITS[i][1],this.joints[i]));this.velocity[i]=0;}
        // Check each joint independently. A tilted base can already put the
        // bucket outside the work volume; permit motion back toward it.
        const p=this.pose();
        const violations=(pose:Pose)=>[Math.max(0,.6-pose.y),Math.max(0,pose.y-3.35),Math.max(0,Math.abs(pose.x)-5),Math.max(0,Math.abs(pose.z)-5)];
        const was=violations(beforeJoint),next=violations(p);
        if(next.some((v,k)=>v>was[k]+1e-9)){this.joints[i]=previous;this.velocity[i]=0;this.target[i]=previous;}
      }
    }
    const after=this.pose();
    return {velocity:[(after.x-before.x)/dt,(after.y-before.y)/dt,(after.z-before.z)/dt] as [number,number,number],omega:(after.angle-before.angle)/dt,yawOmega:((after.yaw??0)-(before.yaw??0))/dt};
  }
  contact(feedback:ContactFeedback,dt:number){
    this.carriedMass=feedback.carriedMass;
    // J^T maps the measured soil impulse onto the hydraulic coordinates.
    // Weight already appears in soil impulses and is not added a second time.
    const original=this.pose(),epsilon=1e-5;
    for(let i=0;i<4;i++){
      this.joints[i]+=epsilon;const next=this.pose();this.joints[i]-=epsilon;
      const impulse=((next.x-original.x)*feedback.impulse[0]+(next.y-original.y)*feedback.impulse[1]+(next.z-original.z)*feedback.impulse[2])/epsilon+(i<3?feedback.torqueImpulse:0);
      this.reaction[i]=impulse/dt;this.velocity[i]+=impulse/inertia[i];
    }
  }
  colliders(velocity:[number,number,number],omega:number,yawOmega:number,worldOmega?:[number,number,number]):Collider[]{
    const pose=this.pose(),basis=pose.basis!;
    const angular=worldOmega??[-Math.sin(this.yaw)*omega,yawOmega,Math.cos(this.yaw)*omega];
    return BUCKET_PARTS.map(part=>{
      const delta=transform(basis,part.center),rotational=cross(angular,delta);
      return {center:[pose.x+delta[0],pose.y+delta[1],pose.z+delta[2]],half:[...part.half],angle:pose.angle,yaw:this.yaw,omega,yawOmega,basis,angularVelocity:angular,bucket:true,velocity:velocity.map((v,i)=>v+rotational[i]) as [number,number,number]};
    });
  }

  report(){return {base:{...this.base},joints:[...this.joints],velocity:[...this.velocity],effort:[...this.effort],reaction:[...this.reaction],pose:this.pose(),carriedMassKg:this.carriedMass};}
}
