import {defineConfig} from 'vite';

// Development-only measurement lease. Other open demos retain their state and
// stop submitting GPU work while one browser measures the integrated adapter.
export default defineConfig({build:{rollupOptions:{input:{game:'index.html',lab:'lab.html'}}},plugins:[{
  name:'diggy-benchmark-isolation',
  configureServer(server){
    let owner:string|null=null;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    const release=()=>{if(timeout)clearTimeout(timeout);if(owner)server.ws.send('diggy:benchmark-isolation',{owner,active:false});owner=null;};
    server.httpServer?.once('close',release);
    server.middlewares.use('/__diggy/benchmark-isolation',(req,res)=>{
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      let body='';
      req.on('data',chunk=>{body+=String(chunk);if(body.length>1024)req.destroy();});
      req.on('end',()=>{
        try{
          const data=JSON.parse(body);
          if(typeof data.owner!=='string'||typeof data.active!=='boolean')throw new Error('Invalid lease');
          if(data.active){
            if(owner&&owner!==data.owner){res.statusCode=409;res.end('Another measurement is running');return;}
            release();owner=data.owner;
            server.ws.send('diggy:benchmark-isolation',{owner,active:true});
            timeout=setTimeout(release,120000);
          }else if(owner===data.owner)release();
          res.statusCode=200;res.end('OK');
        }catch{res.statusCode=400;res.end('Invalid measurement request');}
      });
    });
  },
}]});
