import test from 'node:test';
import assert from 'node:assert/strict';
import { presets, stableTimestep, moistureCohesion } from '../src/simulation/material';
import { seedScenario, SCENARIOS, STATE_FLOATS } from '../src/simulation/scenarios';
import { boxDistance, colliders } from '../src/simulation/bucket';
import { percentile } from '../src/diagnostics/performance';

test('all scenarios seed reproducibly with conserved volume and mass',()=>{
  for(const scenario of Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]){
    if(scenario==='terrain')continue;
    const a=seedScenario(scenario,4096,presets.soil),b=seedScenario(scenario,4096,presets.soil);
    assert.deepEqual(a.positions,b.positions);assert.ok(a.count>2500&&a.count<=4096);
    let mass=0,volume=0;
    for(let i=0;i<a.count;i++){mass+=a.positions[i*4+3];volume+=a.states[i*STATE_FLOATS+3];assert.equal(a.states[i*STATE_FLOATS+4],1);}
    assert.ok(Math.abs(mass-a.mass)/a.mass<1e-6);assert.ok(Math.abs(volume-a.volume)/a.volume<1e-6);
  }
});
test('mixing preserves two different compositions',()=>{
  const seed=seedScenario('mix',4096,presets.soil);
  const moisture=new Set(Array.from({length:seed.count},(_,i)=>seed.states[i*STATE_FLOATS+28].toFixed(2)));
  assert.deepEqual([...moisture].sort(),['0.00','0.62']);
});
test('moisture cohesion is non-monotonic and wave bound responds to stiffness',()=>{
  assert.ok(moistureCohesion(0.5,0.8)>moistureCohesion(0.95,0.8));
  assert.ok(stableTimestep({...presets.soil,stiffness:120000},0.08)<stableTimestep({...presets.soil,stiffness:15000},0.08));
});
test('rotated box contact distinguishes interior and open bucket',()=>{
  const boxes=colliders({x:0,y:1,z:0,angle:0},[0,0,0],0,false,false);
  assert.ok(boxes.every(box=>boxDistance([0,1,0],box).distance>0));
  assert.ok(boxDistance([0,0.66,0],boxes[0]).distance<0);
  const box={...boxes[0],center:[0,1,0] as [number,number,number],angle:Math.PI/2};
  const contact=boxDistance([0.1,1,0],box);assert.ok(contact.distance>0);assert.ok(contact.normal[0]>0.99);
});
test('p95 retains long-frame evidence',()=>{assert.equal(percentile([...Array(18).fill(16),50,100],0.95),50);});

test('rolling performance remains correct beyond its capacity',async()=>{
  const {PerformanceWindow}=await import('../src/diagnostics/performance');
  const perf=new PerformanceWindow(10);
  for(let i=0;i<100;i++)perf.add(20,0.02);
  assert.ok(Math.abs(perf.summary().fps-50)<1e-9);assert.ok(Math.abs(perf.summary().simulationRate-1)<1e-9);
});
