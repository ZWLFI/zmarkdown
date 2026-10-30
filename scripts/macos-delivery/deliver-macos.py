#!/usr/bin/env python3
"""Reproducible, resumable macOS delivery. No automatic commits or version bumps."""
import argparse, hashlib, json, os, pathlib, platform, plistlib, shlex, shutil
import subprocess, sys, threading, time, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
STAGES = ['build', 'test', 'package', 'verify', 'install', 'publish']
UNIT = ['source-mode-dirty', 'source-mode-commit-debounce', 'save-receipt-version',
        'flush-before-save', 'write-file-atomic', 'close-window-save-failure',
        'browserPanel-doc-read', 'buffer-store-durable', 'auto-save-timer']
E2E = ['interaction-reliability', 'embedded-panel', 'nested-file-tree',
       'parity-source-undo-saved', 'unified-sidebars', 'workspace-focus',
       'selection-delete', 'auto-save-cancel']
class Stop(RuntimeError): pass

def sha(p):
    h = hashlib.sha256()
    with pathlib.Path(p).open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def require(ok, message):
    if not ok: raise Stop(message)

def asset_conflicts(remote, local):
    """Only skip exact assets; never overwrite conflicts."""
    byname = {a['name']: a for a in remote}
    missing = []
    for p in local:
        a = byname.get(p.name)
        if a is None: missing.append(p); continue
        require(a.get('state') == 'uploaded' and a.get('size') == p.stat().st_size
                and a.get('digest') == 'sha256:' + sha(p), '远端同名附件冲突/未完成: '+p.name)
    return missing

class Delivery:
    def __init__(self, args, root=ROOT):
        self.args, self.root = args, root
        self.log = None
        self.lock = None
        self.state = {}
        self.env = dict(os.environ)
        self.env.pop('NODE_OPTIONS', None)
        self.env['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
    def say(self, msg):
        print(msg, flush=True)
        if self.log: self.log.write(msg+'\n'); self.log.flush()
    def run(self, cmd, capture=False, env=None, input=None, label=None):
        self.say('$ '+(label or shlex.join(map(str,cmd))))
        start=time.monotonic()
        p=subprocess.Popen(list(map(str,cmd)),cwd=self.root,env=env or self.env,
            stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        if input is not None: p.stdin.write(input); p.stdin.close()
        lines=[]
        def reader():
            for line in p.stdout:
                if capture: lines.append(line)
                else: self.say(line.rstrip())
        t=threading.Thread(target=reader); t.start()
        while p.poll() is None:
            try: p.wait(timeout=15)
            except subprocess.TimeoutExpired: self.say('  运行中，已耗时 %.0fs'%(time.monotonic()-start))
        t.join(); p.stdout.close()
        require(p.returncode==0, '命令失败 exit=%s；查看日志。修复后重跑相同阶段，不会自动进入后续阶段。'%p.returncode)
        self.say('  完成 %.1fs'%(time.monotonic()-start))
        return ''.join(lines).strip()
    def git(self,*a): return self.run(['git',*a],capture=True)
    def fingerprint(self):
        names=self.git('ls-files','--cached','--others','--exclude-standard','-z').split('\0')
        h=hashlib.sha256()
        for n in sorted(set(filter(None,names))):
            p=self.root/n
            h.update(n.encode()+b'\0')
            if p.is_symlink(): h.update(os.readlink(p).encode())
            elif p.is_file(): h.update(p.read_bytes())
            else: h.update(b'<missing>')
        return h.hexdigest()
    def setup(self):
        for tool in ['git','node','pnpm','ditto','file']:
            require(shutil.which(tool), '缺少工具 '+tool+'；请先安装工具再运行，不会自动安装依赖。')
        require(platform.system()=='Darwin' and platform.machine()=='arm64','只支持 Apple Silicon macOS')
        require((self.root/'node_modules').exists(),'依赖缺失；先在仓库执行 pnpm install --frozen-lockfile，再重试。')
        self.version=json.loads((self.root/'package.json').read_text())['version']
        require(self.version==json.loads((self.root/'packages/desktop/package.json').read_text())['version'],'两处版本不一致')
        import re
        require(re.fullmatch(r'\d+\.\d+\.\d+',self.version),'仅接受正式 x.y.z 版本')
        self.commit=self.git('rev-parse','HEAD'); self.fp=self.fingerprint()
        self.base=self.root/'temp'/'delivery'/(self.version+'-'+self.fp[:16]);self.base.mkdir(parents=True,exist_ok=True)
        self.log=(self.base/('run-'+time.strftime('%Y%m%d-%H%M%S')+'.log')).open('a')
        self.say('日志: '+self.log.name)
        import fcntl
        self.lock=(self.root/'temp/delivery/.lock').open('a')
        try: fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise Stop('已有交付进程运行，不能并发执行')
        self.record=self.base/'state.json'
        if self.record.exists(): self.state=json.loads(self.record.read_text())
        self.state.update(version=self.version,commit=self.commit,fingerprint=self.fp)
        self.app=self.base/'package'/'mac-arm64'/'zmarkdown.app'
        self.assets=self.base/'assets';self.assets.mkdir(exist_ok=True)
        self.tag='v'+self.version
        self.say('源码 '+self.commit+'；输入指纹 '+self.fp)
        self.run(['node','--version']);self.run(['pnpm','--version'])
    def save(self):
        tmp=self.record.with_suffix('.tmp');tmp.write_text(json.dumps(self.state,indent=2));tmp.replace(self.record)
    def need(self,*stages):
        for s in stages: require(self.state.get(s) is True,'缺少成功的 '+s+' 记录；请先运行 --stage '+s)
    def digest_app(self,p):
        # Include every bundle file, including native helpers, not just app.asar.
        h=hashlib.sha256()
        for f in sorted(p.rglob('*')):
            if f.is_symlink(): val='link:'+os.readlink(f)
            elif f.is_file(): val=sha(f)
            else: continue
            h.update((str(f.relative_to(p))+'\0'+val+'\n').encode())
        return h.hexdigest()
    def check_app(self):
        require(self.app.exists(),'包不存在；重新 --stage package')
        require(self.digest_app(self.app)==self.state.get('bundleHash'),'包已改变；重新打包与验收')
    def build(self):
        self.run(['pnpm','typecheck']); self.run(['pnpm','--filter','zmarkdown','build'])
        self.state['outHash']=self.digest_app(self.root/'packages/desktop/out')
    def test(self):
        self.need('build')
        env=dict(self.env)
        major=int(self.run(['node','-p','process.versions.node.split(".")[0]'],capture=True))
        if major>=25: env['NODE_OPTIONS']='--no-experimental-webstorage'
        self.run(['pnpm','--filter','zmarkdown','exec','vitest','run',
                  *['test/unit/specs/'+n+'.spec.ts' for n in UNIT]],env=env)
        self.run(['pnpm','--filter','@muyajs/core','exec','vitest','run',
                  'src/selection/__tests__/TableRectSelection.spec.ts',
                  'src/selection/__tests__/textDragSelection.spec.ts',
                  'src/clipboard/__tests__/keydownTableGuard.spec.ts'],env=env)
    def package(self):
        self.need('build','test')
        require(self.state['outHash']==self.digest_app(self.root/'packages/desktop/out'),'构建输出变化；重新 build/test')
        self.run(['pnpm','--filter','zmarkdown','exec','electron-builder','--mac','--arm64','--dir','--publish','never',
                  '--config.electronDist=node_modules/electron/dist','--config.mac.identity=null',
                  '--config.directories.output='+str(self.base/'package')])
        require(plistlib.loads((self.app/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']==self.version,'包版本错误')
        require('arm64' in self.run(['file',self.app/'Contents/MacOS/zmarkdown'],capture=True),'包架构错误')
        self.state['bundleHash']=self.digest_app(self.app)
    def verify(self):
        self.need('package');self.check_app()
        env=dict(self.env);env.update(PANEL_APP=str(self.app/'Contents/MacOS/zmarkdown'),TREE_APP=str(self.app/'Contents/MacOS/zmarkdown'))
        self.run(['pnpm','--filter','zmarkdown','exec','playwright','test',
                  *['test/e2e/'+n+'.spec.ts' for n in E2E],'--workers=1'],env=env)
        self.check_app()
    def installed_running(self,target):
        procs=self.run(['ps','-axo','comm='],capture=True)
        return str(target/'Contents/MacOS/zmarkdown') in [x.strip() for x in procs.splitlines()]
    def install(self):
        self.need('verify');self.check_app()
        target=pathlib.Path.home()/'Applications/zmarkdown.app'
        require(not self.installed_running(target),'程序仍在运行。请保存文档并正常退出，再运行 --stage install；不会强制退出。')
        target.parent.mkdir(exist_ok=True)
        if not target.exists() or self.digest_app(target)!=self.state['bundleHash']:
            stamp=time.strftime('%Y%m%d-%H%M%S');backup=target.with_name('zmarkdown-backup-'+stamp+'.app');stage=target.with_name('zmarkdown-staged-'+stamp+'.app')
            require(not backup.exists() and not stage.exists(),'安装临时路径冲突')
            self.run(['ditto',self.app,stage]);require(self.digest_app(stage)==self.state['bundleHash'],'复制包不一致')
            require(not self.installed_running(target),'复制期间程序启动；保留暂存包，请先正常退出')
            if target.exists():target.rename(backup);self.state['backup']=str(backup);self.save()
            try:stage.rename(target)
            except BaseException:
                if backup.exists() and not target.exists():backup.rename(target)
                raise
            self.say('可回退备份: '+str(backup))
        # Normal user profile; do not use test profile or terminate the session.
        startup_log=self.base/'startup.log'
        with startup_log.open('ab') as stream:
            p=subprocess.Popen([str(target/'Contents/MacOS/zmarkdown')],stdout=stream,stderr=stream,start_new_session=True)
        time.sleep(5)
        require(p.poll() is None and self.installed_running(target),'正常启动进程检查失败；请查看 startup.log，不发布')
        self.say('正常配置进程启动成功。此检查不代替人工窗口/文档验收；应用保留运行。')
        self.state['installedHash']=self.digest_app(target)
    def release_data(self):
        # Listing is also unambiguous when a requested release does not exist.
        data=json.loads(self.run(['gh','api','--paginate','--slurp','repos/ZWLFI/zmarkdown/releases?per_page=100'],capture=True))
        return next((r for page in data for r in page if r['tag_name']==self.tag),None)
    def publish(self):
        self.need('verify','install');self.check_app()
        require(shutil.which('gh') and shutil.which('curl'),'发布需要 gh 与 curl')
        require(not self.git('status','--porcelain'),'发布要求干净工作树；请人工审查并提交相关文件，不会自动 git add/commit。')
        require(self.git('remote','get-url','origin') in ['https://github.com/ZWLFI/zmarkdown.git','git@github.com:ZWLFI/zmarkdown.git'],'origin不是已授权仓库')
        require(self.state.get('installedHash')==self.digest_app(pathlib.Path.home()/'Applications/zmarkdown.app')==self.state['bundleHash'],'安装包与验收包不一致')
        require(self.args.notes and self.args.notes.is_file(),'发布需 --notes 更新说明文件（应注明测试限制和未签名未公证）')
        self.run(['gh','auth','status'],capture=True)
        remote=self.git('ls-remote','origin','refs/heads/main','refs/tags/'+self.tag,'refs/tags/'+self.tag+'^{}')
        refs=dict(line.split()[::-1] for line in remote.splitlines())
        tagsha=refs.get('refs/tags/'+self.tag+'^{}',refs.get('refs/tags/'+self.tag))
        require(tagsha in [None,self.commit],'远端标签对应其他提交；选择新的版本，不能覆盖')
        if tagsha: require(refs.get('refs/heads/main')==self.commit,'已有标签但main已变化；检查版本/分支，不自动改写')
        release=self.release_data()
        if release and not release['draft']:
            require(tagsha==self.commit,'已有公开Release版本冲突')
            # No new builds may replace a public version. Verify only exact prior assets.
            require(self.state.get('published')==release['html_url'],'此版本已公开；不会覆盖。选择新补丁版本并构建，或使用原交付记录。')
            self.say('已完成同一交付: '+release['html_url']);return
        # Create deterministic source archive and preserve an existing application ZIP on resume.
        appzip=self.assets/('zmarkdown-'+self.version+'-mac-arm64.zip')
        if not appzip.exists():self.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',self.app,appzip])
        with zipfile.ZipFile(appzip) as z:
            require(hashlib.sha256(z.read('zmarkdown.app/Contents/Resources/app.asar')).hexdigest()==sha(self.app/'Contents/Resources/app.asar'),'本地发布ZIP不匹配')
        source=self.assets/('zmarkdown-'+self.version+'-source.zip')
        self.run(['git','archive','--format=zip','--prefix=zmarkdown-'+self.version+'/', '-o',source,self.commit])
        sums=self.assets/'SHA256SUMS';sums.write_text(''.join(sha(p)+'  '+p.name+'\n' for p in [appzip,source]))
        local=[appzip,source,sums]
        if release:asset_conflicts(release['assets'],local)
        if not tagsha:
            # Push is fast-forward only; neither history nor existing tags are rewritten.
            localtag=self.run(['git','tag','--list',self.tag],capture=True)
            if localtag:require(self.git('rev-parse',self.tag+'^{}')==self.commit,'本地标签冲突')
            else:self.run(['git','tag','-a',self.tag,'-m','zmarkdown '+self.version])
            self.run(['git','-c','credential.helper=','-c','credential.helper=!gh auth git-credential','push','--atomic','origin','HEAD:main','refs/tags/'+self.tag])
        # Bounded CI polling; no success if runs are absent or failed.
        deadline=time.monotonic()+600
        while True:
            runs=json.loads(self.run(['gh','run','list','--repo','ZWLFI/zmarkdown','--commit',self.commit,'--json','status,conclusion,url'],capture=True))
            if runs and all(r['status']=='completed' for r in runs):
                require(all(r['conclusion']=='success' for r in runs),'该提交CI未通过');break
            require(time.monotonic()<deadline,'CI等待超时；稍后 --stage publish 继续')
            self.say('等待该提交CI，15秒后检查');time.sleep(15)
        if not release:
            self.run(['gh','release','create',self.tag,'--repo','ZWLFI/zmarkdown','--verify-tag','--draft','--title','zmarkdown '+self.version,'--notes-file',self.args.notes])
            release=self.release_data()
        # Token only in memory and curl stdin. curl progress is real byte progress.
        token=subprocess.check_output(['gh','auth','token'],text=True).strip()
        for p in asset_conflicts(release['assets'],local):
            url=release['upload_url'].split('{')[0]+'?name='+p.name
            config='header = "Authorization: Bearer '+token+'"\nheader = "Content-Type: application/octet-stream"\n'
            self.run(['curl','--config','-','--fail','--show-error','--progress-bar','--connect-timeout','30','--max-time','1200','--data-binary','@'+str(p),url],input=config,label='上传 '+p.name+'（curl真实传输进度）')
        release=self.release_data();require(not asset_conflicts(release['assets'],local),'仍有缺失附件')
        download=self.base/'download';download.mkdir(exist_ok=True)
        # API download via gh; heartbeat exposes liveness; complete hashes are mandatory.
        for p in local:
            dest=download/p.name
            if dest.exists() and sha(dest)==sha(p):continue
            if dest.exists():dest.unlink() # only our incomplete generated download
            self.run(['gh','release','download',self.tag,'--repo','ZWLFI/zmarkdown','--pattern',p.name,'--dir',download])
            require(sha(dest)==sha(p),'下载校验失败: '+p.name)
        self.run(['gh','release','edit',self.tag,'--repo','ZWLFI/zmarkdown','--draft=false'])
        release=self.release_data();require(release and not release['draft'],'公开状态未确认，先检查远端再重试')
        self.state['published']=release['html_url'];self.say('发布成功 '+release['html_url'])
    def execute(self):
        selected=STAGES if self.args.all else (self.args.stage or STAGES[:4])
        if self.args.from_stage:selected=STAGES[STAGES.index(self.args.from_stage):]
        if self.args.dry_run:
            print('DRY RUN：不执行命令、不创建文件。仓库: '+str(self.root))
            for i,s in enumerate(selected,1):print('[%d/%d] %s'%(i,len(selected),s))
            print('发布必须有干净工作树、新版本、成功测试与安装记录及 --notes；不会自动提交。');return
        self.setup()
        for i,s in enumerate(selected,1):
            self.say('[%d/%d] %s 开始'%(i,len(selected),s));start=time.monotonic()
            require(self.fingerprint()==self.fp,'执行期间源码变化；停止，请重新运行')
            # Invalidate downstream success before rerunning an earlier stage.
            for later in STAGES[STAGES.index(s):]:self.state.pop(later,None)
            self.save();getattr(self,s)()
            require(self.fingerprint()==self.fp,'阶段期间源码变化；本阶段不计成功')
            self.state[s]=True;self.save();self.say('[%d/%d] %s 成功 %.1fs'%(i,len(selected),s,time.monotonic()-start))
        self.say('所选阶段完成；记录 '+str(self.record))

def main():
    p=argparse.ArgumentParser(description='macOS arm64 交付：默认本地构建、定向测试、打包、包内UI回归。')
    g=p.add_mutually_exclusive_group();g.add_argument('--all',action='store_true',help='包括安装和GitHub发布')
    g.add_argument('--stage',nargs='+',choices=STAGES,help='独立阶段，按给定顺序执行')
    g.add_argument('--from',dest='from_stage',choices=STAGES,help='从已具备前置记录的阶段恢复至发布')
    p.add_argument('--dry-run',action='store_true',help='只打印阶段，不执行')
    p.add_argument('--notes',type=lambda x:pathlib.Path(x).expanduser().resolve(),help='发布更新说明文件')
    args=p.parse_args()
    try:Delivery(args).execute()
    except (Stop,OSError,ValueError,subprocess.SubprocessError) as e:
        print('失败：'+str(e),file=sys.stderr);return 1
    return 0
if __name__=='__main__':sys.exit(main())
