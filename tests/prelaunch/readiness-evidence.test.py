"""Release evidence links must never turn local tests into external acceptance."""
import hashlib, json, pathlib, subprocess, tempfile, unittest
CHECKER=pathlib.Path(__file__).resolve().parents[2]/'docs/prelaunch/launch-readiness/check_readiness.py'
CANDIDATE='a'*64
class EvidenceGates(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name);(self.root/'docs/prelaunch/launch-readiness').mkdir(parents=True)
  scopes={**{f'OP-{n:02d}':'FORMAL_POLICY_SIGNOFF' for n in [3,4,5,7,8,9,10,11,12,13,14,15]},**{f'RV-{n:02d}':'FORMAL_POLICY_SIGNOFF' for n in range(1,8)},**{f'ENG-{n:02d}':'VERIFIED_IMPLEMENTATION' for n in range(1,4)},'EXT-01':'REAL_CHANNEL','EXT-02':'REAL_CHANNEL','EXT-03':'PRODUCTION_ENVIRONMENT','QA-01':'REAL_DEVICE','QA-02':'REAL_CHANNEL','OPS-01':'FORMAL_POLICY_SIGNOFF','REL-01':'PRODUCTION_ENVIRONMENT'}
  artifact=self.root/'evidence.json';artifact.write_text('{}');digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
  self.state={'baseline_candidate':CANDIDATE,'working_candidate':CANDIDATE,'gates':[{'id':i,'status':'PASS','description':i,'evidence':{'path':'evidence.json','sha256':digest,'scope':scope,'candidate_id':CANDIDATE}} for i,scope in scopes.items()]}
 def run_check(self):
  (self.root/'docs/prelaunch/launch-readiness/READINESS_STATE.json').write_text(json.dumps(self.state))
  result=subprocess.run(['python3',str(CHECKER),'--root',str(self.root)],capture_output=True,text=True,check=False)
  return result.returncode,json.loads(result.stdout)
 def gate(self,identity):return next(g for g in self.state['gates'] if g['id']==identity)
 def test_complete_links_still_do_not_authorize_release(self):
  code,result=self.run_check();self.assertEqual(code,0);self.assertFalse(result['release_authorized']);self.assertFalse(result['deploy_performed']);self.assertEqual(result['result'],'EVIDENCE_LINKS_COMPLETE_REQUIRES_SEMANTIC_REVIEW')
 def test_local_tests_cannot_replace_signoff_device_or_channel(self):
  for identity in ['RV-01','OP-03','QA-01','QA-02','REL-01','EXT-02']:
   with self.subTest(identity=identity):
    gate=self.gate(identity);scope=gate['evidence']['scope'];gate['evidence']['scope']='VERIFIED_IMPLEMENTATION'
    code,result=self.run_check();self.assertEqual(code,2);self.assertIn({'id':identity,'reason':'INSUFFICIENT_EVIDENCE_SCOPE'},result['issues']);gate['evidence']['scope']=scope
 def test_old_candidate_is_rejected(self):
  self.gate('ENG-01')['evidence']['candidate_id']='b'*64
  code,result=self.run_check();self.assertEqual(code,2);self.assertIn({'id':'ENG-01','reason':'EVIDENCE_CANDIDATE_MISMATCH'},result['issues'])
 def test_symlink_parent_is_rejected(self):
  (self.root/'linked').symlink_to(self.root,target_is_directory=True);self.gate('QA-02')['evidence']['path']='linked/evidence.json'
  code,result=self.run_check();self.assertEqual(code,2);self.assertIn({'id':'QA-02','reason':'SYMLINK_EVIDENCE_PATH'},result['issues'])
 def test_modified_evidence_is_rejected(self):
  (self.root/'evidence.json').write_text('{"altered":true}')
  code,result=self.run_check();self.assertEqual(code,2);self.assertTrue(all(i['reason']=='EVIDENCE_HASH_MISMATCH' for i in result['issues']))
 def test_missing_gate_cannot_pass(self):
  self.state['gates']=[g for g in self.state['gates'] if g['id']!='RV-07'];code,result=self.run_check();self.assertEqual(code,2);self.assertIn({'id':'RV-07','reason':'REQUIRED_GATE_MISSING'},result['issues'])
 def test_missing_candidate_cannot_pass(self):
  del self.state['working_candidate'];code,result=self.run_check();self.assertEqual(code,2);self.assertIn({'id':'CANDIDATE','reason':'WORKING_CANDIDATE_REQUIRED'},result['issues'])
if __name__=='__main__':unittest.main()
