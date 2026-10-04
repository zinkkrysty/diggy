import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});await page.evaluate(()=>(window as any).diggy.pause());
 const tests=[];
 for(const preset of ['sand','soil','wet']){
  const stages=await page.evaluate(p=>(window as any).diggy.compactionProbe(p),preset);
  for(const stage of stages){assert.equal(stage.snapshot.invalidParticles,0);assert.ok(Math.abs(stage.snapshot.massErrorPercent)<0.001);}
  assert.ok(stages[0].snapshot.elasticCompressionPercent<0.6,'Ordinary pressure must barely change material volume');
  assert.ok(stages[1].snapshot.elasticCompressionPercent<4.1,'Even high-pressure elastic compression must remain small');
  assert.ok(Math.abs(stages[0].snapshot.permanentCompactionPercent)<0.001,'Ordinary pressure must not permanently compact material');
  if(preset==='sand')assert.ok(Math.abs(stages[1].snapshot.permanentCompactionPercent)<0.001,'Sand must not permanently compact even at high pressure');
  else{assert.ok(stages[1].snapshot.permanentCompactionPercent>1,'Fine soil must compact under high pressure');assert.ok(stages[1].snapshot.maxCompactionPercent<=10.01,'Fine soil compaction must remain bounded');}
  assert.ok(Math.abs(stages[2].snapshot.permanentCompactionPercent-stages[1].snapshot.permanentCompactionPercent)<0.001,'Unloading must preserve only the bounded permanent compaction');
  assert.ok(Math.abs(stages[2].snapshot.elasticCompressionPercent)<0.01,'Recoverable compression must disappear on unloading');
  tests.push({preset,stages});console.log(JSON.stringify({preset,stages}));
 }
 await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/compaction-check.json',JSON.stringify({tests,errors},null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();}
