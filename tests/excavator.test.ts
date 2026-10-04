import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Excavator,JOINT_LIMITS} from '../src/simulation/excavator';
import {boxDistance} from '../src/simulation/bucket';
test('Swing rotates the physical bucket and its collision geometry together',()=>{
 const m=new Excavator(),before=m.pose();m.joints[3]=Math.PI/2;const after=m.pose();
 assert.ok(Math.abs(after.x-m.base.x)<1e-9);assert.ok(Math.abs(after.z-(m.base.z-(before.x-m.base.x)))<1e-9);assert.equal(before.y,after.y);
 const boxes=m.colliders([0,0,0],0,0);for(const b of boxes)assert.ok(boxDistance(b.center,b).distance<0);
 const edge=boxes[0];assert.ok(boxDistance([edge.center[0]+.7,edge.center[1],edge.center[2]],edge).distance>0);
});
test('Hydraulic joints hold, obey limits, and respond to measured resistance',()=>{
 const m=new Excavator();for(let i=0;i<200;i++)m.step(.032,{boom:0,stick:0,curl:0,swing:0});
 assert.ok(Math.abs(m.joints[0]-.9)<1e-9);
 const before=m.velocity[0];m.contact({impulse:[-100,0,0],torqueImpulse:-100,carriedMass:240},.032);
 assert.notEqual(m.velocity[0],before);assert.equal(m.carriedMass,240);
 for(let i=0;i<1000;i++)m.step(.032,{boom:1,stick:1,curl:1,swing:0});
 m.joints.slice(0,3).forEach((q,i)=>assert.ok(q>=JOINT_LIMITS[i][0]&&q<=JOINT_LIMITS[i][1]));
 assert.ok(m.pose().y>=.6&&m.pose().y<=3.35);
});
import {supportHeights} from '../src/simulation/ground-support';
test('Vehicle support excludes carried and airborne soil',()=>{
 const p=Float32Array.from([0,.25,0,1,0,.45,0,1,0,2.25,0,1,0,2.45,0,1]);
 const height=supportHeights(p)[12+12*25];assert.ok(Math.abs(height-.55)<1e-6);
 assert.ok(Math.abs(supportHeights(p.slice(8))[12+12*25]-.15)<1e-6);
});
import {colliderBounds} from '../src/simulation/bucket';
test('Contact broad phase encloses every rotated box corner',()=>{
 const m=new Excavator();for(const yaw of [0,.4,1.5,3])for(const curl of [-.8,.1,2]){
  m.joints[3]=yaw;m.joints[2]=curl;
  for(const b of m.colliders([0,0,0],0,0)){const bounds=colliderBounds(b),c=Math.cos(b.angle),s=Math.sin(b.angle),cy=Math.cos(b.yaw!),sy=Math.sin(b.yaw!);
   for(const sx of [-1,1])for(const sySign of [-1,1])for(const sz of [-1,1]){
    const x=c*sx*b.half[0]-s*sySign*b.half[1],y=s*sx*b.half[0]+c*sySign*b.half[1],z=sz*b.half[2];
    [cy*x+sy*z,y,-sy*x+cy*z].forEach((v,i)=>assert.ok(Math.abs(v)<=bounds[i]+1e-10));
   }
  }
 }
});
import {yawPitchBasis,transform} from '../src/simulation/rigid-transform';
test('Tilted chassis rotates bucket contact and broad phase with the model',()=>{
 const m=new Excavator();m.base.basis=yawPitchBasis(.6,.45);
 for(const box of m.colliders([0,0,0],0,0)){
  const bounds=colliderBounds(box);
  assert.ok(boxDistance(box.center,box).distance<0);
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
   const d=transform(box.basis!,[x*box.half[0],y*box.half[1],z*box.half[2]]);
   d.forEach((v,i)=>assert.ok(Math.abs(v)<=bounds[i]+1e-10));
   assert.ok(Math.abs(boxDistance(d.map((v,i)=>v+box.center[i]) as [number,number,number],box).distance)<1e-9);
  }
 }
});
test('Arm can recover after chassis motion puts bucket above the work volume',()=>{
 const m=new Excavator();m.base.y=2.8;
 const start=m.pose();assert.ok(start.y>3.35);
 for(let i=0;i<100;i++)m.step(.032,{boom:-1,stick:0,curl:0,swing:0});
 assert.ok(m.pose().y<start.y-.2,'Lowering must remain available outside the height limit');
});
test('Out-of-bounds arm still permits swing and inward recovery',()=>{
 const m=new Excavator();m.base.x=3;const start=m.pose();assert.ok(start.x>5);
 for(let i=0;i<100;i++)m.step(.032,{boom:1,stick:0,curl:0,swing:1});
 assert.ok(m.pose().x<start.x-.2);assert.ok(m.joints[3]>.2,'One constrained joint must not freeze swing');
});
