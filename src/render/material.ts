import * as THREE from 'three/webgpu';
import {color,float,mix,positionWorld,texture,triplanarTexture,smoothstep} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

const SAND=0xb9ab89,SOIL=0x88745e,WET_DIRT=0x40362d;

/** Composition shading is shared by bulk soil, detached chunks, and grains. */
export function materialColorNode(shade:Node<'float'>){
  const dry=mix(color(SAND),color(SOIL),smoothstep(.04,.22,shade));
  return mix(dry,color(WET_DIRT),smoothstep(.24,.68,shade));
}
export function materialColor(water:number,fines:number):THREE.Color{
  const shade=Math.min(.85,water*.8+fines*.3);
  return new THREE.Color(SAND).lerp(new THREE.Color(SOIL),THREE.MathUtils.smoothstep(shade,.04,.22))
    .lerp(new THREE.Color(WET_DIRT),THREE.MathUtils.smoothstep(shade,.24,.68));
}

/** Mipmapped fine-grain shading: visual detail independent of simulation resolution. */
export function grainTexture():THREE.DataTexture{
  const size=128,data=new Uint8Array(size*size*4);let seed=15231;
  for(let i=0;i<size*size;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const tone=165+(seed>>>24)%91;
    data.set([tone,tone,tone,255],i*4);
  }
  const map=new THREE.DataTexture(data,size,size);map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  return map;
}
export function soilMaterial(shade:Node<'float'>):{material:THREE.MeshStandardNodeMaterial;map:THREE.DataTexture}{
  const map=grainTexture();
  const material=new THREE.MeshStandardNodeMaterial({roughness:0.98,metalness:0});
  const grain=triplanarTexture(texture(map),null,null,float(7),positionWorld).r;
  const mottling=triplanarTexture(texture(map),null,null,float(.025),positionWorld).r;
  material.colorNode=materialColorNode(shade).mul(grain.mul(.22).add(.82)).mul(mottling.mul(.45).add(.64));
  // Damp fines darken and smooth the surface without giving soil a glossy finish.
  material.roughnessNode=mix(float(.98),float(.76),smoothstep(.24,.68,shade));
  return {material,map};
}
