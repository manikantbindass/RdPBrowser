import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('quality',Path(__file__).with_name('run.py'))
quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)


class AcceptanceTests(unittest.TestCase):
    def test_catalog_ids_are_unique_and_bound_execution(self):
        checks=quality.catalog()
        self.assertEqual(len(checks),len({row['id'] for row in checks}))
        self.assertTrue(all(0<row['timeout']<=1800 for row in checks))

    def test_unknown_check_cannot_succeed_as_an_empty_run(self):
        result=subprocess.run([sys.executable,str(Path(__file__).with_name('run.py')),'--select','not-a-check'],capture_output=True)
        self.assertNotEqual(result.returncode,0)

    def test_credentials_are_redacted_before_evidence_is_written(self):
        value='postgresql://user:private-value@localhost/test eyJfixture.payload.signature'
        sanitized=quality.redact(value)
        self.assertNotIn('private-value',sanitized)
        self.assertNotIn('eyJfixture',sanitized)

    def test_machine_report_requires_executed_cases_without_skips(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)
            report=output/'backend-jest.json'
            base={'numPassedTests':1,'numFailedTests':0,'numPendingTests':0,'numTodoTests':0}
            for change in ({'numPassedTests':0},{'numPendingTests':1},{'numFailedTests':1}):
                report.write_text(json.dumps({**base,**change}))
                self.assertIsNotNone(quality.test_report_problem('backend-unit',output,''))
            report.write_text(json.dumps(base))
            self.assertIsNone(quality.test_report_problem('backend-unit',output,''))

    def test_load_gate_rejects_errors_latency_and_missing_completion(self):
        sample={'requests':300,'concurrency':10,'errors':0,'requestsPerSecond':100,'latencyMs':{'p95':150,'p99':200},'restoreSeconds':10,'activationSeconds':30}
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'load.jsonl'
            for changed,expected in [({},0),({'errors':1},1),({'requestsPerSecond':1},1),({'latencyMs':{'p95':1500,'p99':2000}},1)]:
                source.write_text(json.dumps({'performance':{**sample,**changed}})+'\n'+json.dumps({'result':'PASS'})+'\n')
                result=subprocess.run([sys.executable,str(Path(__file__).with_name('performance.py')),str(source)],capture_output=True)
                self.assertEqual(result.returncode,expected)
            source.write_text(json.dumps({'performance':sample})+'\n')
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('performance.py')),str(source)],capture_output=True)
            self.assertNotEqual(result.returncode,0)


if __name__=='__main__':unittest.main()
