"""Enforce bounded smoke-load acceptance; never infer a production SLA."""
import json
from pathlib import Path
import sys
rows=[json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.startswith('{')]
measurements=next(row['performance'] for row in rows if 'performance' in row)
limits={'minimumRequests':300,'minimumConcurrency':10,'maximumErrors':0,'minimumRequestsPerSecond':20,'p95Milliseconds':1000,'p99Milliseconds':2000,'maximumRestoreSeconds':60,'maximumActivationSeconds':90}
passed=(measurements['requests']>=limits['minimumRequests'] and measurements['concurrency']>=limits['minimumConcurrency']
        and measurements['errors']==0 and measurements['requestsPerSecond']>=limits['minimumRequestsPerSecond']
        and measurements['latencyMs']['p95']<=limits['p95Milliseconds'] and measurements['latencyMs']['p99']<=limits['p99Milliseconds']
        and measurements['restoreSeconds']<=limits['maximumRestoreSeconds'] and measurements['activationSeconds']<=limits['maximumActivationSeconds']
        and rows[-1].get('result')=='PASS')
report={'status':'PASS' if passed else 'FAIL','limits':limits,'measurements':measurements,'scope':'Small isolated fixture; shared-runner regression gate, not capacity certification'}
Path(sys.argv[1]).with_suffix('.performance.json').write_bytes((json.dumps(report,indent=2)+'\n').encode())
print(json.dumps(report))
raise SystemExit(0 if passed else 1)
