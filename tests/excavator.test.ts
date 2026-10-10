import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seedTerrain} from '../src/simulation/terrain';
import {presets} from '../src/simulation/material';
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
 const layers=Array.from({length:12},(_,i)=>[0,-1.75+i*.2,0,1]).flat();
 const p=Float32Array.from([...layers,0,2.25,0,1,0,2.45,0,1]);
 const height=supportHeights(p)[24+24*49];assert.ok(Math.abs(height-.55)<1e-6);
 assert.ok(Math.abs(supportHeights(p.slice(layers.length))[24+24*49]+1.85)<1e-6);
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

test('arm can excavate beneath the original surface height',()=>{
 const m=new Excavator();m.base={x:0,y:1,z:0,yaw:0};
 for(let i=0;i<200;i++)m.step(.032,{boom:-1,stick:0,curl:0,swing:0});
 for(let i=0;i<60;i++)m.step(.032,{boom:0,stick:1,curl:0,swing:0});
 assert.ok(m.pose().y<0,'The deeper soil must be reachable by the bucket');
 assert.ok(m.pose().y>=-1.4,'Bucket travel remains above the lowered bedrock');
});

test('chassis ground support follows excavation below the old floor',()=>{
 const seed=seedTerrain(presets.soil),cut:number[]=[];
 for(let i=0;i<seed.count;i++){
  const x=seed.positions[4*i],y=seed.positions[4*i+1],z=seed.positions[4*i+2];
  if(Math.abs(x)<1&&Math.abs(z)<1&&y>-.7)continue;
  cut.push(...seed.positions.slice(4*i,4*i+4));
 }
 const heights=supportHeights(Float32Array.from(cut));
 assert.ok(heights[24+24*49]<-.6,'Excavated support must descend below the previous floor');
 assert.ok(Math.abs(heights[32+32*49]-.55)<1e-6,'Undisturbed ground keeps its height');
});

test('small soil uplift changes support continuously rather than dropping to bedrock',()=>{
 const seed=seedTerrain(presets.soil);
 for(const delta of [-.101,-.04,.04,.099,.101]){
  const positions=seed.positions.slice();for(let i=1;i<positions.length;i+=4)positions[i]+=delta;
  const height=supportHeights(positions)[32+32*49];
  assert.ok(Math.abs(height-(.55+delta))<1e-5,`Support must track ${delta} m of displacement continuously`);
 }
});

import {GroundSupportCache} from '../src/simulation/ground-support';
test('incremental ground support matches full reconstruction when samples move columns',()=>{
 const seed=seedTerrain(presets.soil),positions=seed.positions.slice(),cache=new GroundSupportCache();cache.update(positions);
 const moved:number[]=[];
 for(let i=0;i<seed.count;i++)if(Math.abs(positions[4*i])<1&&Math.abs(positions[4*i+2])<1){moved.push(i);positions[4*i]+=.55;positions[4*i+1]-=.06;}
 assert.deepEqual(cache.update(positions,Uint32Array.from(moved)),supportHeights(positions));
});

test('shared pump slows concurrent functions and releases flow when commands stop',()=>{
 const single=new Excavator(),combined=new Excavator();
 for(let i=0;i<20;i++){
  single.step(.016,{boom:0,stick:0,curl:0,swing:1});
  combined.step(.016,{boom:1,stick:1,curl:1,swing:1});
 }
 assert.ok(combined.joints[3]<single.joints[3]*.7,'Concurrent arm commands must reduce swing travel');
 assert.ok(combined.hydraulics.flowDemand*combined.hydraulics.allocation<=1.6+1e-9);
 combined.step(.016,{boom:0,stick:0,curl:0,swing:1});
 assert.equal(combined.hydraulics.allocation,1);
 combined.reset();assert.deepEqual(combined.hydraulics,{flowDemand:0,powerDemandWatts:0,allocation:1});
});

test('measured cutting resistance slows and overload stalls curl without target windup',()=>{
 const travel=(load:number)=>{
  const m=new Excavator(),start=m.joints[2];
  for(let i=0;i<50;i++){
   m.step(.016,{boom:0,stick:0,curl:1,swing:0});
   m.contact({impulse:[0,0,0],torqueImpulse:-load*.016,carriedMass:100},.016);
   assert.ok(m.joints.every(Number.isFinite));
   assert.ok(Math.abs(m.target[2]-m.joints[2])<=.081);
   assert.ok(Math.abs(m.effort[2])<=22000);
  }
  return m.joints[2]-start;
 };
 const free=travel(0),cut=travel(8000),overload=travel(26000);
 assert.ok(free>cut&&cut>overload,'Increasing physical resistance must reduce travel');
 assert.ok(overload<.02,'Overload must stall or backdrive the joint');
});

test('pump power allocation accounts for measured load and ignores joints at stops',()=>{
 const m=new Excavator();m.effort=[100000,65000,22000,40000];
 m.step(.016,{boom:1,stick:1,curl:1,swing:0});
 assert.ok(m.hydraulics.powerDemandWatts*m.hydraulics.allocation<=45000+1e-9);
 m.joints[2]=JOINT_LIMITS[2][1];m.target[2]=m.joints[2];
 m.step(.016,{boom:0,stick:0,curl:1,swing:1});
 assert.equal(m.hydraulics.flowDemand,1);
 assert.equal(m.hydraulics.allocation,1);
});
