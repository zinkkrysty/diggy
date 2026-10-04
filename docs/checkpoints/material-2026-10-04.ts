export interface MaterialSettings {
  moisture: number; grainMm: number; friction: number; cohesion: number;
  stiffness: number; viscosity: number; adhesion: number;
}
export const presets: Record<string, MaterialSettings> = {
  sand: { moisture: 0, grainMm: 0.7, friction: 34, cohesion: 0, stiffness: 45000, viscosity: 0, adhesion: 0 },
  soil: { moisture: 0.12, grainMm: 0.12, friction: 38, cohesion: 1500, stiffness: 85000, viscosity: 0.15, adhesion: 0.08 },
  wet: { moisture: 0.62, grainMm: 0.035, friction: 29, cohesion: 1800, stiffness: 40000, viscosity: 1.5, adhesion: 0.55 },
};
export function finesFromGrain(mm: number): number { return Math.max(0, Math.min(1, -Math.log10(mm) / 2.2)); }
export function density(moisture: number): number { return 1450 + 550 * moisture; }
export function moistureCohesion(water: number, fines: number): number {
  return 2500 * (0.15 + 0.85 * fines) * Math.sin(Math.PI * water);
}
// Bulk resistance is independent of shear/shape stiffness. Ordinary loading
// should not halve material volume merely because a granular material yields.
export const BULK_MODULUS=2000000;
export const BULK_DAMPING=0.8;
export const COMPACTION_YIELD=35000;
export const COMPACTION_HARDENING=300000;
export function stableTimestep(settings: MaterialSettings, dx: number): number {
  const mu=settings.stiffness/2.4;
  const waveSpeed=Math.sqrt((BULK_MODULUS+4*mu/3)/1450);
  const bulkDiffusionBound=0.14*dx/(BULK_DAMPING*Math.sqrt(BULK_MODULUS/1450));
  return Math.min(1/600,0.18*dx/(waveSpeed+8),bulkDiffusionBound);
}
