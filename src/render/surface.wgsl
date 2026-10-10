// Visual reconstruction only. Does not modify material position, mass, or momentum.
struct Particle { velocity: vec4f, f0: vec4f, f1: vec4f, f2: vec4f, c0: vec4f, c1: vec4f, c2: vec4f, material: vec4f, history: vec4f }
struct Field { density: atomic<u32>, shade: atomic<u32> }
struct Box { centerAngle: vec4f, halfOmega: vec4f, velocityKind: vec4f }
struct Rotation { x:vec4f,y:vec4f,z:vec4f,omega:vec4f }
struct Params {
  dims: vec4u, // nx, ny, nz, material point count
  surface: vec4f, // voxel width, support radius, isovalue, vertex capacity
  time: vec4f, // dt, seed spacing, detail enabled, floor height
  origin: vec4f,
  boxes: array<Box,8>,
  flags: vec4u,
  orientations:array<vec4f,8>,
  bounds:array<vec4f,8>,
  rotations:array<Rotation,8>,
  tile:vec4u, // tile id (main pass: tile count), x/z cell origin, owned cell width
}
struct Draw { count: atomic<u32>, instances: u32, first: u32, base: u32 }
struct Draws { surface:Draw, detached:Draw, spill:Draw }
struct Grain { position: vec4f, velocity: vec4f } // position.w is remaining lifetime
@group(0) @binding(0) var<storage,read> points: array<vec4f>;
@group(0) @binding(1) var<storage,read> particles: array<Particle>;
@group(0) @binding(2) var<storage,read_write> field: array<Field>;
@group(0) @binding(3) var<storage,read_write> vertices: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> normals: array<vec4f>;
@group(0) @binding(5) var<storage,read_write> draw: array<Draws>;
@group(0) @binding(6) var<uniform> params: Params;
@group(0) @binding(7) var<storage,read_write> detail: array<Grain>;
@group(0) @binding(8) var<storage,read_write> counters: array<atomic<u32>>;
const SCALE: f32=100000.0;
fn index(c:vec3u)->u32 {return c.x+c.y*params.dims.x+c.z*params.dims.x*params.dims.y;}
fn coord(i:u32)->vec3u {return vec3u(i%params.dims.x,(i/params.dims.x)%params.dims.y,i/(params.dims.x*params.dims.y));}
fn valid(c:vec3i)->bool{
  if(any(c<vec3i(0))||any(c>=vec3i(params.dims.xyz))){return false;}
  if(params.tile.w>0u){
    let lo=vec2i(params.tile.yz)-vec2i(4);let hi=vec2i(params.tile.yz+vec2u(params.tile.w))+vec2i(5);
    return all(c.xz>=lo)&&all(c.xz<hi);
  }
  return true;
}
fn tileId()->u32{return select(0u,params.tile.x,params.tile.w>0u);}
fn surfaceCount()->u32{return 4u+tileId()*2u;}
fn workCount()->u32{
  if(params.tile.w==0u){return params.dims.x*params.dims.y*params.dims.z;}
  let width=params.tile.w+9u;return width*params.dims.y*width;
}
fn workCoord(i:u32)->vec3i{
  if(params.tile.w==0u){return vec3i(coord(i));}
  let width=params.tile.w+9u;
  return vec3i(vec3u(i%width,(i/width)%params.dims.y,i/(width*params.dims.y)))+vec3i(i32(params.tile.y)-4,0,i32(params.tile.z)-4);
}
fn densityAt(c:vec3i)->f32 {
  if(!valid(c)){return 0.0;}
  return f32(atomicLoad(&field[index(vec3u(c))].density))/SCALE;
}
fn gradient(c:vec3u)->vec3f {
  let p=vec3i(c);
  return -vec3f(densityAt(p+vec3i(1,0,0))-densityAt(p-vec3i(1,0,0)),densityAt(p+vec3i(0,1,0))-densityAt(p-vec3i(0,1,0)),densityAt(p+vec3i(0,0,1))-densityAt(p-vec3i(0,0,1)));
}
fn boxDistance(point:vec3f,b:Box,rotation:Rotation,bounds:vec3f)->f32 {
  if(any(abs(point-b.centerAngle.xyz)>bounds+vec3f(0.005))){return 1000000.0;}
  let local=transpose(mat3x3f(rotation.x.xyz,rotation.y.xyz,rotation.z.xyz))*(point-b.centerAngle.xyz);
  let q=abs(local)-b.halfOmega.xyz;
  return length(max(q,vec3f(0)))+min(max(q.x,max(q.y,q.z)),0.0);
}
@compute @workgroup_size(1)
fn clearDetail(){atomicStore(&counters[2],0u);atomicStore(&counters[3],0u);}
@compute @workgroup_size(128)
fn clear(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i<workCount()){
    let c=workCoord(i);if(valid(c)){let j=index(vec3u(c));atomicStore(&field[j].density,0u);atomicStore(&field[j].shade,0u);}
  }
  if(i==0u){atomicStore(&counters[surfaceCount()],0u);atomicStore(&counters[surfaceCount()+1u],0u);}
}
@compute @workgroup_size(64)
fn splat(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=params.dims.w){return;}
  let p=points[i].xyz;
  if(params.tile.w>0u){
    let lo=params.origin.xyz+vec3f(f32(params.tile.y)-4.0,0,f32(params.tile.z)-4.0)*params.surface.x;
    let hi=lo+vec3f(f32(params.tile.w)+8.0,f32(params.dims.y),f32(params.tile.w)+8.0)*params.surface.x;
    if(any(p.xz<lo.xz-vec2f(params.surface.y))||any(p.xz>hi.xz+vec2f(params.surface.y))){return;}
  }
  let volume=particles[i].velocity.w*particles[i].history.x*determinant(mat3x3f(particles[i].f0.xyz,particles[i].f1.xyz,particles[i].f2.xyz));
  let h=params.surface.y;let dx=params.surface.x;
  let center=vec3i(floor((p-params.origin.xyz)/dx));let range=i32(ceil(h/dx));
  var lower=center-vec3i(range);var upper=center+vec3i(range);
  if((params.flags.z&2u)>0u){
    // Omitted nodes have zero kernel weight. Retained contributions use the
    // same coordinates, density formula and integer rounding as before.
    lower=max(lower,vec3i(ceil((p-params.origin.xyz-vec3f(h))/dx)));
    upper=min(upper,vec3i(floor((p-params.origin.xyz+vec3f(h))/dx)));
    lower=max(lower,vec3i(0));upper=min(upper,vec3i(params.dims.xyz)-vec3i(1));
    if(params.tile.w>0u){
      lower=max(lower,vec3i(i32(params.tile.y)-4,0,i32(params.tile.z)-4));
      upper=min(upper,vec3i(i32(params.tile.y+params.tile.w)+4,i32(params.dims.y)-1,i32(params.tile.z+params.tile.w)+4));
    }
  }
  // Poly6 kernel integrates to one. Its field is visual material occupancy, not a force.
  let norm=315.0/(64.0*3.14159265*h*h*h);
  let shade=clamp(particles[i].material.x*0.8+particles[i].material.y*0.3,0.0,0.85);
  for(var z=lower.z;z<=upper.z;z++){for(var y=lower.y;y<=upper.y;y++){for(var x=lower.x;x<=upper.x;x++){
    let c=vec3i(x,y,z);if((params.flags.z&2u)==0u&&!valid(c)){continue;}
    let world=params.origin.xyz+vec3f(c)*dx;
    let r2=dot(world-p,world-p)/(h*h);if(r2>=1.0){continue;}
    let q=1.0-r2;let density=volume*norm*q*q*q;
    let idx=index(vec3u(c));atomicAdd(&field[idx].density,u32(round(density*SCALE)));atomicAdd(&field[idx].shade,u32(round(density*shade*SCALE)));
  }}}
}
@compute @workgroup_size(128)
fn clip(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=workCount()){return;}let c=workCoord(i);if(!valid(c)){return;}
  let j=index(vec3u(c));let p=params.origin.xyz+vec3f(c)*params.surface.x;
  // Clip the visualization against actual collision geometry, not a broad halo.
  if(p.y<params.time.w){atomicStore(&field[j].density,0u);atomicStore(&field[j].shade,0u);return;}
  if(atomicLoad(&field[j].density)==0u){return;}
  for(var b=0u;b<params.flags.x;b++){
    if(boxDistance(p,params.boxes[b],params.rotations[b],params.bounds[b].xyz)<0.0){atomicStore(&field[j].density,0u);atomicStore(&field[j].shade,0u);return;}
  }
}
struct Vertex {position:vec3f,normal:vec3f,shade:f32}
fn crossing(a:vec3u,b:vec3u)->Vertex{
  let da=densityAt(vec3i(a));let db=densityAt(vec3i(b));
  let t=clamp((params.surface.z-da)/(db-da),0.0,1.0);
  let pos=params.origin.xyz+mix(vec3f(a),vec3f(b),t)*params.surface.x;
  let grad=mix(gradient(a),gradient(b),t);
  let shadeA=f32(atomicLoad(&field[index(a)].shade))/SCALE;
  let shadeB=f32(atomicLoad(&field[index(b)].shade))/SCALE;
  let shade=clamp(mix(shadeA,shadeB,t)/max(mix(da,db,t),1e-6),0.0,0.85);
  return Vertex(pos,normalize(grad+vec3f(0,1e-8,0)),shade);
}
fn triangle(a:Vertex,b:Vertex,c:Vertex){
  let localOffset=atomicAdd(&counters[surfaceCount()],3u);
  let offset=tileId()*u32(params.surface.w)+localOffset;
  if(localOffset+3u>u32(params.surface.w)){atomicAdd(&counters[surfaceCount()+1u],1u);return;}
  var bb=b;var cc=c;
  if(dot(cross(b.position-a.position,c.position-a.position),a.normal+b.normal+c.normal)<0.0){bb=c;cc=b;}
  vertices[offset]=vec4f(a.position,a.shade);normals[offset]=vec4f(a.normal,0);
  vertices[offset+1u]=vec4f(bb.position,bb.shade);normals[offset+1u]=vec4f(bb.normal,0);
  vertices[offset+2u]=vec4f(cc.position,cc.shade);normals[offset+2u]=vec4f(cc.normal,0);
}
fn tetra(corners:array<vec3u,4>){
  var inside:array<u32,4>;var outside:array<u32,4>;var count=0u;var outCount=0u;
  for(var i=0u;i<4u;i++){
    if(densityAt(vec3i(corners[i]))>=params.surface.z){inside[count]=i;count++;}
    else{outside[outCount]=i;outCount++;}
  }
  if(count==0u||count==4u){return;}
  if(count==1u){let a=corners[inside[0]];triangle(crossing(a,corners[outside[0]]),crossing(a,corners[outside[1]]),crossing(a,corners[outside[2]]));}
  else if(count==3u){let a=corners[outside[0]];triangle(crossing(a,corners[inside[0]]),crossing(a,corners[inside[1]]),crossing(a,corners[inside[2]]));}
  else{
    let a=corners[inside[0]];let b=corners[inside[1]];let c=corners[outside[0]];let d=corners[outside[1]];
    let ac=crossing(a,c);let ad=crossing(a,d);let bc=crossing(b,c);let bd=crossing(b,d);
    triangle(ac,ad,bc);triangle(bc,ad,bd);
  }
}
@compute @workgroup_size(64)
fn extract(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=workCount()){return;}let signed=workCoord(i);if(!valid(signed)){return;}
  let c=vec3u(signed);if(any(c>=params.dims.xyz-vec3u(1))){return;}
  if(params.tile.w>0u&&(any(c.xz<params.tile.yz)||any(c.xz>=params.tile.yz+vec2u(params.tile.w)))){return;}
  let offsets=array<vec3u,8>(vec3u(0,0,0),vec3u(1,0,0),vec3u(1,1,0),vec3u(0,1,0),vec3u(0,0,1),vec3u(1,0,1),vec3u(1,1,1),vec3u(0,1,1));
  var corner:array<vec3u,8>;var lo=1e6;var hi=0.0;
  for(var k=0u;k<8u;k++){corner[k]=c+offsets[k];let d=densityAt(vec3i(corner[k]));lo=min(lo,d);hi=max(hi,d);}
  if(lo>=params.surface.z||hi<params.surface.z){return;}
  // All cubes share the same body diagonal, avoiding cracks between tetrahedra.
  tetra(array<vec3u,4>(corner[0],corner[1],corner[2],corner[6]));
  tetra(array<vec3u,4>(corner[0],corner[2],corner[3],corner[6]));
  tetra(array<vec3u,4>(corner[0],corner[3],corner[7],corner[6]));
  tetra(array<vec3u,4>(corner[0],corner[7],corner[4],corner[6]));
  tetra(array<vec3u,4>(corner[0],corner[4],corner[5],corner[6]));
  tetra(array<vec3u,4>(corner[0],corner[5],corner[1],corner[6]));
}
@compute @workgroup_size(1)
fn finalizeTile(){
  let tile=tileId();atomicStore(&draw[tile].surface.count,min(atomicLoad(&counters[surfaceCount()]),u32(params.surface.w)));
  draw[tile].surface.instances=1u;draw[tile].surface.first=tile*u32(params.surface.w);draw[tile].surface.base=0u;
}
@compute @workgroup_size(1)
fn finalize(){
  var vertices=0u;var overflow=0u;
  for(var tile=0u;tile<params.tile.x;tile++){
    vertices+=atomicLoad(&draw[tile].surface.count);overflow+=atomicLoad(&counters[5u+tile*2u]);
  }
  atomicStore(&counters[0],vertices);atomicStore(&counters[1],overflow);
  atomicStore(&draw[0].detached.count,params.flags.w);draw[0].detached.instances=select(params.dims.w,atomicLoad(&counters[3]),(params.flags.z&1u)>0u);draw[0].detached.first=0u;draw[0].detached.base=0u;
  atomicStore(&draw[0].spill.count,6u);draw[0].spill.instances=select(0u,params.flags.y,atomicLoad(&counters[2])>0u);draw[0].spill.first=0u;draw[0].spill.base=0u;
}
fn hash(i:u32)->f32{var v=i*747796405u+2891336453u;v=((v>>((v>>28u)+4u))^v)*277803737u;v=(v>>22u)^v;return f32(v)/4294967295.0;}
@compute @workgroup_size(64)
fn grains(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=arrayLength(&detail)){return;}
  let dt=params.time.x;
  if(i>=params.flags.y){
    // Preserve the volume of dilute physical material. One shaded proxy follows
    // each actual sample; no random jitter cloud substitutes for missing surface.
    let local=i-params.flags.y;let source=local;let p=points[source].xyz;
    let d=densityAt(vec3i(round((p-params.origin.xyz)/params.surface.x)));
    let visibility=1.0-smoothstep(params.surface.z,params.surface.z*1.35,d);
    let radius=pow(particles[source].velocity.w*particles[source].history.x*determinant(mat3x3f(particles[source].f0.xyz,particles[source].f1.xyz,particles[source].f2.xyz))*3.0/(4.0*3.14159265),1.0/3.0);
    let proxy=Grain(vec4f(p,radius*visibility),vec4f(particles[source].velocity.xyz,clamp(particles[source].material.x*0.8+particles[source].material.y*0.3,0.0,0.85)));
    if(radius*visibility>0.0){
      let slot=atomicAdd(&counters[3],1u);
      if((params.flags.z&1u)>0u){detail[params.flags.y+slot]=proxy;}
    }
    if((params.flags.z&1u)==0u){detail[i]=proxy;}
    return;
  }
  var g=detail[i];
  if(params.time.z<0.5){g.position.w=0.0;detail[i]=g;return;}
  if(dt<=0.0){if(g.position.w>0.0){atomicAdd(&counters[2],1u);}return;}
  if(g.position.w>0.0){
    g.velocity.y-=9.81*dt;g.position=vec4f(g.position.xyz+g.velocity.xyz*dt,g.position.w-dt);
    if(g.position.y<params.time.w+0.006){g.position.w=0.0;}
    for(var b=0u;b<params.flags.x;b++){if(boxDistance(g.position.xyz,params.boxes[b],params.rotations[b],params.bounds[b].xyz)<0.005){g.position.w=0.0;}}
  }else{
    let source=(i*1973u+u32(params.origin.w)*1013u)%params.dims.w;
    let p=points[source].xyz;let v=particles[source].velocity.xyz;
    let c=vec3i(round((p-params.origin.xyz)/params.surface.x));
    let d=densityAt(c);
    // Emit only from material actually moving at an exposed boundary. Never animate resting soil.
    let water=particles[source].material.x;let fine=particles[source].material.y;
    let emissionChance=(0.01+0.08*(1.0-water)*(1.0-water))*(1.0-0.7*fine);
    if(length(v)>0.45&&p.y>params.time.w+0.1&&d<1.25&&d>0.02&&hash(i+u32(params.origin.w)*31u)<emissionChance){
      let jitter=vec3f(hash(i*3u)-0.5,hash(i*3u+1u)-0.5,hash(i*3u+2u)-0.5)*params.time.y*0.15;
      g.position=vec4f(p+jitter,0.10+hash(i+7u)*0.12);
      g.velocity=vec4f(v+jitter*2.0,clamp(particles[source].material.x*0.8+particles[source].material.y*0.3,0.0,0.85));
    }
  }
  if(g.position.w>0.0){atomicAdd(&counters[2],1u);}
  detail[i]=g;
}
