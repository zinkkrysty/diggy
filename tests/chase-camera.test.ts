import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chaseCameraFrame} from '../src/simulation/chase-camera';
import {rotateYaw} from '../src/simulation/excavator';
test('Third-person camera remains above and behind the chassis through turns',()=>{
 for(const yaw of [0,.6,Math.PI/2,Math.PI,-Math.PI]){
  const base={x:2,y:1,z:-3,yaw},frame=chaseCameraFrame(base),[fx,fz]=rotateYaw(1,0,yaw);
  assert.ok((frame.position.x-base.x)*fx+(frame.position.z-base.z)*fz<0);
  assert.ok(frame.position.y>base.y+4);
  assert.ok((frame.target.x-base.x)*fx+(frame.target.z-base.z)*fz>0);
  assert.ok(Math.abs(Math.hypot(frame.position.x-frame.target.x,frame.position.y-frame.target.y,frame.position.z-frame.target.z)-9.8)<1e-9);
 }
});
