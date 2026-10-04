import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {Chassis} from '../src/physics/chassis';
await mkdir('.local/artifacts',{recursive:true});await Chassis.init();const results=[];
for(const degrees of [20,30,50]){
 const p:number[]=[]; const slope=Math.tan(degrees*Math.PI/180);
 for(let x=-5.8;x<5.9;x+=.2)for(let z=-5.8;z<5.9;z+=.2){const top=.55+Math.min(1.2,Math.max(0,(x+2)*slope));for(let y=.25;y<top;y+=.2)p.push(x,y,z,1);}
 const c=new Chassis();c.updateGround(new Float32Array(p));for(let i=0;i<60;i++)c.step(1/60,0,0,{x:-1,y:2,z:0});
 let tilt=0;for(let i=0;i<840;i++){c.step(1/60,1,0,{x:-1,y:2,z:0});tilt=Math.max(tilt,Math.asin(c.base.basis![1]));}const result={degrees,x:c.base.x,height:c.base.y,peakPitch:tilt};results.push(result);if(degrees<=30){assert.ok(result.x>1,`Must climb ${degrees} degree pile`);assert.ok(result.height>2.1);assert.ok(tilt>.2);}else assert.ok(result.x<-.8,'Very steep slope must restrict climbing');c.destroy();
}
await writeFile('.local/artifacts/pile-driving-validation.json',JSON.stringify(results,null,2));console.log(results);
