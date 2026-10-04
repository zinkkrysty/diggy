import test from 'node:test';
import assert from 'node:assert/strict';
import { BucketActuator } from '../src/simulation/actuator';
const initial={x:0,y:1,z:0,angle:0};
function run(load:number,strength=1){
  const a=new BucketActuator({...initial});a.strength=strength;
  for(let i=0;i<200;i++){a.step(.01,[.7,0,0,0]);a.contact({impulse:[-load*.01,0,0],torqueImpulse:0,carriedMass:0},.01);}
  return a;
}
test('finite actuator force slows and stalls digging without target windup',()=>{
  const free=run(0),resisted=run(12000),stalled=run(25000);
  assert.ok(free.pose.x>resisted.pose.x+.25);assert.ok(stalled.pose.x<.1);
  assert.ok(stalled.target.x-stalled.pose.x<=.161);
  assert.ok(stalled.effort[0]<=28000);
});
test('empty fixture holds against gravity and soil weight consumes lift capacity',()=>{
  const a=new BucketActuator({...initial});
  for(let i=0;i<200;i++)a.step(.01,[0,0,0,0]);
  assert.ok(Math.abs(a.pose.y-initial.y)<1e-9);
  a.strength=.5;
  for(let i=0;i<200;i++){a.step(.01,[0,.7,0,0]);a.contact({impulse:[0,-7000*.01,0],torqueImpulse:0,carriedMass:700},.01);}
  assert.ok(a.pose.y<initial.y);assert.equal(a.carriedMass,700);assert.ok(a.effort[1]<=22500);
});
test('reaction torque changes angular momentum and reset removes stored motion',()=>{
  const a=new BucketActuator({...initial});a.contact({impulse:[180,0,0],torqueImpulse:110,carriedMass:10},.02);
  assert.equal(a.velocity[0],.1);assert.equal(a.velocity[3],.1);
  a.reset(initial);assert.deepEqual(a.velocity,[0,0,0,0]);assert.equal(a.carriedMass,0);
});
