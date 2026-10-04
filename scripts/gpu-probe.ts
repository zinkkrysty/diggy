import { chromium } from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:!process.argv.includes('--headed'),args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--enable-features=Vulkan','--use-vulkan=native']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/lab.html');
 const gpu=await page.evaluate(async()=>{const adapter=await navigator.gpu?.requestAdapter({powerPreference:'low-power'});return adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,device:adapter.info.device,features:[...adapter.features]}:null;});
 console.log(JSON.stringify(gpu));const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getInfo');console.log(JSON.stringify(info.gpu));
}finally{await browser.close();}
