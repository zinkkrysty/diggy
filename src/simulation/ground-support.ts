import {terrainEdgeRadius,TERRAIN_FLOOR,SOIL_SPACING} from './terrain';
const WIDTH=49;
function columnAt(x:number,z:number):number{
  const ix=Math.round((x+12)*2),iz=Math.round((z+12)*2);
  return ix>=0&&ix<WIDTH&&iz>=0&&iz<WIDTH?iz+ix*WIDTH:-1;
}
function connectedTop(column:number[],index:number):number{
  column.sort((a,b)=>a-b);let top=TERRAIN_FLOOR;
  const radius=SOIL_SPACING*.5;
  for(const y of column){
    // A small basal displacement is not a missing column. Real separated
    // volumes above a gap still cannot manufacture support underneath a track.
    if(y-radius>top+(top===TERRAIN_FLOOR?SOIL_SPACING*.6:.035))break;
    top=Math.max(top,y+radius);
  }
  const x=Math.floor(index/WIDTH)*.5-12,z=(index%WIDTH)*.5-12;
  return Math.hypot(x,z)>terrainEdgeRadius(Math.atan2(z,x))-.1?Math.max(.53,top):top;
}
/** Cache membership so local GPU feedback only recomputes changed columns. */
export class GroundSupportCache{
  readonly heights=new Float32Array(WIDTH*WIDTH).fill(TERRAIN_FLOOR);
  private columns=Array.from({length:WIDTH*WIDTH},()=>new Set<number>());
  private owners=new Int32Array(0);
  update(positions:Float32Array,indices?:Uint32Array):Float32Array<ArrayBuffer>{
    const dirty=new Set<number>(),count=positions.length/4;
    if(!indices||this.owners.length!==count){
      this.owners=new Int32Array(count).fill(-1);for(const column of this.columns)column.clear();
      for(let i=0;i<count;i++){const c=columnAt(positions[i*4],positions[i*4+2]);this.owners[i]=c;if(c>=0)this.columns[c].add(i);}
      for(let c=0;c<this.columns.length;c++)dirty.add(c);
    }else for(const i of indices){
      const old=this.owners[i],c=columnAt(positions[i*4],positions[i*4+2]);
      if(old>=0)dirty.add(old);if(c>=0)dirty.add(c);
      if(old!==c){if(old>=0)this.columns[old].delete(i);if(c>=0)this.columns[c].add(i);this.owners[i]=c;}
    }
    for(const c of dirty)this.heights[c]=connectedTop(Array.from(this.columns[c],i=>positions[i*4+1]),c);
    return this.heights;
  }
}
/** Continuous ground-connected support, excluding carried/airborne material. */
export function supportHeights(positions:Float32Array):Float32Array<ArrayBuffer>{return new GroundSupportCache().update(positions);}
