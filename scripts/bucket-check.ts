import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // tsx names nested functions with this helper when serializing evaluate.
 await page.addInitScript('window.__name = (fn) => fn;');
 await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
 await page.evaluate(async()=>{const g=(window as any).diggy;g.pause();const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})}));
 const result=await page.evaluate(async()=>{
  const solverPath='/src/physics/solver.ts',materialPath='/src/simulation/material.ts',bucketPath='/src/simulation/bucket.ts',transformPath='/src/simulation/rigid-transform.ts';
  const {SoilSolver}=await import(solverPath),{presets,density,finesFromGrain}=await import(materialPath),{colliders}=await import(bucketPath),{yawPitchBasis,transform}=await import(transformPath);
  const adapter=await (navigator as any).gpu.requestAdapter({powerPreference:'low-power'}),device=await adapter.requestDevice();
  const errors:string[]=[];device.addEventListener('uncapturederror',(e:any)=>errors.push(e.error.message));
  const makeSeed=(preset:string,angle:number,layers=4)=>{
   const material=presets[preset],pose={x:0,y:1.5,z:0,angle},basis=yawPitchBasis(0,angle);
   const positions:number[]=[],states:number[]=[],volume=.12**3;
   for(let x=0;x<7;x++)for(let y=0;y<layers;y++)for(let z=0;z<7;z++){
    const p=transform(basis,[-.4+x*.12,-.2+y*.12,-.36+z*.12]);
    positions.push(pose.x+p[0],pose.y+p[1],pose.z+p[2],volume*density(material.moisture));
    const state=Array(36).fill(0);state[3]=volume;state[4]=state[9]=state[14]=state[32]=1;state[28]=material.moisture;state[29]=finesFromGrain(material.grainMm);states.push(...state);
   }
   return {positions:Float32Array.from(positions),states:Float32Array.from(states),count:positions.length/4,mass:positions.length/4*volume*density(material.moisture),volume:positions.length/4*volume,pose};
  };
  const runs=[];
  for(const dx of [.125,.25])for(const preset of ['sand','soil','wet']){
   const seed=makeSeed(preset,.4),s=new SoilSolver(device,seed,dx);await s.init();
   try{
    let pose={...seed.pose};const samples:any[]=[];
    const advance=async(name:string,seconds:number,target:any)=>{
     const start={...pose},dt=s.timestep(presets[preset]),total=Math.ceil(seconds/dt),batch=32;
     for(let step=0;step<total;step+=batch){
      const n=Math.min(batch,total-step),t=(step+n)/total;pose={x:start.x+(target.x-start.x)*t,y:start.y+(target.y-start.y)*t,z:0,angle:start.angle+(target.angle-start.angle)*t};
      const v:[number,number,number]=[(target.x-start.x)/(total*dt),(target.y-start.y)/(total*dt),0],omega=(target.angle-start.angle)/(total*dt);
      s.step(n,presets[preset],colliders(pose,v,omega,false,false));await device.queue.onSubmittedWorkDone();
     }
     const snapshot=await s.snapshot(colliders(pose,[0,0,0],0,false,false));samples.push({name,snapshot});return snapshot;
    };
    await advance('settle',.8,pose);
    await advance('carry',.8,{...pose,x:.5,y:1.8});
    await advance('tip',.6,{...pose,angle:-1.6});
    await advance('dump',1.2,pose);
    const transported=await s.readParticles();
    for(let i=0;i<seed.count;i++)for(const offset of [28,29])if(transported.states[36*i+offset]!==seed.states[36*i+offset])throw new Error('Transport changed material composition');
    runs.push({preset,dx,initialMass:seed.mass,samples});
   }finally{s.destroy();}
  }
  // Overfill may spill through the open rim; no artificial chamber clamp.
  const seed=makeSeed('sand',0,8),s=new SoilSolver(device,seed,.125);await s.init();
  let overfill;
  try{s.step(Math.ceil(1.2/s.timestep(presets.sand)),presets.sand,colliders(seed.pose,[0,0,0],0,false,false));await device.queue.onSubmittedWorkDone();overfill={initialMass:seed.mass,snapshot:await s.snapshot(colliders(seed.pose,[0,0,0],0,false,false))};}finally{s.destroy();}
  const peeling=[];
  for(const [adhesion,moisture]of [[0,.62],[.55,.62],[.55,0]]){
   const source=makeSeed('wet',Math.PI),point=transform(yawPitchBasis(0,Math.PI),[0,-.275,0]);
   const mass=source.positions[3],probeSeed={...source,positions:Float32Array.from([point[0],source.pose.y+point[1],point[2],mass]),states:source.states.slice(0,36),count:1,mass,volume:.12**3};
   probeSeed.states[28]=moisture;
   const probe=new SoilSolver(device,probeSeed,.125);await probe.init();
   try{
    const settings={...presets.wet,adhesion},boxes=colliders(probeSeed.pose,[0,0,0],0,false,false);
    probe.step(1,settings,boxes);await device.queue.onSubmittedWorkDone();const initial=await probe.snapshot(boxes);
    probe.step(Math.ceil(.03/probe.timestep(settings)),settings,boxes);await device.queue.onSubmittedWorkDone();const early=await probe.snapshot(boxes);
    probe.step(Math.ceil(.5/probe.timestep(settings)),settings,boxes);await device.queue.onSubmittedWorkDone();const released=await probe.snapshot(boxes);
    peeling.push({adhesion,moisture,initial,early,released});
   }finally{probe.destroy();}
  }
  const source=makeSeed('sand',0),mass=source.positions[3],probeSeed={...source,positions:Float32Array.from([0,1.34,0,mass]),states:source.states.slice(0,36),count:1,mass,volume:.12**3};
  probeSeed.states[1]=-700;
  const probe=new SoilSolver(device,probeSeed,.125);await probe.init();let sweep;
  try{const boxes=colliders(probeSeed.pose,[0,0,0],0,false,false);probe.step(1,presets.sand,boxes);await device.queue.onSubmittedWorkDone();sweep=await probe.snapshot(boxes);}finally{probe.destroy();}
  await device.queue.onSubmittedWorkDone();const info=adapter.info;device.destroy();return {adapter:{vendor:info.vendor,architecture:info.architecture,description:info.description},runs,overfill,peeling,sweep,errors};
 });
 await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/bucket-validation.json',JSON.stringify(result,null,2));
 for(const r of result.runs){
  console.log(r.preset,r.dx,r.samples.map((s:any)=>({stage:s.name,mass:s.snapshot.bucketMass,volume:s.snapshot.bucketRestVolume})));
  for(const {snapshot:s}of r.samples){assert.equal(s.invalidParticles,0);assert.ok(Math.abs(s.massErrorPercent)<.001);assert.ok(s.penetrationMm<1);}
  const [settled,carried,,dumped]=r.samples.map((s:any)=>s.snapshot.bucketMass);
  assert.ok(settled>r.initialMass*.5,`${r.preset}: upright retention`);
  assert.ok(carried>settled*.75,`${r.preset}: retained carry`);
  assert.ok(dumped<carried*.15,`${r.preset}: oriented dump`);
 }
 assert.equal(result.overfill.snapshot.invalidParticles,0);assert.ok(Math.abs(result.overfill.snapshot.massErrorPercent)<.001);
 assert.ok(result.overfill.snapshot.bucketMass<result.overfill.initialMass*.85,'Overfill must spill');
 console.log('Peeling',result.peeling.map((p:any)=>({adhesion:p.adhesion,earlyY:p.early.centerOfMass[1],releasedY:p.released.centerOfMass[1]})),'sweep',result.sweep.centerOfMass);
 assert.ok(result.peeling[1].early.centerOfMass[1]>result.peeling[0].early.centerOfMass[1]+.0001,'Wet adhesion must delay separating from inverted metal');
 assert.ok(Math.abs(result.peeling[2].early.centerOfMass[1]-result.peeling[0].early.centerOfMass[1])<.00001,'Dry material must not inherit wet adhesion');
 for(const p of result.peeling){
  assert.ok(p.released.centerOfMass[1]<p.initial.centerOfMass[1]-.5,'Adhesion must release unsupported material');
  for(const s of [p.initial,p.early,p.released]){assert.equal(s.invalidParticles,0);assert.ok(Math.abs(s.massErrorPercent)<.001);}
 }
 assert.ok(result.sweep.centerOfMass[1]>=1.23-1e-5,'Fast sample must stay on the interior side of the floor');
 assert.equal(result.sweep.invalidParticles,0);assert.ok(Math.abs(result.sweep.massErrorPercent)<.001);
 assert.deepEqual(result.errors,[]);assert.deepEqual(errors,[]);
 console.log('Bucket retention, carry, dump, and overfill passed');
}finally{try{await release?.();}finally{await browser.close();}}
