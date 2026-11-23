/* Dependency-aware scheduling primitives (working-day network).
 * Dependency records: { predecessor: taskId, type: 'FS'|'SS'|'FF'|'SF', lag: workingDays }.
 * Pure helpers; intended to be integrated with CBSched.compute.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.CBDependency=factory();
})(this,function(){
  'use strict';
  function addWork(day,n,off,nextWork){
    var d=day,step=n>=0?1:-1,remain=Math.abs(Math.round(n));
    while(remain){d+=step;if(!off[((d+4)%7+7)%7])remain--;}
    return step>0?nextWork(d,off):d;
  }
  function topological(tasks){
    var ids=Object.keys(tasks), indeg={}, edges={};
    ids.forEach(function(id){indeg[id]=0;edges[id]=[];});
    ids.forEach(function(id){
      (tasks[id].deps||[]).forEach(function(dep){
        var pred=String(dep.predecessor||dep.from||'');
        if(!tasks[pred]||pred===id)return;
        edges[pred].push(id);indeg[id]++;
      });
    });
    var q=ids.filter(function(id){return indeg[id]===0;}),out=[];
    while(q.length){var id=q.shift();out.push(id);edges[id].forEach(function(v){indeg[v]--;if(indeg[v]===0)q.push(v);});}
    return {order:out,cycle:out.length!==ids.length};
  }
  function solve(tasks,baseStart,off,helpers){
    var topo=topological(tasks); if(topo.cycle)return {cycle:true,order:topo.order,dates:{}};
    var nextWork=helpers.nextWork,finishOf=helpers.finishOf,dates={},order=topo.order;
    order.forEach(function(id){
      var t=tasks[id]||{},dur=Math.max(0,Number(t.dur)||0),st=baseStart;
      if(t.start)st=helpers.toDays(t.start);
      var deps=t.deps||[];
      deps.forEach(function(dep){
        var pred=dates[String(dep.predecessor||dep.from||'')];if(!pred)return;
        var lag=Math.round(Number(dep.lag)||0),type=String(dep.type||'FS').toUpperCase(),candidate;
        if(type==='SS')candidate=helpers.addLag(pred.start,lag,off);
        else if(type==='FF')candidate=helpers.addLag(pred.finish,lag,off)-Math.max(1,Math.ceil(dur-1e-9))+1;
        else if(type==='SF')candidate=helpers.addLag(pred.start,lag,off)-Math.max(1,Math.ceil(dur-1e-9))+1;
        else candidate=helpers.addLag(pred.finish,lag+1,off);
        if(!t.start||candidate>st)st=candidate;
      });
      st=nextWork(st,off);var fin=finishOf(st,dur,off);
      dates[id]={start:st,finish:fin,dur:dur};
    });
    var projectFinish=order.reduce(function(m,id){return Math.max(m,dates[id].finish);},baseStart);
    var latest={},float={},critical=[];
    order.slice().reverse().forEach(function(id){
      var t=tasks[id]||{},d=dates[id],latestFinish=projectFinish;
      Object.keys(tasks).forEach(function(sid){
        (tasks[sid].deps||[]).forEach(function(dep){
          if(String(dep.predecessor||dep.from||'')!==id)return;
          var lag=Math.round(Number(dep.lag)||0),type=String(dep.type||'FS').toUpperCase(),sd=latest[sid];
          if(!sd)return;
          var candidate=type==='SS'?sd.start-lag:type==='FF'?sd.finish-lag:type==='SF'?sd.finish-lag:sd.start-lag-1;
          latestFinish=Math.min(latestFinish,candidate);
        });
      });
      var lf=latestFinish,ls=lf-Math.max(1,Math.ceil(d.dur-1e-9))+1;
      latest[id]={start:ls,finish:lf};float[id]=ls-d.start;
      if(float[id]<=0)critical.push(id);
    });
    return {cycle:false,order:order,dates:dates,latest:latest,float:float,critical:critical,projectFinish:projectFinish};
  }
  return {topological:topological,solve:solve};
});
