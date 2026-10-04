import {yawPitchBasis,transform,inverseTransform,type Basis} from './rigid-transform';
export interface Pose { x: number; y: number; z: number; angle: number; yaw?: number; basis?:Basis }
export interface Collider { center: [number, number, number]; half: [number, number, number]; angle: number; velocity: [number, number, number]; omega: number; bucket: boolean; yaw?: number; yawOmega?: number; basis?:Basis; angularVelocity?:[number,number,number] }
export const BUCKET_PARTS = [
  { center: [0, -0.34, 0], half: [0.59, 0.06, 0.61] },
  { center: [-0.54, 0.02, 0], half: [0.06, 0.36, 0.61] },
  { center: [0, 0.02, -0.56], half: [0.59, 0.36, 0.05] },
  { center: [0, 0.02, 0.56], half: [0.59, 0.36, 0.05] },
] as const;
export function colliders(pose: Pose, velocity: [number, number, number], omega: number, support: boolean, collapse: boolean): Collider[] {
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const result: Collider[] = BUCKET_PARTS.map(part => {
    const [x,y,z] = part.center;
    return { center: [pose.x+c*x-s*y, pose.y+s*x+c*y, pose.z+z], half: [...part.half], angle: pose.angle,
      velocity: [velocity[0]-omega*(s*x+c*y), velocity[1]+omega*(c*x-s*y), velocity[2]], omega, bucket: true };
  });
  if (collapse) {
    for (const x of [-1.05, 1.05]) result.push({center: [x,0.57,0],half: [0.2,0.42,0.62],angle:0,velocity:[0,0,0],omega:0,bucket:false});
    if (support) result.push({center:[0,0.94,0],half:[0.85,0.05,0.62],angle:0,velocity:[0,0,0],omega:0,bucket:false});
  }
  return result;
}
export function boxDistance(point: number[], box: Collider): { distance: number; normal: number[] } {
  const basis=colliderBasis(box),d=point.map((v,i)=>v-box.center[i]);
  const local=inverseTransform(basis,d);
  const q=local.map((v,i)=>Math.abs(v)-box.half[i]);
  const outside=q.map(v=>Math.max(0,v));
  const length=Math.hypot(...outside);
  let n: number[];
  if(length>1e-9) n=outside.map((v,i)=>v/length*(local[i]<0?-1:1));
  else { const axis=q.indexOf(Math.max(...q)); n=[0,0,0]; n[axis]=local[axis]<0?-1:1; }
  return {distance:length+Math.min(Math.max(...q),0),normal:transform(basis,n)};
}
/** Conservative world AABB of a yaw/pitch oriented contact box. */
export function colliderBounds(box:Collider):[number,number,number]{
  const b=colliderBasis(box);return [0,1,2].map(i=>Math.abs(b[i])*box.half[0]+Math.abs(b[3+i])*box.half[1]+Math.abs(b[6+i])*box.half[2]) as [number,number,number];
}
export function colliderBasis(box:Collider):Basis{return box.basis??yawPitchBasis(box.yaw??0,box.angle);}
export function writeColliderRotation(f:Float32Array,offset:number,box:Collider){
  const b=colliderBasis(box),yaw=box.yaw??0,w=box.angularVelocity??[-Math.sin(yaw)*box.omega,box.yawOmega??0,Math.cos(yaw)*box.omega];
  f.set([b[0],b[1],b[2],0,b[3],b[4],b[5],0,b[6],b[7],b[8],0,...w,0],offset);
}
