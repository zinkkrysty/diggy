import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let releaseIsolation:(()=>Promise<void>)|undefined;
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
  await page.evaluate(async()=>{
    const response=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:true})});
    if(!response.ok)throw new Error('Could not isolate GPU measurement');
  });
  releaseIsolation=()=>page.evaluate(async()=>{await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})});});
  await page.waitForTimeout(250);
  const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getInfo');
  const identity={adapter:await page.evaluate(()=>(window as any).diggy.adapter),renderer:info.gpu.auxAttributes?.glRenderer,devices:info.gpu.devices};
  if(identity.adapter.vendor!=='amd'||identity.adapter.architecture!=='gcn-5'||identity.adapter.isFallbackAdapter)throw new Error('Vega target not verified');
  console.log('Adapter',JSON.stringify(identity));
  await mkdir('.local/artifacts',{recursive:true});const measurements:unknown[]=[];
  const configs=(process.argv.includes('--terrain')||process.argv.includes('--quick')||process.argv.includes('--collapse'))?[['sand',0.125,4096,'surface',true],['soil',0.125,4096,'surface',true],['wet',0.125,4096,'surface',true]]:[['sand',0.125,4096,'points',false],['sand',0.125,4096,'surface',false],['sand',0.125,4096,'surface',true],['sand',0.1,4096,'surface',true],['sand',0.125,8192,'surface',true],['wet',0.125,4096,'surface',true]];
  const runs=process.argv.includes('--optimization-ab')?configs.flatMap(config=>[{config,optimized:false},{config,optimized:true}]):configs.map(config=>({config,optimized:true}));
  for(const {config:[preset,dx,points,view,detail],optimized}of runs){
    const scenario=process.argv.includes('--terrain')?'terrain':process.argv.includes('--collapse')?'collapse':'scoop';
    await page.evaluate(async([preset,dx,points,view,detail,scenario])=>{
      (window as any).diggy.pause();await (window as any).diggy.reset(scenario,preset,points,dx);(window as any).diggy.setView(view);(window as any).diggy.setDetail(detail);
    },[preset,dx,points,view,detail,scenario]);
    await page.evaluate(enabled=>(window as any).diggy.setOptimizations(enabled),optimized);
    await page.evaluate(()=>(window as any).diggy.benchmark());
    const volumeSamples=[];const started=Date.now();
    while(await page.locator('#benchmark').isDisabled()){
      if(Date.now()-started>60000)throw new Error('Measurement timed out');
      await page.waitForTimeout(750);
      const live=await page.evaluate(()=>(window as any).diggy.liveReport());
      if(live.snapshot)volumeSamples.push({time:live.simulationSeconds,snapshot:live.snapshot});
    }
    const result=await page.evaluate(()=>(window as any).diggy.report());
    if(result.benchmark.maxInvalidParticles||result.benchmark.maxPenetrationMm>=1||result.rendering.surface?.overflowTriangles)throw new Error('Invalid material state, collider penetration, or surface overflow');
    if((await page.locator('#message').textContent())?.includes('Surface capacity exceeded'))throw new Error('Surface capacity exceeded during measurement');
    if(preset==='sand'&&result.benchmark.maxPermanentCompactionPercent>0.001)throw new Error('Sand permanently compacted during scooping');
    measurements.push({...result,volumeSamples});
    console.log(JSON.stringify({preset,optimized,dx:result.solver.dx,points:result.solver.points,view,detail,...result.benchmark,surface:result.rendering.surface,invalid:result.snapshot?.invalidParticles}));
    await page.screenshot({path:`.local/artifacts/${scenario}-${preset}-${dx}-${points}-${view}-${detail}-${optimized}.png`});
    await writeFile(process.argv.includes('--optimization-ab')?'.local/artifacts/terrain-optimization-ab.json':process.argv.includes('--terrain')?'.local/artifacts/terrain-presentation-benchmark.json':process.argv.includes('--collapse')?'.local/artifacts/collapse-presentation-benchmark.json':process.argv.includes('--quick')?'.local/artifacts/presentation-final-check.json':'.local/artifacts/presentation-benchmark.json',JSON.stringify({identity,viewport:{width:1440,height:960},measurements,errors},null,2));
  }
  if(errors.length)throw new Error(errors.join('\n'));
}finally{try{await releaseIsolation?.();}finally{await browser.close();}}
