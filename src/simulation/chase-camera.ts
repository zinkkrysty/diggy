import {rotateYaw,type MachineBase} from './excavator';
export function chaseCameraFrame(base:MachineBase,distance=9.8){
  const [lookX,lookZ]=rotateYaw(1.3,0,base.yaw);
  const target={x:base.x+lookX,y:base.y+1.2,z:base.z+lookZ};
  const scale=distance/Math.hypot(8,5.5,1.2),[dx,dz]=rotateYaw(-8*scale,1.2*scale,base.yaw);
  return {target,position:{x:target.x+dx,y:target.y+5.5*scale,z:target.z+dz}};
}
