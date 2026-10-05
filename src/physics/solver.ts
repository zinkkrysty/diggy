import {TerrainActivity,TERRAIN_ORIGIN,CHUNK_COUNT,CHUNK_DIMS,TERRAIN_FLOOR} from '../simulation/terrain';
import shader from './solver.wgsl?raw';
import { stableTimestep, BULK_MODULUS, BULK_DAMPING, COMPACTION_YIELD, COMPACTION_HARDENING, type MaterialSettings } from '../simulation/material';
import { STATE_FLOATS, type Seed } from '../simulation/scenarios';
import type { ContactFeedback } from '../simulation/actuator';
import {colliderBasis,writeColliderRotation,colliderBounds, type Collider } from '../simulation/bucket';

export interface Snapshot {
  mass: number; massErrorPercent: number; volume: number; restVolume:number; deformedVolume:number; permanentCompactionPercent:number; elasticCompressionPercent:number; maxCompactionPercent:number; maxPressurePa:number; maxSpeed: number;
  kineticEnergy: number; invalidParticles: number; penetrationMm: number;
  preCorrectionPenetrationMm: number; bucketMass: number; bucketReferenceVolume:number; bucketRestVolume:number; bucketDeformedVolume:number; reactionN: number[];
  centerOfMass: number[]; cpuAnalysisMs:number; gpuMs: number | null;
}
export class SoilSolver {
  readonly positions: GPUBuffer;
  readonly state: GPUBuffer;
  readonly dx: number;
  readonly dimensions: number[];
  readonly estimatedBytes: number;
  readonly count: number;
  readonly mass: number;
  private grid: GPUBuffer;
  private gridVelocity: GPUBuffer;
  private uniform: GPUBuffer;
  private metrics: GPUBuffer;
  private snapshotBuffer: GPUBuffer;
  private contactBuffer: GPUBuffer;
  private terrainReadback:GPUBuffer;
  private cachedPositions:Float32Array;
  private cachedVelocities:Float32Array;
  private activeParticleCount=0;
  terrainFeedbackReport:{activeParticles:number;readbackBytes:number;cpuAnalysisMs:number;gpuMs:number|null}|null=null;
  private pipelines: GPUComputePipeline[]=[];
  private bindGroup!: GPUBindGroup;
  private querySet?: GPUQuerySet;
  private queryResolve?: GPUBuffer;
  private queryRead?: GPUBuffer;
  private activityBuffer:GPUBuffer;
  private activeBuffer:GPUBuffer;
  private dispatchBuffer:GPUBuffer;
  private boundaryGrid:GPUBuffer;
  useBoundaryCache=true;
  private nodeCount=0;
  private activityVersion="";
  readonly terrain?:TerrainActivity;
  private lastSteps=0;
  private lastDt=0;
  private reading=false;
  onTerrainReadback?: (positions:Float32Array,indices?:Uint32Array)=>void;
  constructor(readonly device: GPUDevice, readonly seed: Seed, dx: number, terrain=false) {
    this.count=seed.count;this.mass=seed.mass;this.dx=dx;
    this.cachedPositions=seed.positions.slice();this.cachedVelocities=new Float32Array(seed.count*3);
    for(let i=0;i<seed.count;i++)this.cachedVelocities.set(seed.states.subarray(i*STATE_FLOATS,i*STATE_FLOATS+3),i*3);
    if(terrain)this.terrain=new TerrainActivity(seed);
    this.dimensions=(terrain?CHUNK_DIMS:[6,4,4]).map(v=>Math.round(v/dx));
    const gridCount=this.dimensions.reduce((a,b)=>a*b,1);
    const create=(label:string,size:number,usage:number)=>device.createBuffer({label,size,usage});
    const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    this.positions=create('Soil positions · shared with Three.js',seed.positions.byteLength,storage|GPUBufferUsage.VERTEX);
    this.state=create('Material and deformation history',seed.states.byteLength,storage);
    this.grid=create('Fixed-point atomic mass and momentum',gridCount*16,storage);
    this.gridVelocity=create('Grid velocity',gridCount*16,storage);
    this.uniform=create('Solver parameters',1248,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    this.activityBuffer=create('Terrain chunk masks and live grid nodes',(CHUNK_COUNT+gridCount)*4,storage);
    this.activeBuffer=create('Active particle indices and indirect dispatch',(8+10*seed.count)*4,storage);
    this.dispatchBuffer=create('Terrain indirect workgroups',24,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST);
    this.boundaryGrid=create('Cached sleeping-boundary grid',gridCount*16,storage);
    this.metrics=create('Contact and stability diagnostics',32,storage);
    this.contactBuffer=create('Contact feedback and active count',48,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    this.terrainReadback=create('Compact active terrain feedback',seed.count*32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    this.snapshotBuffer=create('Infrequent diagnostic readback',seed.positions.byteLength+seed.states.byteLength+32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    this.estimatedBytes=seed.positions.byteLength+seed.states.byteLength+gridCount*32+1248+64+this.snapshotBuffer.size+this.activityBuffer.size+this.activeBuffer.size+24+this.boundaryGrid.size+this.terrainReadback.size;
    device.queue.writeBuffer(this.positions,0,seed.positions as Float32Array<ArrayBuffer>);
    device.queue.writeBuffer(this.state,0,seed.states as Float32Array<ArrayBuffer>);
    if(device.features.has('timestamp-query')) {
      this.querySet=device.createQuerySet({type:'timestamp',count:2});
      this.queryResolve=create('Timestamp resolve',16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC);
      this.queryRead=create('Timestamp read',16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    }
  }
  async init(): Promise<void> {
    const module=this.device.createShaderModule({label:'Diggy MLS-MPM',code:shader});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length) throw new Error(errors.map(e=>`WGSL ${e.lineNum}:${e.linePos}: ${e.message}`).join('\n'));
    const layout=this.device.createBindGroupLayout({entries:[0,1,2,3,4,5,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'uniform' as const:binding===6?'read-only-storage' as const:'storage' as const}}))});
    const pipelineLayout=this.device.createPipelineLayout({bindGroupLayouts:[layout]});
    this.pipelines=await Promise.all(['clearGrid','scatter','updateGrid','gather','bucketLoad','selectActive','activeDispatch','clearBoundary','scatterBoundary','terrainReadback'].map(entryPoint=>this.device.createComputePipelineAsync({label:entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})));
    this.bindGroup=this.device.createBindGroup({layout,entries:[this.positions,this.state,this.grid,this.gridVelocity,this.uniform,this.metrics,this.activityBuffer,this.activeBuffer,this.boundaryGrid].map((buffer,binding)=>({binding,resource:{buffer}}))});
  }
  timestep(material: MaterialSettings): number { return stableTimestep(material,this.dx); }
  step(steps: number, material: MaterialSettings, colliders: Collider[]): void {
    const dt=this.timestep(material);
    this.lastDt=dt;this.lastSteps=steps;
    const data=new ArrayBuffer(1248),f=new Float32Array(data),u=new Uint32Array(data);
    u.set([this.count,...this.dimensions]);
    f.set([dt,this.dx,material.stiffness,Math.tan(material.friction*Math.PI/180)],4);
    f.set([material.cohesion,material.viscosity,material.adhesion,this.dx*0.08],8);
    colliders.slice(0,8).forEach((box,i)=> {
      f.set([...box.center,box.angle,...box.half,box.omega,...box.velocity,box.bucket?1:0],12+i*12);
      f.set([box.yaw??0,box.yawOmega??0,Math.cos(box.yaw??0),Math.sin(box.yaw??0)],120+i*4);
      f.set([...colliderBounds(box),0],152+i*4);writeColliderRotation(f,184+i*16,box);
    });
    u[108]=Math.min(8,colliders.length);u[110]=this.useBoundaryCache?1:0;
    f.set([BULK_MODULUS,BULK_DAMPING,COMPACTION_YIELD,COMPACTION_HARDENING],112);
    f.set([...(this.terrain?TERRAIN_ORIGIN:[-3,0,-2]),this.terrain?1:0],116);
    if(this.terrain){
      const version=Array.from(this.terrain.modes).join('');
      if(version!==this.activityVersion){
        const nodes=this.terrain.gridNodes(this.dx);this.nodeCount=nodes.length;
        this.device.queue.writeBuffer(this.activityBuffer,0,this.terrain.modes as Uint32Array<ArrayBuffer>);
        this.device.queue.writeBuffer(this.activityBuffer,CHUNK_COUNT*4,nodes as Uint32Array<ArrayBuffer>);this.activityVersion=version;
      }
      u[109]=this.nodeCount;
    }
    this.device.queue.writeBuffer(this.uniform,0,data);
    const encoder=this.device.createCommandEncoder({label:`${steps} soil substeps`});
    encoder.clearBuffer(this.metrics);
    if(this.terrain)encoder.clearBuffer(this.activeBuffer,0,32);
    const gridCount=this.dimensions.reduce((a,b)=>a*b,1);
    // Dispatches have ordered storage dependencies within a compute pass. Keeping
    // the batch in one pass avoids repeated pass setup without changing substeps.
    if(this.terrain){
      const select=encoder.beginComputePass({label:'Compact terrain particle activity',...(this.querySet?{timestampWrites:{querySet:this.querySet,beginningOfPassWriteIndex:0}}:{})});select.setBindGroup(0,this.bindGroup);
      select.setPipeline(this.pipelines[5]);select.dispatchWorkgroups(Math.ceil(this.count/64));select.setPipeline(this.pipelines[6]);select.dispatchWorkgroups(1);select.end();
      encoder.copyBufferToBuffer(this.activeBuffer,4,this.dispatchBuffer,0,12);
      encoder.copyBufferToBuffer(this.activeBuffer,20,this.dispatchBuffer,12,12);
      if(this.useBoundaryCache){
        const boundary=encoder.beginComputePass({label:'Cache fixed boundary transfers once per batch'});boundary.setBindGroup(0,this.bindGroup);
        boundary.setPipeline(this.pipelines[7]);boundary.dispatchWorkgroups(Math.ceil(this.nodeCount/128));
        boundary.setPipeline(this.pipelines[8]);boundary.dispatchWorkgroupsIndirect(this.dispatchBuffer,12);boundary.end();
      }
    }
    const pass=encoder.beginComputePass({label:'MLS-MPM substep batch',
      ...(this.querySet?{timestampWrites:{querySet:this.querySet,...(this.terrain?{}:{beginningOfPassWriteIndex:0}),endOfPassWriteIndex:1}}:{})});
    pass.setBindGroup(0,this.bindGroup);
    for(let step=0;step<steps;step++) for(let phase=0;phase<4;phase++) {
      pass.setPipeline(this.pipelines[phase]);
      if(this.terrain && (phase===1||phase===3))pass.dispatchWorkgroupsIndirect(this.dispatchBuffer,0);
      else pass.dispatchWorkgroups(Math.ceil((phase===0||phase===2?(this.terrain?this.nodeCount:gridCount):this.count)/(phase===0||phase===2?128:64)));
    }
    pass.setPipeline(this.pipelines[4]);pass.dispatchWorkgroups(Math.ceil(this.count/64));
    pass.end();
    encoder.copyBufferToBuffer(this.metrics,0,this.contactBuffer,0,32);
    if(this.terrain)encoder.copyBufferToBuffer(this.activeBuffer,0,this.contactBuffer,32,16);
    if(this.querySet) encoder.resolveQuerySet(this.querySet,0,2,this.queryResolve!,0);
    this.device.queue.submit([encoder.finish()]);
  }
  terrainTime=0;
  updateTerrain(pose:import("../simulation/bucket").Pose,time:number,extra:import("../simulation/bucket").Pose[]=[]):void{this.terrainTime=time;this.terrain?.update(pose,time,extra);}
  updateTerrainContacts(colliders:Collider[],time:number):void{this.terrainTime=time;this.terrain?.updateContacts(colliders,time);}
  async contactFeedback(): Promise<ContactFeedback> {
    await this.contactBuffer.mapAsync(GPUMapMode.READ);
    const data=this.contactBuffer.getMappedRange(),m=new Int32Array(data,0,8);
    const result:ContactFeedback={impulse:[m[0]/10000,m[1]/10000,m[2]/10000],torqueImpulse:m[6]/1000,carriedMass:m[7]/1000};
    if(this.terrain)this.activeParticleCount=new Uint32Array(data,32,4)[0];
    const invalid=m[4];this.contactBuffer.unmap();
    if(invalid)throw new Error(`Invalid material state detected (${invalid} samples). Reset the site.`);
    return result;
  }
  /** Normal gameplay reads only active positions/velocities; full histories stay on GPU. */
  async terrainFeedback():Promise<typeof this.terrainFeedbackReport>{
    if(!this.terrain||this.reading)return null;this.reading=true;
    try{
      const count=this.activeParticleCount,bytes=count*32;
      const encoder=this.device.createCommandEncoder({label:'Local terrain feedback'});
      if(count){
        const pass=encoder.beginComputePass();pass.setBindGroup(0,this.bindGroup);pass.setPipeline(this.pipelines[9]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();
        encoder.copyBufferToBuffer(this.activeBuffer,(8+2*this.count)*4,this.terrainReadback,0,bytes);
      }
      if(this.queryResolve)encoder.copyBufferToBuffer(this.queryResolve,0,this.queryRead!,0,16);
      this.device.queue.submit([encoder.finish()]);
      if(bytes)await this.terrainReadback.mapAsync(GPUMapMode.READ,0,bytes);
      const started=performance.now(),indices=new Uint32Array(count);
      if(bytes){
        const data=this.terrainReadback.getMappedRange(0,bytes),words=new Uint32Array(data),values=new Float32Array(data);
        for(let slot=0;slot<count;slot++){
          const offset=slot*8,index=words[offset];indices[slot]=index;
          this.cachedPositions.set(values.subarray(offset+1,offset+5),index*4);
          this.cachedVelocities.set(values.subarray(offset+5,offset+8),index*3);
        }
        this.terrainReadback.unmap();
      }
      this.terrain.observeChanges(this.cachedPositions,this.cachedVelocities,indices,this.terrainTime);
      this.onTerrainReadback?.(this.cachedPositions,indices);
      const cpuAnalysisMs=performance.now()-started;let gpuMs:number|null=null;
      if(this.queryRead){await this.queryRead.mapAsync(GPUMapMode.READ);const times=new BigUint64Array(this.queryRead.getMappedRange());gpuMs=Number(times[1]-times[0])/1e6;this.queryRead.unmap();}
      return this.terrainFeedbackReport={activeParticles:count,readbackBytes:bytes,cpuAnalysisMs,gpuMs};
    }finally{this.reading=false;}
  }
  async snapshot(colliders: Collider[]): Promise<Snapshot | null> {
    if(this.reading)return null;
    this.reading=true;
    const steps=this.lastSteps,dt=this.lastDt;
    try {
      const encoder=this.device.createCommandEncoder({label:'Diagnostic snapshot (not needed for rendering)'});
      encoder.copyBufferToBuffer(this.positions,0,this.snapshotBuffer,0,this.positions.size);
      encoder.copyBufferToBuffer(this.state,0,this.snapshotBuffer,this.positions.size,this.state.size);
      encoder.copyBufferToBuffer(this.metrics,0,this.snapshotBuffer,this.positions.size+this.state.size,32);
      if(this.queryResolve) encoder.copyBufferToBuffer(this.queryResolve,0,this.queryRead!,0,16);
      this.device.queue.submit([encoder.finish()]);
      await this.snapshotBuffer.mapAsync(GPUMapMode.READ);
      const analysisStarted=performance.now();
      const data=this.snapshotBuffer.getMappedRange();
      const positions=new Float32Array(data,0,this.count*4),states=new Float32Array(data,this.positions.size,this.count*STATE_FLOATS);
      const metrics=new Int32Array(data,this.positions.size+this.state.size,8);
      let mass=0,volume=0,maxSpeed=0,kineticEnergy=0,invalidParticles=metrics[4],penetrationMm=0,bucketMass=0;
      let restVolume=0,deformedVolume=0,maxCompactionPercent=0,maxPressurePa=0,bucketReferenceVolume=0,bucketRestVolume=0,bucketDeformedVolume=0;
      const com=[0,0,0];
      const boxes=colliders.map(box=>({...box,c:Math.cos(box.angle),s:Math.sin(box.angle),basis:colliderBasis(box),bounds:colliderBounds(box),cy:Math.cos(box.yaw??0),sy:Math.sin(box.yaw??0)}));
      const bucket=boxes.find(b=>b.bucket);
      for(let i=0;i<this.count;i++) {
        const offset=i*4,o=i*STATE_FLOATS;
        const x=positions[offset],y=positions[offset+1],z=positions[offset+2],m=positions[offset+3];
        const vx=states[o],vy=states[o+1],vz=states[o+2];
        const a=states[o+4],b=states[o+8],c=states[o+12],d=states[o+5],e=states[o+9],f=states[o+13],g=states[o+6],h=states[o+10],j=states[o+14];
        const det=a*(e*j-f*h)-b*(d*j-f*g)+c*(d*h-e*g);
        if(!Number.isFinite(x+y+z+vx+vy+vz+det)||det<=0){invalidParticles++;continue;}
        const rest=states[o+3]*states[o+32];
        restVolume+=rest;deformedVolume+=rest*det;
        maxCompactionPercent=Math.max(maxCompactionPercent,100*(1-states[o+32]));
        maxPressurePa=Math.max(maxPressurePa,-BULK_MODULUS*Math.log(det));
        mass+=m;volume+=states[o+3];const speedSquared=vx*vx+vy*vy+vz*vz;
        maxSpeed=Math.max(maxSpeed,Math.sqrt(speedSquared));kineticEnergy+=0.5*m*speedSquared;
        com[0]+=x*m;com[1]+=y*m;com[2]+=z*m;
        penetrationMm=Math.max(penetrationMm,Math.max(0,(this.terrain?TERRAIN_FLOOR:.15)-y)*1000);
        for(const box of boxes) {
          const dx=x-box.center[0],dy=y-box.center[1],dz=z-box.center[2];
          if(Math.abs(dx)>box.bounds[0]||Math.abs(dy)>box.bounds[1]||Math.abs(dz)>box.bounds[2])continue;
          const b=box.basis;
          const qx=Math.abs(b[0]*dx+b[1]*dy+b[2]*dz)-box.half[0];
          const qy=Math.abs(b[3]*dx+b[4]*dy+b[5]*dz)-box.half[1];
          const qz=Math.abs(b[6]*dx+b[7]*dy+b[8]*dz)-box.half[2];
          if(qx<0&&qy<0&&qz<0)penetrationMm=Math.max(penetrationMm,-Math.max(qx,qy,qz)*1000);
        }
        // Geometric containment estimate, separate from measured contact reaction.
        if(bucket){const dx=x-bucket.center[0],dy=y-bucket.center[1],dz=z-bucket.center[2];
          const b=bucket.basis,px=b[0]*dx+b[1]*dy+b[2]*dz,py=b[3]*dx+b[4]*dy+b[5]*dz,rz=b[6]*dx+b[7]*dy+b[8]*dz;
          if(px>-0.48&&px<0.57&&py>0.06&&py<0.7&&Math.abs(rz)<0.5){bucketMass+=m;bucketReferenceVolume+=states[o+3];bucketRestVolume+=rest;bucketDeformedVolume+=rest*det;}
        }
      }
      const reactionN=[metrics[0],metrics[1],metrics[2]].map(v=>v/10000/Math.max(steps*dt,1e-9));
      const preCorrectionPenetrationMm=metrics[3]/1000;
      if(this.terrain){
        this.cachedPositions.set(positions);
        for(let i=0;i<this.count;i++)this.cachedVelocities.set(states.subarray(i*STATE_FLOATS,i*STATE_FLOATS+3),i*3);
        this.terrain.observe(this.cachedPositions,this.cachedVelocities,this.terrainTime,3);
      }
      this.onTerrainReadback?.(positions);
      const cpuAnalysisMs=performance.now()-analysisStarted;
      this.snapshotBuffer.unmap();
      let gpuMs:null|number=null;
      if(this.queryRead){await this.queryRead.mapAsync(GPUMapMode.READ);const times=new BigUint64Array(this.queryRead.getMappedRange());gpuMs=Number(times[1]-times[0])/1e6;this.queryRead.unmap();}
      return {cpuAnalysisMs,mass,massErrorPercent:100*(mass-this.mass)/this.mass,volume,restVolume,deformedVolume,permanentCompactionPercent:100*(1-restVolume/volume),elasticCompressionPercent:100*(1-deformedVolume/restVolume),maxCompactionPercent,maxPressurePa,maxSpeed,kineticEnergy,invalidParticles,penetrationMm,preCorrectionPenetrationMm,bucketMass,bucketReferenceVolume,bucketRestVolume,bucketDeformedVolume,reactionN,centerOfMass:com.map(v=>v/mass),gpuMs};
    } finally {this.reading=false;}
  }
  async readParticles():Promise<{positions:Float32Array;states:Float32Array}>{
    const buffer=this.device.createBuffer({label:'On-demand particle inspection',size:this.positions.size+this.state.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{
      const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(this.positions,0,buffer,0,this.positions.size);encoder.copyBufferToBuffer(this.state,0,buffer,this.positions.size,this.state.size);
      this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const data=buffer.getMappedRange();
      const result={positions:new Float32Array(data.slice(0,this.positions.size)),states:new Float32Array(data.slice(this.positions.size))};
      buffer.unmap();return result;
    }finally{buffer.destroy();}
  }
  destroy(): void {
    for(const buffer of [this.positions,this.state,this.grid,this.gridVelocity,this.uniform,this.metrics,this.contactBuffer,this.activityBuffer,this.activeBuffer,this.dispatchBuffer,this.boundaryGrid,this.terrainReadback,this.snapshotBuffer,this.queryResolve,this.queryRead]) buffer?.destroy();
    this.querySet?.destroy();
  }
}
