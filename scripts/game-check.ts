import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let release:(()=>Promise<unknown>)|undefined;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log(m.text());}});
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>Boolean((window as any).diggyGame?.ready)||document.querySelector('#loading-message')?.textContent?.includes('could not run'),{},{timeout:120000});
 assert.ok(await page.evaluate(()=>Boolean((window as any).diggyGame?.ready)),await page.locator('#loading-message').textContent()??'Game failed');
 console.log('Game ready',await page.evaluate(()=>(window as any).diggyGame.adapter));
 await page.evaluate(async()=>{const g=(window as any).diggyGame;g.pause();const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
 release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggyGame.instanceId,active:false})}).then(()=>true));
 await mkdir('.local/artifacts',{recursive:true});await page.screenshot({path:'.local/artifacts/game-initial.png'});
 const before=await page.evaluate(()=>(window as any).diggyGame.report());
 assert.equal(before.camera.mode,'third-person');assert.ok(before.camera.position[0]<before.machine.base.x&&before.camera.position[1]>before.machine.base.y+3,'Camera starts behind and above');
 const results=[];
 for(const [name,command,batches,forward,turn]of [
  ['lower',{boom:-1,stick:0,curl:0,swing:0},45,0,0],
  ['reach',{boom:0,stick:1,curl:0,swing:0},70,0,0],
  ['curl',{boom:0,stick:0,curl:1,swing:0},70,0,0],
  ['lift',{boom:1,stick:0,curl:0,swing:0},80,0,0],
  ['swing',{boom:0,stick:0,curl:0,swing:1},90,0,0],
  ['dump',{boom:0,stick:0,curl:-1,swing:0},160,0,0],
  ['tracks',{boom:0,stick:0,curl:0,swing:0},60,0,-1],
  ['drive',{boom:0,stick:0,curl:0,swing:0},75,1,0],
 ]as const){
  const result=await page.evaluate(([c,n,f,t])=>(window as any).diggyGame.drive(c,n,f,t),[command,batches,forward,turn]);
  assert.equal(result.snapshot.invalidParticles,0,`${name}: finite state`);assert.ok(Math.abs(result.snapshot.massErrorPercent)<.001,`${name}: mass`);assert.equal(result.surface.overflowTriangles,0);assert.equal(result.surface.drawnProxyInstances,result.surface.sparseSamples);
  results.push({name,...result});console.log(name,JSON.stringify({pose:result.machine.pose,joints:result.machine.joints,mass:result.machine.carriedMassKg,overlap:result.snapshot.penetrationMm,base:result.machine.base}));
  if(name==='lift'||name==='swing'||name==='dump')await page.screenshot({path:`.local/artifacts/game-${name}.png`});
 }
 assert.ok(Math.abs(results[4].machine.joints[3]-before.machine.joints[3])>.3,'Upper body must swing');
 assert.ok(Math.abs(results[6].machine.base.yaw-before.machine.base.yaw)>.03,'Tracks must steer');
 assert.ok(Math.hypot(results[7].machine.base.x-results[6].machine.base.x,results[7].machine.base.z-results[6].machine.base.z)>.15,'Tracks must drive');
 const driving=[];
 for(const preset of ['sand','soil','wet']){
  await page.evaluate(p=>(window as any).diggyGame.reset(p),preset);
  const start=await page.evaluate(()=>(window as any).diggyGame.report().machine.base);
  const drive=await page.evaluate(()=>(window as any).diggyGame.drive({boom:0,stick:0,curl:0,swing:0},75,1,0));
  assert.ok(drive.machine.base.x-start.x>.8,`${preset}: level-ground driving distance`);assert.equal(drive.snapshot.invalidParticles,0);assert.ok(Math.abs(drive.snapshot.massErrorPercent)<.001);
  const stop=await page.evaluate(()=>(window as any).diggyGame.drive({boom:0,stick:0,curl:0,swing:0},30,0,0));
  const reverse=await page.evaluate(()=>(window as any).diggyGame.drive({boom:0,stick:0,curl:0,swing:0},75,-1,0));
  assert.ok(stop.machine.base.x-reverse.machine.base.x>.8,`${preset}: reverse on ground`);assert.equal(reverse.snapshot.invalidParticles,0);
  driving.push({preset,start,drive:drive.machine.base,reverse:reverse.machine.base});console.log('Level-ground drive',JSON.stringify(driving.at(-1)));
 }
 await page.locator('#camera').click();assert.equal(await page.evaluate(()=>(window as any).diggyGame.report().camera.mode),'orbit');await page.locator('#camera').click();assert.equal(await page.evaluate(()=>(window as any).diggyGame.report().camera.mode),'third-person');
 await page.locator('#help').click();assert.equal(await page.locator('#controls-panel').isVisible(),true);await page.locator('#close-help').click();
 await page.evaluate(()=>(window as any).diggyGame.reset('soil'));assert.equal(await page.evaluate(()=>(window as any).diggyGame.report().simulationTime),0);
 await page.locator('canvas').click();const old=await page.evaluate(()=>(window as any).diggyGame.report().machine.joints[0]);await page.evaluate(()=>(window as any).diggyGame.resume());await page.keyboard.down('KeyW');await page.waitForTimeout(1200);await page.keyboard.up('KeyW');await page.evaluate(()=>(window as any).diggyGame.pause());
 assert.ok(await page.evaluate(old=>(window as any).diggyGame.report().machine.joints[0]>old+.02,old),'Keyboard boom control');
 await page.evaluate(()=>(window as any).diggyGame.reset('wet'));const wet=await page.evaluate(()=>(window as any).diggyGame.drive({boom:-1,stick:0,curl:0,swing:0},20));assert.equal(wet.snapshot.invalidParticles,0);
 assert.equal(errors.length,0,errors.join('\n'));
 await writeFile('.local/artifacts/game-validation.json',JSON.stringify({adapter:await page.evaluate(()=>(window as any).diggyGame.adapter),before,results,driving,errors},null,2));
 const lab=await browser.newPage();await lab.goto('http://127.0.0.1:5173/lab.html');await lab.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});await lab.evaluate(()=>(window as any).diggy.pause());assert.equal(await lab.locator('#scenario').inputValue(),'terrain');console.log('Lab preserved; game checks passed');
}finally{try{await release?.();}finally{await browser.close();}}
