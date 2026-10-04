export function percentile(values: number[], fraction: number): number {
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))];
}
export class PerformanceWindow {
  frames: number[]=[];
  private simulated: number[]=[];
  constructor(private capacity=600) {}
  simSeconds=0;
  wallSeconds=0;
  add(frameMs:number,simSeconds:number):void {
    this.frames.push(frameMs);this.simulated.push(simSeconds);
    if(this.frames.length>this.capacity){this.wallSeconds-=this.frames.shift()!/1000;this.simSeconds-=this.simulated.shift()!;}
    this.simSeconds+=simSeconds;this.wallSeconds+=frameMs/1000;
  }
  reset():void{this.frames=[];this.simulated=[];this.simSeconds=0;this.wallSeconds=0;}
  summary(){return {samples:this.frames.length,medianMs:percentile(this.frames,0.5),p95Ms:percentile(this.frames,0.95),p99Ms:percentile(this.frames,0.99),fps:this.wallSeconds?this.frames.length/this.wallSeconds:0,simulationRate:this.wallSeconds?this.simSeconds/this.wallSeconds:0};}
}
