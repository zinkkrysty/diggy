// MLS-MPM / APIC transfers, quadratic B-splines, Hencky strain plasticity.
// Soil is a continuum: these points are quadrature samples, not physical grains.
struct Particle {
  velocity: vec4f, f0: vec4f, f1: vec4f, f2: vec4f,
  c0: vec4f, c1: vec4f, c2: vec4f, material: vec4f, history: vec4f,
}
struct Cell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, mass: atomic<i32> }
struct Box { centerAngle: vec4f, halfOmega: vec4f, velocityKind: vec4f }
struct Params {
  counts: vec4u, // particle count, nx, ny, nz
  step: vec4f, // dt, dx, E, friction coefficient
  soil: vec4f, // base cohesion, viscosity, metal adhesion, particle collision margin
  boxes: array<Box, 8>,
  flags: vec4u, // collider count
  compression: vec4f, // bulk modulus, damping, yield pressure, hardening
  domain: vec4f, // origin.xyz, terrain enabled
}
@group(0) @binding(0) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> grid: array<Cell>;
@group(0) @binding(3) var<storage, read_write> gridVelocity: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(6) var<storage,read> activity:array<u32>;
@group(0) @binding(7) var<storage,read_write> activeList:array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> metrics: array<atomic<i32>>;
const MASS_SCALE: f32 = 1000000.0;
const MOMENTUM_SCALE: f32 = 100000.0;
const IDENTITY = mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));
const ZERO = mat3x3f(vec3f(0),vec3f(0),vec3f(0));

fn diagonal(v: vec3f) -> mat3x3f { return mat3x3f(vec3f(v.x,0,0),vec3f(0,v.y,0),vec3f(0,0,v.z)); }
fn outer(a: vec3f,b: vec3f) -> mat3x3f { return mat3x3f(a*b.x,a*b.y,a*b.z); }
fn coord(index: u32) -> vec3u { return vec3u(index%params.counts.y,(index/params.counts.y)%params.counts.z,index/(params.counts.y*params.counts.z)); }
fn indexOf(c: vec3i) -> u32 { return u32(c.x)+u32(c.y)*params.counts.y+u32(c.z)*params.counts.y*params.counts.z; }
fn valid(c: vec3i) -> bool { if(any(c<vec3i(0)) || any(c>=vec3i(params.counts.yzw))){return false;}if(params.domain.w>0.5){return activity[terrainChunk(params.domain.xyz+vec3f(c)*params.step.y)]>0u;}return true; }
fn weight(f: vec3f) -> mat3x3f {
  return mat3x3f(0.5*(vec3f(1.5)-f)*(vec3f(1.5)-f),vec3f(0.75)-(f-vec3f(1))*(f-vec3f(1)),0.5*(f-vec3f(0.5))*(f-vec3f(0.5)));
}
struct Spectrum { stretch: vec3f, right: mat3x3f, left: mat3x3f }
fn spectral(f: mat3x3f) -> Spectrum {
  var a=transpose(f)*f;
  var v=IDENTITY;
  // Jacobi diagonalization of F^T F. Avoid a closed-form cubic near repeated eigenvalues.
  for(var sweep=0u;sweep<4u;sweep++) {
    for(var pair=0u;pair<3u;pair++) {
      var i=0u; var j=1u;
      if(pair==1u){i=0u;j=2u;} if(pair==2u){i=1u;j=2u;}
      let off=a[j][i];
      if(abs(off)>1e-7) {
        let tau=(a[j][j]-a[i][i])/(2.0*off);
        let t=select(-1.0,1.0,tau>=0.0)/(abs(tau)+sqrt(1.0+tau*tau));
        let c=inverseSqrt(1.0+t*t);let s=t*c;
        var q=IDENTITY;
        q[i][i]=c;q[j][j]=c;q[i][j]=-s;q[j][i]=s;
        a=transpose(q)*a*q;v=v*q;
      }
    }
  }
  let sig=sqrt(max(vec3f(a[0][0],a[1][1],a[2][2]),vec3f(1e-8)));
  return Spectrum(sig,v,f*v*diagonal(1.0/sig));
}
struct Projection { f: mat3x3f, stress: mat3x3f, plastic: f32, damage: f32, dilation: f32 }
fn plasticity(f: mat3x3f, material: vec4f, history: vec4f, divergence: f32) -> Projection {
  let E=params.step.z;
  let mu=E/2.4;let K=params.compression.x;let lambda=K-2.0*mu/3.0;
  let spec=spectral(f);
  let trialEps=log(clamp(spec.stretch,vec3f(0.05),vec3f(20)));
  let water=material.x;let fine=material.y;
  let moistureBond=2500.0*(0.15+0.85*fine)*sin(3.14159265*water);
  let cohesion=(params.soil.x+moistureBond)*(1.0-0.75*history.y);
  // Retain the stress-free volume opened by loose grains. Compression first
  // closes this gap instead of manufacturing pressure in a dilute falling stream.
  // Cohesive material retains bonded rest shapes through the same smooth curve.
  let loose=exp(-cohesion/300.0);
  var eps=trialEps+vec3f(history.z*loose/3.0);
  // Composition controls permanent compaction continuously. Coarse sand has
  // none; fine soil has a small bounded allowance, only above a pressure cap.
  let maxCompaction=0.1*smoothstep(0.12,0.6,fine);
  let oldLogCompaction=-log(clamp(history.x,0.8,1.0));
  let maxLogCompaction=-log(1.0-maxCompaction);
  let trialPressure=max(-K*(eps.x+eps.y+eps.z),0.0);
  let yieldPressure=params.compression.z*(1.0+0.7*water)+params.compression.w*oldLogCompaction;
  let plasticIncrement=clamp((trialPressure-yieldPressure)/(K+params.compression.w),0.0,max(maxLogCompaction-oldLogCompaction,0.0));
  eps+=vec3f(plasticIncrement/3.0);
  let trace=eps.x+eps.y+eps.z;
  let mean=trace/3.0;
  let dev=eps-vec3f(mean);let devLen=length(dev);
  // Friction decreases toward saturation; modest hardening under compaction.
  let friction=params.step.w*(1.0-0.35*water)*clamp(pow(history.x,-0.15),0.8,1.2);
  let yieldRadius=cohesion/(2.0*mu)+1.5*friction*max(-K*trace,0.0)/(2.0*mu);
  var projected=eps;
  var damage=history.y;
  // Tensile cap: loose grains cannot support tension; cohesive soil has finite strength.
  let tensile=cohesion/(3.0*(2.0*mu+3.0*lambda));
  if(mean>tensile) {
    projected=eps-vec3f(mean-tensile);
    if(cohesion>1.0) { damage=min(0.98,damage+max(mean-tensile,0.0)*4.0); }
  }
  if(devLen>yieldRadius && devLen>1e-7) {
    projected=projected-dev*(1.0-yieldRadius/devLen);
    damage=min(0.98,damage+max(devLen-yieldRadius,0.0)*0.3*water);
  }
  // Shear/tensile return mapping preserves compressive volume; no generic
  // component clamp is allowed to manufacture irreversible volume loss.
  let elasticTrace=projected.x+projected.y+projected.z;
  let elasticMean=(2.0*mu/3.0+lambda)*elasticTrace;
  // Kelvin-Voigt bulk dissipation: oppose compression and unloading, without
  // damping translation or adding shear viscosity to freely flowing dry sand.
  // No pressure/damping in the stress-free dilation gap. Cohesive tension retains
  // the existing tensile cap. Grid-scale coefficient tracks stiffness/resolution.
  let rho=1450.0+550.0*water;
  let bulkViscosity=params.compression.y*params.step.y*sqrt(K*rho);
  let loadBearing=clamp(-elasticMean/150.0,0.0,1.0);
  let dampedMean=min(elasticMean+bulkViscosity*divergence*loadBearing,cohesion/3.0);
  // Frictional shear support must disappear with unloading pressure. Retaining
  // the old elastic shear limit here would leave loose sand pulling in strands.
  let projectedDev=projected-vec3f(elasticTrace/3.0);
  let pressureRadius=cohesion/(2.0*mu)+1.5*friction*max(-dampedMean,0.0)/(2.0*mu);
  let shearScale=min(1.0,pressureRadius/max(length(projectedDev),1e-8));
  projected=vec3f(elasticTrace/3.0)+projectedDev*shearScale;
  let corrected=f*spec.right*diagonal(exp(projected)/spec.stretch)*transpose(spec.right);
  let principal=2.0*mu*projected+vec3f(lambda*elasticTrace+dampedMean-elasticMean);
  let stress=spec.left*diagonal(principal)*transpose(spec.left);
  let jp=exp(-oldLogCompaction-plasticIncrement);
  let dilation=clamp(history.z+trialEps.x+trialEps.y+trialEps.z-elasticTrace+plasticIncrement,0.0,6.0);
  return Projection(corrected,stress,jp,damage,dilation);
}
struct Contact { distance: f32, normal: vec3f, velocity: vec3f }
fn boxContact(point: vec3f, box: Box) -> Contact {
  let c=cos(box.centerAngle.w);let s=sin(box.centerAngle.w);
  let delta=point-box.centerAngle.xyz;
  let p=vec3f(c*delta.x+s*delta.y,-s*delta.x+c*delta.y,delta.z);
  let q=abs(p)-box.halfOmega.xyz;
  let outside=max(q,vec3f(0));
  let len=length(outside);
  var normal=vec3f(0);
  if(len>1e-8) {normal=outside/len*select(vec3f(-1),vec3f(1),p>=vec3f(0));}
  else {
    var axis=0u;if(q.y>q.x){axis=1u;}if(q.z>q[axis]){axis=2u;}
    normal[axis]=select(-1.0,1.0,p[axis]>=0.0);
  }
  let n=vec3f(c*normal.x-s*normal.y,s*normal.x+c*normal.y,normal.z);
  let velocity=box.velocityKind.xyz+box.halfOmega.w*vec3f(-delta.y,delta.x,0);
  return Contact(len+min(max(q.x,max(q.y,q.z)),0.0),n,velocity);
}
fn contactVelocity(v: vec3f, contact: Contact, friction: f32, adhesion: f32) -> vec3f {
  let relative=v-contact.velocity;
  let vn=dot(relative,contact.normal);
  let tangent=relative-vn*contact.normal;
  let tangentLen=length(tangent);
  let frictionDrop=friction*max(-vn,0.0)+adhesion*params.step.x*9.81;
  let slide=tangent*max(0.0,1.0-frictionDrop/max(tangentLen,1e-7));
  return contact.velocity+max(vn,0.0)*contact.normal+slide;
}
@compute @workgroup_size(128)
fn clearGrid(@builtin(global_invocation_id) gid: vec3u) {
  var i=gid.x;if(params.domain.w>0.5){if(i>=params.flags.y){return;}i=activity[576u+i];}else if(i>=params.counts.y*params.counts.z*params.counts.w){return;}
  atomicStore(&grid[i].x,0);atomicStore(&grid[i].y,0);atomicStore(&grid[i].z,0);atomicStore(&grid[i].mass,0);
  gridVelocity[i]=vec4f(0);
}
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  var i=gid.x;if(params.domain.w>0.5){if(i>=atomicLoad(&activeList[0])){return;}i=atomicLoad(&activeList[4u+i]);}else if(i>=params.counts.x){return;}
  let pos=positions[i];var p=particles[i];
  let C=mat3x3f(p.c0.xyz,p.c1.xyz,p.c2.xyz);
  let trial=(IDENTITY+params.step.x*C)*mat3x3f(p.f0.xyz,p.f1.xyz,p.f2.xyz);
  let projected=plasticity(trial,p.material,p.history,C[0].x+C[1].y+C[2].z);
  p.f0=vec4f(projected.f[0],0);p.f1=vec4f(projected.f[1],0);p.f2=vec4f(projected.f[2],0);
  p.history.x=projected.plastic;p.history.y=projected.damage;p.history.z=projected.dilation;if(params.domain.w<0.5 || activity[terrainChunk(pos.xyz)]==1u){particles[i]=p;}
  let affine=pos.w*C-params.step.x*p.velocity.w*p.history.x*4.0/(params.step.y*params.step.y)*projected.stress;
  let xp=(pos.xyz-params.domain.xyz)/params.step.y;
  let base=vec3i(floor(xp-vec3f(0.5)));let fx=xp-vec3f(base);let w=weight(fx);
  for(var x=0;x<3;x++){for(var y=0;y<3;y++){for(var z=0;z<3;z++){
    let cell=base+vec3i(x,y,z);if(!valid(cell)){continue;}
    let weightValue=w[x].x*w[y].y*w[z].z;
    let dpos=(vec3f(f32(x),f32(y),f32(z))-fx)*params.step.y;
    let momentum=weightValue*(pos.w*p.velocity.xyz+affine*dpos);
    let idx=indexOf(cell);
    atomicAdd(&grid[idx].x,i32(round(momentum.x*MOMENTUM_SCALE)));
    atomicAdd(&grid[idx].y,i32(round(momentum.y*MOMENTUM_SCALE)));
    atomicAdd(&grid[idx].z,i32(round(momentum.z*MOMENTUM_SCALE)));
    atomicAdd(&grid[idx].mass,i32(round(weightValue*pos.w*MASS_SCALE)));
  }}}
}
@compute @workgroup_size(128)
fn updateGrid(@builtin(global_invocation_id) gid: vec3u) {
  var idx=gid.x;if(params.domain.w>0.5){if(idx>=params.flags.y){return;}idx=activity[576u+idx];}else if(idx>=params.counts.y*params.counts.z*params.counts.w){return;}
  let mass=f32(atomicLoad(&grid[idx].mass))/MASS_SCALE;if(mass<=1e-7){return;}
  var v=vec3f(f32(atomicLoad(&grid[idx].x)),f32(atomicLoad(&grid[idx].y)),f32(atomicLoad(&grid[idx].z)))/MOMENTUM_SCALE/mass;
  v.y-=9.81*params.step.x;
  let point=params.domain.xyz+vec3f(coord(idx))*params.step.y;
  if(params.domain.w>0.5 && activity[terrainChunk(point)]==2u){gridVelocity[idx]=vec4f(0,0,0,mass);return;}
  let floorHeight=0.15;
  if(point.y<floorHeight && v.y<0.0) {
    let n=vec3f(0,1,0);v=contactVelocity(v,Contact(point.y-floorHeight,n,vec3f(0)),params.step.w,0.0);
  }
  let coordinate=coord(idx);
  for(var a=0u;a<3u;a++) {
    if(coordinate[a]<2u && v[a]<0.0){v[a]=0.0;}
    if(coordinate[a]>params.counts[a+1u]-3u && v[a]>0.0){v[a]=0.0;}
  }
  for(var b=0u;b<params.flags.x;b++) {
    let box=params.boxes[b];let contact=boxContact(point,box);
    if(contact.distance<0.0) {
      let before=v;v=contactVelocity(v,contact,params.step.w,params.soil.z*box.velocityKind.w);
      if(box.velocityKind.w>0.5) {
        let impulse=mass*(v-before);
        atomicAdd(&metrics[0],i32(round(-impulse.x*10000.0)));
        atomicAdd(&metrics[1],i32(round(-impulse.y*10000.0)));
        atomicAdd(&metrics[2],i32(round(-impulse.z*10000.0)));
        let floorBox=params.boxes[0];
        let pivot=floorBox.centerAngle.xyz+vec3f(-sin(floorBox.centerAngle.w)*0.34,cos(floorBox.centerAngle.w)*0.34,0);
        atomicAdd(&metrics[6],i32(round(cross(point-pivot,-impulse).z*1000.0)));
      }
    }
  }
  gridVelocity[idx]=vec4f(v,mass);
}
@compute @workgroup_size(64)
fn gather(@builtin(global_invocation_id) gid: vec3u) {
  var i=gid.x;if(params.domain.w>0.5){if(i>=atomicLoad(&activeList[0])){return;}i=atomicLoad(&activeList[4u+i]);}else if(i>=params.counts.x){return;}
  var pos=positions[i];var p=particles[i];
  if(params.domain.w>0.5 && activity[terrainChunk(pos.xyz)]!=1u){return;}
  let xp=(pos.xyz-params.domain.xyz)/params.step.y;
  let base=vec3i(floor(xp-vec3f(0.5)));let fx=xp-vec3f(base);let w=weight(fx);
  var v=vec3f(0);var C=ZERO;
  for(var x=0;x<3;x++){for(var y=0;y<3;y++){for(var z=0;z<3;z++){
    let cell=base+vec3i(x,y,z);if(!valid(cell)){continue;}
    let weightValue=w[x].x*w[y].y*w[z].z;
    let dpos=vec3f(f32(x),f32(y),f32(z))-fx;
    let gv=gridVelocity[indexOf(cell)].xyz;
    v+=weightValue*gv;
    C+=4.0/params.step.y*weightValue*outer(gv,dpos);
  }}}
  let symmetric=0.5*(C+transpose(C));
  C-=symmetric*clamp(params.soil.y*(0.1+p.material.x)*params.step.x*30.0,0.0,0.15);
  // Track a stability failure explicitly; do not silently repair invalid states.
  if(any(v!=v) || any(abs(v)>vec3f(1000))) {atomicAdd(&metrics[4],1);return;}
  pos=vec4f(pos.xyz+params.step.x*v,pos.w);
  let margin=params.soil.w;
  if(pos.y<0.15+margin) {
    pos.y=0.15+margin;
    // Inelastic contact must also remove inward APIC subcell motion. Keeping
    // its normal affine row would re-inject impact energy on the next scatter.
    if(v.y<0.0){C=(IDENTITY-outer(vec3f(0,1,0),vec3f(0,1,0)))*C;}
    v=contactVelocity(v,Contact(0.0,vec3f(0,1,0),vec3f(0)),params.step.w,0.0);
  }
  let lower=params.domain.xyz+vec3f(params.step.y*1.6,0.15+margin,params.step.y*1.6);
  let upper=params.domain.xyz+vec3f(params.counts.yzw)*params.step.y-vec3f(params.step.y*1.6);
  pos=vec4f(clamp(pos.xyz,lower,upper),pos.w);
  for(var b=0u;b<params.flags.x;b++) {
    let box=params.boxes[b];let contact=boxContact(pos.xyz,box);
    if(contact.distance<margin) {
      atomicMax(&metrics[3],i32(round(max(-contact.distance,0.0)*1000000.0)));
      let before=v;
      if(dot(v-contact.velocity,contact.normal)<0.0){
        let rigidC=mat3x3f(vec3f(0,box.halfOmega.w,0),vec3f(-box.halfOmega.w,0,0),vec3f(0));
        C=rigidC+(IDENTITY-outer(contact.normal,contact.normal))*(C-rigidC);
      }
      v=contactVelocity(v,contact,params.step.w,params.soil.z*box.velocityKind.w);
      pos=vec4f(pos.xyz+(margin-contact.distance)*contact.normal,pos.w);
      if(box.velocityKind.w>0.5) {
        let impulse=pos.w*(v-before);
        atomicAdd(&metrics[0],i32(round(-impulse.x*10000.0)));
        atomicAdd(&metrics[1],i32(round(-impulse.y*10000.0)));
        atomicAdd(&metrics[2],i32(round(-impulse.z*10000.0)));
        let floorBox=params.boxes[0];
        let pivot=floorBox.centerAngle.xyz+vec3f(-sin(floorBox.centerAngle.w)*0.34,cos(floorBox.centerAngle.w)*0.34,0);
        atomicAdd(&metrics[6],i32(round(cross(pos.xyz-pivot,-impulse).z*1000.0)));
      }
    }
  }
  p.velocity=vec4f(v,p.velocity.w);
  p.c0=vec4f(C[0],0);p.c1=vec4f(C[1],0);p.c2=vec4f(C[2],0);
  particles[i]=p;positions[i]=pos;
  atomicMax(&metrics[5],i32(round(length(v)*1000.0)));
}

// Containment load once per batch, independent of constitutive updates.
@compute @workgroup_size(64)
fn bucketLoad(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=params.counts.x||params.flags.x==0u){return;}
  let box=params.boxes[0];if(box.velocityKind.w<0.5){return;}
  let p=positions[i];let d=p.xyz-box.centerAngle.xyz;
  let c=cos(box.centerAngle.w);let s=sin(box.centerAngle.w);
  let x=c*d.x+s*d.y;let y=-s*d.x+c*d.y;
  if(x > -0.48 && x < 0.57 && y > 0.06 && y < 0.7 && abs(d.z)<0.5) {
    atomicAdd(&metrics[7],i32(round(p.w*1000.0)));
  }
}

fn terrainChunk(p:vec3f)->u32 {
  let c=vec3u(clamp(floor(p-params.domain.xyz),vec3f(0),vec3f(11,3,11)));
  return c.x+c.y*12u+c.z*48u;
}
@compute @workgroup_size(64)
fn selectActive(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=params.counts.x){return;}
  if(activity[terrainChunk(positions[i].xyz)]>0u){let slot=atomicAdd(&activeList[0],1u);atomicStore(&activeList[4u+slot],i);}
}
@compute @workgroup_size(1)
fn activeDispatch(){atomicStore(&activeList[1],(atomicLoad(&activeList[0])+63u)/64u);atomicStore(&activeList[2],1u);atomicStore(&activeList[3],1u);}
