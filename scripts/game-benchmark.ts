import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>Boolean((window as any).diggyGame?.ready),{},{timeout:120000});
 await page.evaluate(async()=>{const g=(window as any).diggyGame;g.pause();const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggyGame.instanceId,active:false})}));
 const results=[];await mkdir('.local/artifacts',{recursive:true});
 for(const preset of ['sand','soil','wet']){
  await page.evaluate(p=>(window as any).diggyGame.reset(p),preset);await page.locator('canvas').click();await page.evaluate(()=>(window as any).diggyGame.resume());
  for(const [key,seconds]of [['KeyS',1.4],['KeyD',2.2],['KeyR',2.2],['KeyW',2.5],['KeyQ',2.5],['KeyF',4.2]]as const){await page.keyboard.down(key);await page.waitForTimeout(seconds*1000);await page.keyboard.up(key);}
  const result=await page.evaluate(()=>(window as any).diggyGame.report());results.push({preset,...result});console.log(JSON.stringify({preset,performance:result.performance,debt:result.debt,invalid:result.snapshot?.invalidParticles,load:result.machine.carriedMassKg}));await page.evaluate(()=>(window as any).diggyGame.pause());await page.screenshot({path:`.local/artifacts/game-benchmark-${preset}.png`});
 }
 if(errors.length)throw new Error(errors.join('\n'));
 await writeFile('.local/artifacts/game-benchmark.json',JSON.stringify({viewport:[1440,960],adapter:await page.evaluate(()=>(window as any).diggyGame.adapter),results,errors},null,2));
}finally{try{await release?.();}finally{await browser.close();}}
