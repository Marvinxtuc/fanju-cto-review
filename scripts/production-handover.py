#!/usr/bin/env python3
"""Export the actual source, artifacts and redacted evidence without declaring release."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(root, *args):
    return subprocess.run(args, cwd=root, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    state_path = 'docs/prelaunch/run-to-production-20261002/EXECUTION_STATE.json'
    state = json.loads((root / state_path).read_text())
    if state['taskId'] != 'FJ-RUN-TO-PRODUCTION-20261002-01':
        raise ValueError('Wrong execution task')
    snapshot = json.loads(command(root, 'node', 'scripts/prelaunch-candidate-hash.mjs'))
    candidate = snapshot['candidate_id']
    if state.get('currentCandidate') != candidate:
        raise ValueError('Persist current candidate before export')
    manifest = json.loads((root / 'docs/prelaunch/FORMAL_CLIENT_BUILD_MANIFEST.json').read_text())
    if manifest['candidate_id'] != candidate:
        raise ValueError('Formal artifacts do not match current source')
    prefix = f'FANJU_PRODUCTION_HANDOVER_{candidate[:12]}_20261002'
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / (prefix + '.zip')
    if output.exists():
        raise ValueError('Refuse overwriting an earlier handover')
    files = {}
    for entry in snapshot['files']:
        path = root / entry['path']
        data = path.read_bytes()
        if path.is_symlink() or digest(data) != entry['sha256']:
            raise ValueError('Source drift or symlink')
        files['source/' + entry['path']] = data
    # Only repository evidence is included, never runtime/env files or secret stores.
    for path in sorted((root / 'docs/prelaunch').rglob('*')):
        if path.is_symlink():
            raise ValueError('Evidence symlink rejected')
        if path.is_file():
            if path.name.startswith('.env') or path.name in {'PRELAUNCH_RUNTIME.json', 'OWNER.json'}:
                raise ValueError('Runtime/credential file cannot enter handover')
            files[path.relative_to(root).as_posix()] = path.read_bytes()
    build_root = Path(manifest['build_root']).resolve(strict=True)
    for entry in manifest['files']:
        path = Path(entry['build_path'])
        destination = entry['path']
        if path.is_symlink() or build_root not in path.resolve().parents or not destination.startswith('artifacts/') or '..' in Path(destination).parts:
            raise ValueError('Unsafe artifact')
        data = path.read_bytes()
        if digest(data) != entry['sha256'] or len(data) != entry['bytes']:
            raise ValueError('Artifact drift')
        files[destination] = data
    files['changes/TRACKED.patch'] = command(root, 'git', 'diff', '--binary', 'adb548472ddbd371f2c5abcfc36fe1ddfa853ae2', '--')
    untracked = set(command(root, 'git', 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    additions = []
    for entry in snapshot['files']:
        if entry['path'] in untracked:
            result = subprocess.run(['git', 'diff', '--no-index', '--binary', '--', '/dev/null', entry['path']], cwd=root, capture_output=True)
            if result.returncode not in (0, 1):
                raise ValueError('Cannot export added source')
            additions.append(result.stdout)
    files['changes/ADDED_SOURCE.patch'] = b''.join(additions)
    identity = {'taskId': state['taskId'], 'candidate': candidate,
                'head': command(root, 'git', 'rev-parse', 'HEAD').decode().strip(),
                'branch': command(root, 'git', 'branch', '--show-current').decode().strip(),
                'executionStatus': state['execution_status'], 'productionState': state,
                'sourceSnapshot': snapshot, 'buildManifest': manifest,
                'note': 'Actual progress handover. Uncompleted deployment, platform, funds, release and observation remain uncompleted.'}
    files['HANDOVER.json'] = (json.dumps(identity, ensure_ascii=False, indent=2) + '\n').encode()
    files['SHA256SUMS'] = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())).encode()
    if json.loads(command(root, 'node', 'scripts/prelaunch-candidate-hash.mjs'))['candidate_id'] != candidate:
        raise ValueError('Source changed during export')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(prefix + '/' + name, data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip():
            raise ValueError('ZIP CRC mismatch')
        for name, data in files.items():
            if digest(archive.read(prefix + '/' + name)) != digest(data):
                raise ValueError('ZIP content mismatch')
    sha = digest(output.read_bytes())
    output.with_suffix('.zip.sha256').write_text(f'{sha}  {output.name}\n')
    print(json.dumps({'zip': str(output), 'sha256': sha, 'candidate': candidate,
                      'status': state['execution_status'], 'bytes': output.stat().st_size}))


if __name__ == '__main__':
    main()
