import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.local/artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});let release:(()=>Promise<unknown>)|undefined;
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});const errors:string[]=[];
 page.on('console',m=>{if(m.type()==='log')console.log(m.text());});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('GPU error:',m.text());}});
 console.log('Opening terrain');
 await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready)||document.querySelector('#loading')?.textContent?.includes('could not run'),{},{timeout:120000});
 await page.waitForTimeout(1000);
 if(!await page.evaluate(()=>Boolean((window as any).diggy?.ready)))throw new Error(await page.locator('#loading').textContent()??'Failed');
 if(errors.length)throw new Error(errors.join('\n'));
 await page.evaluate(async()=>{const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})}).then(()=>true));
 const adapter=await page.evaluate(()=>(window as any).diggy.adapter);console.log('GPU ready',JSON.stringify(adapter));if(adapter.vendor!=='amd'||adapter.architecture!=='gcn-5'||adapter.isFallbackAdapter)throw new Error('Integrated Vega not verified');
 await page.evaluate(async()=>{const d=(window as any).diggy;d.pause();await Promise.race([d.reset('terrain','soil'),new Promise((_,reject)=>setTimeout(()=>reject(new Error(document.querySelector('#loading')?.textContent??'Reset timed out')),15000))]);d.setActuation('force');});
 const support=await page.evaluate(()=>(window as any).diggy.terrainSupportProbe());console.log('Unsupported remote clump',JSON.stringify(support));if(support.initial.unsupportedChunks<2||support.final.invalidParticles||support.final.centerOfMass[1]>.6)throw new Error('Unsupported terrain failed to wake/fall');
 console.log('Terrain reset ready');
 const result=await page.evaluate(async()=>{
  const d=(window as any).diggy,before=await d.particles();let maxLoad=0,maxReaction=0,maxInvalid=0;const samples=[];const everActive=new Set<number>();
  for(let i=0;i<300;i++) {
   if(i%30===0)console.log('Terrain batch',i);
   const command=i<110?[.7,-.12,0,0]:i<170?[0,.15,0,.7]:i<240?[-.4,.7,0,0]:[0,0,.4,-.7];
   const result=await d.drive(command,32),s=result.snapshot;
   if(s.invalidParticles||Math.abs(s.massErrorPercent)>.001||s.penetrationMm>=1)throw new Error('Invalid terrain material/contact');
   d.terrainChunks().forEach((mode:number,i:number)=>{if(mode===1)everActive.add(i);});
   maxLoad=Math.max(maxLoad,result.dynamics.carriedMassKg);maxReaction=Math.max(maxReaction,Math.hypot(...result.dynamics.reaction.slice(0,3)));maxInvalid=Math.max(maxInvalid,s.invalidParticles);
   if(i%30===0)samples.push({batch:i,...result,terrain:d.liveReport().terrain});
  }
  const after=await d.particles();let sleepingPoints=0,changedPoints=0,farChanged=0,maxFarStateChange=0;
  for(let i=0;i<before.positions.length/4;i++){
   const o=4*i,x=before.positions[o],z=before.positions[o+2];
   const y=before.positions[o+1],chunk=Math.floor(x+6)+Math.floor(y)*12+Math.floor(z+6)*48;
   if(!everActive.has(chunk)){sleepingPoints++;for(let j=0;j<4;j++)if(before.positions[o+j]!==after.positions[o+j])farChanged++;for(let j=0;j<36;j++)maxFarStateChange=Math.max(maxFarStateChange,Math.abs(before.states[36*i+j]-after.states[36*i+j]));}
   if(Math.hypot(...[0,1,2].map(j=>after.positions[o+j]-before.positions[o+j]))>.05)changedPoints++;
  }
  return {pointCount:before.positions.length/4,maxLoad,maxReaction,maxInvalid,sleepingPoints,farChanged,maxFarStateChange,changedPoints,everActiveChunks:everActive.size,samples,report:d.liveReport()};
 });
 console.log(JSON.stringify({...result,samples:undefined,report:undefined,terrain:result.report.terrain}));
 if(result.sleepingPoints<Math.ceil(result.pointCount*.01)||result.farChanged||result.maxFarStateChange)throw new Error('Sleeping material changed');
 if(result.changedPoints<100||result.maxLoad<50)throw new Error('No useful excavation/transfer');
 if(errors.length)throw new Error(errors.join('\n'));
 await page.evaluate(async()=>{const d=(window as any).diggy;await d.advance(1);d.pause();});
 const visual=await page.evaluate(()=>(window as any).diggy.liveReport().rendering.surface);console.log('Terrain surface',JSON.stringify(visual));if(visual.drawnProxyInstances!==visual.sparseSamples||visual.drawnProxyInstances>=result.pointCount)throw new Error('Proxy compaction is not reflected in the draw count');if(!visual?.triangles||visual.overflowTriangles)throw new Error('Terrain surface missing or overflowed');await page.screenshot({path:'.local/artifacts/terrain-excavation.png'});
 await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/terrain-validation.json',JSON.stringify({result,support,visual,errors},null,2));console.log('Terrain checks passed');
}finally{try{await release?.();}finally{await browser.close();}}
