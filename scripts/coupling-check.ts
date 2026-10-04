import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.local/artifacts',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
let release:(()=>Promise<unknown>)|undefined;
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
  await page.evaluate(async()=>{const r=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:true})});if(!r.ok)throw new Error('Isolation failed');});
  release=()=>page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggy.instanceId,active:false})}).then(()=>true));
  const runs=[];
  for(const strength of [1,.5]) {
    await page.evaluate(async(strength)=>{const d=(window as any).diggy;d.pause();await d.reset('scoop','soil');d.setActuation('force',strength);},strength);
    const result=await page.evaluate(async()=>{
      const d=(window as any).diggy;const samples=[];let maxReaction=0,maxTorque=0,maxLoad=0,maxSpeed=0;let result;
      // Push, curl, lift, then tip; elapsed simulation time is deterministic.
      for(let i=0;i<560;i++) {
        const command=i<220?[.7,0,0,0]:i<330?[0,.1,0,.7]:i<440?[-.35,.7,0,0]:[0,0,0,-.7];
        result=await d.drive(command,32);
        const s=result.snapshot;if(s.invalidParticles||Math.abs(s.massErrorPercent)>.001||s.penetrationMm>=1)throw new Error('Invalid contact state');
        const a=result.dynamics;maxReaction=Math.max(maxReaction,Math.hypot(...a.reaction.slice(0,3)));maxTorque=Math.max(maxTorque,Math.abs(a.reaction[3]));maxLoad=Math.max(maxLoad,a.carriedMassKg);maxSpeed=Math.max(maxSpeed,...a.velocity.map(Math.abs));
        if(i%40===0)samples.push({batch:i,pose:result.pose,dynamics:a,snapshot:s});
      }
      return {samples,final:result,maxReaction,maxTorque,maxLoad,maxSpeed,report:d.liveReport()};
    });
    runs.push({strength,...result});console.log(JSON.stringify({strength,maxReaction:result.maxReaction,maxTorque:result.maxTorque,maxLoad:result.maxLoad,maxSpeed:result.maxSpeed,pose:result.final.pose}));
    await page.screenshot({path:`.local/artifacts/coupling-${strength}.png`});
  }
  if(runs.some(r=>r.maxLoad<50||r.maxReaction<1000||r.maxTorque<100))throw new Error('No meaningful material coupling measured');
  const fullPush=runs[0].samples.find(s=>s.batch===200)!.pose.x,halfPush=runs[1].samples.find(s=>s.batch===200)!.pose.x;
  if(!(fullPush>halfPush+.03))throw new Error(`Reduced force did not slow excavation: ${fullPush}, ${halfPush}`);
  if(runs.some(r=>r.maxSpeed>3))throw new Error('Unstable fixture velocity');
  if(errors.length)throw new Error(errors.join('\n'));
  await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/coupling-validation.json',JSON.stringify({adapter:await page.evaluate(()=>(window as any).diggy.adapter),runs,errors},null,2));
  console.log('Coupling checks passed');
}finally{try{await release?.();}finally{await browser.close();}}
