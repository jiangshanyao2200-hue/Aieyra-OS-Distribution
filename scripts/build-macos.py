# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: release_identity; copy_desktop_network_runtime; main
# Impact: python -B scripts/code-atlas.py show scripts/build-macos.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build a native .app, ZIP and DMG on a macOS runner. No release credentials needed."""
from pathlib import Path
import datetime, hashlib, importlib.util, json, os, plistlib, re, shutil, subprocess, sys

ROOT=Path(__file__).resolve().parents[1]


def release_identity(root=ROOT,environment=None):
    """Bind every platform package to the release metadata in this source commit."""
    environment=os.environ if environment is None else environment
    source=(root/'Core/host/app.go').read_text(encoding='utf-8')
    match=re.search(r'var Version = "([^"\n]+)"',source)
    if not match or not re.fullmatch(r'\d+\.\d+\.\d+',match.group(1)):
        raise ValueError('Cannot read the source release version')
    version=match.group(1)
    metadata=root/'scripts/release-metadata.json'
    if not metadata.is_file():
        raise ValueError('Missing scripts/release-metadata.json; prepare the release version and sequence before packaging')
    identity=json.loads(metadata.read_text(encoding='utf-8'))
    if (not isinstance(identity,dict) or type(identity.get('schema')) is not int or identity.get('schema')!=1 or identity.get('product')!='aieyra-os'
            or identity.get('version')!=version or type(identity.get('sequence')) is not int or identity['sequence']<1):
        raise ValueError('Release metadata does not match the source version or has an invalid sequence')
    for name,expected in [('RELEASE_VERSION',version),('RELEASE_SEQUENCE',str(identity['sequence']))]:
        value=environment.get(name,'')
        if value and value!=expected:
            raise ValueError(name+' disagrees with the committed release metadata')
    if environment.get('GITHUB_REF_TYPE')=='tag' and environment.get('GITHUB_REF_NAME')!='v'+version:
        raise ValueError('GitHub tag does not match the committed release version')
    return {'schema':1,'product':'aieyra-os','version':version,'sequence':identity['sequence']}


def copy_desktop_network_runtime(source, product):
    # Required JS dependency closures from the locked SSH and SOCKS clients.
    for name in ('ssh2', 'asn1', 'bcrypt-pbkdf', 'safer-buffer', 'tweetnacl',
                 'socks', 'ip-address', 'smart-buffer'):
        relative = Path('Client/Desktop/node_modules') / name
        shutil.copytree(source / relative, product / relative, symlinks=True)


def main():
    if '--validate-metadata' in sys.argv[1:]:
        print(json.dumps(release_identity(ROOT,os.environ),sort_keys=True));return
    privacy_spec=importlib.util.spec_from_file_location('privacy',ROOT/'scripts/public-privacy.py')
    privacy=importlib.util.module_from_spec(privacy_spec);privacy_spec.loader.exec_module(privacy)
    privacy_result=privacy.check_source(ROOT)
    if not privacy_result['ok']:raise RuntimeError(json.dumps(privacy_result))
    identity=release_identity(ROOT,os.environ)
    VERSION=identity['version'];SEQUENCE=identity['sequence']
    ARCH=subprocess.check_output(['uname','-m'],text=True).strip()
    ARCH={'aarch64':'arm64','x86_64':'x64'}.get(ARCH,ARCH)
    assert sys.platform=='darwin' and ARCH in ('arm64','x64')
    OUT=ROOT/'dist';OUT.mkdir(exist_ok=True)
    APP=OUT/'Aieyra OS.app';assert not APP.exists(),'Use a clean build directory'
    CONTENT=APP/'Contents';PRODUCT=CONTENT/'Resources/product'
    PRODUCT.mkdir(parents=True);(CONTENT/'MacOS').mkdir()

    def run(*args,cwd=ROOT,env=None):subprocess.run(args,cwd=cwd,env=env,check=True)
    runtime_spec=importlib.util.spec_from_file_location('runtime_files',ROOT/'scripts/runtime-files.py')
    runtime=importlib.util.module_from_spec(runtime_spec);runtime_spec.loader.exec_module(runtime)
    # Copy precisely the reviewed bytes, including the public README mapping.
    # A directory copy would bypass exclusions for private runtime files.
    source={name:p.read_bytes() for name,p in runtime.runtime_files(privacy.source_files(ROOT)).items()}
    failures=[{'path':name,'rule':rule} for name,data in source.items() for rule in privacy.validate(name,data)]
    if failures:raise RuntimeError(json.dumps(failures))
    source, _ = privacy.development.prepare(source)
    for name,data in source.items():
     target=PRODUCT/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    assert all((PRODUCT/name).read_bytes()==data for name,data in source.items())
    run('npm','ci','--no-audit','--no-fund',cwd=ROOT/'Client/Desktop')
    run('node','tools/ensure-electron.cjs',cwd=ROOT/'Client/Desktop')
    # Electron's distributable contains its own licenses and native framework links.
    # Download/install tooling remains in the build checkout.
    shutil.copytree(ROOT/'Client/Desktop/node_modules/electron',PRODUCT/'Client/Desktop/node_modules/electron',symlinks=True)
    copy_desktop_network_runtime(ROOT, PRODUCT)
    env={**os.environ,'CGO_ENABLED':'0','GOOS':'darwin','GOARCH':'amd64' if ARCH=='x64' else ARCH}
    run('go','build','-trimpath','-ldflags',f'-s -w -X github.com/aieyra/aieyra-os/CORE/host.Version={VERSION}','-o',str(PRODUCT/'Aieyra OS'),'./cmd/aieyra-os',cwd=ROOT/'Core',env=env)
    run('go','build','-trimpath','-ldflags','-s -w','-o',str(CONTENT/'MacOS/AieyraOS'),'./cmd/aieyra-mac',cwd=ROOT/'Core',env=env)
    (PRODUCT/'Config/release.json').write_text(json.dumps({'version':VERSION,'sequence':SEQUENCE,'platform':'darwin','arch':ARCH})+'\n')
    iconset=OUT/'Aieyra.iconset';iconset.mkdir()
    for size in [16,32,128,256,512]:
     for scale in [1,2]:
      run('sips','-z',str(size*scale),str(size*scale),str(ROOT/'Client/Desktop/assets/os.png'),'--out',str(iconset/f'icon_{size}x{size}{"@2x" if scale==2 else ""}.png'))
    run('iconutil','-c','icns',str(iconset),'-o',str(CONTENT/'Resources/Aieyra.icns'))
    with (PRODUCT/'Client/Desktop/node_modules/electron/dist/Electron.app/Contents/Info.plist').open('rb') as f:
     minimum_os=plistlib.load(f)['LSMinimumSystemVersion']
    with (CONTENT/'Info.plist').open('wb') as f:
     plistlib.dump({'CFBundleName':'Aieyra OS','CFBundleDisplayName':'Aieyra OS','CFBundleIdentifier':'cn.aieyra.os','CFBundleExecutable':'AieyraOS','CFBundleIconFile':'Aieyra.icns','CFBundlePackageType':'APPL','CFBundleShortVersionString':VERSION,'CFBundleVersion':VERSION,'LSMinimumSystemVersion':minimum_os,'NSHighResolutionCapable':True,'NSPrincipalClass':'NSApplication','NSHumanReadableCopyright':'Copyright © Aieyra contributors. MIT.'},f)
    # Inner Electron is signed by its publisher. The outer launcher is ad-hoc signed;
    # this does not claim Apple Developer ID notarization.
    for binary in [PRODUCT/'Aieyra OS',CONTENT/'MacOS/AieyraOS']:
     run('codesign','--force','--sign','-',str(binary))
    run('codesign','--force','--sign','-',str(APP))
    run('codesign','--verify','--deep','--strict',str(APP))
    run('node',str(ROOT/'scripts/smoke-macos.cjs'),str(APP))
    name=f'AieyraOS-{VERSION}-macos-{ARCH}'
    run('ditto','-c','-k','--sequesterRsrc','--keepParent',str(APP),str(OUT/(name+'.zip')))
    volume=OUT/'dmg-content';volume.mkdir();shutil.copytree(APP,volume/APP.name,symlinks=True);(volume/'Applications').symlink_to('/Applications')
    run('hdiutil','create','-volname','Aieyra OS','-srcfolder',str(volume),'-ov','-format','UDZO',str(OUT/(name+'.dmg')))
    run('hdiutil','verify',str(OUT/(name+'.dmg')))
    files=[OUT/(name+'.zip'),OUT/(name+'.dmg')]
    receipt={'version':VERSION,'sequence':SEQUENCE,'platform':'darwin','arch':ARCH,'minimumOS':minimum_os,'notarized':False,'signed':'ad-hoc','sourceCommit':os.environ.get('GITHUB_SHA',''),'artifacts':[{'name':p.name,'size':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p in files]}
    (OUT/f'macos-{ARCH}-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))

if __name__=='__main__':
    main()
