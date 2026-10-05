import './style.css';
import {GameScene} from '../render/game-scene';
import {SoilSolver,type Snapshot} from '../physics/solver';
import {Chassis} from '../physics/chassis';
import {Excavator,type ExcavatorCommand} from '../simulation/excavator';
import {seedTerrain} from '../simulation/terrain';
import {presets} from '../simulation/material';
import {PerformanceWindow,percentile} from '../diagnostics/performance';
import {angularDelta} from '../simulation/rigid-transform';
import type {Collider} from '../simulation/bucket';

const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<canvas tabindex="0" aria-label="Diggy excavator sandbox. Drag to orbit; use keyboard to operate the excavator."></canvas>
<div class="topbar"><div class="brand"><strong>diggy.</strong><small>EXCAVATOR<br>SANDBOX</small></div><nav class="actions" aria-label="Game actions"><button id="pause" aria-pressed="false">Pause</button><button id="camera">Third-person camera</button><button id="help" aria-expanded="false">Controls</button><button id="settings" aria-expanded="false">Site</button></nav></div>
<div class="site-info"><div class="eyebrow">FREE PLAY / 01</div><h1>The clearing</h1><p>Dig. Move. Make it your own.</p></div>
<div class="bottom"><div class="drive-guide"><div><span>BOOM</span><b><kbd data-key="KeyW">W</kbd> <kbd data-key="KeyS">S</kbd></b></div><div><span>STICK</span><b><kbd data-key="KeyA">A</kbd> <kbd data-key="KeyD">D</kbd></b></div><div><span>BUCKET</span><b><kbd data-key="KeyR">R</kbd> <kbd data-key="KeyF">F</kbd></b></div><div><span>SWING</span><b><kbd data-key="KeyQ">Q</kbd> <kbd data-key="KeyE">E</kbd></b></div><div><span>TRACKS</span><b><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></b></div></div><div class="telemetry"><div><strong id="fps">—</strong> FPS</div><div class="load" id="load">Bucket empty</div><div id="state">Ready to dig</div></div></div>
<div class="hint" id="hint">Scroll to zoom · C for orbit view · Shift for precise movement</div>
<section class="panel" id="controls-panel" hidden aria-label="Keyboard controls"><h2>At the controls</h2><p>Operate each hydraulic joint independently. Combine boom, stick, and bucket motion to cut into the bank. Curl to collect, raise to lift, swing aside, then tip to dump.</p>
<div class="control-row"><span>Raise / lower boom</span><b><kbd>W</kbd> <kbd>S</kbd></b></div><div class="control-row"><span>Stick in / out</span><b><kbd>A</kbd> <kbd>D</kbd></b></div><div class="control-row"><span>Curl / tip bucket</span><b><kbd>R</kbd> <kbd>F</kbd></b></div><div class="control-row"><span>Swing left / right</span><b><kbd>Q</kbd> <kbd>E</kbd></b></div><div class="control-row"><span>Drive / steer tracks</span><b><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></b></div><div class="control-row"><span>Precise movement</span><kbd>Shift</kbd></div><div class="control-row"><span>Pause / camera / help</span><b><kbd>Space</kbd> <kbd>C</kbd> <kbd>H</kbd></b></div><p>The default camera follows behind the tracks. Scroll to zoom. Press C for orbit view, then drag to orbit or right-drag to pan. Work inside the four site markers.</p><button class="wide" id="close-help">Back to digging</button></section>
<section class="panel" id="site-panel" hidden aria-label="Site settings"><h2>Your sandbox</h2><p>A broad dirt clearing, central sand pile, and drivable access road. Reloading starts fresh.</p><label for="material">Ground material</label><select id="material"><option value="sand">Dry sand</option><option value="soil" selected>Dry soil</option><option value="wet">Wet dirt</option></select><p>Changing material starts a new site.</p><button class="wide" id="reset">Reset site & machine</button><details><summary style="margin-top:20px;font-size:12px;cursor:pointer">Performance</summary><p id="debug-status"></p></details><a class="lab-link" href="/lab.html">Open the material laboratory ↗</a></section>
<div id="loading"><div class="loading-brand">diggy.</div><div id="loading-message">Preparing your sandbox…</div></div>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=document.querySelector('canvas')!;
const keys=new Set<string>(),machine=new Excavator(),perf=new PerformanceWindow();
let precise=false;
let scene:GameScene,solver:SoilSolver,chassis:Chassis,device:GPUDevice;
let materialKey='soil',paused=false,dead=false,busy=false,manual=false,suspended=false;
let simulationTime=0,debt=0,lastFrame=performance.now(),lastHUD=0,lastSnapshot=0;
let snapshot:Snapshot|null=null,pendingSnapshot:Promise<void>|null=null;
let pendingReset=false,resetWaiters:Array<()=>void>=[];
let adapterInfo:Record<string,unknown>={};
let renderScale=.85,lastQuality=0;
let timings={chassisMs:0,armMs:0,renderSubmitMs:0,feedbackWaitMs:0};
const instanceId=crypto.randomUUID();
function message(text:string){el('loading-message').textContent=text;}
function fail(error:unknown){dead=true;el('loading').hidden=false;message(`The sandbox could not run.\n${error instanceof Error?error.message:String(error)}\nReload to try again.`);console.error(error);}
function closePanels(){el('controls-panel').hidden=true;el('site-panel').hidden=true;el('help').setAttribute('aria-expanded','false');el('settings').setAttribute('aria-expanded','false');keys.clear();}
function togglePanel(id:string){const open=el(id).hidden;closePanels();el(id).hidden=!open;el('help').setAttribute('aria-expanded',String(!el('controls-panel').hidden));el('settings').setAttribute('aria-expanded',String(!el('site-panel').hidden));}
function pause(value:boolean){paused=value;debt=0;keys.clear();el('pause').textContent=value?'Resume':'Pause';el('pause').setAttribute('aria-pressed',String(value));lastFrame=performance.now();if(solver)hud();}
function requestReset(){if(dead)return Promise.reject(new Error('Reload the sandbox after the reported GPU error.'));pendingReset=true;return new Promise<void>(resolve=>resetWaiters.push(resolve));}
async function reset(){
  el('loading').hidden=false;message('Preparing fresh ground…');
  await pendingSnapshot;await device.queue.onSubmittedWorkDone();
  const seed=seedTerrain(presets[materialKey]),next=new SoilSolver(device,seed,.25,true);await next.init();
  scene.setGroundAppearance(presets[materialKey]);
  await scene.attachParticles(seed,next.positions,next.state,true);solver?.destroy();solver=next;
  chassis?.destroy();chassis=new Chassis();chassis.updateGround(seed.positions);machine.reset();machine.base=chassis.base;
  solver.onTerrainReadback=(positions,indices)=>chassis.updateGround(positions,indices);
  simulationTime=0;debt=0;snapshot=null;lastSnapshot=0;perf.reset();scene.updateMachine(machine,chassis.trackTravel,1);scene.home();
  scene.updateMaterial(boxes([0,0,0],0,0),0);
  await scene.renderer.compileAsync(scene.scene,scene.camera);scene.render();await device.queue.onSubmittedWorkDone();
  lastFrame=performance.now();el('loading').hidden=true;pendingReset=false;resetWaiters.splice(0).forEach(resolve=>resolve());canvas.focus({preventScroll:true});
}
function axis(positive:string,negative:string){return Number(keys.has(positive))-Number(keys.has(negative));}
function input():ExcavatorCommand{const scale=precise?.25:1;return {boom:axis('KeyW','KeyS')*scale,stick:axis('KeyD','KeyA')*scale,curl:axis('KeyR','KeyF')*scale,swing:axis('KeyQ','KeyE')*scale};}
function boxes(velocity:[number,number,number],omega:number,yawOmega:number,worldOmega?:[number,number,number]):Collider[]{return [...machine.colliders(velocity,omega,yawOmega,worldOmega),...chassis.colliders()];}
async function tick(steps:number,command:ExcavatorCommand,forward=0,turn=0){
  const dt=steps*solver.timestep(presets[materialKey]),before=machine.pose();
  const cpuStart=performance.now();chassis.step(dt,forward,turn,before);const afterChassis=performance.now();machine.base=chassis.base;machine.step(dt,command);const afterArm=performance.now();
  const pose=machine.pose(),velocity:[number,number,number]=[(pose.x-before.x)/dt,(pose.y-before.y)/dt,(pose.z-before.z)/dt],omega=(pose.angle-before.angle)/dt;
  const yawDelta=(pose.yaw??0)-(before.yaw??0),yawOmega=Math.atan2(Math.sin(yawDelta),Math.cos(yawDelta))/dt;
  const worldOmega=angularDelta(before.basis!,pose.basis!,dt);
  const colliders=boxes(velocity,omega,yawOmega,worldOmega);
  solver.updateTerrainContacts(colliders,simulationTime);solver.step(steps,presets[materialKey],colliders);simulationTime+=dt;
  // Start feedback before submitting the render so physics/readback can overlap it.
  const feedback=solver.contactFeedback();scene.updateMachine(machine,chassis.trackTravel,dt);scene.updateMaterial(colliders,dt,solver.terrain?.modes);scene.render();
  const afterRender=performance.now();const contact=await feedback;const afterFeedback=performance.now();machine.contact(contact,dt);chassis.contact(contact.impulse,pose);
  timings={chassisMs:afterChassis-cpuStart,armMs:afterArm-afterChassis,renderSubmitMs:afterRender-afterArm,feedbackWaitMs:afterFeedback-afterRender};
  return colliders;
}
function adjustRenderQuality(now:number){
  if(now-lastQuality<2500||perf.frames.length<90)return;lastQuality=now;
  const recent=perf.frames.slice(-90),p95=percentile(recent,.95);
  if(p95>23&&renderScale>.65){renderScale=Math.max(.65,Math.round((renderScale-.1)*100)/100);scene.renderer.setPixelRatio(Math.min(devicePixelRatio,1)*renderScale);scene.resize();}
}
function hud(){
  const p=perf.summary();el('fps').textContent=p.fps>0?p.fps.toFixed(0):'—';el('load').textContent=machine.carriedMass>10?`${Math.round(machine.carriedMass).toLocaleString()} kg in bucket`:'Bucket empty';
  el('state').textContent=paused?'Paused':suspended?'Measurement in progress':debt>.15?'Simulation catching up':'Free play';
  el('debug-status').textContent=`${String(adapterInfo.description)}\nFrame p95: ${p.p95Ms.toFixed(1)} ms\nSimulation: ${p.simulationRate.toFixed(2)}×\nTime debt: ${(debt*1000).toFixed(0)} ms\nRender resolution: ${Math.round(renderScale*100)}%\nMaterial samples: ${solver.count.toLocaleString()}\nMass drift: ${snapshot?`${snapshot.massErrorPercent.toFixed(5)}%`:'checked on demand'}\nInvalid samples: ${snapshot?.invalidParticles??0}`;
  document.querySelectorAll<HTMLElement>('[data-key]').forEach(k=>k.classList.toggle('pressed',keys.has(k.dataset.key!)));
}
async function frame(){
  if(dead)return;requestAnimationFrame(()=>void frame());if(busy||manual||suspended)return;if(document.hidden&&!pendingReset){lastFrame=performance.now();debt=0;return;}busy=true;
  try{
    if(pendingReset)await reset();
    const now=performance.now(),delta=(now-lastFrame)/1000;lastFrame=now;
    if(!paused&&!document.hidden)debt+=delta;
    const dt=solver.timestep(presets[materialKey]),steps=paused||document.hidden?0:Math.min(48,Math.floor(debt/dt));
    let colliders:Collider[];
    if(steps){colliders=await tick(steps,input(),axis('ArrowUp','ArrowDown')*(precise?.25:1),axis('ArrowLeft','ArrowRight')*(precise?.25:1));debt-=steps*dt;}
    else{colliders=boxes([0,0,0],0,0);scene.updateMachine(machine,chassis.trackTravel);scene.updateMaterial(colliders,0);scene.render();await device.queue.onSubmittedWorkDone();}
    if(now-lastSnapshot>200&&!pendingSnapshot){lastSnapshot=now;pendingSnapshot=solver.terrainFeedback().then(()=>{}).catch(fail).finally(()=>{pendingSnapshot=null;});}
    if(delta>0&&delta<10&&!paused&&!document.hidden)perf.add(delta*1000,steps*dt);
    if(now-lastHUD>200){lastHUD=now;hud();if(!paused)adjustRenderQuality(now);}
  }catch(error){fail(error);}finally{busy=false;}
}
el('pause').onclick=()=>pause(!paused);el('help').onclick=()=>togglePanel('controls-panel');el('settings').onclick=()=>togglePanel('site-panel');el('close-help').onclick=()=>{togglePanel('controls-panel');canvas.focus();};
el('camera').onclick=()=>{scene.follow=!scene.follow;el('camera').textContent=scene.follow?'Third-person camera':'Orbit camera';scene.home();};
el('reset').onclick=()=>{keys.clear();void requestReset();};
el<HTMLSelectElement>('material').onchange=()=>{materialKey=el<HTMLSelectElement>('material').value;keys.clear();void requestReset();};
const handled=['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyR','KeyF','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyC','KeyH'];
window.addEventListener('keydown',event=>{
  precise=event.shiftKey;
  if(event.code==='Escape'){closePanels();canvas.focus();return;}
  if((event.target as HTMLElement).matches('input,select,textarea'))return;
  if(handled.includes(event.code))event.preventDefault();
  if(event.repeat&&['Space','KeyC','KeyH'].includes(event.code))return;
  if(event.code==='Space')pause(!paused);else if(event.code==='KeyC')el('camera').click();else if(event.code==='KeyH')togglePanel('controls-panel');else keys.add(event.code);
});
window.addEventListener('keyup',event=>{precise=event.shiftKey;keys.delete(event.code);});
canvas.addEventListener('pointerdown',event=>{precise=event.shiftKey;});
window.addEventListener('blur',()=>{keys.clear();precise=false;});
document.addEventListener('visibilitychange',()=>{keys.clear();precise=false;debt=0;lastFrame=performance.now();});window.addEventListener('resize',()=>scene?.resize());
import.meta.hot?.on('diggy:benchmark-isolation',(data:{owner:string;active:boolean})=>{if(data.owner!==instanceId){suspended=data.active;keys.clear();debt=0;lastFrame=performance.now();}});
async function init(){
  if(!navigator.gpu)throw new Error('WebGPU is required. Open localhost in a browser with WebGPU enabled.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});if(!adapter)throw new Error('No WebGPU adapter is available.');
  const info=adapter.info;adapterInfo={description:[info.vendor,info.architecture,info.description].filter(Boolean).join(' · '),vendor:info.vendor,architecture:info.architecture,isFallbackAdapter:info.isFallbackAdapter};
  device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});
  device.addEventListener('uncapturederror',event=>fail(new Error(event.error.message)));device.lost.then(info=>{if(!dead)fail(new Error(`GPU device lost: ${info.message}`));});
  await Chassis.init();scene=new GameScene(canvas,device);await scene.init();scene.renderer.setPixelRatio(Math.min(devicePixelRatio,1)*renderScale);scene.resize();await reset();
  (window as unknown as {diggyGame:unknown}).diggyGame={ready:true,instanceId,adapter:adapterInfo,pause:()=>pause(true),resume:()=>pause(false),
    report:()=>({machine:machine.report(),camera:scene.cameraReport(),snapshot,performance:perf.summary(),simulationTime,debt,paused,renderScale,timings:{...timings},material:materialKey,terrain:solver.terrain?.report(),terrainFeedback:solver.terrainFeedbackReport}),
    reset:async(preset='soil')=>{materialKey=preset;el<HTMLSelectElement>('material').value=preset;await requestReset();},
    drive:async(command:ExcavatorCommand,batches=1,forward=0,turn=0)=>{
      pause(true);while(busy)await new Promise(resolve=>setTimeout(resolve,5));manual=true;
      try{await pendingSnapshot;let colliders:Collider[]=boxes([0,0,0],0,0);for(let i=0;i<batches;i++){colliders=await tick(32,command,forward,turn);if(i%8===0)await solver.snapshot(colliders);}snapshot=await solver.snapshot(colliders);hud();return {machine:machine.report(),snapshot,surface:await scene.surfaceDiagnostics()};}
      finally{manual=false;lastFrame=performance.now();}
    },particles:()=>solver.readParticles()};
  setTimeout(()=>{el('hint').hidden=true;},14000);requestAnimationFrame(()=>void frame());
}
void init().catch(fail);
