import { BULK_MODULUS, density, finesFromGrain, type MaterialSettings } from './material';
import { STATE_FLOATS, type Seed } from './scenarios';
import {colliderBounds,type Collider,type Pose} from './bucket';
export const TERRAIN_SIZE=24, CHUNK_SIZE=1, TERRAIN_HEIGHT=6;
export const TERRAIN_ORIGIN=[-12,-2,-12] as const;
export const TERRAIN_FLOOR=TERRAIN_ORIGIN[1]+.15;
export const SOIL_SPACING=.2;
export const CHUNK_DIMS=[24,6,24] as const;
export const CHUNK_COUNT=3456;
export function chunkAt(x:number,y:number,z:number):number {
  const c=[Math.floor(x+12),Math.floor(y-TERRAIN_ORIGIN[1]),Math.floor(z+12)];
  if(c.some((v,i)=>v<0||v>=CHUNK_DIMS[i]))return -1;
  return c[0]+c[1]*24+c[2]*144;
}
export function chunkCoord(i:number):number[]{return [i%24,Math.floor(i/24)%6,Math.floor(i/144)];}
export function neighbors(i:number):number[]{const c=chunkCoord(i),out:number[]=[];for(let a=0;a<3;a++)for(const d of [-1,1]){const n=[...c];n[a]+=d;if(n[a]>=0&&n[a]<CHUNK_DIMS[a])out.push(n[0]+n[1]*24+n[2]*144);}return out;}
export function haloNeighbors(i:number):number[]{
  const c=chunkCoord(i),out:number[]=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    if(x===0&&y===0&&z===0)continue;const n=[c[0]+x,c[1]+y,c[2]+z];
    if(n.every((v,a)=>v>=0&&v<CHUNK_DIMS[a]))out.push(n[0]+n[1]*24+n[2]*144);
  }
  return out;
}
/** Rounded clearing outline shared by the soil and its grass verge. */
export function terrainEdgeRadius(angle:number):number {
  return (11.25+.18*Math.sin(angle*3)+.1*Math.sin(angle*7))/Math.pow(Math.abs(Math.cos(angle))**6+Math.abs(Math.sin(angle))**6,1/6);
}
export function terrainTop(x:number,z:number):number {
  return .55+Math.max(0,1.35-Math.hypot(x-.8,z)*.65);
}
export function seedTerrain(material:MaterialSettings):Seed {
  const spacing=SOIL_SPACING,records:number[][]=[];
  // Unbroken dirt clearing: the road runs outside the western edge.
  for(let x=-11.9;x<11.9;x+=spacing)for(let z=-11.9;z<11.9;z+=spacing){
    if(Math.hypot(x,z)>terrainEdgeRadius(Math.atan2(z,x)))continue;
    const top=terrainTop(x,z);
    // Keep the original lattice above zero and add ten layers below it.
    for(let layer=-10;.25+layer*spacing<top;layer++){
      const y=.25+layer*spacing;records.push([x,y,z,y>.55?1:0]);
    }
  }
  const count=records.length,positions=new Float32Array(count*4),states=new Float32Array(count*STATE_FLOATS);let mass=0;
  records.forEach((p,i)=>{
    const water=p[3]?0:material.moisture,fine=p[3]?.1:finesFromGrain(material.grainMm),volume=spacing**3;
    const m=volume*density(water);mass+=m;positions.set([p[0],p[1],p[2],m],4*i);
    // Buried soil already carries its overburden. Waking it must not initiate
    // a fresh gravity-settling wave. Include the dry sand stockpile's weight.
    const sandDepth=Math.max(0,terrainTop(p[0],p[2])-Math.max(.55,p[1]));
    const pressure=9.81*(density(material.moisture)*Math.max(0,.55-p[1])+density(0)*sandDepth);
    const stretch=Math.exp(-pressure/(3*BULK_MODULUS)),o=i*STATE_FLOATS;
    // Reference volume compensates the elastic preload, preserving the exact
    // initial occupied volume and therefore the existing surface elevation.
    states[o+3]=volume/(stretch**3);
    states[o+4]=states[o+9]=states[o+14]=stretch;
    states[o+28]=water;states[o+29]=fine;states[o+32]=1;
  });
  return {count,positions,states,mass,volume:count*spacing**3,pose:{x:-1.65,y:1,z:0,angle:0}};
}
/** CPU scheduler only; all mass, composition, deformation and velocity stay on GPU. */
export class TerrainActivity {
  modes=new Uint32Array(CHUNK_COUNT); // 0 sleep, 1 moving, 2 fixed boundary halo
  private until=new Float64Array(CHUNK_COUNT);
  private occupied=new Uint8Array(CHUNK_COUNT);
  private voxels=new Uint8Array(96*24*96);
  private previousVoxels=new Uint8Array(96*24*96);
  private voxelList=new Uint32Array(96*24*96);
  private previousList=new Uint32Array(96*24*96);
  private previousCount=0;
  private supported=new Uint8Array(96*24*96);
  private queue=new Uint32Array(96*24*96);
  private moving=new Uint8Array(CHUNK_COUNT);
  private extents=new Float32Array(CHUNK_COUNT*6);
  private voxelCounts=new Uint32Array(96*24*96);
  private particleVoxels:Int32Array;
  private particleChunks:Int32Array;
  private members=Array.from({length:CHUNK_COUNT},()=>new Set<number>());
  private faces=Array.from({length:CHUNK_COUNT},(_,i)=>neighbors(i));
  private halos=Array.from({length:CHUNK_COUNT},(_,i)=>haloNeighbors(i));
  private centres=Array.from({length:CHUNK_COUNT},(_,i)=>{const c=chunkCoord(i);return [c[0]-11.5,c[1]+TERRAIN_ORIGIN[1]+.5,c[2]-11.5];});
  topologyRebuilds=0;
  private unsupported=new Set<number>();
  private time=0;
  private gridLayout?:{dx:number;dims:number[];start:Int32Array;end:Int32Array;y:Uint32Array;z:Uint32Array;nodes:Uint32Array};
  constructor(seed:Seed){
    this.particleVoxels=new Int32Array(seed.count).fill(-1);this.particleChunks=new Int32Array(seed.count).fill(-1);
    this.observe(seed.positions,seed.states,0);
  }
  wake(chunk:number,seconds=2):void{if(chunk<0)return;this.until[chunk]=Math.max(this.until[chunk],this.time+seconds);}
  observe(positions:Float32Array,states:Float32Array,time:number,stride=STATE_FLOATS):void {
    this.time=time;this.occupied.fill(0);this.voxels.fill(0);this.moving.fill(0);this.voxelCounts.fill(0);this.particleVoxels.fill(-1);this.particleChunks.fill(-1);
    for(const members of this.members)members.clear();
    for(let c=0;c<CHUNK_COUNT;c++){this.extents.fill(Infinity,c*6,c*6+3);this.extents.fill(-Infinity,c*6+3,c*6+6);}
    const width=96,height=24,plane=width*height;let count=0,changed=false;
    for(let i=0;i<positions.length/4;i++) {
      const x=positions[i*4],y=positions[i*4+1],z=positions[i*4+2],c=chunkAt(x,y,z);if(c<0)continue;this.occupied[c]=1;this.members[c].add(i);this.particleChunks[i]=c;
      const o=i*stride,vx=states[o],vy=states[o+1],vz=states[o+2];
      if(Math.hypot(vx,vy,vz)>.08)this.moving[c]=1;
      for(let axis=0;axis<3;axis++){
        const value=positions[i*4+axis],b=c*6+axis;
        this.extents[b]=Math.min(this.extents[b],value);this.extents[b+3]=Math.max(this.extents[b+3],value);
      }
      const v=Math.floor((x+12)/.25)+Math.floor((y-TERRAIN_ORIGIN[1])/.25)*width+Math.floor((z+12)/.25)*plane;
      this.particleVoxels[i]=v;this.voxelCounts[v]++;
      if(!this.voxels[v]){this.voxels[v]=1;this.voxelList[count++]=v;if(!this.previousVoxels[v])changed=true;}
    }
    // Moving material keeps its own chunk awake. A velocity fluctuation alone
    // must not activate a ring of previously undisturbed, supported soil.
    for(let c=0;c<CHUNK_COUNT;c++)if(this.moving[c])this.wake(c,.5);
    changed ||= count!==this.previousCount;
    if(changed){
      // Wake the material whose support was removed, not every adjoining
      // chunk. Sub-voxel settling otherwise propagates a wake front through
      // supported soil. Connectivity separately wakes all detached volumes.
      for(let i=0;i<this.previousCount;i++){
        const v=this.previousList[i],iy=Math.floor(v/width)%height;
        if(!this.voxels[v]&&iy<height-1&&this.voxels[v+width]){
          const c=chunkAt((v%width)*.25-12+.125,(iy+1)*.25+TERRAIN_ORIGIN[1]+.125,Math.floor(v/plane)*.25-12+.125);
          this.wake(c);
        }
      }
      this.rebuildSupport(this.voxels,this.voxelList,count);
    }
    // A stationary disconnected volume still wakes even when topology is unchanged.
    for(const c of this.unsupported){this.wake(c);for(const n of this.faces[c])this.wake(n);}
    [this.voxels,this.previousVoxels]=[this.previousVoxels,this.voxels];
    [this.voxelList,this.previousList]=[this.previousList,this.voxelList];this.previousCount=count;
  }
  private rebuildSupport(voxels:Uint8Array,list:Uint32Array,count:number):void {
    const width=96,height=24,plane=width*height;
      this.topologyRebuilds++;this.supported.fill(0);let head=0,tail=0;
      const visit=(v:number)=>{if(voxels[v]&&!this.supported[v]){this.supported[v]=1;this.queue[tail++]=v;}};
      for(let i=0;i<count;i++){const v=list[i];if(Math.floor(v/width)%height<=1)visit(v);}
      while(head<tail){
        const v=this.queue[head++],x=v%width,y=Math.floor(v/width)%height,z=Math.floor(v/plane);
        if(x>0)visit(v-1);if(x<width-1)visit(v+1);
        if(y>0)visit(v-width);if(y<height-1)visit(v+width);
        if(z>0)visit(v-plane);if(z<width-1)visit(v+plane);
      }
      this.unsupported.clear();
      for(let i=0;i<count;i++){
        const v=list[i];if(this.supported[v])continue;
        const x=v%width,y=Math.floor(v/width)%height,z=Math.floor(v/plane);
        this.unsupported.add(Math.floor(x/4)+Math.floor(y/4)*24+Math.floor(z/4)*144);
      }
  }
  /** Apply compact GPU feedback without rescanning unchanged samples. */
  observeChanges(positions:Float32Array,velocities:Float32Array,indices:Uint32Array,time:number):void {
    this.time=time;
    const touched=new Map<number,boolean>(),dirty=new Set<number>(),width=96,height=24,plane=width*height;
    for(const i of indices){
      const x=positions[i*4],y=positions[i*4+1],z=positions[i*4+2],chunk=chunkAt(x,y,z),oldChunk=this.particleChunks[i];
      if(oldChunk>=0)dirty.add(oldChunk);if(chunk>=0)dirty.add(chunk);
      if(chunk!==oldChunk){if(oldChunk>=0)this.members[oldChunk].delete(i);if(chunk>=0)this.members[chunk].add(i);this.particleChunks[i]=chunk;}
      const voxel=chunk<0?-1:Math.floor((x+12)/.25)+Math.floor((y-TERRAIN_ORIGIN[1])/.25)*width+Math.floor((z+12)/.25)*plane;
      const oldVoxel=this.particleVoxels[i];
      if(oldVoxel!==voxel){
        for(const v of [oldVoxel,voxel])if(v>=0&&!touched.has(v))touched.set(v,Boolean(this.previousVoxels[v]));
        if(oldVoxel>=0)this.voxelCounts[oldVoxel]--;if(voxel>=0)this.voxelCounts[voxel]++;
        this.particleVoxels[i]=voxel;
      }
    }
    for(const c of dirty){
      const offset=c*6;this.extents.fill(Infinity,offset,offset+3);this.extents.fill(-Infinity,offset+3,offset+6);
      this.occupied[c]=Number(this.members[c].size>0);this.moving[c]=0;
      for(const i of this.members[c]){
        if(Math.hypot(velocities[i*3],velocities[i*3+1],velocities[i*3+2])>.08)this.moving[c]=1;
        for(let axis=0;axis<3;axis++){const value=positions[i*4+axis],b=offset+axis;this.extents[b]=Math.min(this.extents[b],value);this.extents[b+3]=Math.max(this.extents[b+3],value);}
      }
      if(this.moving[c])this.wake(c,.5);
    }
    let changed=false;
    for(const [v,before]of touched){const occupied=this.voxelCounts[v]>0;this.previousVoxels[v]=Number(occupied);changed ||= occupied!==before;}
    if(changed){
      for(const [v,before]of touched)if(before&&!this.previousVoxels[v]&&Math.floor(v/width)%height<height-1&&this.previousVoxels[v+width]){
        const c=chunkAt((v%width)*.25-12+.125,(Math.floor(v/width)%height+1)*.25+TERRAIN_ORIGIN[1]+.125,Math.floor(v/plane)*.25-12+.125);
        this.wake(c);
      }
      let count=0;for(let v=0;v<this.previousVoxels.length;v++)if(this.previousVoxels[v])this.previousList[count++]=v;
      this.previousCount=count;this.rebuildSupport(this.previousVoxels,this.previousList,count);
    }
    for(const c of this.unsupported){this.wake(c);for(const n of this.faces[c])this.wake(n);}
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
  updateContacts(colliders:Collider[],time:number):void {
    this.time=time;
    const boxes=colliders.map(c=>({center:c.center,half:colliderBounds(c)}));
    for(let c=0;c<CHUNK_COUNT;c++){
      const offset=c*6;
      if(this.occupied[c]&&boxes.some(b=>b.center.every((v,a)=>
        this.extents[offset+a]<=v+b.half[a]+.3&&this.extents[offset+a+3]>=v-b.half[a]-.3)))this.wake(c,.25);
      this.modes[c]=this.until[c]>time?1:0;
    }
    const dynamic=this.modes.slice();
    for(let c=0;c<CHUNK_COUNT;c++)if(dynamic[c])for(const n of this.halos[c])if(!this.modes[n])this.modes[n]=2;
  }
  gridNodes(dx:number):Uint32Array {
    if(this.gridLayout?.dx!==dx){
      const dims=[24,6,24].map(v=>Math.round(v/dx)),start=new Int32Array(24).fill(-1),end=new Int32Array(24);
      // Use the original floor mapping, including non-integral cell/chunk ratios.
      for(let x=0;x<dims[0];x++){const c=Math.floor(x*dx);if(start[c]<0)start[c]=x;end[c]=x+1;}
      this.gridLayout={dx,dims,start,end,y:Uint32Array.from({length:dims[1]},(_,i)=>Math.floor(i*dx)*24),z:Uint32Array.from({length:dims[2]},(_,i)=>Math.floor(i*dx)*144),nodes:new Uint32Array(dims[0]*dims[1]*dims[2])};
    }
    const {dims,start,end,y:yc,z:zc,nodes}=this.gridLayout;let count=0;
    // Skip sleeping spans while preserving the reference's exact node order.
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++){
      const c=yc[y]+zc[z],row=(y+z*dims[1])*dims[0];
      for(let chunk=0;chunk<24;chunk++)if(this.modes[c+chunk]&&start[chunk]>=0){
        for(let x=start[chunk];x<end[chunk];x++)nodes[count++]=row+x;
      }
    }
    return nodes.slice(0,count);
  }
  report(){return {mapMetres:[24,6,24],chunkMetres:1,activeChunks:Array.from(this.modes).filter(v=>v===1).length,boundaryChunks:Array.from(this.modes).filter(v=>v===2).length,sleepingOccupiedChunks:Array.from(this.occupied).filter((v,i)=>v&&this.modes[i]===0).length,unsupportedChunks:this.unsupported.size};}
}
