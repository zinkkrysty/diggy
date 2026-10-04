import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const hardware=process.argv.includes('--hardware');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:[
  '--no-sandbox','--enable-unsafe-webgpu','--disable-dev-shm-usage',
  ...(hardware?['--use-angle=gl','--ignore-gpu-blocklist','--use-vulkan=native','--enable-features=Vulkan']:['--use-angle=swiftshader','--use-vulkan=swiftshader','--enable-unsafe-swiftshader']),
]});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(process.env.DIGGY_URL??'http://127.0.0.1:5173/lab.html');
  await page.waitForFunction(()=>Boolean((window as any).diggy?.ready)||document.querySelector('#loading')?.textContent?.includes('could not run'),{},{timeout:120000});
  const status=await page.locator('#loading').textContent();
  if(!(await page.evaluate(()=>Boolean((window as any).diggy?.ready))))throw new Error(status??'Lab failed');
  console.log('Lab ready',await page.evaluate(()=>(window as any).diggy.adapter));
  await page.evaluate(()=>(window as any).diggy.pause());
  await mkdir('.local/artifacts',{recursive:true});
  const results:Record<string,unknown>={adapter:await page.evaluate(()=>(window as any).diggy.adapter),hardwareRequested:hardware,scenarios:[]};
  for(const [scenario,preset] of [['pour','sand'],['pile','sand'],['scoop','soil'],['clump','wet'],['mix','soil'],['collapse','wet']]) {
    console.log('Checking',scenario,preset);
    await page.evaluate(async([s,p])=>{await (window as any).diggy.reset(s,p);(window as any).diggy.pause();},[scenario,preset]);
    const before=await page.evaluate(()=>(window as any).diggy.advance(1));
    let snapshot;
    for(let chunk=0;chunk<(hardware?12:1);chunk++)snapshot=await page.evaluate((steps)=>(window as any).diggy.advance(steps),hardware?120:12);
    (results.scenarios as unknown[]).push({scenario,preset,snapshot});
    if(!snapshot||snapshot.invalidParticles>0||Math.abs(snapshot.massErrorPercent)>0.001)throw new Error(`Invalid physics snapshot: ${scenario} ${JSON.stringify(snapshot)}`);
    if(hardware&&scenario==='pour'&&snapshot.centerOfMass[1]>1.2)throw new Error('Pour did not fall and settle');
    if(hardware&&scenario==='collapse'){await page.evaluate(()=>(window as any).diggy.removeSupport());let after;for(let chunk=0;chunk<10;chunk++)after=await page.evaluate(()=>(window as any).diggy.advance(120));(results.scenarios as unknown[]).push({scenario:'unsupported bridge',before:snapshot,after});if(after.invalidParticles)throw new Error('Collapse produced invalid particles');}
  }
  await page.evaluate(async()=>{await (window as any).diggy.reset('scoop','soil');(window as any).diggy.pause();await (window as any).diggy.advance(12);});
  const poseBefore=await page.evaluate(()=>(window as any).diggy.report().bucketPose.x);
  await page.locator('#pause').click();await page.locator('canvas').focus();
  await page.keyboard.down('KeyD');await page.waitForTimeout(300);await page.keyboard.up('KeyD');
  await page.locator('#pause').click();
  const poseAfter=await page.evaluate(()=>(window as any).diggy.report().bucketPose.x);
  if(!(poseAfter>poseBefore))throw new Error('Keyboard bucket control did not move');
  await page.screenshot({path:'.local/artifacts/soil-lab.png'});
  results.report=await page.evaluate(()=>(window as any).diggy.report());
  results.errors=errors;
  await writeFile(`.local/artifacts/${hardware?'hardware':'software'}-smoke.json`,JSON.stringify(results,null,2));
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
