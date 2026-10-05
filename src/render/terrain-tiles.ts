import {CHUNK_COUNT,chunkCoord,TERRAIN_ORIGIN} from '../simulation/terrain';
import {colliderBounds,type Collider} from '../simulation/bucket';
export const SURFACE_TILE_SIZE=4,SURFACE_TILE_AXIS=6,SURFACE_TILE_COUNT=36;
export const SURFACE_TILE_CELLS=25,SURFACE_TILE_HALO=4,SURFACE_TILE_VERTICES=65536;
/** Include density-kernel/normal halos so neighboring cached meshes meet exactly. */
export function terrainSurfaceTiles(modes:Uint32Array,boxes:Collider[]=[]):Set<number>{
  const tiles=new Set<number>();
  const add=(minX:number,maxX:number,minZ:number,maxZ:number)=>{
    const loX=Math.max(0,Math.floor((minX-TERRAIN_ORIGIN[0])/SURFACE_TILE_SIZE));
    const hiX=Math.min(5,Math.floor((maxX-TERRAIN_ORIGIN[0])/SURFACE_TILE_SIZE));
    const loZ=Math.max(0,Math.floor((minZ-TERRAIN_ORIGIN[2])/SURFACE_TILE_SIZE));
    const hiZ=Math.min(5,Math.floor((maxZ-TERRAIN_ORIGIN[2])/SURFACE_TILE_SIZE));
    for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)tiles.add(x+z*6);
  };
  for(let c=0;c<CHUNK_COUNT;c++)if(modes[c]===1){const p=chunkCoord(c);add(p[0]-12-.64,p[0]-11+.64,p[2]-12-.64,p[2]-11+.64);}
  for(const box of boxes){const half=colliderBounds(box);add(box.center[0]-half[0]-.64,box.center[0]+half[0]+.64,box.center[2]-half[2]-.64,box.center[2]+half[2]+.64);}
  return tiles;
}
