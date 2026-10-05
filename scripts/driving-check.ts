import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {Chassis} from '../src/physics/chassis';
import {seedTerrain} from '../src/simulation/terrain';
import {presets} from '../src/simulation/material';
await Chassis.init();const results=[];
for(const preset of ['sand','soil','wet']){
 const c=new Chassis();c.body.setTranslation({x:-3.7,y:1,z:0},true);c.updateGround(seedTerrain(presets[preset]).positions);
 for(let i=0;i<60;i++)c.step(1/60,0,0,{x:-1,y:2,z:0});
 const start=c.base;
 for(let i=0;i<120;i++)c.step(1/60,1,0,{x:-1,y:2,z:0});
 const forward=c.base;assert.ok(forward.x-start.x>.9,'Tracks must cover useful distance on level ground');assert.ok(Math.abs(forward.z-start.z)<.03,'Straight drive must not veer');
 for(let i=0;i<60;i++)c.step(1/60,0,0,{x:-1,y:2,z:0});const stopped=c.body.linvel();assert.ok(Math.hypot(stopped.x,stopped.z)<.015,'Release must brake');
 for(let i=0;i<120;i++)c.step(1/60,-1,0,{x:4.95,y:2,z:0});
 const reverse=c.base;assert.ok(forward.x-reverse.x>.9,'Reverse must remain available away from a bucket boundary');
 for(let i=0;i<120;i++)c.step(1/60,0,1,{x:-1,y:2,z:0});
 const turn=c.base;assert.ok(turn.yaw-reverse.yaw>.25,`Counter-rotating tracks must steer in place: ${JSON.stringify({reverse,turn})}`);assert.ok(c.trackTravel[0]!==c.trackTravel[1]);
 c.body.setTranslation({x:-3,y:4,z:0},true);c.body.setLinvel({x:0,y:0,z:0},true);c.body.setAngvel({x:0,y:0,z:0},true);
 c.world.timestep=1/60;c.world.step();const air=c.base;
 for(let i=0;i<10;i++)c.step(1/60,1,1,{x:-1,y:4,z:0});
 assert.ok(Math.abs(c.base.x-air.x)<.001,'Airborne tracks cannot propel');assert.ok(Math.abs(c.base.yaw-air.yaw)<.001,'Airborne tracks cannot steer');
 results.push({preset,start,forward,reverse,turn,stopped,trackTravel:c.trackTravel});c.destroy();
}
await mkdir('.local/artifacts',{recursive:true});await writeFile('.local/artifacts/driving-validation.json',JSON.stringify({results},null,2));console.log(JSON.stringify(results));
