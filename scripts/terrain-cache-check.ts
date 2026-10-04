import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready)||document.querySelector('#loading')?.textContent?.includes('could not run'),{},{timeout:120000});
 if(!await page.evaluate(()=>Boolean((window as any).diggy?.ready)))throw new Error(await page.locator('#loading').textContent()??'GPU init failed');
 await page.evaluate(async()=>{const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');(window as any).diggy.pause();});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})}).then(()=>true));
 const results=[];
 for(const preset of ['sand','soil','wet']){
  const result=await page.evaluate(p=>(window as any).diggy.terrainCacheProbe(p),preset);results.push(result);console.log(JSON.stringify(result));
  if(result.maxPositionDifference!==0||result.maxStateDifference!==0||result.maxReactionDifference!==0)throw new Error('Cached boundary changed simulation results');
 }
 if(errors.length)throw new Error(errors.join('\n'));
 await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/terrain-cache-validation.json',JSON.stringify({adapter:await page.evaluate(()=>(window as any).diggy.adapter),results,errors},null,2));
 console.log('Boundary cache matches reference exactly');
}finally{try{await release?.();}finally{await browser.close();}}
