import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:!process.argv.includes('--headed'),args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.DIGGY_URL??'http://127.0.0.1:5173/lab.html');
  await page.waitForFunction(()=>Boolean((window as any).diggy?.ready),{},{timeout:120000});
  const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getInfo');
  const identity={adapter:await page.evaluate(()=>(window as any).diggy.adapter),devices:info.gpu.devices,renderer:info.gpu.auxAttributes?.glRenderer,headless:!process.argv.includes('--headed')};
  console.log('Benchmark identity',JSON.stringify(identity));
  if(identity.adapter.vendor!=='amd'||identity.adapter.architecture!=='gcn-5'||identity.adapter.isFallbackAdapter)throw new Error('Expected AMD integrated adapter, refusing misleading hardware benchmark');
  await mkdir('.local/artifacts',{recursive:true});
  const measurements:unknown[]=[];
  const configs=process.argv.includes('--quick')?[[0.125,4096]]:[ [0.125,4096],[0.1,4096],[0.08,4096],[0.125,8192],[0.1,8192],[0.08,8192],[0.125,16384],[0.1,16384],[0.08,16384] ];
  for(const [dx,points]of configs){
    await page.evaluate(async([dx,points])=>{(window as any).diggy.pause();await (window as any).diggy.reset('scoop','soil',points,dx);},[dx,points]);
    await page.evaluate(()=>(window as any).diggy.benchmark());
    await page.waitForFunction(()=>!(document.querySelector('#benchmark') as HTMLButtonElement).disabled,{},{timeout:60000});
    const result=await page.evaluate(()=>(window as any).diggy.report());measurements.push(result);
    console.log(JSON.stringify({dx,points,...result.benchmark,simulationSeconds:result.simulationSeconds,invalid:result.snapshot?.invalidParticles}));
    if(dx===0.125&&points===4096)await page.screenshot({path:'.local/artifacts/scoop-cycle.png'});
    await writeFile('.local/artifacts/benchmark-matrix.json',JSON.stringify({identity,measurements,errors},null,2));
  }
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
