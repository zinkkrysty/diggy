import { density, finesFromGrain, type MaterialSettings } from './material';
import { STATE_FLOATS, type Seed } from './scenarios';
import type { Pose } from './bucket';
export const TERRAIN_SIZE=12, CHUNK_SIZE=1, TERRAIN_HEIGHT=4;
export const TERRAIN_ORIGIN=[-6,0,-6] as const;
export const CHUNK_DIMS=[12,4,12] as const;
export const CHUNK_COUNT=576;
export function chunkAt(x:number,y:number,z:number):number {
  const c=[Math.floor(x+6),Math.floor(y),Math.floor(z+6)];
  if(c.some((v,i)=>v<0||v>=CHUNK_DIMS[i]))return -1;
  return c[0]+c[1]*12+c[2]*48;
}
export function chunkCoord(i:number):number[]{return [i%12,Math.floor(i/12)%4,Math.floor(i/48)];}
export function neighbors(i:number):number[]{const c=chunkCoord(i),out:number[]=[];for(let a=0;a<3;a++)for(const d of [-1,1]){const n=[...c];n[a]+=d;if(n[a]>=0&&n[a]<CHUNK_DIMS[a])out.push(n[0]+n[1]*12+n[2]*48);}return out;}
export function haloNeighbors(i:number):number[]{
  const c=chunkCoord(i),out:number[]=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    if(x===0&&y===0&&z===0)continue;const n=[c[0]+x,c[1]+y,c[2]+z];
    if(n.every((v,a)=>v>=0&&v<CHUNK_DIMS[a]))out.push(n[0]+n[1]*12+n[2]*48);
  }
  return out;
}
export function seedTerrain(material:MaterialSettings):Seed {
  const spacing=.2,records:number[][]=[];
  // A low bed plus a taller bank: side access makes the first excavation playable.
  for(let x=-5.5;x<5.5;x+=spacing)for(let z=-5.5;z<5.5;z+=spacing){
    const top=x>-.6&&x<3.4&&Math.abs(z)<2?1.35:.55;
    for(let y=.25;y<top;y+=spacing)records.push([x,y,z]);
  }
  const count=records.length,positions=new Float32Array(count*4),states=new Float32Array(count*STATE_FLOATS);let mass=0;
  records.forEach((p,i)=>{const volume=spacing**3,m=volume*density(material.moisture);mass+=m;positions.set([...p,m],4*i);const o=i*STATE_FLOATS;states[o+3]=volume;states[o+4]=states[o+9]=states[o+14]=1;states[o+28]=material.moisture;states[o+29]=finesFromGrain(material.grainMm);states[o+32]=1;});
  return {count,positions,states,mass,volume:count*spacing**3,pose:{x:-1.65,y:1,z:0,angle:0}};
}
/** CPU scheduler only; all mass, composition, deformation and velocity stay on GPU. */
export class TerrainActivity {
  modes=new Uint32Array(CHUNK_COUNT); // 0 sleep, 1 moving, 2 fixed boundary halo
  private until=new Float64Array(CHUNK_COUNT);
  private occupied=new Uint8Array(CHUNK_COUNT);
  private voxels=new Uint8Array(48*16*48);
  private previousVoxels=new Uint8Array(48*16*48);
  private voxelList=new Uint32Array(48*16*48);
  private previousList=new Uint32Array(48*16*48);
  private previousCount=0;
  private supported=new Uint8Array(48*16*48);
  private queue=new Uint32Array(48*16*48);
  private moving=new Uint8Array(CHUNK_COUNT);
  private faces=Array.from({length:CHUNK_COUNT},(_,i)=>neighbors(i));
  private halos=Array.from({length:CHUNK_COUNT},(_,i)=>haloNeighbors(i));
  private centres=Array.from({length:CHUNK_COUNT},(_,i)=>{const c=chunkCoord(i);return [c[0]-5.5,c[1]+.5,c[2]-5.5];});
  topologyRebuilds=0;
  private unsupported=new Set<number>();
  private time=0;
  constructor(seed:Seed){this.observe(seed.positions,seed.states,0);}
  wake(chunk:number,seconds=2):void{if(chunk<0)return;this.until[chunk]=Math.max(this.until[chunk],this.time+seconds);}
  observe(positions:Float32Array,states:Float32Array,time:number):void {
    this.time=time;this.occupied.fill(0);this.voxels.fill(0);this.moving.fill(0);
    const width=48,height=16,plane=width*height;let count=0,changed=false;
    for(let i=0;i<positions.length/4;i++) {
      const x=positions[i*4],y=positions[i*4+1],z=positions[i*4+2],c=chunkAt(x,y,z);if(c<0)continue;this.occupied[c]=1;
      const o=i*STATE_FLOATS,vx=states[o],vy=states[o+1],vz=states[o+2];
      if(Math.hypot(vx,vy,vz)>.08)this.moving[c]=1;
      const v=Math.floor((x+6)/.25)+Math.floor(y/.25)*width+Math.floor((z+6)/.25)*plane;
      if(!this.voxels[v]){this.voxels[v]=1;this.voxelList[count++]=v;if(!this.previousVoxels[v])changed=true;}
    }
    for(let c=0;c<CHUNK_COUNT;c++)if(this.moving[c]){this.wake(c);for(const n of this.faces[c])this.wake(n);}
    changed ||= count!==this.previousCount;
    if(changed){
      for(let i=0;i<this.previousCount;i++){
        const v=this.previousList[i],iy=Math.floor(v/width)%height;
        if(!this.voxels[v]&&iy<height-1&&this.voxels[v+width]){
          const c=chunkAt((v%width)*.25-6+.125,iy*.25+.125,Math.floor(v/plane)*.25-6+.125);
          this.wake(c);if(c>=0)for(const n of this.faces[c])this.wake(n);
        }
      }
      this.topologyRebuilds++;this.supported.fill(0);let head=0,tail=0;
      const visit=(v:number)=>{if(this.voxels[v]&&!this.supported[v]){this.supported[v]=1;this.queue[tail++]=v;}};
      for(let i=0;i<count;i++){const v=this.voxelList[i];if(Math.floor(v/width)%height<=1)visit(v);}
      while(head<tail){
        const v=this.queue[head++],x=v%width,y=Math.floor(v/width)%height,z=Math.floor(v/plane);
        if(x>0)visit(v-1);if(x<width-1)visit(v+1);
        if(y>0)visit(v-width);if(y<height-1)visit(v+width);
        if(z>0)visit(v-plane);if(z<width-1)visit(v+plane);
      }
      this.unsupported.clear();
      for(let i=0;i<count;i++){
        const v=this.voxelList[i];if(this.supported[v])continue;
        const x=v%width,y=Math.floor(v/width)%height,z=Math.floor(v/plane);
        this.unsupported.add(Math.floor(x/4)+Math.floor(y/4)*12+Math.floor(z/4)*48);
      }
    }
    // A stationary disconnected volume still wakes even when topology is unchanged.
    for(const c of this.unsupported){this.wake(c);for(const n of this.faces[c])this.wake(n);}
    [this.voxels,this.previousVoxels]=[this.previousVoxels,this.voxels];
    [this.voxelList,this.previousList]=[this.previousList,this.voxelList];this.previousCount=count;
  }
  update(pose:Pose,time:number,extra:Pose[]=[]):void {
    this.time=time;
    for(let i=0;i<CHUNK_COUNT;i++) {
      const c=this.centres[i];const distance=Math.hypot(c[0]-pose.x,c[1]-pose.y,c[2]-pose.z);
      if(distance<1.7||extra.some(p=>Math.hypot(c[0]-p.x,c[1]-p.y,c[2]-p.z)<2))this.wake(i,.5);
      this.modes[i]=this.until[i]>time?1:0;
    }
    const dynamic=this.modes.slice();for(let i=0;i<CHUNK_COUNT;i++)if(dynamic[i])for(const n of this.halos[i])if(!this.modes[n])this.modes[n]=2;
  }
  gridNodes(dx:number):Uint32Array {
    const dims=[12,4,12].map(v=>Math.round(v/dx)),nodes:number[]=[];
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++) {
      const c=Math.floor(x*dx)+Math.floor(y*dx)*12+Math.floor(z*dx)*48;
      if(this.modes[c])nodes.push(x+y*dims[0]+z*dims[0]*dims[1]);
    }
    return Uint32Array.from(nodes);
  }
  report(){return {mapMetres:[12,4,12],chunkMetres:1,activeChunks:Array.from(this.modes).filter(v=>v===1).length,boundaryChunks:Array.from(this.modes).filter(v=>v===2).length,sleepingOccupiedChunks:Array.from(this.occupied).filter((v,i)=>v&&this.modes[i]===0).length,unsupportedChunks:this.unsupported.size};}
}
