import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage();await page.addInitScript('window.__name=(fn)=>fn;');
 await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
 await page.evaluate(async()=>{const g=(window as any).diggy;g.pause();const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})}));
 const result=await page.evaluate(async()=>{
  const paths=['/src/physics/solver.ts','/src/render/surface.ts','/src/simulation/terrain.ts','/src/simulation/material.ts','/src/simulation/bucket.ts'];
  const {SoilSolver}=await import(paths[0]),{MaterialSurface}=await import(paths[1]),{seedTerrain}=await import(paths[2]),{presets}=await import(paths[3]),{colliders}=await import(paths[4]);
  const adapter=await (navigator as any).gpu.requestAdapter({powerPreference:'low-power'}),device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});
  const errors:string[]=[];device.addEventListener('uncapturederror',(e:any)=>errors.push(e.error.message));
  const seed=seedTerrain(presets.soil),solver=new SoilSolver(device,seed,.25,true);await solver.init();
  const surfaces=[new MaterialSurface(device,seed,solver.positions,solver.state,true),new MaterialSurface(device,seed,solver.positions,solver.state,true)];surfaces[0].useTightSplatBounds=false;
  const comparisons=[];
  try{
   for(const s of surfaces)await s.init();
   for(let batch=0;batch<6;batch++){
    const pose={...seed.pose,x:seed.pose.x+batch*.12,angle:batch*.15},boxes=colliders(pose,[.5,0,0],.2,false,false);
    solver.updateTerrain(pose,batch*.04);solver.step(32,presets.soil,boxes);await solver.contactFeedback();
    const stats=[];
    for(const s of surfaces){s.update(boxes,.04,true,solver.terrain.modes);await device.queue.onSubmittedWorkDone();stats.push(await s.diagnostics());}
    // Compare the full shared density/shade field, including cached tile halos.
    const bytes=surfaces[0].field.size,read=device.createBuffer({size:bytes*2,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    let differences=0;
    try{const e=device.createCommandEncoder();surfaces.forEach((s:any,i:number)=>e.copyBufferToBuffer(s.field,0,read,bytes*i,bytes));device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
     const data=read.getMappedRange(),a=new Uint32Array(data,0,bytes/4),b=new Uint32Array(data,bytes,bytes/4);for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences++;read.unmap();
    }finally{read.destroy();}
    comparisons.push({batch,differences,stats});
   }
  }finally{surfaces.forEach((s:any)=>s.destroy());solver.destroy();device.destroy();}
  return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},comparisons,errors};
 });
 await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/surface-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 for(const c of result.comparisons){assert.equal(c.differences,0,'Optimized density/shade must match reference exactly');assert.equal(c.stats[0].triangles,c.stats[1].triangles);assert.equal(c.stats[1].overflowTriangles,0);assert.equal(c.stats[0].sparseSamples,c.stats[1].sparseSamples);}
 assert.deepEqual(result.errors,[]);
}finally{try{await release?.();}finally{await browser.close();}}
