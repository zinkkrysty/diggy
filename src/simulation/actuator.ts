import type { Pose } from './bucket';

export interface ContactFeedback { impulse: [number,number,number]; torqueImpulse: number; carriedMass: number }
const axes = ['x','y','z','angle'] as const;
const lower = [-2.1,0.58,-1.1,-1.4], upper = [2.1,3,1.1,1.4];
/** Restricted four-axis bucket fixture. Machine dynamics will replace the fixture. */
export class BucketActuator {
  readonly mass = 1800; // bucket plus translating test carriage, kg
  readonly inertia = 1100; // bucket plus rotating fixture, kg m²
  velocity = [0,0,0,0];
  lower=[...lower];upper=[...upper];
  target: Pose;
  effort = [0,0,0,0];
  strength = 1;
  carriedMass = 0;
  reaction = [0,0,0,0];
  constructor(public pose: Pose) { this.target={...pose}; }
  reset(pose: Pose): void { this.pose={...pose};this.target={...pose};this.velocity.fill(0);this.effort.fill(0);this.reaction.fill(0);this.carriedMass=0; }
  step(dt:number, command:number[], scripted?:Pose): {velocity:[number,number,number];omega:number} {
    const before={...this.pose};
    // Bounded position error prevents windup while the cutting edge is stalled.
    for(let i=0;i<4;i++) {
      const key=axes[i];
      const desired=scripted?.[key]??this.target[key]+command[i]*dt;
      this.target[key]=Math.max(this.lower[i],Math.min(this.upper[i],Math.max(this.pose[key]-0.16,Math.min(this.pose[key]+0.16,desired))));
    }
    const steps=Math.ceil(dt/0.002),h=dt/steps;
    for(let n=0;n<steps;n++) for(let i=0;i<4;i++) {
      const key=axes[i],inertia=i===3?this.inertia:this.mass;
      const gravity=i===1?-this.mass*9.81:0;
      const limit=[28000,45000,28000,22000][i]*this.strength;
      const requested=160000*(this.target[key]-this.pose[key])-24000*this.velocity[i]-gravity;
      const force=Math.max(-limit,Math.min(limit,requested));this.effort[i]=force;
      this.velocity[i]+=(force+gravity)*h/inertia;
      // Actuator flow limit; contact impulses are not capped here or turned into a drag multiplier.
      this.velocity[i]=Math.max(-0.85,Math.min(0.85,this.velocity[i]));
      this.pose[key]+=this.velocity[i]*h;
      if(this.pose[key]<this.lower[i]||this.pose[key]>this.upper[i]) {this.pose[key]=Math.max(this.lower[i],Math.min(this.upper[i],this.pose[key]));this.velocity[i]=0;}
    }
    return {velocity:[(this.pose.x-before.x)/dt,(this.pose.y-before.y)/dt,(this.pose.z-before.z)/dt],omega:(this.pose.angle-before.angle)/dt};
  }
  contact(feedback:ContactFeedback,dt:number):void {
    this.carriedMass=feedback.carriedMass;
    // Soil weight is already in the contact impulses. Adding it as a separate
    // gravity force would count it twice; containment is diagnostic only.
    const impulses=[...feedback.impulse,feedback.torqueImpulse];
    for(let i=0;i<4;i++) {
      this.reaction[i]=impulses[i]/dt;
      this.velocity[i]+=impulses[i]/(i===3?this.inertia:this.mass);
    }
  }
  report(){return {mode:'force-limited fixture',massKg:this.mass,inertiaKgM2:this.inertia,strength:this.strength,velocity:[...this.velocity],effort:[...this.effort],reaction:[...this.reaction],carriedMassKg:this.carriedMass};}
}
