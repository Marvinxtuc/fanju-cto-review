#!/usr/bin/env python3
"""Export a concrete incomplete review package; never invent successful executions.
Finalize assessed reports/ledgers in worktree first. Export copies their actual bytes.
"""
import argparse,hashlib,json,subprocess,shutil,zipfile,difflib
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,obj):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def canonical(entries):return hashlib.sha256(json.dumps(entries,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def source_inventory(root):
    response=subprocess.run(['node','scripts/prelaunch-candidate-hash.mjs'],cwd=root,capture_output=True,text=True,check=True)
    return json.loads(response.stdout)
def relative_file(root,rel):
    p=root/rel
    if p.is_symlink() or root.resolve() not in p.resolve().parents:raise ValueError('Unsafe source path')
    if not p.is_file():raise ValueError('Missing source file')
    return p

def export(args):
    root=args.root.resolve(strict=True);pack=args.pack.resolve(strict=True)
    state=json.loads((root/'docs/prelaunch/EXECUTION_STATE.json').read_text())
    if state['root']!=str(root) or state['pack_id']!='FJ-PRELAUNCH-MASTER-V1.1-20261001-01':raise ValueError('Project/task identity mismatch')
    head=subprocess.run(['git','rev-parse','HEAD'],cwd=root,capture_output=True,text=True,check=True).stdout.strip()
    if head!=state['base_head']:raise ValueError('Unexpected current HEAD; preserve and investigate')
    target=args.output.resolve()/ 'FANJU_PRELAUNCH_REVIEW'
    if target.exists():raise ValueError('Refuse overwriting previous delivery')
    target.mkdir(parents=True)
    snap=source_inventory(root)
    for entry in snap['files']:
        source=relative_file(root,entry['path'])
        if sha(source)!=entry['sha256']:raise ValueError('Source drift while exporting')
        dest=target/'source'/entry['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
    # Reports and native evidence never include scratch runtime or credentials.
    docs=root/'docs/prelaunch'
    for path in sorted(docs.rglob('*')):
        if path.is_symlink():raise ValueError('Symlink in evidence')
        if path.is_file():
            dest=target/'docs/prelaunch'/path.relative_to(docs);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
    changes=target/'changes';changes.mkdir()
    save(changes/'BASE_IDENTITY.json',{'root':str(root),'branch':state['branch'],'base_head':head,'baseline_dirty_snapshot_hash':state['baseline_dirty_snapshot_hash']})
    # Full patch includes tracked diff plus all untracked source as additions.
    tracked=subprocess.run(['git','diff','--binary',head,'--'],cwd=root,capture_output=True,check=True).stdout
    additions=[]
    untracked=set(subprocess.run(['git','ls-files','--others','--exclude-standard','-z'],cwd=root,capture_output=True,check=True).stdout.decode().split('\0'))
    for entry in snap['files']:
        rel=entry['path']
        if rel in untracked:
            result=subprocess.run(['git','diff','--no-index','--binary','--','/dev/null',rel],cwd=root,capture_output=True)
            if result.returncode not in (0,1):raise ValueError('Cannot export untracked source')
            additions.append(result.stdout)
    (changes/'COMPLETE.patch').write_bytes(tracked+b''.join(additions))
    # Incremental patch uses actual preserved baseline bytes, never reconstructed HEAD guesses.
    baseline=args.baseline.resolve(strict=True)
    owner=json.loads((baseline.parent/'OWNER.json').read_text())
    if owner.get('task_id')!=state['pack_id'] or owner.get('root')!=str(root):raise ValueError('Baseline scratch owner mismatch')
    old=json.loads((docs/'baseline/BASELINE_SNAPSHOT.json').read_text())['hashes']
    patch=[];file_changes=[]
    current={e['path']:e['sha256'] for e in snap['files']}
    for rel in sorted(set(old)|set(current)):
        # docs/prelaunch is separately packaged, not candidate source.
        if rel.startswith('docs/prelaunch/'):continue
        original=baseline/rel
        if rel in old:
            if not original.is_file() or sha(original)!=old[rel]:raise ValueError('Baseline byte mismatch')
            before=original.read_bytes()
        else:before=b''
        after=relative_file(root,rel).read_bytes() if rel in current else b''
        if before==after:continue
        file_changes.append({'path':rel,'change':'ADDED' if rel not in old else 'DELETED' if rel not in current else 'MODIFIED'})
        try:
            patch.extend(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile='a/'+rel if rel in old else '/dev/null',tofile='b/'+rel if rel in current else '/dev/null'))
        except UnicodeDecodeError:raise ValueError('Binary incremental source requires explicit git binary export: '+rel)
    (changes/'INCREMENTAL.patch').write_text(''.join(patch) or '# No task source changes\n')
    save(changes/'FILE_CHANGES.json',file_changes)
    artifact_manifest=json.loads((docs/'BUILD_ARTIFACT_MANIFEST.json').read_text())
    if artifact_manifest.get('candidate_id')!=snap['candidate_id']:raise ValueError('Native build artifacts are from another candidate')
    build_root=Path(artifact_manifest['build_root']).resolve(strict=True)
    # Check explicit owned scratch provenance; never export worktree stale dist by fallback.
    build_owner=json.loads((build_root.parent/'OWNER.json').read_text())
    if build_owner.get('task_id')!=state['pack_id'] or build_owner.get('root')!=str(root):raise ValueError('Build scratch identity mismatch')
    for entry in artifact_manifest['files']:
        rel=entry['path'];src=Path(entry['build_path'])
        if not rel.startswith('artifacts/') or '..' in Path(rel).parts or src.is_symlink() or build_root not in src.resolve().parents:raise ValueError('Unsafe artifact path')
        if sha(src)!=entry['sha256'] or src.stat().st_size!=entry['bytes']:raise ValueError('Native artifact drift')
        dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
    manifest_path=target/'docs/prelaunch/RELEASE_CANDIDATE_MANIFEST.json'
    if not manifest_path.exists():raise ValueError('Create honest candidate manifest/reports before export')
    manifest=json.loads(manifest_path.read_text())
    if manifest.get('candidate_id')!=snap['candidate_id']:raise ValueError('Assessed manifest does not match exported source')
    if source_inventory(root)['candidate_id']!=snap['candidate_id']:raise ValueError('Source drift during package export')
    files=[{'path':p.relative_to(target).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(target.rglob('*')) if p.is_file() and p.relative_to(target).as_posix() not in {'docs/prelaunch/FILE_MANIFEST.json','REVIEW_SHA256SUMS'}]
    save(target/'docs/prelaunch/FILE_MANIFEST.json',{'candidate_id':snap['candidate_id'],'files':files,'excluded':['docs/prelaunch/FILE_MANIFEST.json','REVIEW_SHA256SUMS']})
    listed=sorted(p for p in target.rglob('*') if p.is_file() and p.name!='REVIEW_SHA256SUMS')
    (target/'REVIEW_SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(target).as_posix()}\n' for p in listed))
    check=subprocess.run(['python3',str(pack/'tools/check_handoff.py'),'--root',str(target),'--pack',str(pack)],capture_output=True,text=True)
    print(check.stdout,end='')
    if check.returncode:raise ValueError('Structure check failed; preserve unpacked export for repair')
    zip_path=args.output.resolve()/'FANJU_PRELAUNCH_REVIEW.zip'
    if zip_path.exists():raise ValueError('Refuse overwriting ZIP')
    with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(target.rglob('*')):
            if p.is_file():archive.write(p,p.relative_to(target.parent))
    # Independent ZIP CRC and byte checks; never execute untrusted extracted code here.
    with zipfile.ZipFile(zip_path) as archive:
        if archive.testzip():raise ValueError('ZIP CRC failure')
        for p in listed:
            rel=p.relative_to(target.parent).as_posix()
            if hashlib.sha256(archive.read(rel)).hexdigest()!=sha(p):raise ValueError('ZIP bytes differ')
    print(json.dumps({'zip':str(zip_path),'sha256':sha(zip_path),'bytes':zip_path.stat().st_size,'candidate_id':snap['candidate_id']},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--pack',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--baseline',required=True,type=Path)
    export(p.parse_args())
