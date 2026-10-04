import * as THREE from 'three/webgpu';
import {color,float,mix,positionWorld,texture,triplanarTexture} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

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
  material.colorNode=mix(color(0xc2b48f),color(0x5a4635),shade).mul(grain.mul(0.32).add(0.8));
  return {material,map};
}
