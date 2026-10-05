import {seedTerrain} from './terrain';
import { density, finesFromGrain, type MaterialSettings } from './material';
import type { Pose } from './bucket';
export type Scenario = 'pour' | 'pile' | 'scoop' | 'clump' | 'mix' | 'collapse' | 'terrain';
export const SCENARIOS: Record<Scenario, { title: string; description: string }> = {
  terrain:{title:'Sandbox ground',description:'Dig and dump in the 24 m excavation clearing. Settled chunks sleep; removing support wakes connected material.'},
  pour: { title:'Pour & settle', description:'A suspended volume falls freely. Observe flow, slope formation, and settling.' },
  pile: { title:'Stable pile', description:'A steep mound relaxes under gravity. Friction should arrest sliding.' },
  scoop: { title:'Scoop & spill', description:'Push the open bucket into the bed, curl, lift, then tip to dump.' },
  clump: { title:'Clump breakup', description:'Drop a cohesive block. Compare fracture and spreading as moisture changes.' },
  mix: { title:'Material mixing', description:'Dry coarse sand and wet fine soil meet. Particle composition stays attached to the material.' },
  collapse: { title:'Undermine', description:'A soil bridge rests on two piers and removable support. Remove the support to test failure.' },
};
interface Block { low: number[]; high: number[]; water?: number; fine?: number }
export interface Seed { positions: Float32Array; states: Float32Array; count: number; mass: number; volume: number; pose: Pose }
export const STATE_FLOATS = 36;
export function seedScenario(scenario: Scenario, target: number, material: MaterialSettings): Seed {
  if(scenario==='terrain')return seedTerrain(material);
  let blocks: Block[];
  switch(scenario) {
    case 'pour': blocks=[{low:[-0.65,2,-0.65],high:[0.65,3,0.65]}]; break;
    case 'pile': blocks=[{low:[-0.8,0.2,-0.8],high:[0.8,1.6,0.8]}]; break;
    case 'scoop': blocks=[{low:[-0.65,0.2,-0.75],high:[1.4,1.05,0.75]}]; break;
    case 'clump': blocks=[{low:[-0.65,2,-0.55],high:[0.65,2.8,0.55]}]; break;
    case 'mix': blocks=[{low:[-1.3,1.5,-0.6],high:[0,2.6,0.6],water:0,fine:0.1},{low:[0,1.5,-0.6],high:[1.3,2.6,0.6],water:0.62,fine:0.8}]; break;
    case 'collapse': blocks=[{low:[-1.3,1.02,-0.55],high:[1.3,1.6,0.55]}]; break;
  }
  const totalVolume=blocks.reduce((sum,b)=>sum+b.high.reduce((v,h,i)=>v*(h-b.low[i]),1),0);
  const spacing=Math.cbrt(totalVolume/target);
  const records: number[][]=[];
  let randomState=123456;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  for(const block of blocks) {
    const dims=block.high.map((v,i)=>Math.max(1,Math.floor((v-block.low[i])/spacing)));
    const step=block.high.map((v,i)=>(v-block.low[i])/dims[i]);
    const vol=step.reduce((v,n)=>v*n,1);
    for(let x=0;x<dims[0];x++)for(let y=0;y<dims[1];y++)for(let z=0;z<dims[2];z++) {
      const p=[x,y,z].map((n,i)=>block.low[i]+(n+0.5+(random()-0.5)*0.6)*step[i]);
      records.push([...p,vol,block.water??material.moisture,block.fine??finesFromGrain(material.grainMm)]);
    }
  }
  const count=records.length,positions=new Float32Array(count*4),states=new Float32Array(count*STATE_FLOATS);
  let mass=0;
  records.forEach((r,i)=> {
    const m=r[3]*density(r[4]);mass+=m;
    positions.set([r[0],r[1],r[2],m],i*4);
    const o=i*STATE_FLOATS;
    states[o+3]=r[3];
    states[o+4]=states[o+9]=states[o+14]=1; // deformation gradient F = identity
    states[o+28]=r[4];states[o+29]=r[5]; // moisture and fines
    states[o+32]=1; // plastic volume; history +33 damage, +34 stress-free dilation
  });
  return {positions,states,count,mass,volume:totalVolume,pose:{x:scenario==='scoop'?-1.65:-2.1,y:scenario==='scoop'?0.63:1,z:0,angle:0}};
}
