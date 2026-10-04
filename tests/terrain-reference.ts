import {STATE_FLOATS,type Seed} from '../src/simulation/scenarios';
import type {Pose} from '../src/simulation/bucket';
import {CHUNK_COUNT,chunkAt,chunkCoord,neighbors,haloNeighbors} from '../src/simulation/terrain';
export class ReferenceTerrainActivity {
  modes=new Uint32Array(CHUNK_COUNT); // 0 sleep, 1 moving, 2 fixed boundary halo
  private until=new Float64Array(CHUNK_COUNT);
  private occupied=new Uint8Array(CHUNK_COUNT);
  private previousVoxels=new Set<number>();
  private unsupported=new Set<number>();
  private time=0;
  constructor(seed:Seed){this.observe(seed.positions,seed.states,0);}
  wake(chunk:number,seconds=2):void{if(chunk<0)return;this.until[chunk]=Math.max(this.until[chunk],this.time+seconds);}
  observe(positions:Float32Array,states:Float32Array,time:number):void {
    this.time=time;this.occupied.fill(0);const voxels=new Set<number>();const owners=new Map<number,number>();const width=48,height=16;
    for(let i=0;i<positions.length/4;i++) {
      const x=positions[i*4],y=positions[i*4+1],z=positions[i*4+2],c=chunkAt(x,y,z);if(c<0)continue;this.occupied[c]=1;
      const vx=states[i*STATE_FLOATS],vy=states[i*STATE_FLOATS+1],vz=states[i*STATE_FLOATS+2];
      if(Math.hypot(vx,vy,vz)>.08){this.wake(c);for(const n of neighbors(c))this.wake(n);}
      const ix=Math.floor((x+6)/.25),iy=Math.floor(y/.25),iz=Math.floor((z+6)/.25);
      const v=ix+iy*width+iz*width*height;voxels.add(v);owners.set(v,c);
    }
    // Removing occupied support wakes adjoining chunks even when their material
    // has not moved yet. No height field: connectivity is three-dimensional.
    for(const v of this.previousVoxels)if(!voxels.has(v)&&voxels.has(v+width)) {
      const ix=v%width,iy=Math.floor(v/width)%height,iz=Math.floor(v/(width*height));
      const c=chunkAt(ix*.25-6+.125,iy*.25+.125,iz*.25-6+.125);this.wake(c);if(c>=0)for(const n of neighbors(c))this.wake(n);
    }
    const supported=new Set<number>(),queue:number[]=[];
    for(const v of voxels)if(Math.floor(v/width)%height<=1){supported.add(v);queue.push(v);}
    for(let head=0;head<queue.length;head++) {
      const v=queue[head],c=[v%width,Math.floor(v/width)%height,Math.floor(v/(width*height))];
      for(let a=0;a<3;a++)for(const d of [-1,1]){const n=[...c];n[a]+=d;if(n[a]<0||n[a]>=[width,height,width][a])continue;const j=n[0]+n[1]*width+n[2]*width*height;if(voxels.has(j)&&!supported.has(j)){supported.add(j);queue.push(j);}}
    }
    this.unsupported.clear();for(const v of voxels)if(!supported.has(v)){const c=owners.get(v)!;this.unsupported.add(c);this.wake(c);for(const n of neighbors(c))this.wake(n);}
    this.previousVoxels=voxels;
  }
  update(pose:Pose,time:number):void {
    this.time=time;
    for(let i=0;i<CHUNK_COUNT;i++) {
      const c=chunkCoord(i);const distance=Math.hypot(c[0]-5.5-pose.x,c[1]+.5-pose.y,c[2]-5.5-pose.z);
      if(distance<1.7)this.wake(i,.5);
      this.modes[i]=this.until[i]>time?1:0;
    }
    const dynamic=Array.from(this.modes);for(let i=0;i<CHUNK_COUNT;i++)if(dynamic[i])for(const n of haloNeighbors(i))if(!this.modes[n])this.modes[n]=2;
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
