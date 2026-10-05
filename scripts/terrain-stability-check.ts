import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean((window as any).diggyGame?.ready),{},{timeout:120000});
 await page.evaluate(async()=>{const g=(window as any).diggyGame;g.pause();await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggyGame.instanceId,active:false})}));
 const equilibrium=[];
 for(const material of ['sand','soil','wet']){
  const sample=await page.evaluate(async material=>{
   const {SoilSolver}=await import('/src/physics/solver.ts' as string),{seedTerrain}=await import('/src/simulation/terrain.ts' as string),{presets}=await import('/src/simulation/material.ts' as string);
   const adapter=await navigator.gpu!.requestAdapter({powerPreference:'low-power'}),device=await adapter!.requestDevice({requiredFeatures:adapter!.features.has('timestamp-query')?['timestamp-query']:[]});
   const seed=seedTerrain(presets[material]),solver=new SoilSolver(device,seed,.25,true);await solver.init();let time=0,maxChunks=0;
   try{
    for(let batch=0;batch<72;batch++){
     solver.updateTerrain({x:-8,y:1.8,z:0,angle:0},time,[{x:-8,y:.8,z:0,angle:0}]);solver.step(32,presets[material],[]);time+=32*solver.timestep(presets[material]);await solver.contactFeedback();
     if(batch%8===7)await solver.terrainFeedback();maxChunks=Math.max(maxChunks,solver.terrain.report().activeChunks);
    }
    const snapshot=await solver.snapshot([]),after=await solver.readParticles();let farMoved=0,maxFar=0;
    for(let i=0;i<seed.count;i++){const o=i*4;if(Math.hypot(seed.positions[o]+8,seed.positions[o+2])<=4)continue;
     const delta=Math.hypot(...[0,1,2].map(a=>after.positions[o+a]-seed.positions[o+a]));maxFar=Math.max(maxFar,delta);if(delta>.01)farMoved++;
    }
    return {material,maxChunks,farMoved,maxFar,snapshot,feedback:solver.terrainFeedbackReport};
   }finally{solver.destroy();device.destroy();}
  },material);
  assert.equal(sample.farMoved,0,'Unchanged soil must not start a remote moving front');assert.ok(sample.maxChunks<100,'Activation must remain local');assert.equal(sample.snapshot.invalidParticles,0);assert.ok(Math.abs(sample.snapshot.massErrorPercent)<.001);equilibrium.push(sample);console.log('equilibrium',JSON.stringify(sample));
 }
 const collapse=await page.evaluate(async()=>{
  const {SoilSolver}=await import('/src/physics/solver.ts' as string),{seedScenario}=await import('/src/simulation/scenarios.ts' as string),{presets}=await import('/src/simulation/material.ts' as string);
  const adapter=await navigator.gpu!.requestAdapter({powerPreference:'low-power'}),device=await adapter!.requestDevice(),seed=seedScenario('clump',128,presets.wet),solver=new SoilSolver(device,seed,.25,true);await solver.init();const initial=solver.terrain.report();let time=0;
  try{
   for(let batch=0;batch<48;batch++){solver.updateTerrainContacts([],time);solver.step(64,presets.wet,[]);time+=64*solver.timestep(presets.wet);await solver.contactFeedback();if(batch%4===3)await solver.terrainFeedback();}
   return {initial,final:await solver.snapshot([])};
  }finally{solver.destroy();device.destroy();}
 });
 assert.ok(collapse.initial.unsupportedChunks>0);assert.ok(collapse.final.centerOfMass[1]<-1,'Unsupported volumes must still fall to the deeper bedrock');assert.equal(collapse.final.invalidParticles,0);assert.ok(Math.abs(collapse.final.massErrorPercent)<.001);
 // Use normal realtime controls here: full snapshots are deliberately reserved
 // for explicit validation, rather than included in every gameplay update.
 await page.evaluate(()=>(window as any).diggyGame.reset('soil'));await page.evaluate(()=>(window as any).diggyGame.resume());await page.keyboard.down('ArrowUp');
 await page.waitForTimeout(11000);await page.keyboard.up('ArrowUp');await page.waitForTimeout(2000);
 const driving=await page.evaluate(()=>(window as any).diggyGame.report());assert.ok(driving.machine.base.x>-9,'Realtime driving must enter the clearing');assert.ok(driving.terrain.activeChunks<100,'Driving must not activate the whole site');
 assert.ok(driving.terrainFeedback.readbackBytes<1000000,'Gameplay feedback must not copy full histories');
 await page.evaluate(()=>(window as any).diggyGame.pause());await mkdir('.local/artifacts',{recursive:true});await page.screenshot({path:'.local/artifacts/terrain-fix-driving.png'});
 const dig=await page.evaluate(async()=>{const g=(window as any).diggyGame;const actions=[{boom:-1,stick:0,curl:0,swing:0},{boom:0,stick:1,curl:0,swing:0},{boom:0,stick:0,curl:1,swing:0},{boom:1,stick:0,curl:0,swing:0},{boom:0,stick:0,curl:-1,swing:0}];const samples=[];for(const command of actions){const result=await g.drive(command,80);samples.push(result);}return samples;});
 for(const sample of dig){assert.equal(sample.snapshot.invalidParticles,0);assert.ok(Math.abs(sample.snapshot.massErrorPercent)<.001);assert.equal(sample.surface.overflowTriangles,0);assert.ok(sample.surface.cachedTiles>0,'Local action must reuse remote surface tiles');}
 assert.ok(dig[3].snapshot.bucketMass>50,'The digging sequence must lift material above the original surface');
 await page.screenshot({path:'.local/artifacts/terrain-fix-digging.png'});assert.equal(errors.length,0,errors.join('\n'));
 const adapter=await page.evaluate(()=>(window as any).diggyGame.adapter);await writeFile('.local/artifacts/terrain-stability-validation.json',JSON.stringify({adapter,equilibrium,collapse,driving,dig,errors},null,2));console.log(JSON.stringify({adapter,driving,collapse}));
}finally{try{await release?.();}finally{await browser.close();}}
