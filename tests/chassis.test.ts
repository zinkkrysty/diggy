import test from 'node:test';
import assert from 'node:assert/strict';
import {Chassis} from '../src/physics/chassis';
import {seedTerrain} from '../src/simulation/terrain';
import {presets} from '../src/simulation/material';

test('excavator drives along the roadside and can enter the dirt clearing',async()=>{
 await Chassis.init();const chassis=new Chassis();
 try{
  chassis.updateGround(seedTerrain(presets.soil).positions);
  const bucket={x:-12,y:2,z:0};
  chassis.body.setRotation({x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2},true);
  for(let i=0;i<60;i++)chassis.step(1/60,0,0,bucket);
  for(let i=0;i<600;i++)chassis.step(1/60,1,0,bucket);
  assert.ok(chassis.base.z<-5,'Must travel along the road');
  assert.ok(Math.abs(chassis.base.x+14.4)<.15,'Road travel must stay straight');
  assert.ok(chassis.base.y>.95&&chassis.base.y<1.1,'Tracks stay supported on asphalt');
  chassis.body.setTranslation({x:-14.4,y:1.03,z:0},true);
  chassis.body.setRotation({x:0,y:0,z:0,w:1},true);
  chassis.body.setLinvel({x:0,y:0,z:0},true);chassis.body.setAngvel({x:0,y:0,z:0},true);
  for(let i=0;i<720;i++)chassis.step(1/60,1,0,bucket);
  assert.ok(chassis.base.x>-8,'Must cross the shoulder into the excavation clearing');
  assert.ok(chassis.base.y>.9,'The verge must support the tracks');
 }finally{chassis.destroy();}
});
