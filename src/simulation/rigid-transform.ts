export type Basis=[number,number,number,number,number,number,number,number,number];
export const IDENTITY_BASIS:Basis=[1,0,0,0,1,0,0,0,1];
export function yawPitchBasis(yaw:number,pitch=0):Basis{const cy=Math.cos(yaw),sy=Math.sin(yaw),c=Math.cos(pitch),s=Math.sin(pitch);return [cy*c,s,-sy*c,-cy*s,c,sy*s,sy,0,cy];}
export function quaternionBasis(q:{x:number;y:number;z:number;w:number}):Basis{
 const {x,y,z,w}=q;return [1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)];
}
export function transform(b:Basis,v:readonly number[]):[number,number,number]{return [b[0]*v[0]+b[3]*v[1]+b[6]*v[2],b[1]*v[0]+b[4]*v[1]+b[7]*v[2],b[2]*v[0]+b[5]*v[1]+b[8]*v[2]];}
export function inverseTransform(b:Basis,v:readonly number[]):[number,number,number]{return [b[0]*v[0]+b[1]*v[1]+b[2]*v[2],b[3]*v[0]+b[4]*v[1]+b[5]*v[2],b[6]*v[0]+b[7]*v[1]+b[8]*v[2]];}
export function multiplyBasis(a:Basis,b:Basis):Basis{return [...transform(a,b.slice(0,3)),...transform(a,b.slice(3,6)),...transform(a,b.slice(6,9))] as Basis;}
export function cross(a:readonly number[],b:readonly number[]):[number,number,number]{return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
export function angularDelta(before:Basis,after:Basis,dt:number):[number,number,number]{const w=[0,0,0];for(let c=0;c<3;c++){const v=cross(before.slice(c*3,c*3+3),after.slice(c*3,c*3+3));v.forEach((n,i)=>w[i]+=n/(2*dt));}return w as [number,number,number];}
