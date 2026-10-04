import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready)||document.querySelector('#loading')?.textContent?.includes('could not run'),{},{timeout:120000});
  if(!(await page.evaluate(()=>Boolean((window as any).diggy?.ready))))throw new Error(await page.locator('#loading').textContent()??'Failed');
  await page.evaluate(()=>(window as any).diggy.pause());
  await mkdir('.local/artifacts',{recursive:true});
  const results:Record<string,unknown>={adapter:await page.evaluate(()=>(window as any).diggy.adapter),tests:[]};
  const single=await page.evaluate(()=>(window as any).diggy.singleParticle());
  const expected=single.initialY-0.5*9.81*single.seconds**2;
  assert.ok(Math.abs(single.snapshot.centerOfMass[1]-expected)<0.025,'Unsupported sample must fall under gravity');assert.equal(single.snapshot.invalidParticles,0);
  results.singleParticle={...single,expectedY:expected};
  // An isolated amount must retain either a reconstructed surface or a shaded
  // volume proxy at different phases within a visual voxel, without spill effects.
  const isolated=[];
  for(const budget of [4096,16384])for(const offset of [0,0.015,0.03,0.045]){
    const sample=await page.evaluate(([offset,budget])=>(window as any).diggy.singleParticle(offset,budget),[offset,budget]);
    assert.ok(sample.surface.triangles>0||sample.surface.sparseSamples===1,'Detached physical volume must remain visible');
    if(sample.surface.triangles===0)assert.ok(sample.visibleRadius>=sample.referenceRadius*0.99,'A missing surface must retain the full detached-volume proxy');
    assert.equal(sample.surface.overflowTriangles,0);assert.equal(sample.snapshot.invalidParticles,0);
    isolated.push({budget,offset,surface:sample.surface,visibleRadius:sample.visibleRadius,referenceRadius:sample.referenceRadius});
  }
  results.isolatedVisibility=isolated;
  const volumeHistory=await page.evaluate(()=>(window as any).diggy.volumeHistory());
  assert.ok(volumeHistory[0].dilation>0.5,'Expansion must retain stress-free volume history');
  assert.ok(Math.abs(volumeHistory[1].elasticStretch[0]-1)<0.01,'Small recompression must close the free gap without pressure');
  assert.ok(volumeHistory[1].dilation<volumeHistory[0].dilation,'Recompression must consume dilation');
  assert.ok(volumeHistory[2].elasticStretch[0]<0.99&&volumeHistory[2].dilation<0.01,'Further compression must recover load-bearing pressure');
  results.volumeHistory=volumeHistory;
  for(const [scenario,preset,dx,points] of [['pour','sand',0.125,4096],['pile','sand',0.125,4096],['pile','sand',0.1,8192],['clump','wet',0.125,4096],['collapse','sand',0.125,4096],['mix','soil',0.125,4096]] as const){
    console.log('Checking',scenario,preset,dx,points);
    await page.evaluate(async([scenario,preset,dx,points])=>{await (window as any).diggy.reset(scenario,preset,points,dx);(window as any).diggy.pause();},[scenario,preset,dx,points]);
    if(scenario==='collapse')await page.evaluate(()=>(window as any).diggy.removeSupport());
    const dt=await page.evaluate(()=>(window as any).diggy.report().solver.dt);
    let snapshot;for(let i=0;i<Math.ceil(3.9/(120*dt));i++)snapshot=await page.evaluate(()=>(window as any).diggy.advance(120));
    const report=await page.evaluate(()=>(window as any).diggy.report());
    const samples=await page.evaluate(()=>(window as any).diggy.particles());
    const ys=samples.positions.filter((_:number,i:number)=>i%4===1);
    const xs=samples.positions.filter((_:number,i:number)=>i%4===0);
    const groundGap=Math.min(...ys)-0.15;
    const profile=new Map<number,number[]>();
    for(let i=0;i<samples.positions.length;i+=4){
      if(Math.abs(samples.positions[i+2])>0.18)continue;
      const radius=Math.abs(samples.positions[i]);if(radius<0.3||radius>1.35)continue;
      const bin=Math.floor(radius/0.15);const values=profile.get(bin)??[];values.push(samples.positions[i+1]);profile.set(bin,values);
    }
    const flank=[...profile.entries()].map(([bin,values])=>{values.sort((a,b)=>a-b);return [(bin+0.5)*0.15,values[Math.floor((values.length-1)*0.9)]];});
    const mx=flank.reduce((s,p)=>s+p[0],0)/flank.length,my=flank.reduce((s,p)=>s+p[1],0)/flank.length;
    const slope=flank.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/flank.reduce((s,p)=>s+(p[0]-mx)**2,0);
    const approximateFlankAngleDeg=Math.atan(-slope)*180/Math.PI;
    assert.equal(snapshot.invalidParticles,0);assert.ok(Math.abs(snapshot.massErrorPercent)<0.001);assert.ok(snapshot.penetrationMm<1);
    assert.ok(report.rendering.surface.triangles>0,'Surface must contain triangles');assert.equal(report.rendering.surface.overflowTriangles,0);
    if(scenario==='pour'||scenario==='pile')assert.ok(groundGap<0.035,'Sand must not rest on an invisible grid-cell halo');
    if(scenario==='collapse'){
      assert.ok(snapshot.centerOfMass[1]<0.8,'Unsupported dry bridge must collapse');
      let unsupported=0;
      for(let i=0;i<samples.positions.length;i+=4)if(Math.abs(samples.positions[i])<0.55&&Math.abs(samples.positions[i+2])<0.5&&samples.positions[i+1]>0.6)unsupported++;
      assert.ok(unsupported/(samples.positions.length/4)<0.02,'Dry sand must not preserve the central unsupported bridge');
    }
    (results.tests as unknown[]).push({scenario,preset,dx,points,snapshot,rendering:report.rendering,groundGapM:groundGap,spreadX:Math.max(...xs)-Math.min(...xs),maxHeightAboveFloorM:Math.max(...ys)-0.15,approximateFlankAngleDeg});
    await page.screenshot({path:`.local/artifacts/${scenario}-${preset}-${dx}-surface.png`});
    await page.evaluate(()=>(window as any).diggy.setView('points'));await page.waitForTimeout(100);
    await page.screenshot({path:`.local/artifacts/${scenario}-${preset}-${dx}-points.png`});
    await page.evaluate(()=>(window as any).diggy.setView('surface'));
  }
  const piles=(results.tests as any[]).filter(t=>t.scenario==='pile');
  assert.ok(Math.abs(piles[0].snapshot.centerOfMass[1]-piles[1].snapshot.centerOfMass[1])<0.05,'Settled bulk height should be similar across the two tested discretizations');
  assert.ok(Math.abs(piles[0].spreadX/piles[1].spreadX-1)<0.15,'Settled pile footprint should be similar');
  // Rendering and massless effects must not mutate physical material state.
  const before=await page.evaluate(()=>(window as any).diggy.particles());
  await page.evaluate(()=>(window as any).diggy.setDetail(false));await page.waitForTimeout(100);
  const after=await page.evaluate(()=>(window as any).diggy.particles());assert.deepEqual(after,before);
  results.errors=errors;await writeFile('.local/artifacts/material-check.json',JSON.stringify(results,null,2));
  assert.deepEqual(errors,[]);console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
