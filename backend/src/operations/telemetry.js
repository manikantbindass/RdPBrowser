'use strict';
const { monitorEventLoopDelay }=require('node:perf_hooks');
const { context,requestTrace }=require('./trace');
const buckets=[0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2,5,10,Infinity];
const label=value=>JSON.stringify(String(value));
function createTelemetry(config,logger) {
  const requests=new Map(),database={count:0,errors:0,durationMs:0};
  const started=Date.now(),lag=monitorEventLoopDelay({ resolution:20 });
  if (config.METRICS_ENABLED) lag.enable();
  const metrics={
    observeDatabase(durationMs,outcome) {database.count++;database.durationMs+=durationMs;if (outcome==='error') database.errors++;},
    middleware(req,res,next) {
      const trace=requestTrace(config.TRACE_SAMPLE_RATE);
      req.trace=trace;res.set('traceparent','00-'+trace.traceId+'-'+trace.spanId+'-'+(trace.sampled ? '01' : '00'));
      const start=process.hrtime.bigint();let recorded=false;
      function finish(aborted) {
        if (recorded) return;recorded=true;
        const elapsed=Number(process.hrtime.bigint()-start)/1e9;
        const route=(req.originalUrl.startsWith('/scim/v2/') ? 'scim' : req.originalUrl.startsWith('/api/') ? 'api' : '')+
          (typeof req.route?.path==='string' ? req.route.path : 'unmatched');
        const method=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(req.method) ? req.method : 'OTHER';
        const status=aborted ? '4xx' : Math.floor(res.statusCode/100)+'xx';
        let key=method+'|'+route+'|'+status;
        if (!requests.has(key) && requests.size>=256) key='OTHER|overflow|'+status;
        if (!requests.has(key)) requests.set(key,{method:key.split('|')[0],route:key.split('|')[1],status,count:0,sum:0,buckets:buckets.map(()=>0)});
        const row=requests.get(key);row.count++;row.sum+=elapsed;
        buckets.forEach((limit,index)=>{if (elapsed<=limit) row.buckets[index]++;});
        if (trace.sampled) logger.info({event:'trace.span',name:'http.request',traceId:trace.traceId,spanId:trace.spanId,method,route,status,durationMs:elapsed*1000,outcome:aborted ? 'aborted' : 'complete'});
      }
      res.once('finish',()=>finish(false));res.once('close',()=>finish(!res.writableFinished));
      context.run({...trace,metrics,logger},next);
    },
    status() {
      const memory=process.memoryUsage();
      return {revision:config.APP_REVISION,environment:config.DEPLOYMENT_ENV,uptimeSeconds:(Date.now()-started)/1000,
        memory:{rss:memory.rss,heapUsed:memory.heapUsed},eventLoopDelayP99Ms:config.METRICS_ENABLED ? Number(lag.percentile(99))/1e6 : null,
        requests:[...requests.values()].reduce((sum,row)=>sum+row.count,0),
        serverErrors:[...requests.values()].filter(row=>row.status==='5xx').reduce((sum,row)=>sum+row.count,0),database:{...database}};
    },
    prometheus(extra={}) {
      const state=metrics.status(),lines=[
        '# TYPE rsx_process_uptime_seconds gauge','rsx_process_uptime_seconds '+state.uptimeSeconds,
        '# TYPE rsx_process_memory_rss_bytes gauge','rsx_process_memory_rss_bytes '+state.memory.rss,
        '# TYPE rsx_event_loop_delay_p99_seconds gauge','rsx_event_loop_delay_p99_seconds '+(state.eventLoopDelayP99Ms || 0)/1000,
        '# TYPE rsx_database_queries_total counter','rsx_database_queries_total '+database.count,
        '# TYPE rsx_database_query_errors_total counter','rsx_database_query_errors_total '+database.errors,
        '# TYPE rsx_database_query_duration_seconds_total counter','rsx_database_query_duration_seconds_total '+database.durationMs/1000,
        '# TYPE rsx_database_ready gauge','rsx_database_ready '+(extra.databaseReady ? 1 : 0),
        '# TYPE rsx_draining gauge','rsx_draining '+(extra.draining ? 1 : 0),
        '# TYPE rsx_http_requests_total counter','# TYPE rsx_http_request_duration_seconds histogram',
      ];
      for (const row of requests.values()) {
        const labels='method='+label(row.method)+',route='+label(row.route)+',status_class='+label(row.status);
        lines.push('rsx_http_requests_total{'+labels+'} '+row.count);
        buckets.forEach((bound,index)=>lines.push('rsx_http_request_duration_seconds_bucket{'+labels+',le='+label(bound===Infinity ? '+Inf' : bound)+'} '+row.buckets[index]));
        lines.push('rsx_http_request_duration_seconds_count{'+labels+'} '+row.count,'rsx_http_request_duration_seconds_sum{'+labels+'} '+row.sum);
      }
      if (extra.pool) for (const key of ['total','idle','waiting']) lines.push('rsx_database_pool_'+key+' '+extra.pool[key]);
      lines.push('rsx_operations_observer_fresh '+(extra.observer?.state==='fresh' ? 1 : 0));
      lines.push('rsx_backup_last_success_timestamp_seconds '+(Date.parse(extra.backup?.completedAt || '')/1000 || 0));
      lines.push('rsx_operations_alerts '+(extra.observer?.alerts?.filter(item=>item.state==='firing').length || 0));
      return lines.join('\n')+'\n';
    },
    close() {lag.disable();},
  };
  return metrics;
}
module.exports={createTelemetry};
