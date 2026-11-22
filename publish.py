"""GitHub Actions runner. Stage verified release assets, then publish the immutable build."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import base64

REPO = 'jiangshanyao2200-hue/Aieyra-OS-Distribution'
ORIGIN = 'https://osupdate.aieyra.cn/api/v1/distribution/publisher'


def api(path, method='GET', payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request('https://api.github.com/repos/' + REPO + path, data=data, method=method,
                  headers={'Authorization':'Bearer ' + os.environ['GH_TOKEN'], 'User-Agent':'Aieyra-Distribution',
                           'Accept':'application/vnd.github+json', 'Content-Type':'application/json'})
    with urlopen(req, timeout=45) as reply:
        return json.loads(reply.read() or b'null')


def fetch(build, asset, directory):
    oidc = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&' + urlencode({'audience':'aieyra-os-distribution'})
    with urlopen(Request(oidc, headers={'Authorization':'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}), timeout=40) as response:
        token = json.load(response)['value']
    target = directory / asset['name']
    # The authenticated origin never redirects. curl retries partial origin transfers from the beginning.
    transfer = subprocess.run(['curl','--disable','--fail-with-body','--silent','--show-error','--proto','=https','--retry','4',
                    '--max-time','1500','--output',str(target),'--config','-'],
                   input=f'header = "Authorization: Bearer {token}"\nurl = "{ORIGIN}/{build}/{asset["name"]}"\n', text=True)
    if transfer.returncode:
        claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
        print('Publisher identity:', {k:claims.get(k) for k in ('iss','aud','repository_id','repository','ref','workflow_ref','sub')},flush=True)
        if target.exists() and target.stat().st_size < 8192:
            try:
                reason = json.loads(target.read_bytes()).get('error','')
                if reason in ('Publication credential required','Publication identity rejected','Publication signature rejected','Build selection changed'):
                    print('Origin:',reason,flush=True)
            except (UnicodeError,ValueError):
                print('Origin returned an intermediary response',flush=True)
        transfer.check_returncode()
    with target.open('rb') as data:
        digest = hashlib.file_digest(data, 'sha256').hexdigest()
    if digest != asset['sha256'] or target.stat().st_size != asset['size']:
        raise ValueError('Origin artifact differs from official signature')
    return target


def publish(record, stable, directory):
    envelope = record['envelope']
    payload = base64.b64decode(envelope['payload'], validate=True)
    signature = base64.b64decode(envelope['signature'], validate=True)
    pem = b'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAwHb56CxwoHhc3ap02mI32sWyq/ml2UWtjNZ0OsCYMa4=\n-----END PUBLIC KEY-----\n'
    (directory/'key.pem').write_bytes(pem)
    (directory/'payload').write_bytes(payload)
    (directory/'signature').write_bytes(signature)
    if envelope['algorithm'] != 'Ed25519':
        raise ValueError('Unsupported signature')
    subprocess.run(['openssl','pkeyutl','-verify','-pubin','-inkey',str(directory/'key.pem'),'-rawin',
                    '-in',str(directory/'payload'),'-sigfile',str(directory/'signature')],check=True)
    release = json.loads(payload)
    build = release['id']
    if not re.fullmatch(r'os-[0-9]+\.[0-9]+\.[0-9]+-r[1-9][0-9]*',build) or (build,release['sourceCommit'],release['sourceRevision']) != (record['id'],record['commit'],record['revision']):
        raise ValueError('Invalid release identity')
    assets = [a for a in release['artifacts'] if a['kind'] in ('installer','portable') and
              (a.get('platform'),a.get('arch'),a.get('component')) == ('win32','x64','os')]
    if sorted(a['kind'] for a in assets) != ['installer','portable']:
        raise ValueError('Missing Windows transport')
    try:
        item = api('/releases/tags/'+build)
    except HTTPError as e:
        if e.code != 404:
            raise
        item = next((r for r in api('/releases?per_page=100') if r['tag_name']==build),None)
    if not item:
        item = api('/releases','POST',{'tag_name':build,'name':build,'target_commitish':record['commit'],
                                       'draft':True,'prerelease':not stable,'make_latest':'false'})
    if item['target_commitish'] != record['commit']:
        raise ValueError('Existing release target mismatch')
    expected = {a['name']:a for a in assets}
    if any(not re.fullmatch(r'[a-zA-Z0-9.-]+',name) for name in expected):
        raise ValueError('Invalid artifact name')
    for a in assets:
        found = next((f for f in item['assets'] if f['name']==a['name']),None)
        if found and found['state']=='uploaded' and found['size']==a['size'] and found.get('digest')=='sha256:'+a['sha256']:
            continue
        if not item['draft']:
            raise ValueError('Published artifact mismatch')
        if found:
            api('/releases/assets/'+str(found['id']),'DELETE')
        target = fetch(build,a,directory)
        subprocess.run(['gh','release','upload',build,str(target),'--repo',REPO],check=True)
        target.unlink()
    result = api('/releases/'+str(item['id']))
    for a in assets:
        found = next(f for f in result['assets'] if f['name']==a['name'])
        if (found['state'],found['size'],found.get('digest')) != ('uploaded',a['size'],'sha256:'+a['sha256']):
            raise ValueError('GitHub artifact verification failed')
    if result['draft'] or (stable and result['prerelease']):
        api('/releases/'+str(item['id']),'PATCH',{'draft':False,'prerelease':not stable,'make_latest':'true' if stable else 'false'})
    ref = api('/git/ref/tags/'+build)
    if ref['object']['sha'] != record['commit']:
        raise ValueError('Release tag differs from official commit')
    print(build, 'stable' if stable else 'development', 'verified', flush=True)


if __name__ == '__main__':
    channels = json.loads(Path('channels.json').read_bytes())['channels']
    seen = set()
    with tempfile.TemporaryDirectory() as temp:
        for channel in ('stable','development'):
            record = channels.get(channel)
            if record and record['id'] not in seen:
                publish(record,channel=='stable',Path(temp))
                seen.add(record['id'])
