'use strict';
const element=id=>document.getElementById(id);
let credential='',timer,loading=false,generation=0;
function text(tag,value,className) {const node=document.createElement(tag);node.textContent=value;if (className) node.className=className;return node;}
function stop() {generation++;credential='';clearInterval(timer);element('snapshot').hidden=true;element('connect').hidden=false;element('cards').replaceChildren();element('alerts').replaceChildren();element('recovery').replaceChildren();}
async function sample() {
  if (loading || !credential) return;loading=true;
  const current=generation;
  try {
    const response=await fetch('/status',{cache:'no-store',headers:{Authorization:'Bearer '+credential},redirect:'error'});
    if (!response.ok) throw new Error(response.status===401 ? 'Token rejected. Connect with the current operations token.' : 'Operations service unavailable.');
    const result=await response.json();
    if (current!==generation || !credential) return;
    element('connect').hidden=true;element('snapshot').hidden=false;element('message').textContent='';
    element('sampled').textContent=result.environment+' · '+result.revision+' · Updated '+new Date().toLocaleTimeString();
    const values=[['Database',result.databaseReady ? 'Ready' : 'Unavailable'],['Uptime',Math.floor(result.uptimeSeconds)+' s'],
      ['RSS memory',Math.round(result.memory.rss/1048576)+' MiB'],['HTTP requests',String(result.requests)],['Server errors',String(result.serverErrors)],
      ['Pool in use',String(result.pool.total-result.pool.idle)],['Pool waiting',String(result.pool.waiting)],['Loop p99',result.eventLoopDelayP99Ms.toFixed(1)+' ms']];
    element('cards').replaceChildren(...values.map(([label,value])=>{const card=text('article','', 'card');card.append(text('span',label),text('strong',value));return card;}));
    element('observer').textContent='Host observer '+result.observer.state;
    const alerts=Array.isArray(result.observer.alerts) ? result.observer.alerts : [];
    element('alerts').replaceChildren(...(alerts.length ? alerts.map(alert=>text('li',alert.key+' · '+alert.state+' · '+alert.message,alert.state)) : [text('li','No alerts reported. Check observer freshness.')]));
    const recovery=[['Backup feed',result.backup.state],['Last backup',result.backup.completedAt || 'Unavailable'],['Shutdown',result.draining ? 'Draining' : 'Serving']];
    element('recovery').replaceChildren(...recovery.map(([label,value])=>{const row=document.createElement('div');row.append(text('dt',label),text('dd',value));return row;}));
  } catch(error) {if(current===generation) {element('message').textContent=error.message;stop();}}
  finally {loading=false;}
}
element('connect').addEventListener('submit',event=>{event.preventDefault();credential=element('token').value;element('token').value='';sample();clearInterval(timer);timer=setInterval(sample,5000);});
element('disconnect').addEventListener('click',()=>{stop();element('message').textContent='Disconnected';});
