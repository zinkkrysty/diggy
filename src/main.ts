import './style.css';
import { BucketActuator } from './simulation/actuator';
import { MaterialSurface, type SurfaceStats } from './render/surface';
import { LabScene } from './render/scene';
import { SoilSolver, type Snapshot } from './physics/solver';
import { presets, BULK_MODULUS, type MaterialSettings } from './simulation/material';
import { seedScenario, SCENARIOS, type Scenario } from './simulation/scenarios';
import { colliders, type Pose } from './simulation/bucket';
import { PerformanceWindow } from './diagnostics/performance';

const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
<header><div><a href="/" style="color:inherit;text-decoration:none" aria-label="Back to the excavator game"><strong>diggy<span>SANDBOX GROUND / 04</span></strong></a></div><div id="gpu-badge">Checking GPU…</div></header>
<main><div class="viewport"><canvas tabindex="0" aria-label="Interactive soil and bucket physics scene"></canvas>
<div class="caption"><div class="eyebrow">Bulk motion · fine detail</div><h1 id="scenario-title">Scoop & spill</h1><p id="scenario-description"></p></div>
<div id="help">Orbit: drag · Zoom: scroll · Bucket: WASD / QE / RF</div>
<div class="status"><strong id="fps">—</strong> FPS<br><span id="rate">— × simulation</span><br><span id="particle-count">— material points</span><br><span id="chunk-status"></span></div>
<div class="toolbar"><button id="pause">Pause</button><button id="reset">Reset scene</button><button id="cycle">Run scoop cycle</button><button id="support" hidden>Remove support</button></div>
<div id="loading">Preparing the GPU physics laboratory…</div></div>
<aside><div class="section"><h2>Experiment</h2><select id="scenario" aria-label="Scenario">${Object.entries(SCENARIOS).map(([key,s])=>`<option value="${key}" ${key==='terrain'?'selected':''}>${s.title}</option>`).join('')}</select>
<label for="resolution">Grid resolution</label><select id="resolution"><option value="0.25">25 cm · terrain</option><option value="0.125" selected>12.5 cm · coarse</option><option value="0.1">10 cm · medium</option><option value="0.08">8 cm · fine</option></select>
<label for="points">Material point budget</label><select id="points"><option value="4096" selected>4,096 points</option><option value="8192">8,192 points</option><option value="16384">16,384 points</option><option id="terrain-budget" value="terrain" hidden>Terrain samples</option></select>
<label for="view-mode">Material view</label><select id="view-mode"><option value="surface">Continuous surface</option><option value="points">Raw points · debug</option></select>
<label><input type="checkbox" id="spill-detail" checked> Fine spill grains</label>
<p class="note">Resolution changes reset the experiment. Points represent volumes of soil, not individual grains.</p></div>
<div class="section"><h2>Bucket actuation</h2><select id="actuation" aria-label="Bucket actuation"><option value="force">Force-limited fixture</option><option value="kinematic">Prescribed motion · comparison</option></select><label for="strength">Actuator strength</label><select id="strength"><option value="1">Full strength</option><option value="0.5">Half strength</option></select><p class="note">Commands set a limited-speed target. Contact can slow or stall the bucket. Release a key to hold position.</p><dl><dt>Lift effort</dt><dd id="lift-effort">—</dd><dt>Curl effort</dt><dd id="curl-effort">—</dd><dt>Contact torque</dt><dd id="contact-torque">—</dd></dl></div><div class="section"><h2>Material</h2><div class="preset-row"><button data-preset="sand" class="active">Sand</button><button data-preset="soil">Soil</button><button data-preset="wet">Wet dirt</button></div>
<div id="sliders"></div><p class="note">Material changes reset the scene for repeatable comparisons. Mixing uses dry coarse and wet fine inputs. Moisture changes strength nonlinearly.</p></div>
<div class="section"><details id="controls"><summary>Keyboard controls</summary><p><kbd>A</kbd> <kbd>D</kbd> Move along the bed<br><kbd>W</kbd> <kbd>S</kbd> Raise / lower<br><kbd>Q</kbd> <kbd>E</kbd> Move across the bed<br><kbd>R</kbd> <kbd>F</kbd> Curl / tip<br><kbd>Space</kbd> Pause<br><kbd>Shift</kbd> Precise movement</p><p>Click the scene before using controls.</p></details></div>
<div class="section"><details open><summary>Physics diagnostics</summary><dl>
<dt>Simulation time</dt><dd id="sim-time">0.00 s</dd><dt>Time debt</dt><dd id="debt">0 ms</dd><dt>Frame p95</dt><dd id="p95">—</dd><dt>GPU compute</dt><dd id="gpu-time">—</dd><dt>Substep / frame</dt><dd id="substeps">—</dd><dt>Mass drift</dt><dd id="mass">—</dd><dt>Permanent compaction</dt><dd id="compaction">—</dd><dt>Elastic volume change</dt><dd id="elastic-volume">—</dd><dt>Peak stored pressure</dt><dd id="pressure">—</dd><dt>Max speed</dt><dd id="speed">—</dd><dt>Kinetic energy</dt><dd id="energy">—</dd><dt>Contact overlap</dt><dd id="penetration">—</dd><dt>Bucket contents¹</dt><dd id="load">—</dd><dt>Bucket material volume¹</dt><dd id="bucket-volume">—</dd><dt>Contact reaction²</dt><dd id="reaction">—</dd><dt>Invalid states</dt><dd id="invalid">—</dd><dt>Solver buffers³</dt><dd id="memory">—</dd><dt>Surface compute</dt><dd id="surface-time">—</dd><dt>Surface triangles</dt><dd id="triangles">—</dd><dt>Fine grains</dt><dd id="grains">—</dd><dt>Visual buffers</dt><dd id="visual-memory">—</dd></dl></details>
<p class="note">¹ Geometric estimate. ² Measured soil contact reaction. The fixture has finite force; full excavator hydraulics follow later. ³ Allocated solver buffers; excludes renderer/driver memory.</p></div>
<div class="section"><h2>Measurement</h2><button class="primary full-width" id="benchmark">Measure 15 seconds</button><button class="full-width" id="export">Export report</button><div id="benchmark-status">Measures actual frame time and simulation throughput during active movement.</div><p id="message"></p></div>
<div class="footnote">MLS-MPM / APIC · Experimental soil plasticity<br>No drainage or separate water phase yet.<br>12 m development terrain · excavator follows.</div></aside></main>`;
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const set=(id:string,value:string)=>{element(id).textContent=value;};
let material:MaterialSettings={...presets.sand};
const sliderSpecs: [keyof MaterialSettings,string,number,number,number,string][]=[
  ['moisture','Water content',0,1,0.01,'%'],['grainMm','Effective grain size',0.01,1,0.01,'mm'],
  ['friction','Internal friction',15,48,1,'°'],['cohesion','Base cohesion',0,4000,50,'Pa'],
  ['stiffness','Stiffness',15000,120000,1000,'kPa'],['viscosity','Viscous resistance',0,4,0.05,''],['adhesion','Metal adhesion',0,1,0.01,''],
];
element('sliders').innerHTML=sliderSpecs.map(([key,title,min,max,step])=>`<label class="slider-label" for="${key}"><span>${title}</span><output id="${key}-value"></output></label><input id="${key}" type="range" min="${min}" max="${max}" step="${step}">`).join('');
function updateSliders(){for(const [key,, , , ,unit]of sliderSpecs){element<HTMLInputElement>(key).value=String(material[key]);let value=material[key];if(key==='moisture')value*=100;if(key==='stiffness')value/=1000;set(`${key}-value`,`${Number(value.toFixed(2))}${unit==='°'?'':' '}${unit}`);}}
updateSliders();
let scene:LabScene,solver:SoilSolver,device:GPUDevice;
let optimizationEnabled=true;
let scenario:Scenario='terrain';let pose:Pose={x:-1.65,y:0.63,z:0,angle:0};
const actuator=new BucketActuator({...pose});
let actuation:'force'|'kinematic'='force';
let paused=false,support=true,cycle=false,cycleStart=0,simTime=0,debt=0,lastSteps=0;
let snapshot:Snapshot|null=null;
let surfaceStats:SurfaceStats|null=null;
let snapshotPending:Promise<void>|null=null;
let pendingReset=false,resetResolvers:Array<()=>void>=[];
let dead=false,frameBusy=false,lastFrame=performance.now(),lastSnapshot=0,lastHUD=0;
const keys=new Set<string>();
const perf=new PerformanceWindow();
let adapterDescription:Record<string,unknown>={};
let benchmark:{started:number;duration:number;perf:PerformanceWindow;gpuTimes:number[];maxPenetration:number;maxInvalid:number;maxBucketMass:number;maxPermanentCompaction:number;maxBucketCompression:number}|null=null;
let lastReport:Record<string,unknown>|null=null;

function requestReset():Promise<void>{if(dead)return Promise.reject(new Error('The GPU runtime has stopped; reload after correcting the reported error.'));pendingReset=true;return new Promise(resolve=>resetResolvers.push(resolve));}
async function resetLab(){
  if(solver){await snapshotPending;await device.queue.onSubmittedWorkDone();}
  if(scenario!=='terrain'&&element<HTMLSelectElement>('points').value==='terrain')element<HTMLSelectElement>('points').value='4096';
  const seed=seedScenario(scenario,Number(element<HTMLSelectElement>('points').value),material);
  const terrain=scenario==='terrain';
  const next=new SoilSolver(device,seed,terrain ? 0.25 : Number(element<HTMLSelectElement>('resolution').value),terrain);
  next.useBoundaryCache=optimizationEnabled;
  await next.init();
  await scene.attachParticles(seed,next.positions,next.state,terrain);solver?.destroy();solver=next;
  pose={...seed.pose};actuator.reset(pose);
  actuator.lower=terrain?[-5.1,.58,-5.1,-1.4]:[-2.1,.58,-1.1,-1.4];actuator.upper=terrain?[5.1,3,5.1,1.4]:[2.1,3,1.1,1.4];
  element<HTMLSelectElement>('resolution').disabled=terrain;element<HTMLSelectElement>('points').disabled=terrain;
  element<HTMLOptionElement>('terrain-budget').hidden=!terrain;
  if(terrain){element<HTMLSelectElement>('resolution').value='0.25';set('terrain-budget',`${seed.count.toLocaleString()} terrain points`);element<HTMLSelectElement>('points').value='terrain';}
  next.updateTerrain(pose,0);simTime=0;debt=0;snapshot=null;surfaceStats=null;support=true;cycle=false;
  scene.setBucket(pose);scene.setSupports(colliders(pose,[0,0,0],0,support,scenario==='collapse'));scene.updateMaterial(colliders(pose,[0,0,0],0,support,scenario==='collapse'),0);
  element('support').hidden=scenario!=='collapse';element('support').textContent='Remove support';
  set('scenario-title',SCENARIOS[scenario].title);set('scenario-description',SCENARIOS[scenario].description);
  set('particle-count',`${seed.count.toLocaleString()} material points`);set('memory',`${(solver.estimatedBytes/1048576).toFixed(1)} MiB`);
  set('visual-memory',`${(scene.visualBufferBytes/1048576).toFixed(1)} MiB`);
  set('message','');set('cycle','Run scoop cycle');perf.reset();lastFrame=performance.now();lastSnapshot=0;
  pendingReset=false;resetResolvers.splice(0).forEach(resolve=>resolve());
}
function scriptPose(time:number):Pose{
  // Smooth prescribed motion used only to exercise material contacts, not animate the soil.
  const points: [number,Pose][]=[
    [0,{x:-1.65,y:0.63,z:0,angle:0}], [3,{x:0.35,y:0.63,z:0,angle:0}],
    [5,{x:0.35,y:0.82,z:0,angle:0.9}], [8,{x:-0.8,y:2.1,z:0,angle:0.9}],
    [11,{x:-0.8,y:2.1,z:0,angle:-0.9}], [13,{x:-1.65,y:0.9,z:0,angle:0}],
    [15,{x:-1.65,y:0.63,z:0,angle:0}],
  ];
  const t=Math.min(15,Math.max(0,time));const end=points.findIndex(([at])=>at>=t);
  if(end===0)return {...points[0][1]};
  const [a,pa]=points[end-1],[b,pb]=points[end];const raw=(t-a)/(b-a),u=raw*raw*(3-2*raw);
  return {x:pa.x+(pb.x-pa.x)*u,y:pa.y+(pb.y-pa.y)*u,z:0,angle:pa.angle+(pb.angle-pa.angle)*u};
}
function moveBucket(duration:number):{velocity:[number,number,number];omega:number}{
  const old={...pose};
  if(actuation==='force') {
    const axis=(positive:string,negative:string)=>(keys.has(positive)?1:0)-(keys.has(negative)?1:0);
    const speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?0.25:0.7;
    const commands=[axis('KeyD','KeyA'),axis('KeyW','KeyS'),axis('KeyE','KeyQ'),axis('KeyR','KeyF')].map(v=>v*speed);
    const motion=actuator.step(duration,commands,cycle?scriptPose(simTime-cycleStart+duration):undefined);
    pose={...actuator.pose};
    if(cycle&&simTime-cycleStart>=15){cycle=false;set('cycle','Run scoop cycle');}
    return motion;
  }
  if(cycle){pose=scriptPose(simTime-cycleStart+duration);if(simTime-cycleStart>=15){cycle=false;set('cycle','Run scoop cycle');}}
  else {
    const axis=(positive:string,negative:string)=>(keys.has(positive)?1:0)-(keys.has(negative)?1:0);
    const speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?0.25:0.7;
    pose.x=Math.max(actuator.lower[0],Math.min(actuator.upper[0],pose.x+axis('KeyD','KeyA')*speed*duration));
    pose.y=Math.max(0.58,Math.min(3,pose.y+axis('KeyW','KeyS')*speed*duration));
    pose.z=Math.max(actuator.lower[2],Math.min(actuator.upper[2],pose.z+axis('KeyE','KeyQ')*speed*duration));
    pose.angle=Math.max(-1.4,Math.min(1.4,pose.angle+axis('KeyR','KeyF')*speed*duration));
  }
  return {velocity:[(pose.x-old.x)/duration,(pose.y-old.y)/duration,(pose.z-old.z)/duration],omega:(pose.angle-old.angle)/duration};
}
function diagnostics(){
  const terrain=solver.terrain?.report();set('chunk-status',terrain?`${terrain.activeChunks} active · ${terrain.sleepingOccupiedChunks} asleep`:'');
  set('lift-effort',actuation==='force'?`${(actuator.effort[1]/1000).toFixed(1)} kN`:'Prescribed');
  set('curl-effort',actuation==='force'?`${(actuator.effort[3]/1000).toFixed(1)} kN·m`:'Prescribed');
  set('contact-torque',`${(actuator.reaction[3]/1000).toFixed(1)} kN·m`);
  const p=perf.summary();set('fps',p.fps.toFixed(0));set('rate',`${p.simulationRate.toFixed(2)} × simulation`);set('p95',`${p.p95Ms.toFixed(1)} ms`);
  set('sim-time',`${simTime.toFixed(2)} s`);set('debt',`${(debt*1000).toFixed(0)} ms`);set('substeps',`${(solver.timestep(material)*1000).toFixed(2)} ms / ${lastSteps}`);
  set('surface-time',surfaceStats?.gpuMs!=null?`${surfaceStats.gpuMs.toFixed(2)} ms`:'—');
  set('triangles',surfaceStats?surfaceStats.triangles.toLocaleString():'—');set('grains',surfaceStats?String(surfaceStats.activeGrains):'—');
  if(surfaceStats?.overflowTriangles)set('message','Surface capacity exceeded; some triangles were omitted. Reduce point budget or reset.');
  if(!snapshot)return;
  set('compaction',`${snapshot.permanentCompactionPercent.toFixed(2)} %`);set('elastic-volume',`${(-snapshot.elasticCompressionPercent).toFixed(2)} %`);set('pressure',`${(snapshot.maxPressurePa/1000).toFixed(1)} kPa`);
  set('mass',`${snapshot.massErrorPercent.toFixed(5)} %`);set('speed',`${snapshot.maxSpeed.toFixed(2)} m/s`);
  set('energy',`${snapshot.kineticEnergy.toFixed(0)} J`);set('penetration',`${snapshot.penetrationMm.toFixed(2)} mm`);
  set('load',`${snapshot.bucketMass.toFixed(0)} kg`);set('bucket-volume',`${snapshot.bucketDeformedVolume.toFixed(3)} m³`);set('reaction',`${Math.hypot(...snapshot.reactionN).toFixed(0)} N`);
  set('invalid',`${snapshot.invalidParticles}`);set('gpu-time',snapshot.gpuMs===null?'Unavailable':`${snapshot.gpuMs.toFixed(2)} ms`);
}
function report(){return {
  schema:4,optimizations:optimizationEnabled,terrain:solver.terrain?.report(),actuation,bucketDynamics:actuator.report(),createdAt:new Date().toISOString(),adapter:adapterDescription,scenario,material:{...material},
  solver:{method:'MLS-MPM / APIC, experimental cohesive Hencky plasticity',dx:solver.dx,grid:solver.dimensions,points:solver.count,allocatedBytes:solver.estimatedBytes,boundaryCache:solver.useBoundaryCache,dt:solver.timestep(material)},
  simulationSeconds:simTime,timeDebtSeconds:debt,bucketPose:{...pose},supportPresent:support,performance:perf.summary(),snapshot,rendering:{mode:scene.mode,detailEnabled:scene.detailEnabled,allocatedVisualBytes:scene.visualBufferBytes,surface:surfaceStats},
  limitations:[...(solver.terrain?['12 m development terrain; planned 40 m map and deeper ground are unfinished.','Sleeping boundary chunks act as fixed support until awakened; sparse execution still uses dense grid storage.']:[]),'Restricted four-axis fixture; full machine joints and chassis are not implemented.','Soil contact is coupled once per frame batch; this is a coupling prototype, not calibrated hydraulics.','No explicit pore water, drainage, or engineering calibration.','Fixed-point grid accumulation introduces quantization.','CPU diagnostic readback is included in wall-time measurements.','Solver buffer allocation excludes renderer and driver memory.'],
};}
async function startBenchmark():Promise<void>{
  if(benchmark)return;
  await requestReset();paused=false;set('pause','Pause');
  benchmark={started:performance.now(),duration:15000,perf:new PerformanceWindow(Infinity),gpuTimes:[],maxPenetration:0,maxInvalid:0,maxBucketMass:0,maxPermanentCompaction:0,maxBucketCompression:0};
  if(scenario==='scoop'||scenario==='terrain'){cycle=true;cycleStart=0;set('cycle','Stop scoop cycle');}
  element<HTMLButtonElement>('benchmark').disabled=true;
  for(const id of ['scenario','resolution','points','reset','pause','cycle','support','view-mode','spill-detail','actuation','strength']) (element(id) as HTMLInputElement).disabled=true;
  for(const [key] of sliderSpecs)element<HTMLInputElement>(key).disabled=true;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.disabled=true);
}
function finishBenchmark(){
  if(!benchmark)return;
  const result={...report(),benchmark:{wallSeconds:(performance.now()-benchmark.started)/1000,...benchmark.perf.summary(),gpuComputeSamples:benchmark.gpuTimes,maxPenetrationMm:benchmark.maxPenetration,maxInvalidParticles:benchmark.maxInvalid,maxBucketMassKg:benchmark.maxBucketMass,maxPermanentCompactionPercent:benchmark.maxPermanentCompaction,maxBucketElasticCompressionPercent:benchmark.maxBucketCompression}};
  lastReport=result;
  const p=benchmark.perf.summary();
  const gpu=String(adapterDescription.description??'').toLowerCase();
  const vega=/vega|cezanne|amd.*gcn-5/.test(gpu)&&!/swiftshader|llvmpipe/.test(gpu);
  const adequate=p.p95Ms<=16.7&&p.simulationRate>=0.98&&benchmark.maxInvalid===0;
  set('benchmark-status',`${adequate?'Frame budget met in this run.':'Frame budget not met in this run.'} ${p.fps.toFixed(1)} FPS · p95 ${p.p95Ms.toFixed(1)} ms · simulation ${p.simulationRate.toFixed(2)}×. ${vega?'Vega reported.':'Vega target not verified.'} Export for the full report.`);
  benchmark=null;
  for(const id of ['benchmark','scenario','resolution','points','reset','pause','cycle','support','view-mode','spill-detail','actuation','strength']) (element(id) as HTMLInputElement).disabled=false;
  if(scenario==='terrain'){element<HTMLSelectElement>('resolution').disabled=true;element<HTMLSelectElement>('points').disabled=true;}
  for(const [key]of sliderSpecs)element<HTMLInputElement>(key).disabled=false;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.disabled=false);
}
function fail(error:unknown){dead=true;element('loading').hidden=false;set('loading',`The physics lab could not run.\n${error instanceof Error?error.message:String(error)}`);console.error(error);set('message',String(error));}
const instanceId=crypto.randomUUID();
let benchmarkSuspended=false;
import.meta.hot?.on('diggy:benchmark-isolation',(data:{owner:string;active:boolean})=>{
  if(data.owner===instanceId)return;
  benchmarkSuspended=data.active;
  lastFrame=performance.now();keys.clear();
  set('benchmark-status',data.active?'Another local Diggy measurement is running. This demo will resume automatically.':'Local measurement finished; this demo has resumed.');
});
let advancingManually=false;
async function frame(){
  if(dead)return;
  requestAnimationFrame(()=>void frame());
  if(frameBusy||advancingManually||benchmarkSuspended)return;
  if(document.hidden&&!pendingReset){lastFrame=performance.now();debt=0;return;}
  frameBusy=true;
  try {
    if(pendingReset){await resetLab();}
    const now=performance.now(),wallDelta=(now-lastFrame)/1000;lastFrame=now;
    const dt=solver.timestep(material);
    if(!paused&&!document.hidden)debt+=wallDelta;
    lastSteps=paused||document.hidden?0:Math.min(48,Math.floor(debt/dt));
    let boxes=colliders(pose,[0,0,0],0,support,scenario==='collapse');
    if(lastSteps>0){const elapsed=lastSteps*dt;const motion=moveBucket(elapsed);boxes=colliders(pose,motion.velocity,motion.omega,support,scenario==='collapse');solver.updateTerrain(pose,simTime);solver.step(lastSteps,material,boxes);simTime+=elapsed;debt-=elapsed;}
    const feedback=lastSteps>0&&actuation==='force'?solver.contactFeedback():null;
    if(benchmark&&scenario==='collapse'&&simTime>2&&support){support=false;boxes=colliders(pose,[0,0,0],0,support,true);scene.setSupports(boxes);set('support','Support removed');}
    scene.setBucket(pose);scene.updateMaterial(boxes,lastSteps*dt);scene.render();
    // Force feedback gates the next physics submission. Render commands stay
    // ordered on the same GPU queue, so the next step cannot overwrite their
    // shared buffers early; at most one render remains beyond this feedback.
    if(feedback)actuator.contact(await feedback,lastSteps*dt);
    else await device.queue.onSubmittedWorkDone();
    if(now-lastSnapshot>(solver.terrain?250:750)&&!snapshotPending){
      lastSnapshot=now;
      snapshotPending=Promise.all([solver.snapshot(boxes),scene.surfaceDiagnostics()]).then(([result,visual])=>{
        snapshot=result;surfaceStats=visual;
        if(benchmark&&snapshot){
          benchmark.maxPenetration=Math.max(benchmark.maxPenetration,snapshot.penetrationMm);
          benchmark.maxInvalid=Math.max(benchmark.maxInvalid,snapshot.invalidParticles);
          benchmark.maxBucketMass=Math.max(benchmark.maxBucketMass,snapshot.bucketMass);
          benchmark.maxPermanentCompaction=Math.max(benchmark.maxPermanentCompaction,snapshot.permanentCompactionPercent);
          if(snapshot.bucketMass>10)benchmark.maxBucketCompression=Math.max(benchmark.maxBucketCompression,100*(1-snapshot.bucketDeformedVolume/snapshot.bucketRestVolume));
          if(snapshot.gpuMs!==null)benchmark.gpuTimes.push(snapshot.gpuMs);
        }
        if(snapshot&&snapshot.invalidParticles>0){paused=true;set('pause','Resume');set('message','Invalid state detected. Simulation paused; reset and reduce stiffness or increase resolution.');}
      }).catch(fail).finally(()=>{snapshotPending=null;});
    }
    // Frame intervals include feedback gating and CPU work; GPU renders overlap in queue order.
    if(wallDelta>0&&wallDelta<10){perf.add(wallDelta*1000,lastSteps*dt);benchmark?.perf.add(wallDelta*1000,lastSteps*dt);}
    if(now-lastHUD>=200){diagnostics();lastHUD=now;}
    if(benchmark){const remaining=Math.max(0,(benchmark.duration-(performance.now()-benchmark.started))/1000);set('benchmark-status',`Measuring… ${remaining.toFixed(0)} s remaining. Active ${scenario} experiment.`);if(remaining<=0)finishBenchmark();}
  }catch(error){fail(error);}finally{frameBusy=false;}
}

element('actuation').addEventListener('change',()=>{actuation=element<HTMLSelectElement>('actuation').value as 'force'|'kinematic';actuator.reset(pose);});
element('strength').addEventListener('change',()=>{actuator.strength=Number(element<HTMLSelectElement>('strength').value);});
element('scenario').addEventListener('change',()=>{scenario=element<HTMLSelectElement>('scenario').value as Scenario;if(scenario!=='terrain'&&element<HTMLSelectElement>('resolution').value==='0.25')element<HTMLSelectElement>('resolution').value='0.125';void requestReset();});
for(const id of ['resolution','points'])element(id).addEventListener('change',()=>void requestReset());
element('view-mode').addEventListener('change',()=>{scene.setMode(element<HTMLSelectElement>('view-mode').value as 'surface'|'points');surfaceStats=null;});
element('spill-detail').addEventListener('change',()=>scene.setDetail(element<HTMLInputElement>('spill-detail').checked));
element('reset').addEventListener('click',()=>void requestReset());
element('pause').addEventListener('click',()=>{paused=!paused;debt=0;set('pause',paused?'Resume':'Pause');});
element('cycle').addEventListener('click',()=>{cycle=!cycle;cycleStart=simTime;set('cycle',cycle?'Stop scoop cycle':'Run scoop cycle');});
element('support').addEventListener('click',()=>{support=!support;scene.setSupports(colliders(pose,[0,0,0],0,support,scenario==='collapse'));set('support',support?'Remove support':'Restore support');});
for(const [key]of sliderSpecs){element(key).addEventListener('input',()=>{material[key]=Number(element<HTMLInputElement>(key).value);updateSliders();document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));});element(key).addEventListener('change',()=>void requestReset());}
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button=>button.addEventListener('click',()=>{material={...presets[button.dataset.preset!]};document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b===button));updateSliders();void requestReset();}));
element('benchmark').addEventListener('click',()=>void startBenchmark());
element('export').addEventListener('click',()=>{const data=lastReport??report();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`diggy-${scenario}-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);});
const canvas=document.querySelector('canvas')!;
canvas.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();if(!benchmark)element('pause').click();}else{keys.add(event.code);if(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyR','KeyF'].includes(event.code))event.preventDefault();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{keys.clear();debt=0;lastFrame=performance.now();});
window.addEventListener('resize',()=>scene?.resize());

async function init(){
  if(!navigator.gpu)throw new Error('WebGPU is unavailable. Open localhost in a browser with WebGPU enabled. This lab does not substitute CPU physics.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});
  if(!adapter)throw new Error('No WebGPU adapter is available. Check browser GPU settings.');
  const info=adapter.info;
  const description=[info.vendor,info.architecture,info.device,info.description].filter(Boolean).join(' · ');
  adapterDescription={description:description||'Adapter identity not exposed',vendor:info.vendor,architecture:info.architecture,device:info.device,isFallbackAdapter:info.isFallbackAdapter,powerPreference:'low-power',timestampQueries:adapter.features.has('timestamp-query')};
  const features:GPUFeatureName[]=adapter.features.has('timestamp-query')?['timestamp-query']:[];
  device=await adapter.requestDevice({requiredFeatures:features});
  device.addEventListener('uncapturederror',event=>fail(new Error(event.error.message)));device.lost.then(info=>{if(!dead)fail(new Error(`GPU device lost: ${info.message}`));});
  scene=new LabScene(canvas,device);await scene.init();scene.resize();await resetLab();
  const software=/swiftshader|llvmpipe|software/.test(description.toLowerCase())||info.isFallbackAdapter;
  set('gpu-badge',`${description||'GPU identity hidden'}${software?' · SOFTWARE ADAPTER':''}`);
  set('message',software?'Software adapter detected. Useful for correctness tests; this cannot validate Vega performance.':/vega|cezanne|amd.*gcn-5/i.test(description)?'Integrated Vega adapter reported. Run the measurement to test the frame budget.':'Low-power adapter requested. Verify the reported device before treating results as Vega measurements.');
  element('loading').hidden=true;
  // Small public diagnostic API used by automated verification; not part of gameplay state.
  (window as unknown as {diggy:unknown}).diggy={
    ready:true,adapter:adapterDescription,
    report:()=>lastReport??report(),
    liveReport:report,
    instanceId,
    setOptimizations:(enabled:boolean)=>{optimizationEnabled=enabled;solver.useBoundaryCache=enabled;scene.setProxyCompaction(enabled);lastReport=null;},
    terrainChunks:()=>solver.terrain?Array.from(solver.terrain.modes):null,
    setActuation:(mode:'force'|'kinematic',strength=1)=>{actuation=mode;actuator.reset(pose);actuator.strength=strength;element<HTMLSelectElement>('actuation').value=mode;element<HTMLSelectElement>('strength').value=String(strength);},
    drive:async(commands:number[],steps=32)=>{
      paused=true;debt=0;while(frameBusy)await new Promise(resolve=>setTimeout(resolve,5));advancingManually=true;
      try {
        await snapshotPending;const dt=steps*solver.timestep(material);
        const motion=actuator.step(dt,commands);pose={...actuator.pose};
        const boxes=colliders(pose,motion.velocity,motion.omega,support,scenario==='collapse');
        solver.updateTerrain(pose,simTime);solver.step(steps,material,boxes);actuator.contact(await solver.contactFeedback(),dt);simTime+=dt;
        scene.setBucket(pose);scene.updateMaterial(boxes,dt);scene.render();
        snapshot=await solver.snapshot(boxes);
        return {pose:{...pose},dynamics:actuator.report(),snapshot};
      }finally{advancingManually=false;lastFrame=performance.now();}
    },
    pause:()=>{paused=true;debt=0;set('pause','Resume');},
    reset:async(next:Scenario,preset='soil',points=4096,dx=0.125)=>{scenario=next;material={...presets[preset]};updateSliders();document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===preset));element<HTMLSelectElement>('scenario').value=next;element<HTMLSelectElement>('points').value=String(points);element<HTMLSelectElement>('resolution').value=String(dx);await requestReset();},
    advance:async(steps:number)=>{
      paused=true;debt=0;
      while(frameBusy)await new Promise(resolve=>setTimeout(resolve,5));
      advancingManually=true;
      try{
        await snapshotPending;
        const boxes=colliders(pose,[0,0,0],0,support,scenario==='collapse');
        solver.updateTerrain(pose,simTime);solver.step(steps,material,boxes);await device.queue.onSubmittedWorkDone();simTime+=steps*solver.timestep(material);
        snapshot=await solver.snapshot(boxes);scene.updateMaterial(boxes,steps*solver.timestep(material));scene.render();await device.queue.onSubmittedWorkDone();surfaceStats=await scene.surfaceDiagnostics();diagnostics();return snapshot;
      }finally{advancingManually=false;lastFrame=performance.now();}
    },
    removeSupport:()=>{support=false;scene.setSupports(colliders(pose,[0,0,0],0,false,scenario==='collapse'));},
    particles:async()=>{const data=await solver.readParticles();return {positions:Array.from(data.positions),states:Array.from(data.states)};},
    terrainCacheProbe:async(preset='soil',batches=180)=>{
      paused=true;while(frameBusy)await new Promise(resolve=>setTimeout(resolve,5));advancingManually=true;
      const settings=presets[preset],seed=seedScenario('terrain',4096,settings);
      const reference=new SoilSolver(device,seed,.25,true),cached=new SoilSolver(device,seed,.25,true);
      reference.useBoundaryCache=false;
      try{
        await snapshotPending;await reference.init();await cached.init();
        const bodies=[new BucketActuator({...seed.pose}),new BucketActuator({...seed.pose})];
        for(const body of bodies){body.lower=[-5.1,.58,-5.1,-1.4];body.upper=[5.1,3,5.1,1.4];}
        const dt=32*cached.timestep(settings);let maxPositionDifference=0,maxStateDifference=0,maxReactionDifference=0,comparisons=0;
        const times:number[][]=[[],[]];
        for(let batch=0;batch<batches;batch++){
          const command=batch<60?[.7,-.12,0,0]:batch<100?[0,.15,0,.7]:batch<145?[-.4,.7,0,0]:[0,0,.4,-.7];
          for(const [index,solver]of [reference,cached].entries()){
            const body=bodies[index],motion=body.step(dt,command),boxes=colliders(body.pose,motion.velocity,motion.omega,true,false);
            solver.updateTerrain(body.pose,batch*dt);solver.step(32,settings,boxes);body.contact(await solver.contactFeedback(),dt);
            if(batch%8===0){const snap=await solver.snapshot(boxes);if(snap?.invalidParticles)throw new Error('Invalid cache comparison');if(snap?.gpuMs!=null)times[index].push(snap.gpuMs);}
          }
          maxReactionDifference=Math.max(maxReactionDifference,...bodies[0].reaction.map((v,i)=>Math.abs(v-bodies[1].reaction[i])));
          if(batch%20===0||batch===batches-1){
            const a=await reference.readParticles(),b=await cached.readParticles();comparisons++;
            for(let i=0;i<a.positions.length;i++)maxPositionDifference=Math.max(maxPositionDifference,Math.abs(a.positions[i]-b.positions[i]));
            for(let i=0;i<a.states.length;i++)maxStateDifference=Math.max(maxStateDifference,Math.abs(a.states[i]-b.states[i]));
          }
        }
        return {preset,batches,simulatedSeconds:batches*dt,comparisons,maxPositionDifference,maxStateDifference,maxReactionDifference,gpuMs:{reference:times[0],cached:times[1]}};
      }finally{reference.destroy();cached.destroy();advancingManually=false;lastFrame=performance.now();}
    },
    terrainSupportProbe:async()=>{
      const settings=presets.wet,source=seedScenario('clump',4096,settings);
      const count=32,positions=new Float32Array(count*4),states=new Float32Array(count*36);
      for(let i=0;i<count;i++){
        positions.set([.9+(i%4)*.1,1.9+(Math.floor(i/4)%4)*.1,.9+Math.floor(i/16)*.1,11.6],i*4);
        states.set(source.states.slice(0,36),i*36);states[i*36+3]=.008;
      }
      const far={x:-5,y:1,z:-5,angle:0},seed={positions,states,count,mass:11.6*count,volume:.008*count,pose:far};
      const probe=new SoilSolver(device,seed,.25,true);await probe.init();
      try{
        const initial=probe.terrain!.report();let result:Snapshot|null=null,time=0;
        for(let i=0;i<60;i++){probe.updateTerrain(far,time);probe.step(32,settings,[]);time+=32*probe.timestep(settings);result=await probe.snapshot([]);}
        return {initial,final:result,terrain:probe.terrain!.report(),seconds:time};
      }finally{probe.destroy();}
    },
    singleParticle:async(offset=0,budget=4096)=>{
      const seed=seedScenario('pour',budget,presets.sand);
      const p=seed.positions.slice(0,4);p.set([offset,2+offset,offset*0.7]);const state=seed.states.slice(0,36);
      const probeSeed={...seed,positions:p,states:state,count:1,mass:p[3],volume:state[3]};
      const probe=new SoilSolver(device,probeSeed,0.125);await probe.init();
      const visual=new MaterialSurface(device,probeSeed,probe.positions,probe.state);
      const radiusReadback=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{
        const steps=240;probe.step(steps,presets.sand,[]);await visual.init();visual.update([],0,false);
        const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(visual.grains,visual.spillCount*32,radiusReadback,0,16);device.queue.submit([encoder.finish()]);
        await radiusReadback.mapAsync(GPUMapMode.READ);const visibleRadius=new Float32Array(radiusReadback.getMappedRange())[3];radiusReadback.unmap();
        return {snapshot:await probe.snapshot([]),surface:await visual.diagnostics(),visibleRadius,referenceRadius:Math.cbrt(state[3]*3/(4*Math.PI)),seconds:steps*probe.timestep(presets.sand),initialY:2+offset};
      }finally{radiusReadback.destroy();visual.destroy();probe.destroy();}
    },
    volumeHistory:async()=>{
      const seed=seedScenario('pour',4096,presets.sand);
      const position=seed.positions.slice(0,4);position.set([0,2,0]);
      const state=seed.states.slice(0,36);
      const probe=new SoilSolver(device,{...seed,positions:position,states:state,count:1,mass:position[3],volume:state[3]},0.125);await probe.init();
      try{
        const stages=[];
        for(const strain of [0.2,-0.1,-0.15]){
          state.fill(0,0,3);state.fill(0,4,28);
          state[4]=state[9]=state[14]=Math.exp(strain);
          device.queue.writeBuffer(probe.state,0,state);
          probe.step(1,presets.sand,[]);await device.queue.onSubmittedWorkDone();
          const result=await probe.readParticles();state.set(result.states);
          stages.push({strain,dilation:state[34],elasticStretch:[state[4],state[9],state[14]]});
        }
        return stages;
      }finally{probe.destroy();}
    },
    compactionProbe:async(preset:string)=>{
      const settings=presets[preset],seed=seedScenario('pour',4096,settings);
      const position=seed.positions.slice(0,4);position.set([0,2,0]);const state=seed.states.slice(0,36);
      const probe=new SoilSolver(device,{...seed,positions:position,states:state,count:1,mass:position[3],volume:state[3]},0.125);await probe.init();
      try{
        const stages=[];
        for(const [pressure,cycles] of [[10000,20],[80000,20],[0,1]]){
          for(let i=0;i<cycles;i++){
            state.fill(0,0,3);state.fill(0,4,28);state[34]=0;
            state[4]=state[9]=state[14]=Math.exp(-pressure/(3*BULK_MODULUS));
            device.queue.writeBuffer(probe.state,0,state);probe.step(1,settings,[]);await device.queue.onSubmittedWorkDone();state.set((await probe.readParticles()).states);
          }
          stages.push({pressure,cycles,snapshot:await probe.snapshot([])});
        }
        return stages;
      }finally{probe.destroy();}
    },
    setView:(mode:'surface'|'points')=>{scene.setMode(mode);element<HTMLSelectElement>('view-mode').value=mode;surfaceStats=null;},
    setDetail:(enabled:boolean)=>{scene.setDetail(enabled);element<HTMLInputElement>('spill-detail').checked=enabled;},
    benchmark:startBenchmark,
  };
  requestAnimationFrame(()=>void frame());
}
void init().catch(fail);
