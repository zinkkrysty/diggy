import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors:string[]=[];
 await page.addInitScript('window.__name=(fn)=>fn;');
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>Boolean((window as any).diggyGame?.ready),{},{timeout:120000});
 await page.evaluate(async()=>{
  const g=(window as any).diggyGame;g.pause();
  const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});
  if(!r.ok)throw new Error('Isolation failed');
 });
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggyGame.instanceId,active:false})}));
 const adapter=await page.evaluate(()=>(window as any).diggyGame.adapter),results=[];
 const idle={boom:0,stick:0,curl:0,swing:0};
 for(const [name,command,batches,forward]of [
  ['approach',idle,130,1],
  ['lower',{...idle,boom:-1},100,0],
  ['cut',{...idle,stick:1},70,0],
  ['scoop',{...idle,stick:-1,curl:1},75,0],
  ['lift',{...idle,boom:1},90,0],
  ['dump',{...idle,curl:-1},150,0],
 ]as const){
  const r=await page.evaluate(([c,n,f])=>(window as any).diggyGame.drive(c,n,f),[command,batches,forward]);
  assert.equal(r.snapshot.invalidParticles,0,`${name}: finite state`);
  assert.ok(Math.abs(r.snapshot.massErrorPercent)<.001,`${name}: mass conservation`);
  assert.equal(r.surface.overflowTriangles,0);
  assert.ok(r.machine.joints.every(Number.isFinite));
  const h=r.machine.hydraulics;
  assert.ok(h.flowDemand*h.allocation<=1.6+1e-9);
  assert.ok(h.powerDemandWatts*h.allocation<=45000+1e-9);
  results.push({name,...r});console.log(JSON.stringify({name,load:r.machine.carriedMassKg,reaction:r.machine.reaction,hydraulics:h}));
 }
 assert.ok(results.some(r=>r.machine.reaction.some((v:number)=>Math.abs(v)>100)),'Sequence must contact material');
 assert.ok(results.some(r=>r.machine.carriedMassKg>10),'Sequence must retain a measurable bucket load');
 assert.ok(results.at(-1)!.machine.carriedMassKg<results.find(r=>r.name==='lift')!.machine.carriedMassKg,'Dump must release the carried load');
 // Measure the rendered game at wall-clock speed, including time debt.
 // Return to the cut rather than benchmarking the empty roadside spawn.
 await page.evaluate(()=>(window as any).diggyGame.drive({boom:-1,stick:0,curl:0,swing:0},100));
 await page.locator('canvas').click();await page.evaluate(()=>(window as any).diggyGame.resume());
 for(const keys of [['KeyD'],['KeyA','KeyR'],['KeyW'],['KeyF'],['KeyQ','KeyS'],['KeyD','KeyE'],['KeyA','KeyR'],['KeyW']]){
  for(const key of keys)await page.keyboard.down(key);
  await page.waitForTimeout(3000);
  for(const key of keys)await page.keyboard.up(key);
 }
 const benchmark=await page.evaluate(()=>{
  const g=(window as any).diggyGame,result=g.report();g.pause();return result;
 });
 assert.ok(benchmark.performance.samples>30,'Active benchmark must record rendered frames');
 const final=await page.evaluate(()=>(window as any).diggyGame.drive({boom:0,stick:0,curl:0,swing:0},1));
 assert.equal(final.snapshot.invalidParticles,0);assert.ok(Math.abs(final.snapshot.massErrorPercent)<.001);
 const remote=await page.evaluate(async()=>{
  const g=(window as any).diggyGame,{seedTerrain}=await import('/src/simulation/terrain.ts' as string),{presets}=await import('/src/simulation/material.ts' as string);
  const seed=seedTerrain(presets.soil),after=await g.particles();let moved=0,maxDisplacement=0;const chunks:Record<string,{count:number;max:number}>={};
  for(let i=0;i<seed.count;i++){
   const o=i*4;if(Math.abs(seed.positions[o+2])<6)continue;
   const d=Math.hypot(after.positions[o]-seed.positions[o],after.positions[o+1]-seed.positions[o+1],after.positions[o+2]-seed.positions[o+2]);
   if(d>1e-6){moved++;const key=[Math.floor(seed.positions[o]),Math.floor(seed.positions[o+2])].join(',');const c=chunks[key]??={count:0,max:0};c.count++;c.max=Math.max(c.max,d);}maxDisplacement=Math.max(maxDisplacement,d);
  }
  return {moved,maxDisplacement,chunks,terrain:g.report().terrain,machine:g.report().machine};
 });
 console.log('remote terrain',JSON.stringify(remote));
 await page.screenshot({path:'.local/artifacts/digging-swing-edge.png'});
 assert.equal(remote.moved,0,'Digging must leave the distant site edge unchanged');
 console.log(JSON.stringify({performance:benchmark.performance,debt:benchmark.debt,renderScale:benchmark.renderScale}));
 assert.equal(errors.length,0,errors.join('\n'));
 await mkdir('.local/artifacts',{recursive:true});
 await writeFile('.local/artifacts/hydraulics-validation.json',JSON.stringify({adapter,results,benchmark,final,remote,errors},null,2));
}finally{try{await release?.();}finally{await browser.close();}}
