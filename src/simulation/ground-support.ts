/** Coarse, ground-connected support proxy for the chassis only. Never changes soil. */
export function supportHeights(positions:Float32Array):Float32Array<ArrayBuffer>{
  const occupied=new Uint32Array(25*25),heights=new Float32Array(25*25).fill(.15);
  for(let i=0;i<positions.length;i+=4){
    const x=Math.round((positions[i]+6)*2),z=Math.round((positions[i+2]+6)*2),y=Math.floor((positions[i+1]-.15+1e-5)/.2);
    if(x>=0&&x<=24&&z>=0&&z<=24&&y>=0&&y<20)occupied[z+x*25]|=1<<y;
  }
  // A gap interrupts support. Soil in a bucket or a falling clump overhead
  // cannot become an invisible pillar underneath the vehicle.
  for(let i=0;i<heights.length;i++){let layers=0;while(layers<20&&(occupied[i]&(1<<layers)))layers++;heights[i]=.15+layers*.2;}
  return heights;
}
