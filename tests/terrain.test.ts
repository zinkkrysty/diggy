import {ReferenceTerrainActivity} from './terrain-reference';
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedTerrain,TerrainActivity,chunkAt,neighbors,haloNeighbors,TERRAIN_ORIGIN,TERRAIN_FLOOR} from '../src/simulation/terrain';
import {presets} from '../src/simulation/material';
import {STATE_FLOATS,type Seed} from '../src/simulation/scenarios';
test('terrain owns a reproducible volumetric mass independent of active chunks',()=>{
 const seed=seedTerrain(presets.soil),other=seedTerrain(presets.soil);assert.deepEqual(seed.positions,other.positions);assert.ok(seed.count>6000);assert.ok(Math.abs(seed.mass/seed.volume-1510)<100);
 for(let i=0;i<seed.count;i++)for(const axis of [0,2])assert.ok(Math.abs(seed.positions[4*i+axis])<=12,'Seed must start inside the physical boundary margin');
 const a=new TerrainActivity(seed);a.update(seed.pose,0);assert.ok(a.report().sleepingOccupiedChunks>50);assert.ok(a.report().activeChunks<100);assert.equal(a.report().unsupportedChunks,0);
 assert.ok(a.gridNodes(.25).length<96*24*96);
});
test('removing support wakes disconnected material across chunk boundaries',()=>{
 // Vertical pillar across y chunk boundaries with a supported horizontal branch.
 const coordinates=[[0,.3,0],[0,.55,0],[0,.8,0],[0,1.05,0],[0,1.3,0],[.25,1.3,0],[.5,1.3,0],[.75,1.3,0],[1,1.3,0],[1.25,1.3,0]];
 const positions=new Float32Array(coordinates.flatMap(p=>[p[0],p[1]+TERRAIN_ORIGIN[1],p[2],1])),states=new Float32Array(coordinates.length*STATE_FLOATS);
 const seed:Seed={positions,states,count:coordinates.length,mass:coordinates.length,volume:1,pose:{x:-5,y:1,z:-5,angle:0}};
 const a=new TerrainActivity(seed);a.update(seed.pose,10);assert.equal(a.report().unsupportedChunks,0);
 const detached=positions.slice(3*4),detachedStates=states.slice(3*STATE_FLOATS);a.observe(detached,detachedStates,10);a.update(seed.pose,10);
 assert.ok(a.report().unsupportedChunks>=2);assert.equal(a.modes[chunkAt(1.25,1.3+TERRAIN_ORIGIN[1],0)],1);assert.equal(a.modes[chunkAt(0,1.05+TERRAIN_ORIGIN[1],0)],1);
});
test('quiet supported chunks sleep again, moving material stays awake',()=>{
 const seed=seedTerrain(presets.sand),a=new TerrainActivity(seed);const far=chunkAt(4,.25,4);
 a.wake(far);a.update(seed.pose,0);assert.equal(a.modes[far],1);a.update(seed.pose,3);assert.equal(a.modes[far],0);
 const states=seed.states.slice();const i=Array.from({length:seed.count},(_,i)=>i).find(i=>chunkAt(...Array.from(seed.positions.slice(i*4,i*4+3)) as [number,number,number])===far)!;
 states[i*STATE_FLOATS]=.3;a.observe(seed.positions,states,3);a.update(seed.pose,3);assert.equal(a.modes[far],1);assert.ok(neighbors(far).every(n=>a.modes[n]===2),'Motion must retain fixed support without propagating activation');
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

test('excavation pad has a central sand pile and a level road approach',()=>{
 const seed=seedTerrain(presets.soil);let sand=0,roadTop=0,pileTop=0;
 for(let i=0;i<seed.count;i++){
  const [x,y,z]=seed.positions.slice(i*4,i*4+3);
  assert.ok(x>-12,'Soil stays east of the roadside shoulder');
  if(x<-2.2&&Math.abs(z)<1.55)roadTop=Math.max(roadTop,y);
  if(y>.55){
   sand++;pileTop=Math.max(pileTop,y);
   assert.ok(Math.hypot(x-.8,z)<2.1,'Sand stays centered in the dirt clearing');
   assert.equal(seed.states[i*STATE_FLOATS+28],0);
   assert.ok(Math.abs(seed.states[i*STATE_FLOATS+29]-.1)<1e-6);
  }
 }
 assert.ok(sand>500);assert.ok(pileTop>1.6);assert.ok(Math.abs(roadTop-.45)<1e-5);
});

test('deeper dirt preserves the original surface and pile while extending below ground',()=>{
 const seed=seedTerrain(presets.soil);let bottom=Infinity,flatTop=-Infinity,pileTop=-Infinity;
 for(let i=0;i<seed.count;i++){
  const x=seed.positions[4*i],y=seed.positions[4*i+1],z=seed.positions[4*i+2];
  bottom=Math.min(bottom,y);pileTop=Math.max(pileTop,y);
  if(Math.abs(x)>4||Math.abs(z)>4)flatTop=Math.max(flatTop,y);
 }
 assert.ok(Math.abs(bottom+1.75)<1e-6,'Ten extra layers extend the dirt down two metres');
 assert.ok(Math.abs(flatTop-.45)<1e-6,'The original top soil samples do not move');
 assert.ok(Math.abs(pileTop-1.65)<1e-6,'Sand pile height stays unchanged');
 assert.ok(chunkAt(0,-1.75,0)>=0);assert.equal(chunkAt(0,TERRAIN_ORIGIN[1]-.1,0),-1);
 assert.ok(TERRAIN_FLOOR<bottom);
});

test('buried seed balances overburden without changing occupied volume',()=>{
 const seed=seedTerrain(presets.soil);let buried=0;
 for(let i=0;i<seed.count;i++){
  const o=i*STATE_FLOATS,stretch=seed.states[o+4];
  assert.ok(Math.abs(seed.states[o+3]*stretch**3-.008)<1e-8,'Preload must preserve the rendered particle volume');
  if(seed.positions[4*i+1]<-1){buried++;assert.ok(stretch<.999,'Buried soil must carry initial compressive stress');}
 }
 assert.ok(buried>10000);
});

test('contact activation stays at the surface and does not wake hovering geometry',()=>{
 const a=new TerrainActivity(seedTerrain(presets.soil));
 a.updateContacts([{center:[-8,2,0],half:[1,.2,.3],angle:0,omega:0,bucket:false,velocity:[0,0,0]}],0);
 assert.equal(a.report().activeChunks,0);
 a.updateContacts([{center:[-8,.8,0],half:[1.35,.25,.28],angle:0,omega:0,bucket:false,velocity:[.65,0,0]}],1);
 assert.ok(a.report().activeChunks>0);assert.ok(a.report().activeChunks<20);
 assert.notEqual(a.modes[chunkAt(-8,-1,0)],1,'Tracks must not activate a deep soil sphere');
 assert.equal(a.modes[chunkAt(4,.3,4)],0,'Remote terrain remains asleep');
});

test('incremental terrain feedback matches a full scan across chunk crossings and cuts',()=>{
 const seed=seedTerrain(presets.soil),full=new TerrainActivity(seed),local=new TerrainActivity(seed);
 const positions=seed.positions.slice(),states=seed.states.slice(),velocities=new Float32Array(seed.count*3);
 const indices=Uint32Array.from(Array.from({length:Math.ceil(seed.count/31)},(_,i)=>i*31).filter(i=>i<seed.count));
 for(let frame=0;frame<12;frame++){
  for(const i of indices){positions[i*4]+=.06;positions[i*4+1]+=frame%3===0?.26:0;states[i*STATE_FLOATS]=velocities[i*3]=frame%4===0?.12:0;}
  const time=frame*.25;full.observe(positions,states,time);local.observeChanges(positions,velocities,indices,time);
  full.update(seed.pose,time);local.update(seed.pose,time);assert.deepEqual(local.modes,full.modes);assert.deepEqual(local.report(),full.report());
 }
});

test('sparse grid-node enumeration preserves reference order across resolutions and masks',()=>{
 const terrain=new TerrainActivity(seedTerrain(presets.soil));
 for(const dx of [.25,.125,.1,.16]){
  const dims=[24,6,24].map(v=>Math.round(v/dx));
  for(const pattern of [0,1,2]){
   for(let c=0;c<terrain.modes.length;c++)terrain.modes[c]=pattern===0?0:pattern===1?Number(c%17===0)*2:1;
   const reference:number[]=[];
   for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
    const c=Math.floor(x*dx)+Math.floor(y*dx)*24+Math.floor(z*dx)*144;
    if(terrain.modes[c])reference.push(x+y*dims[0]+z*dims[0]*dims[1]);
   }
   assert.deepEqual(terrain.gridNodes(dx),Uint32Array.from(reference));
  }
 }
});

test('support removal wakes the chunk above a cut without waking supported neighbors',()=>{
 const seed=seedTerrain(presets.soil),positions=seed.positions.slice(),indices:number[]=[];
 const voxel=(x:number,y:number,z:number)=>[Math.floor((x+12)/.25),Math.floor((y-TERRAIN_ORIGIN[1])/.25),Math.floor((z+12)/.25)].join(',');
 const cut=voxel(-.1,-.15,.1);
 for(let i=0;i<seed.count;i++)if(voxel(...Array.from(positions.slice(i*4,i*4+3)) as [number,number,number])===cut){indices.push(i);positions[i*4+1]=10;}
 assert.ok(indices.length>0);
 for(const incremental of [false,true]){
  const activity=new TerrainActivity(seed);
  if(incremental)activity.observeChanges(positions,new Float32Array(seed.count*3),Uint32Array.from(indices),10);
  else activity.observe(positions,seed.states,10);
  activity.updateContacts([],10);
  assert.equal(activity.report().unsupportedChunks,0,'Surrounding columns still support the cut');
  assert.equal(activity.modes[chunkAt(-.1,.05,.1)],1,'The material directly above the cut wakes across the vertical chunk boundary');
  assert.notEqual(activity.modes[chunkAt(.1,.05,.1)],1,'Supported adjoining soil remains a fixed halo');
  assert.notEqual(activity.modes[chunkAt(-.1,-.15,.1)],1,'The chunk below the cut does not wake unnecessarily');
 }
});
