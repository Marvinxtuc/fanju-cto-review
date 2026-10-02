#!/usr/bin/env python3
"""Generate assessed reports from candidate-linked actual evidence. Unmapped coverage stays NOT_RUN.
Usage: python3 script ROOT PACK NEW_DRAFT_DIRECTORY [ASSESSMENT_JSON]
ASSESSMENT uses rules/scenarios/tasks arrays keyed by id, blockers array, manifest overrides and review text.
Never infers rule/scenario PASS from aggregate suite PASS. No real runtime files are read.
"""
import sys,json,hashlib,subprocess
from pathlib import Path
root,pack,out=map(lambda x:Path(x).resolve(),sys.argv[1:4])
assessment=json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv)>4 else {}
if out.exists():raise ValueError('Refuse overwriting previous report draft')
contract=json.loads((pack/'acceptance/HANDOFF_CONTRACT.json').read_text())
state=json.loads((root/'docs/prelaunch/EXECUTION_STATE.json').read_text())
result=subprocess.run(['node','scripts/prelaunch-candidate-hash.mjs'],cwd=root,capture_output=True,text=True,check=True)
snapshot=json.loads(result.stdout);candidate=snapshot['candidate_id']
content=json.loads((Path(__file__).parent/'prelaunch-report-content.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
runs=[];artifacts={}
for p in sorted((root/'docs/prelaunch/evidence').glob('*/RUNS.json')):
 blob=json.loads(p.read_text())
 for raw in blob.get('runs',[]):
  if raw.get('candidate_id')!=candidate or raw.get('source_drift_during_run'):continue
  if raw.get('category') not in ('FINAL_CANDIDATE','CLEAN_BUILD'):continue
  row=dict(raw)
  if type(row.get('exit_code')) is not int:continue
  for key in ['category','command','cwd','started_at','finished_at']:
   if not isinstance(row.get(key),str) or not row[key]:raise ValueError('Malformed final run: '+key)
  if row.get('runner') not in ['native','adapter','manual'] or not row.get('toolchain'):raise ValueError('Native provenance missing')
  paths=row.get('artifact_paths',[])
  if not paths:raise ValueError('Raw artifact missing')
  for rel in paths:
   path=root/rel
   if path.is_symlink() or not path.is_file() or root not in path.resolve().parents:raise ValueError('Unsafe evidence artifact')
   artifacts[rel]={'path':rel,'sha256':sha(path),'bytes':path.stat().st_size}
  runs.append(row)
# Nested compatibility records keep their original provenance and are included only when
# explicitly emitted by a same-candidate final wrapper. They are not promoted to FINAL_CANDIDATE.
for parent in list(runs):
 if parent['category']!='FINAL_CANDIDATE' or 'worker-compat' not in parent['command']:continue
 parent_stdout=[rel for rel in parent['artifact_paths'] if rel.endswith('.stdout.log')]
 if len(parent_stdout)!=1:raise ValueError('Compatibility wrapper stdout is ambiguous')
 log=(root/parent_stdout[0]).read_text()
 links=[line.removeprefix('Legacy consumer compatibility evidence: ').strip() for line in log.splitlines() if line.startswith('Legacy consumer compatibility evidence: ')]
 if not links:
  if parent['exit_code']==0:raise ValueError('Successful compatibility wrapper omitted child evidence location')
  continue
 if len(links)!=1:raise ValueError('Compatibility wrapper has ambiguous child evidence directories')
 nested=Path(links[0]).resolve(strict=True)
 evidence=(root/'docs/prelaunch/evidence').resolve()
 if nested.parent!=evidence or not nested.name.startswith('worker-compat-') or nested.is_symlink():raise ValueError('Unsafe nested compatibility directory')
 child_runs_path=nested/'RUNS.json';provenance_path=nested/'CONSUMER_PROVENANCE.json'
 child_blob=json.loads(child_runs_path.read_text());provenance=json.loads(provenance_path.read_text())
 if provenance.get('consumer')!='STARTING_272_SOURCE_PLUS_CURRENT_LEGACY_WORKER_ALLOWLIST' or provenance.get('worker_source_sha256')!=sha(root/'services/api/src/worker.ts'):raise ValueError('Compatibility consumer provenance mismatch')
 if provenance.get('synthetic_only') is not True or provenance.get('production_authorized') is not False:raise ValueError('Compatibility authorization mismatch')
 env=child_blob.get('environment',{})
 if env.get('task_id')!=contract['pack_id'] or env.get('root')!=str(root) or env.get('database_marker_verified') is not True:raise ValueError('Compatibility owned environment mismatch')
 for raw in child_blob.get('runs',[]):
  if raw.get('candidate_id')!=candidate or raw.get('source_snapshot_after')!=candidate or raw.get('source_drift_during_run') is not False:raise ValueError('Linked compatibility candidate drift or mismatch')
  if raw.get('category')!='ENGINEERING_PROGRESS_NOT_FINAL' or raw.get('native_or_adapter')!='NATIVE':raise ValueError('Unrecognized compatibility child provenance')
  rid=raw.get('run_id');prefix=child_blob.get('run_id','')+'-'
  if not isinstance(rid,str) or not rid.startswith(prefix):raise ValueError('Malformed child run identity')
  child_name=rid[len(prefix):]
  if child_name not in ['network-guard','legacy-worker-build','legacy-worker-process']:raise ValueError('Unexpected child command in compatibility evidence')
  source_path=nested/(child_name+'.source.json');source=json.loads(source_path.read_text())
  canonical=json.dumps(source.get('files',[]),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
  if hashlib.sha256(canonical).hexdigest()!=candidate or source.get('candidate_id')!=candidate or source.get('source_snapshot_sha256')!=candidate or source.get('files')!=snapshot['files']:raise ValueError('Compatibility source snapshot does not prove current candidate')
  command=raw.get('command')
  if not isinstance(command,list) or not command or any(not isinstance(a,str) for a in command):raise ValueError('Malformed child execution command')
  if type(raw.get('exit_code')) is not int:raise ValueError('Child actual exit code missing')
  paths=[raw.get('stdout'),raw.get('stderr'),child_runs_path.relative_to(root).as_posix(),provenance_path.relative_to(root).as_posix(),source_path.relative_to(root).as_posix()]
  for key in ['stdout','stderr']:
   rel=raw.get(key);path=root/rel
   if path.is_symlink() or path.parent.resolve()!=nested or not path.is_file() or sha(path)!=raw.get(key+'_sha256'):raise ValueError('Compatibility raw stream hash/path mismatch')
  row={'id':rid,'category':'FINAL_COMPAT_DETAILS','original_category':raw['category'],'parent_final_run_id':parent['id'],'candidate_id':candidate,'source_snapshot_after':candidate,'source_drift_during_run':False,'runner':'native','command':json.dumps(command,ensure_ascii=False),'cwd':raw.get('cwd'),'started_at':raw.get('started'),'finished_at':raw.get('finished'),'exit_code':raw['exit_code'],'status':raw.get('status'),'signal':raw.get('signal'),'passed':raw.get('passed'),'failed':raw.get('failed'),'skipped':raw.get('skipped'),'todo':raw.get('todo'),'toolchain':{'parent_reported':parent['toolchain'],'child_executable':command[0],'provenance':'Actual parent final wrapper toolchain; child did not independently emit version discovery'},'artifact_paths':paths,'consumer_provenance':provenance}
  for key in ['cwd','started_at','finished_at']:
   if not isinstance(row[key],str) or not row[key]:raise ValueError('Child timestamp/cwd missing')
  if row['status'] not in ['PASS','FAIL'] or (row['status']=='PASS' and row['exit_code']!=0):raise ValueError('Child status contradicts actual execution')
  if child_name=='legacy-worker-process':
   tap=(root/raw['stdout']).read_text()
   import re
   for key,label in [('passed','pass'),('failed','fail'),('skipped','skipped'),('todo','todo')]:
    matches=re.findall(r'^# '+label+r' (\d+)$',tap,re.M)
    if len(matches)!=1 or int(matches[0])!=row[key]:raise ValueError('Compatibility native TAP counters mismatch')
   if row['status']=='PASS' and (not row['passed'] or row['failed']!=0 or row['skipped']!=0 or row['todo']!=0):raise ValueError('Compatibility tests unresolved')
  for rel in paths:
   path=root/rel
   if path.is_symlink() or not path.is_file():raise ValueError('Missing nested artifact')
   artifacts[rel]={'path':rel,'sha256':sha(path),'bytes':path.stat().st_size}
  runs.append(row)

if len({r['id'] for r in runs})!=len(runs):raise ValueError('Duplicate native run IDs')
index={r['id']:r for r in runs}
blockers=assessment.get('blockers',[])

bids={b['id'] for b in blockers}
def validate_refs(row,pass_claim):
 if any(b not in bids for b in row.get('blocker_ids',[])):raise ValueError('Unknown blocker reference')
 refs=row.get('evidence_ids',[])
 if any(r not in index for r in refs):raise ValueError('Unknown/current-candidate evidence reference')
 if pass_claim and (not refs or any(index[r]['exit_code']!=0 or index[r].get('status')!='PASS' for r in refs)):raise ValueError('PASS lacks actual successful native run')
 for ref in row.get('code_refs',[]):
  rel=ref.split(':')[0]
  if not (root/rel).is_file():raise ValueError('Missing implementation ref '+rel)
def assessed(kind,ids):
 supplied={x['id']:x for x in assessment.get(kind,[])}
 if set(supplied)-set(ids):raise ValueError('Unknown assessment IDs')
 result=[]
 for id in ids:
  base={'id':id,'candidate_id':candidate,'evidence_ids':[],'blocker_ids':[],'assessment_note':'No individually reviewed native evidence mapping supplied; aggregate results do not establish this requirement.'}
  if kind=='rules':base.update(implementation_status='PARTIAL',verification_status='NOT_RUN',code_refs=[])
  else:base['status']='INCOMPLETE' if kind=='tasks' else 'NOT_RUN'
  base.update(supplied.get(id,{}));base['candidate_id']=candidate
  is_pass=base.get('verification_status',base.get('status')) in ['PASS','COMPLETED']
  validate_refs(base,is_pass)
  if kind=='rules' and base['implementation_status']=='IMPLEMENTED' and not base.get('code_refs'):raise ValueError('Implemented rule lacks explicit code ref')
  result.append(base)
 return result
coverage={'candidate_id':candidate,'rules':assessed('rules',contract['expected_rule_ids']),'scenarios':assessed('scenarios',contract['expected_scenario_ids'])}
tasks={'candidate_id':candidate,'tasks':assessed('tasks',contract['expected_task_ids'])}
manifest={'pack_id':contract['pack_id'],'candidate_id':candidate,'source_snapshot_sha256':candidate,'base_head':state['base_head'],'delivery_status':'INCOMPLETE_ENGINEERING','policy_status':'REBASED_DRAFT','policy_bundle_sha256':contract['source_policy_bundle_sha256'],'production_authorized':False,'real_money_executed':False,'production_deployed':False,'git_committed_in_task':False,'git_pushed':False,'self_review_rounds':['R1','R2','R3','R4'],'self_review_note':'R4 documented as final candidate/evidence review; final completion status appears in SELF_REVIEW_AND_REMEDIATION.md. Inclusion is not a claim of successful runtime or independent approval.','critical_high_engineering_findings':assessment.get('critical_high_engineering_findings',[])}
manifest.update(assessment.get('manifest',{}))
for key in ['candidate_id','source_snapshot_sha256']:manifest[key]=candidate
for key in ['production_authorized','real_money_executed','production_deployed','git_committed_in_task','git_pushed']:
 if manifest[key] is not False:raise ValueError('Authorization boundary expanded')
if manifest['delivery_status']=='RC_READY_FOR_INDEPENDENT_REVIEW':
 if any(b['state']=='OPEN' and b['kind'] in ['POLICY','ENGINEERING'] for b in blockers) or any(t['status']!='COMPLETED' for t in tasks['tasks']) or any(s['status'] not in ['PASS','BLOCKED_EXTERNAL','BLOCKED_ENVIRONMENT'] for s in coverage['scenarios']):raise ValueError('Full RC claimed with unresolved essential gates')
out.mkdir();docs=out/'docs/prelaunch';docs.mkdir(parents=True)
def save(name,obj):(docs/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
save('RELEASE_CANDIDATE_MANIFEST.json',manifest);save('COVERAGE_LEDGER.json',coverage);save('TASK_STATUS.json',tasks);save('BLOCKER_REGISTER.json',{'candidate_id':candidate,'items':blockers});save('EVIDENCE_INDEX.json',{'candidate_id':candidate,'runs':runs,'artifacts':list(artifacts.values())})
state.update(candidate_id=candidate,phase='REVIEW_PACKAGE_PREPARATION',delivery_status=manifest['delivery_status']);save('EXECUTION_STATE.json',state)
# FILE_MANIFEST is deliberately reserved for exporter after complete actual byte inventory exists.
report_groups={'BUILD_REPORT':['build','generate','tool-'],'TEST_REPORT':['test','a1','typecheck'],'SECURITY_REVIEW':['network-guard','check-secrets','check-copy'],'MIGRATION_REPORT':['migrate','schema','legacy-worker'],'RECOVERY_REVIEW':['process','legacy-worker'],'FAILURE_INJECTION_REPORT':['process'],'CONCURRENCY_REVIEW':['process'],'MINIAPP_ACCEPTANCE':['miniapp','weapp'],'OPS_ACCEPTANCE':['ops'],'API_ACCEPTANCE':['api','process'],'RESTAURANT_ACCEPTANCE':['ops','process']}
for rel in contract['reports']:
 name=Path(rel).stem;text=content[name]
 selected=[r for r in runs if any(n in r['id'] for n in report_groups.get(name,[]))]
 rows=['| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |','|---|---|---:|---|---|']
 for r in selected:rows.append('| '+r['id']+' | '+r.get('status','UNKNOWN')+' | '+str(r['exit_code'])+' | '+' / '.join(str(r.get(k,'N/A')) for k in ['passed','failed','skipped','todo'])+' | '+', '.join(r['artifact_paths'])+' |')
 if not selected:rows=['此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。']
 note=assessment.get('report_notes',{}).get(name,'')
 if name=='SELF_REVIEW_AND_REMEDIATION':note+='\n\n'+assessment.get('review_status','R4 最终候选全回归/旧worker/交付源码复现/ZIP核验结果尚需按实际证据填写；此稿不宣称独立评审通过。')
 (out/rel).write_text('# '+name+'\n\nCandidate: `'+candidate+'`\n\n'+text+'\n\n'+note+'\n\n'+'\n'.join(rows)+'\n')
print(json.dumps({'draft_root':str(out),'candidate_id':candidate,'linked_runs':len(runs),'linked_artifacts':len(artifacts),'mapped_rules':len(assessment.get('rules',[])),'mapped_scenarios':len(assessment.get('scenarios',[])),'delivery_status':manifest['delivery_status'],'file_manifest':'Generated only by final package exporter'},ensure_ascii=False))
