import {ReferenceTerrainActivity} from './terrain-reference';
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedTerrain,TerrainActivity,chunkAt,neighbors,haloNeighbors} from '../src/simulation/terrain';
import {presets} from '../src/simulation/material';
import {STATE_FLOATS,type Seed} from '../src/simulation/scenarios';
test('terrain owns a reproducible volumetric mass independent of active chunks',()=>{
 const seed=seedTerrain(presets.soil),other=seedTerrain(presets.soil);assert.deepEqual(seed.positions,other.positions);assert.ok(seed.count>7000);assert.ok(Math.abs(seed.mass/seed.volume-1510)<100);
 for(let i=0;i<seed.count;i++)for(const axis of [0,2])assert.ok(Math.abs(seed.positions[4*i+axis])<=5.6,'Seed must start inside the physical boundary margin');
 const a=new TerrainActivity(seed);a.update(seed.pose,0);assert.ok(a.report().sleepingOccupiedChunks>50);assert.ok(a.report().activeChunks<100);assert.equal(a.report().unsupportedChunks,0);
 assert.ok(a.gridNodes(.25).length<48*16*48);
});
test('removing support wakes disconnected material across chunk boundaries',()=>{
 // Vertical pillar across y chunk boundaries with a supported horizontal branch.
 const coordinates=[[0,.3,0],[0,.55,0],[0,.8,0],[0,1.05,0],[0,1.3,0],[.25,1.3,0],[.5,1.3,0],[.75,1.3,0],[1,1.3,0],[1.25,1.3,0]];
 const positions=new Float32Array(coordinates.flatMap(p=>[...p,1])),states=new Float32Array(coordinates.length*STATE_FLOATS);
 const seed:Seed={positions,states,count:coordinates.length,mass:coordinates.length,volume:1,pose:{x:-5,y:1,z:-5,angle:0}};
 const a=new TerrainActivity(seed);a.update(seed.pose,10);assert.equal(a.report().unsupportedChunks,0);
 const detached=positions.slice(3*4),detachedStates=states.slice(3*STATE_FLOATS);a.observe(detached,detachedStates,10);a.update(seed.pose,10);
 assert.ok(a.report().unsupportedChunks>=2);assert.equal(a.modes[chunkAt(1.25,1.3,0)],1);assert.equal(a.modes[chunkAt(0,1.05,0)],1);
});
test('quiet supported chunks sleep again, moving material stays awake',()=>{
 const seed=seedTerrain(presets.sand),a=new TerrainActivity(seed);const far=chunkAt(4,.25,4);
 a.wake(far);a.update(seed.pose,0);assert.equal(a.modes[far],1);a.update(seed.pose,3);assert.equal(a.modes[far],0);
 const states=seed.states.slice();const i=Array.from({length:seed.count},(_,i)=>i).find(i=>chunkAt(...Array.from(seed.positions.slice(i*4,i*4+3)) as [number,number,number])===far)!;
 states[i*STATE_FLOATS]=.3;a.observe(seed.positions,states,3);a.update(seed.pose,3);assert.equal(a.modes[far],1);assert.ok(neighbors(far).some(n=>a.modes[n]===1));
});

test('transfer halo covers diagonal chunk corners as well as faces',()=>{
 const seed=seedTerrain(presets.sand),a=new TerrainActivity(seed),c=chunkAt(4,2,4);a.wake(c);a.update(seed.pose,0);
 assert.equal(haloNeighbors(c).length,26);assert.equal(a.modes[chunkAt(5,3,5)],2);
});

test('reused occupancy buffers preserve wake/sleep decisions of the previous scheduler',()=>{
 const seed=seedTerrain(presets.soil),a=new TerrainActivity(seed),b=new ReferenceTerrainActivity(seed);
 const positions=seed.positions.slice(),states=seed.states.slice();
 for(let frame=0;frame<24;frame++){
  const time=frame*.25,pose={...seed.pose,x:seed.pose.x+frame*.06};
  for(let i=0;i<positions.length/4;i+=13){positions[4*i+1]+=frame%3===0?.26:0;states[i*STATE_FLOATS]=frame%4===0?.12:0;}
  a.observe(positions,states,time);b.observe(positions,states,time);a.update(pose,time);b.update(pose,time);
  assert.deepEqual(a.modes,b.modes);assert.deepEqual(a.report(),b.report());
 }
});
test('unchanged topology reuses connectivity but still wakes unsupported volumes',()=>{
 const seed=seedTerrain(presets.sand),a=new TerrainActivity(seed),before=a.topologyRebuilds;
 a.observe(seed.positions,seed.states,.25);a.observe(seed.positions,seed.states,.5);
 assert.equal(a.topologyRebuilds,before);
});
