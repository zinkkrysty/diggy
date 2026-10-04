import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/lab.html');await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
  await page.evaluate(()=>(window as any).diggy.pause());
  const baseline=process.argv.includes('--verify')?JSON.parse(await readFile('docs/rebound-before.json','utf8')):null;
  const tests=[];
  for(const scenario of ['pile','clump'])for(const preset of ['sand','soil','wet']){
    await page.evaluate(async([scenario,preset])=>{await (window as any).diggy.reset(scenario,preset);(window as any).diggy.pause();},[scenario,preset]);
    const dt=await page.evaluate(()=>(window as any).diggy.report().solver.dt);
    const steps=Math.ceil(4/(55*dt));const timeline=[];let time=0;
    for(let tick=0;tick<55;tick++){
      const sample=await page.evaluate(async(steps)=>{
        const snapshot=await (window as any).diggy.advance(steps);
        const samples=await (window as any).diggy.particles();
        let upwardEnergy=0,downwardEnergy=0,meanVy=0,groundMass=0;
        for(let i=0;i<samples.positions.length/4;i++){
          const mass=samples.positions[i*4+3],vy=samples.states[i*36+1];
          if(vy>0)upwardEnergy+=0.5*mass*vy*vy;else downwardEnergy+=0.5*mass*vy*vy;
          meanVy+=mass*vy;if(samples.positions[i*4+1]<0.185)groundMass+=mass;
        }
        return {snapshot,dt:(window as any).diggy.report().solver.dt,upwardEnergy,downwardEnergy,meanVy:meanVy/snapshot.mass,groundFraction:groundMass/snapshot.mass};
      },steps);
      const {snapshot}=sample;time+=steps*sample.dt;
      assert.equal(snapshot.invalidParticles,0);assert.ok(Math.abs(snapshot.massErrorPercent)<0.001);assert.ok(snapshot.penetrationMm<1);
      timeline.push({time,comY:snapshot.centerOfMass[1],meanVy:sample.meanVy,upwardEnergy:sample.upwardEnergy,downwardEnergy:sample.downwardEnergy,groundFraction:sample.groundFraction,kineticEnergy:snapshot.kineticEnergy});
    }
    const impact=timeline.findIndex(t=>t.groundFraction>0.03);
    const after=timeline.slice(impact+1);
    const peakMeanUp=Math.max(0,...after.map(t=>t.meanVy));
    const peakUpwardEnergy=Math.max(0,...after.map(t=>t.upwardEnergy));
    const result={scenario,preset,peakMeanUp,peakUpwardEnergy,final:timeline.at(-1),timeline};tests.push(result);
    console.log(JSON.stringify({scenario,preset,peakMeanUp,peakUpwardEnergy,final:result.final}));
    if(process.argv.includes('--verify')){
      assert.ok(peakMeanUp<0.16,'Bulk upward rebound must remain small after contact');
      const before=baseline.tests.find((t:any)=>t.scenario===scenario&&t.preset===preset);
      assert.ok(peakUpwardEnergy<before.peakUpwardEnergy*0.4,'Impact upward energy must decrease substantially from the measured baseline');
    }
  }
  await mkdir('.local/artifacts',{recursive:true});await writeFile(process.argv.includes('--baseline')?'.local/artifacts/rebound-before.json':'.local/artifacts/rebound-after.json',JSON.stringify({adapter:await page.evaluate(()=>(window as any).diggy.adapter),tests,errors},null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();}
