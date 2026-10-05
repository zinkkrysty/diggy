import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainSurfaceTiles} from '../src/render/terrain-tiles';
import {chunkAt,CHUNK_COUNT} from '../src/simulation/terrain';
test('surface cache includes adjacent kernel tiles while retaining remote meshes',()=>{
 const modes=new Uint32Array(CHUNK_COUNT);modes[chunkAt(-.1,.3,-.1)]=1;
 const dirty=terrainSurfaceTiles(modes);
 assert.deepEqual([...dirty].sort((a,b)=>a-b),[14,15,20,21]);
 assert.ok(dirty.size<36);assert.equal(terrainSurfaceTiles(new Uint32Array(CHUNK_COUNT)).size,0);
});
test('moving collider clipping refreshes both sides of a tile boundary',()=>{
 const dirty=terrainSurfaceTiles(new Uint32Array(CHUNK_COUNT),[{center:[0,1,0],half:[.5,.5,.5],angle:0,omega:0,bucket:false,velocity:[1,0,0]}]);
 assert.deepEqual([...dirty].sort((a,b)=>a-b),[14,15,20,21]);
});
