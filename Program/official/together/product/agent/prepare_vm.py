# @file-map:start
# 文件: link/agent/prepare_vm.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/local_vm.py, link/agent/source_protocol.py, link/agent/vm_guest.py, link/agent/workspace.py
# 上游: link/agent/local_vm.py, tests/test_vm_preparation.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: tests/test_vm_preparation.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   assets | function
#   wait_exec | function
#   refresh_runner | function
#   prepare | function
#   prepare.copy | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Prepare a local verification baseline from official Ubuntu/Go assets, inside QEMU."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
from urllib.parse import urlsplit, urlunsplit

try:
    from . import source_protocol as source
    from .local_vm import VMHost, digest_file, guest, guest_write, qmp, resource_budget
    from .workspace import atomic, document, exclusive, plain
except ImportError:
    import source_protocol as source
    from local_vm import VMHost, digest_file, guest, guest_write, qmp, resource_budget
    from workspace import atomic, document, exclusive, plain


# @chain-region assets | calls: Path, ValueError, atomic, cache.mkdir, digest_file, iter, json.loads, len …
def assets(root):
    cache = root/'assets';cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    origin = 'https://cloud-images.ubuntu.com/minimal/releases/noble/release/'
    name = 'ubuntu-24.04-minimal-cloudimg-amd64.img'
    with urllib.request.urlopen(origin+'SHA256SUMS',timeout=30) as stream:
        sums = stream.read(200000).decode()
    expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == name)
    with urllib.request.urlopen('https://go.dev/dl/?mode=json',timeout=30) as stream:
        versions = json.loads(stream.read(1500000))
    # The experiment source uses the Go 1.26 language/toolchain line.
    version = next(row for row in versions if row['version'].startswith('go1.26.'))
    archive = next(row for row in version['files'] if row['os']=='linux' and row['arch']=='amd64' and row['kind']=='archive')
    rows = [{'kind':'ubuntu-cloud','url':origin+name,'sha256':expected,'path':str(cache/('ubuntu-'+expected+'.qcow2'))},
            {'kind':'go-toolchain','url':'https://go.dev/dl/'+archive['filename'],'sha256':archive['sha256'],'path':str(cache/archive['filename'])}]
    for row in rows:
        target = Path(row['path'])
        if not target.is_file() or digest_file(target) != row['sha256']:
            temporary = target.with_suffix('.download')
            with urllib.request.urlopen(row['url'],timeout=45) as stream, temporary.open('wb') as out:
                count = 0
                for block in iter(lambda:stream.read(1024*1024),b''):
                    count += len(block)
                    if count > 1024*1024*1024: raise ValueError('vm_asset_capacity')
                    out.write(block)
            if digest_file(temporary) != row['sha256']: raise ValueError('vm_official_asset_digest_mismatch')
            temporary.replace(target)
        row.update(bytes=target.stat().st_size,verified=True)
    atomic(root/'assets.json',{'assets':rows,'go_version':version['version']})
    return rows


# @chain-region wait_exec | calls: ValueError, base64.b64decode, base64.b64decode(result.get('out-data', ''), validate=True).decode, guest, result.get, time.monotonic, time.sleep
def wait_exec(agent, path, args, timeout=60):
    executed = guest(agent,'guest-exec',{'path':path,'arg':args,'capture-output':True})
    deadline = time.monotonic()+timeout
    while time.monotonic()<deadline:
        result = guest(agent,'guest-exec-status',{'pid':executed['pid']})
        if result.get('exited'):
            if result.get('exitcode')!=0: raise ValueError('vm_baseline_guest_probe_failed')
            return base64.b64decode(result.get('out-data',''),validate=True).decode(errors='replace')
        time.sleep(0.25)
    raise ValueError('vm_baseline_probe_timeout')


# @chain-region refresh_runner | calls: (setup / 'qemu.log').open, Path, Path(__file__).with_name, Path(__file__).with_name('vm_guest.py').read_bytes, ValueError, atomic, digest_file, document …
def refresh_runner(host):
    """Upgrade only the trusted helper in a verified disk; no source or network."""
    prior = document(host.config_path)
    if prior.get('verified_boot') is not True or digest_file(Path(prior['image'])) != prior['image_sha256']:
        raise ValueError('vm_refresh_requires_verified_baseline')
    root = host.root
    with exclusive(root/'prepare.lock'), exclusive(root/'execution.lock'):
        actual_memory,resources=resource_budget(prior['memory_mb'])
        setup = root/('refresh-'+secrets.token_hex(6));setup.mkdir(mode=0o700)
        disk = setup/'environment.qcow2'
        subprocess.run(['qemu-img','create','-q','-f','qcow2','-F','qcow2','-b',prior['image'],str(disk)],check=True,timeout=30)
        sockets = root/'setup-sockets';sockets.mkdir(exist_ok=True,mode=0o700)
        monitor,agent = sockets/'monitor.sock',sockets/'guest.sock'
        for path in (monitor,agent):path.unlink(missing_ok=True)
        command = ['qemu-system-x86_64','-name','Aieyra-Link-Trusted-Helper-Refresh','-machine','q35,accel=kvm','-cpu','host','-smp','1','-m',str(actual_memory),
                   '-drive','file='+str(disk)+',format=qcow2,if=virtio','-net','none','-display','none','-monitor','none',
                   '-qmp','unix:'+str(monitor)+',server=on,wait=off','-chardev','socket,path='+str(agent)+',server=on,wait=off,id=qga0',
                   '-device','virtio-serial-pci','-device','virtserialport,chardev=qga0,name=org.qemu.guest_agent.0',
                   '-serial','file:'+str(setup/'console.log'),'-no-reboot']
        with (setup/'qemu.log').open('ab') as log:process = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        try:
            deadline = time.monotonic()+120
            while True:
                if process.poll() is not None:raise ValueError('vm_refresh_boot_failed')
                try:guest(agent,'guest-ping');break
                except (OSError,ValueError,TimeoutError):
                    if time.monotonic()>deadline:raise ValueError('vm_refresh_boot_timeout')
                    time.sleep(1)
            helper = Path(__file__).with_name('vm_guest.py').read_bytes()
            guest_write(agent,'/opt/aieyra-link/vm_guest.py',helper)
            expected = source.digest(helper)
            actual = wait_exec(agent,'/usr/bin/sha256sum',['/opt/aieyra-link/vm_guest.py']).split()[0]
            if actual != expected: raise ValueError('vm_refresh_runner_digest_mismatch')
            wait_exec(agent,'/usr/bin/sync',[]);qmp(monitor,'system_powerdown');process.wait(timeout=45)
            if process.returncode!=0:raise ValueError('vm_refresh_shutdown_failed')
            final = root/('baseline-'+setup.name+'.qcow2')
            subprocess.run(['qemu-img','convert','-O','qcow2',str(disk),str(final)],check=True,timeout=180);final.chmod(0o400)
            identity = {'image_sha256':digest_file(final),'guest_runner_sha256':expected,'tools':prior['tools']}
            config = {**prior,**identity,'image':str(final),'baseline_id':source.digest(source.canonical(identity).encode()),'prepared':time.time()}
            atomic(host.config_path,config);atomic(setup/'completed.json',{'passed':True,'baseline_id':config['baseline_id'],'network':'none','source_executed':False})
            return host.doctor()
        finally:
            if process.poll() is None:
                try:qmp(monitor,'quit')
                except (OSError,ValueError):process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            atomic(setup/'exit.json',{'code':process.returncode,'owned_vm':True})


# @chain-region prepare | calls: "import os,subprocess,tarfile,pathlib,hashlib,json\nconfig=CONFIGURATION\nos.environ['DEBIAN_FRONTEND']='noninteractive'\nsubprocess.run(['apt-get','update'],check=True)\nsubprocess.run(['apt-get','install','-y','--no-install-recommends','qemu-guest-agent','python3','ca-certificates'],check=True)\nassert hashlib.sha256(pathlib.Path('/tmp/go-toolchain.tar.gz').read_bytes()).hexdigest()==config['go_sha256']\nwith tarfile.open('/tmp/go-toolchain.tar.gz','r:gz') as t:t.extractall('/usr/local',filter='data')\nroot=pathlib.Path('/opt/aieyra-link');root.mkdir(mode=0o755,exist_ok=True)\nrunner=root/'vm_guest.py';runner.write_bytes(pathlib.Path('/tmp/vm_guest.py').read_bytes());runner.chmod(0o644)\nassert hashlib.sha256(runner.read_bytes()).hexdigest()==config['runner_sha256']\nfor path in ['/work/control','/work/sources','/work/results','/work/tmp','/work/cache/go-build','/opt/aieyra-link/go-mod','/opt/aieyra-link/gopath']:\n pathlib.Path(path).mkdir(parents=True,exist_ok=True)\nfor path in ['/work/cache','/opt/aieyra-link/go-mod','/opt/aieyra-link/gopath']:subprocess.run(['chown','-R','1000:1000',path],check=True)\nsource=pathlib.Path('/tmp/aieyra-public-source');source.mkdir()\nwith tarfile.open('/tmp/public-source.tar.gz','r:gz') as t:t.extractall(source,filter='data')\nsubprocess.run(['chown','-R','1000:1000',str(source)],check=True)\nenv={'PATH':'/usr/local/go/bin:/usr/bin:/bin','HOME':'/home/ubuntu','GOPATH':'/opt/aieyra-link/gopath','GOMODCACHE':'/opt/aieyra-link/go-mod','GOCACHE':'/work/cache/go-build','GOMAXPROCS':'1','GOFLAGS':'-p=1','GOTOOLCHAIN':'local','GOVCS':'*:off','GOPROXY':'https://proxy.golang.org','GOSUMDB':'sum.golang.org','CGO_ENABLED':'0'}\nenv.update(config['setup_proxies'])\nfor module in config['modules']:\n print('Preparing public module dependencies:',module,flush=True)\n subprocess.run(['/usr/bin/setpriv','--reuid=1000','--regid=1000','--clear-groups','/usr/local/go/bin/go','mod','download'],cwd=source/module,env=env,check=True,timeout=600)\nsubprocess.run(['systemctl','start','qemu-guest-agent'],check=True)\nsubprocess.run(['systemctl','is-active','qemu-guest-agent'],check=True)\n# Remove setup-only credentials and privilege escalation before accepting candidate code.\nfor p in pathlib.Path('/etc/sudoers.d').glob('*'):\n if p.is_file() and 'ubuntu' in p.read_text(errors='ignore'):p.unlink()\nfor p in [pathlib.Path('/home/ubuntu/.ssh/authorized_keys'),pathlib.Path('/tmp/go-toolchain.tar.gz'),pathlib.Path('/tmp/public-source.tar.gz')]:p.unlink(missing_ok=True)\nsubprocess.run(['rm','-rf',str(source)],check=True)\nprint('Local guest baseline prepared; no candidate job has run.',flush=True)\n".replace, (setup / 'meta-data').write_text, (setup / 'provision.log').open, (setup / 'qemu.log').open, (setup / 'ssh-probe.log').open, (setup / 'user-data').write_text, Path, Path(__file__).with_name …
def prepare(payload, config=None, supplied_assets=None):
    if os.name == 'nt': raise ValueError('prepare_vm_runs_in_local_wsl_host')
    host = VMHost(config)
    for binary in ('qemu-system-x86_64','qemu-img','genisoimage','ssh','scp','ssh-keygen'):
        if not shutil.which(binary): raise ValueError('local_vm_dependency_missing:'+binary)
    if not os.access('/dev/kvm',os.R_OK|os.W_OK): raise ValueError('local_kvm_access_required')
    files = source.validate_manifest(payload['files'])
    dependencies={name:digest for name,digest in files.items() if Path(name).name in ('go.mod','go.sum','go.work','go.work.sum')}
    dependency_sha=source.digest(source.canonical(dependencies).encode())
    if host.config_path.exists():
        prior=host.doctor();configuration=document(host.config_path)
        same=configuration.get('dependency_sha256')==dependency_sha
        if prior.get('ready') and same:return prior | {'reused':True,'dependencies_verified':True}
        if same and prior.get('error')=='vm_guest_runner_upgrade_requires_baseline_refresh':return refresh_runner(host)
    tree = Path(payload['path']).resolve();plain(tree,True)
    if 'Core/go.mod' not in files: raise ValueError('public_os_core_source_required')
    root = host.root
    with exclusive(root/'prepare.lock'), exclusive(root/'execution.lock'):
        actual_memory,resources=resource_budget(1536)
        official = supplied_assets or assets(root)
        for item in official:
            if not item.get('verified') or digest_file(Path(item['path'])) != item['sha256']:
                raise ValueError('vm_asset_digest_mismatch')
        ubuntu = next(item for item in official if item['kind']=='ubuntu-cloud')
        toolchain = next(item for item in official if item['kind']=='go-toolchain')
        setup = root/('prepare-'+secrets.token_hex(6));setup.mkdir(mode=0o700)
        key = setup/'key'
        subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-C','Aieyra-local-VM-setup','-f',str(key)],check=True,timeout=30)
        public = key.with_suffix('.pub').read_text().strip()
        (setup/'meta-data').write_text('instance-id: aieyra-link-'+setup.name+'\nlocal-hostname: aieyra-link-vm\n')
        (setup/'user-data').write_text('#cloud-config\nssh_pwauth: false\nssh_authorized_keys:\n  - '+public+'\n')
        seed = setup/'seed.iso'
        subprocess.run(['genisoimage','-quiet','-output',str(seed),'-volid','cidata','-joliet','-rock',str(setup/'user-data'),str(setup/'meta-data')],check=True,timeout=30)
        disk = setup/'environment.qcow2'
        subprocess.run(['qemu-img','create','-q','-f','qcow2','-F','qcow2','-b',ubuntu['path'],str(disk)],check=True,timeout=30)
        subprocess.run(['qemu-img','resize','-q',str(disk),'12G'],check=True,timeout=30)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port = listener.getsockname()[1]
        sockets = root/'setup-sockets';sockets.mkdir(exist_ok=True,mode=0o700)
        monitor, agent = sockets/'monitor.sock',sockets/'guest.sock'
        for p in (monitor,agent):p.unlink(missing_ok=True)
        command = ['qemu-system-x86_64','-name','Aieyra-Link-Environment-Preparation','-machine','q35,accel=kvm','-cpu','host','-smp','1','-m',str(actual_memory),
                   '-drive','file='+str(disk)+',format=qcow2,if=virtio','-drive','file='+str(seed)+',format=raw,if=virtio,readonly=on',
                   '-netdev','user,id=provision,hostfwd=tcp:127.0.0.1:'+str(port)+'-:22','-device','virtio-net-pci,netdev=provision',
                   '-display','none','-monitor','none','-qmp','unix:'+str(monitor)+',server=on,wait=off',
                   '-chardev','socket,path='+str(agent)+',server=on,wait=off,id=qga0','-device','virtio-serial-pci',
                   '-device','virtserialport,chardev=qga0,name=org.qemu.guest_agent.0','-serial','file:'+str(setup/'console.log'),'-no-reboot']
        ssh_options = ['-i',str(key),'-o','BatchMode=yes','-o','ConnectTimeout=5',
                       '-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+str(setup/'known_hosts')]
        ssh = ['ssh',*ssh_options,'-p',str(port),'ubuntu@127.0.0.1']
        scp = ['scp','-q',*ssh_options,'-P',str(port)]
        with (setup/'qemu.log').open('ab') as log:
            process = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        try:
            deadline = time.monotonic()+180
            while True:
                if process.poll() is not None: raise ValueError('vm_environment_boot_failed')
                with (setup/'ssh-probe.log').open('ab') as diagnostics:
                    probe = subprocess.run([*ssh,'true'],stdout=diagnostics,stderr=diagnostics,timeout=8)
                if probe.returncode==0:break
                if time.monotonic()>deadline: raise ValueError('vm_environment_ssh_timeout')
                time.sleep(2)
            # @chain-region prepare.copy | calls: str, subprocess.run
            def copy(path, remote):
                subprocess.run([*scp,str(path),'ubuntu@127.0.0.1:'+remote],check=True,timeout=180)
            copy(Path(toolchain['path']),'/tmp/go-toolchain.tar.gz')
            copy(Path(__file__).with_name('vm_guest.py'),'/tmp/vm_guest.py')
            archive = setup/'public-source.tar.gz'
            with tarfile.open(archive,'w:gz',format=tarfile.PAX_FORMAT) as out:
                for name,digest in sorted(files.items()):
                    p=tree/name;plain(p)
                    raw=p.read_bytes()
                    if source.digest(raw)!=digest:raise ValueError('preparation_source_changed')
                    row=tarfile.TarInfo(name);row.size=len(raw);row.mode=0o644
                    out.addfile(row,io.BytesIO(raw))
            copy(archive,'/tmp/public-source.tar.gz')
            modules = sorted({str(Path(name).parent) for name in files if name.endswith('/go.mod')})
            setup_proxies = {}
            for name in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'):
                value = os.environ.get(name)
                if not value: continue
                parsed = urlsplit(value)
                if parsed.username or parsed.password: raise ValueError('vm_setup_proxy_credentials_not_forwarded')
                if parsed.hostname in ('127.0.0.1','localhost'):
                    value = urlunsplit((parsed.scheme,'10.0.2.2'+(':'+str(parsed.port) if parsed.port else ''),parsed.path,'',''))
                setup_proxies[name] = value
            configuration = {'go_sha256':toolchain['sha256'],'runner_sha256':digest_file(Path(__file__).with_name('vm_guest.py')),'modules':modules,'setup_proxies':setup_proxies}
            bootstrap = """import os,subprocess,tarfile,pathlib,hashlib,json
config=CONFIGURATION
os.environ['DEBIAN_FRONTEND']='noninteractive'
subprocess.run(['apt-get','update'],check=True)
subprocess.run(['apt-get','install','-y','--no-install-recommends','qemu-guest-agent','python3','ca-certificates'],check=True)
assert hashlib.sha256(pathlib.Path('/tmp/go-toolchain.tar.gz').read_bytes()).hexdigest()==config['go_sha256']
with tarfile.open('/tmp/go-toolchain.tar.gz','r:gz') as t:t.extractall('/usr/local',filter='data')
root=pathlib.Path('/opt/aieyra-link');root.mkdir(mode=0o755,exist_ok=True)
runner=root/'vm_guest.py';runner.write_bytes(pathlib.Path('/tmp/vm_guest.py').read_bytes());runner.chmod(0o644)
assert hashlib.sha256(runner.read_bytes()).hexdigest()==config['runner_sha256']
for path in ['/work/control','/work/sources','/work/results','/work/tmp','/work/cache/go-build','/opt/aieyra-link/go-mod','/opt/aieyra-link/gopath']:
 pathlib.Path(path).mkdir(parents=True,exist_ok=True)
for path in ['/work/cache','/opt/aieyra-link/go-mod','/opt/aieyra-link/gopath']:subprocess.run(['chown','-R','1000:1000',path],check=True)
source=pathlib.Path('/tmp/aieyra-public-source');source.mkdir()
with tarfile.open('/tmp/public-source.tar.gz','r:gz') as t:t.extractall(source,filter='data')
subprocess.run(['chown','-R','1000:1000',str(source)],check=True)
env={'PATH':'/usr/local/go/bin:/usr/bin:/bin','HOME':'/home/ubuntu','GOPATH':'/opt/aieyra-link/gopath','GOMODCACHE':'/opt/aieyra-link/go-mod','GOCACHE':'/work/cache/go-build','GOMAXPROCS':'1','GOFLAGS':'-p=1','GOTOOLCHAIN':'local','GOVCS':'*:off','GOPROXY':'https://proxy.golang.org','GOSUMDB':'sum.golang.org','CGO_ENABLED':'0'}
env.update(config['setup_proxies'])
for module in config['modules']:
 print('Preparing public module dependencies:',module,flush=True)
 subprocess.run(['/usr/bin/setpriv','--reuid=1000','--regid=1000','--clear-groups','/usr/local/go/bin/go','mod','download'],cwd=source/module,env=env,check=True,timeout=600)
subprocess.run(['systemctl','start','qemu-guest-agent'],check=True)
subprocess.run(['systemctl','is-active','qemu-guest-agent'],check=True)
# Remove setup-only credentials and privilege escalation before accepting candidate code.
for p in pathlib.Path('/etc/sudoers.d').glob('*'):
 if p.is_file() and 'ubuntu' in p.read_text(errors='ignore'):p.unlink()
for p in [pathlib.Path('/home/ubuntu/.ssh/authorized_keys'),pathlib.Path('/tmp/go-toolchain.tar.gz'),pathlib.Path('/tmp/public-source.tar.gz')]:p.unlink(missing_ok=True)
subprocess.run(['rm','-rf',str(source)],check=True)
print('Local guest baseline prepared; no candidate job has run.',flush=True)
""".replace('CONFIGURATION',repr(configuration),1)
            with (setup/'provision.log').open('wb') as log:
                subprocess.run([*ssh,'sudo','-n','python3','-u','-'],input=bootstrap.encode(),stdout=log,stderr=subprocess.STDOUT,check=True,timeout=1200)
            guest(agent,'guest-ping')
            helper = wait_exec(agent,'/usr/bin/sha256sum',['/opt/aieyra-link/vm_guest.py']).split()[0]
            if helper!=configuration['runner_sha256']:raise ValueError('vm_runner_baseline_hash_mismatch')
            go_version = wait_exec(agent,'/usr/local/go/bin/go',['version']).strip()
            identity = wait_exec(agent,'/usr/bin/id',['-u','ubuntu']).strip()
            if identity!='1000':raise ValueError('vm_unprivileged_user_required')
            wait_exec(agent,'/usr/bin/sync',[])
            qmp(monitor,'system_powerdown')
            process.wait(timeout=45)
            if process.returncode!=0:raise ValueError('vm_baseline_shutdown_failed')
            final = root/('baseline-'+setup.name+'.qcow2')
            subprocess.run(['qemu-img','convert','-O','qcow2',str(disk),str(final)],check=True,timeout=180)
            final.chmod(0o400)
            image_sha = digest_file(final)
            tools = {'go':go_version,'source_snapshot':payload['snapshot'],'os':'Ubuntu 24.04 minimal','network_during_verification':'none'}
            identity = {'image_sha256':image_sha,'guest_runner_sha256':helper,'tools':tools}
            config = {'schema':1,'provider':'qemu-kvm','image':str(final),**identity,
                      'baseline_id':source.digest(source.canonical(identity).encode()),'verified_boot':True,
                      'memory_mb':1536,'cpus':1,'asset_provenance':official,'prepared':time.time(),'dependency_sha256':dependency_sha}
            atomic(host.config_path,config)
            atomic(setup/'completed.json',{'passed':True,'config':str(host.config_path),'baseline_id':config['baseline_id'],
                                         'setup_code':process.returncode,'guest_runner_hash_verified':True,'guest_uid':1000})
            return host.doctor()
        finally:
            if process.poll() is None:
                try:qmp(monitor,'quit')
                except (OSError,ValueError):process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            atomic(setup/'exit.json',{'code':process.returncode,'owned_vm':True})


# @chain-region main | calls: argparse.ArgumentParser, args.assets.read_text, args.source.read_text, json.loads, p.add_argument, p.parse_args, prepare, print …
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--config',type=Path);p.add_argument('--assets',type=Path)
    args=p.parse_args()
    payload=json.loads(args.source.read_text(encoding='utf-8'))
    supplied=json.loads(args.assets.read_text(encoding='utf-8')) if args.assets else None
    print(source.canonical(prepare(payload,args.config,supplied)))


if __name__ == '__main__':main()
