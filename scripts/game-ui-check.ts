import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=gl','--use-vulkan=native','--enable-features=Vulkan','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(process.env.DIGGY_URL??'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>Boolean((window as any).diggyGame?.ready),{},{timeout:120000});
  await page.evaluate(async()=>{
    const g=(window as any).diggyGame;g.pause();
    const response=await fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:g.instanceId,active:true})});
    if(!response.ok)throw new Error('Could not isolate browser verification');
  });
  for(const [trigger,panel]of [['help','controls-panel'],['settings','site-panel']]){
    await page.locator(`#${trigger}`).click();
    if(trigger==='settings')await page.locator('#material').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`#${panel}`).isVisible(),false,`${trigger}: Escape closes panel`);
    assert.equal(await page.locator(`#${trigger}`).getAttribute('aria-expanded'),'false',`${trigger}: collapsed state`);
    assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'CANVAS');
  }
  await mkdir('.local/artifacts',{recursive:true});
  for(const width of [320,390,600,850]){
    await page.setViewportSize({width,height:844});
    for(const id of ['pause','camera','help','settings']){
      const bounds=await page.locator(`#${id}`).boundingBox();
      assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width,`${id}: fits ${width}px viewport`);
    }
    const hint=await page.locator('#hint').boundingBox(),telemetry=await page.locator('.telemetry').boundingBox();
    if(hint&&telemetry)assert.ok(hint.y+hint.height<=telemetry.y||hint.x+hint.width<=telemetry.x||hint.x>=telemetry.x+telemetry.width||hint.y>=telemetry.y+telemetry.height,'Hint must not overlap telemetry');
    await page.screenshot({path:`.local/artifacts/game-ui-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:960});
  const rates:number[]=[];
  for(const fromSelect of [false,true]){
    await page.evaluate(async()=>{const g=(window as any).diggyGame;await g.reset('sand');g.resume();});
    if(fromSelect){await page.locator('#settings').click();await page.locator('#material').focus();}
    await page.keyboard.down('Shift');
    await page.locator('canvas').click({position:{x:650,y:500}});
    const before=await page.evaluate(()=>(window as any).diggyGame.report());
    await page.keyboard.down('KeyW');await page.waitForTimeout(800);await page.keyboard.up('KeyW');await page.keyboard.up('Shift');
    const after=await page.evaluate(()=>(window as any).diggyGame.report());
    rates.push((after.machine.joints[0]-before.machine.joints[0])/(after.simulationTime-before.simulationTime));
    await page.evaluate(()=>(window as any).diggyGame.pause());await page.keyboard.press('Escape');
  }
  assert.ok(rates[0]>0&&Math.abs(rates[1]/rates[0]-1)<.25,`Shift speed preserved across form focus: ${rates}`);
  assert.deepEqual(errors,[]);
  console.log('Game UI checks passed; precision rates:',rates);
}finally{
  await page.evaluate(()=>fetch('/__diggy/benchmark-isolation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:(window as any).diggyGame?.instanceId,active:false})})).catch(()=>{});
  await browser.close();
}
