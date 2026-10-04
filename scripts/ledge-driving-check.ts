import assert from 'node:assert/strict';
import {Chassis} from '../src/physics/chassis';
import {Excavator} from '../src/simulation/excavator';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('.local/artifacts',{recursive:true});await Chassis.init();const results=[];
for(const droppedSide of [-1,1]){
 const c=new Chassis(),p:number[]=[];
 function ground(dropped:boolean){p.length=0;for(let x=-5.8;x<5.9;x+=.2)for(let z=-5.8;z<5.9;z+=.2){const top=dropped&&z*droppedSide>.1?.55:1.35;for(let y=.25;y<top;y+=.2)p.push(x,y,z,1);}c.updateGround(Float32Array.from(p));}
 ground(false);c.body.setTranslation({x:-3,y:1.8,z:0},true);
 const bucket={x:5.8,y:4,z:0};for(let i=0;i<90;i++)c.step(1/60,0,0,bucket);
 ground(true);for(let i=0;i<180;i++)c.step(1/60,0,0,bucket);
 const start=c.base;assert.ok(Math.abs(start.basis![5])>.1,'Ledge drop must roll the chassis');
 const m=new Excavator();m.base=start;m.base.y+=1.4;const armStart=m.pose().y;
 for(let i=0;i<100;i++)m.step(.032,{boom:-1,stick:0,curl:0,swing:0});assert.ok(m.pose().y<armStart-.1,'Arm must recover while rolled');
 for(let i=0;i<180;i++)c.step(1/60,1,0,bucket);const end=c.base;
 assert.ok(end.x-start.x>.6,`Supported belt must propel across ledge: ${end.x-start.x}`);
 results.push({droppedSide,start,end,armHeightChange:m.pose().y-armStart});c.destroy();
}
await writeFile('.local/artifacts/ledge-driving-validation.json',JSON.stringify(results,null,2));console.log(results.map(r=>({side:r.droppedSide,distance:r.end.x-r.start.x,arm:r.armHeightChange})));
