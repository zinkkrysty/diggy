import {terrainSurfaceTiles,SURFACE_TILE_COUNT,SURFACE_TILE_AXIS,SURFACE_TILE_CELLS,SURFACE_TILE_HALO,SURFACE_TILE_VERTICES} from './terrain-tiles';
import {TERRAIN_ORIGIN,TERRAIN_FLOOR,TERRAIN_HEIGHT} from '../simulation/terrain';
import shader from './surface.wgsl?raw';
import type { Seed } from '../simulation/scenarios';
import {writeColliderRotation,colliderBounds,type Collider } from '../simulation/bucket';

export interface SurfaceStats { vertices:number; triangles:number; overflowTriangles:number; activeGrains:number;sparseSamples:number; gpuMs:number|null; updatedTiles:number; cachedTiles:number; drawnProxyInstances:number;drawnSpillInstances:number }
/** GPU-resident, camera-independent visual density surface. Physics buffers are read-only. */
export class MaterialSurface {
  readonly spacing:number;
  readonly dimensions:number[];
  readonly vertexCapacity:number;
  readonly tileCount:number;
  readonly spillCount=2048;
  private tileUniforms:GPUBuffer[]=[];
  private tileBindings:GPUBindGroup[]=[];
  private previousClipTiles=new Set<number>();
  private initialized=false;
  private updatedTiles=0;
  readonly grainCount:number;
  readonly vertices:GPUBuffer;
  readonly normals:GPUBuffer;
  readonly indirect:GPUBuffer;
  readonly grains:GPUBuffer;
  readonly estimatedBytes:number;
  useProxyCompaction=true;
  private field:GPUBuffer;
  private uniform:GPUBuffer;
  private counters:GPUBuffer;
  private readback:GPUBuffer;
  private pipelines:GPUComputePipeline[]=[];
  private bindGroup!:GPUBindGroup;
  private query?:GPUQuerySet;
  private queryResolve?:GPUBuffer;
  private reading=false;
  private frame=0;
  private cellCount:number;
  constructor(readonly device:GPUDevice,readonly seed:Seed,private positions:GPUBuffer,private state:GPUBuffer,private terrain=false){
    this.spacing=terrain ? 0.16 : 0.06;this.dimensions=terrain?[151,Math.ceil(TERRAIN_HEIGHT/.16)+1,151]:[101,68,68];this.tileCount=terrain?SURFACE_TILE_COUNT:1;this.vertexCapacity=terrain?SURFACE_TILE_VERTICES*SURFACE_TILE_COUNT:393216;
    this.grainCount=this.spillCount+seed.count;
    this.cellCount=this.dimensions.reduce((a,b)=>a*b,1);
    const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
    const create=(label:string,size:number,usage:number)=>device.createBuffer({label,size,usage});
    this.field=create('Visual material density',this.cellCount*8,storage);
    this.vertices=create('Reconstructed surface positions and color',this.vertexCapacity*16,storage|GPUBufferUsage.VERTEX);
    this.normals=create('Reconstructed surface normals',this.vertexCapacity*16,storage|GPUBufferUsage.VERTEX);
    this.indirect=create('Cached tile and proxy indirect draws',48*this.tileCount,storage|GPUBufferUsage.INDIRECT);
    this.grains=create('Massless visual spill grains',this.grainCount*32,storage|GPUBufferUsage.VERTEX);
    this.uniform=create('Surface parameters',1248,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    this.counters=create('Tile surface capacity and active grains',(4+this.tileCount*2)*4,storage);
    this.readback=create('Surface diagnostic readback',80,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    if(device.features.has('timestamp-query')){
      this.query=device.createQuerySet({type:'timestamp',count:2});
      this.queryResolve=create('Surface timing resolve',16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC);
    }
    this.estimatedBytes=this.field.size+this.vertices.size+this.normals.size+this.indirect.size+this.grains.size+this.uniform.size+this.counters.size+this.readback.size+this.tileCount*1248+(this.queryResolve?.size??0);
  }
  async init():Promise<void>{
    const module=this.device.createShaderModule({label:'Material density reconstruction',code:shader});
    const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw new Error(errors.map(e=>`Surface WGSL ${e.lineNum}: ${e.message}`).join('\n'));
    const layout=this.device.createBindGroupLayout({entries:[0,1,2,3,4,5,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===6?'uniform' as const:binding<2?'read-only-storage' as const:'storage' as const}}))});
    const pipelineLayout=this.device.createPipelineLayout({bindGroupLayouts:[layout]});
    this.pipelines=await Promise.all(['clear','splat','clip','extract','grains','finalize','clearDetail','finalizeTile'].map(entryPoint=>this.device.createComputePipelineAsync({label:`Surface ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint}})));
    const bind=(uniform:GPUBuffer)=>this.device.createBindGroup({layout,entries:[this.positions,this.state,this.field,this.vertices,this.normals,this.indirect,uniform,this.grains,this.counters].map((buffer,binding)=>({binding,resource:{buffer}}))});
    this.bindGroup=bind(this.uniform);
    if(this.terrain)for(let tile=0;tile<this.tileCount;tile++){
      const uniform=this.device.createBuffer({label:`Terrain tile ${tile} parameters`,size:1248,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.tileUniforms.push(uniform);this.tileBindings.push(bind(uniform));
    }
  }
  update(boxes:Collider[],dt:number,detailEnabled:boolean,modes?:Uint32Array):void{
    const data=new ArrayBuffer(1248),f=new Float32Array(data),u=new Uint32Array(data);
    const sampleSpacing=Math.cbrt(this.seed.volume/this.seed.count);
    u.set([...this.dimensions,this.seed.count]);
    // Local support: smooth neighboring samples, without connecting far-separated pieces.
    f.set([this.spacing,sampleSpacing*1.85,0.12,this.vertexCapacity],4);
    f.set([dt,sampleSpacing,detailEnabled?1:0,this.terrain?TERRAIN_FLOOR:.15],8);
    f.set([...(this.terrain?TERRAIN_ORIGIN:[-3,0,-2]),this.frame++],12);
    boxes.slice(0,8).forEach((b,i)=>{f.set([...b.center,b.angle,...b.half,b.omega,...b.velocity,b.bucket?1:0],16+i*12);f.set([b.yaw??0,b.yawOmega??0,Math.cos(b.yaw??0),Math.sin(b.yaw??0)],116+i*4);f.set([...colliderBounds(b),0],148+i*4);writeColliderRotation(f,180+i*16,b);});
    u[112]=Math.min(8,boxes.length);u[113]=this.spillCount;u[114]=this.useProxyCompaction?1:0;u[115]=240;
    u[308]=this.tileCount;
    this.device.queue.writeBuffer(this.uniform,0,data);
    const dirty=this.terrain&&this.initialized&&modes?terrainSurfaceTiles(modes,boxes):new Set(Array.from({length:this.tileCount},(_,i)=>i));
    for(const tile of this.previousClipTiles)dirty.add(tile);
    this.previousClipTiles=this.terrain?terrainSurfaceTiles(new Uint32Array(0),boxes):new Set();
    this.updatedTiles=dirty.size;
    if(this.terrain)for(const tile of dirty){
      const tileData=data.slice(0),tf=new Float32Array(tileData),tu=new Uint32Array(tileData);
      tf[7]=SURFACE_TILE_VERTICES;tu.set([tile,(tile%SURFACE_TILE_AXIS)*SURFACE_TILE_CELLS,Math.floor(tile/SURFACE_TILE_AXIS)*SURFACE_TILE_CELLS,SURFACE_TILE_CELLS],308);
      this.device.queue.writeBuffer(this.tileUniforms[tile],0,tileData);
    }
    const encoder=this.device.createCommandEncoder({label:'Material surface and spill detail'});
    const pass=encoder.beginComputePass({label:'Visual reconstruction',...(this.query?{timestampWrites:{querySet:this.query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{})});
    pass.setBindGroup(0,this.bindGroup);pass.setPipeline(this.pipelines[6]);pass.dispatchWorkgroups(1);
    const tileNodes=(SURFACE_TILE_CELLS+2*SURFACE_TILE_HALO+1)**2*this.dimensions[1];
    const cells=this.terrain?tileNodes:this.cellCount;
    for(const tile of dirty){
      pass.setBindGroup(0,this.terrain?this.tileBindings[tile]:this.bindGroup);
      const counts=[Math.ceil(cells/128),Math.ceil(this.seed.count/64),Math.ceil(cells/128),Math.ceil(cells/64)];
      for(let phase=0;phase<4;phase++){pass.setPipeline(this.pipelines[phase]);pass.dispatchWorkgroups(counts[phase]);}
      pass.setPipeline(this.pipelines[7]);pass.dispatchWorkgroups(1);
    }
    pass.setBindGroup(0,this.bindGroup);pass.setPipeline(this.pipelines[4]);pass.dispatchWorkgroups(Math.ceil(this.grainCount/64));
    pass.setPipeline(this.pipelines[5]);pass.dispatchWorkgroups(1);
    this.initialized=true;
    pass.end();if(this.query)encoder.resolveQuerySet(this.query,0,2,this.queryResolve!,0);
    this.device.queue.submit([encoder.finish()]);
  }
  async diagnostics():Promise<SurfaceStats|null>{
    if(this.reading)return null;this.reading=true;
    try{
      const encoder=this.device.createCommandEncoder({label:'Surface diagnostics'});
      encoder.copyBufferToBuffer(this.counters,0,this.readback,0,16);
      if(this.queryResolve)encoder.copyBufferToBuffer(this.queryResolve,0,this.readback,16,16);
      encoder.copyBufferToBuffer(this.indirect,0,this.readback,32,48);
      this.device.queue.submit([encoder.finish()]);await this.readback.mapAsync(GPUMapMode.READ);
      const data=this.readback.getMappedRange(),counters=new Uint32Array(data,0,4);
      const times=new BigUint64Array(data,16,2),draws=new Uint32Array(data,32,12);
      const vertices=Math.min(this.vertexCapacity,counters[0]);
      const result={drawnProxyInstances:draws[5],drawnSpillInstances:draws[9],vertices,triangles:vertices/3,overflowTriangles:counters[1],activeGrains:counters[2],sparseSamples:counters[3],updatedTiles:this.updatedTiles,cachedTiles:this.tileCount-this.updatedTiles,gpuMs:this.query?Number(times[1]-times[0])/1e6:null};
      this.readback.unmap();return result;
    }finally{this.reading=false;}
  }
  destroy():void{for(const buffer of [...this.tileUniforms,this.field,this.vertices,this.normals,this.indirect,this.grains,this.uniform,this.counters,this.readback,this.queryResolve])buffer?.destroy();this.query?.destroy();}
}
