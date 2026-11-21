# @file-map:start
# 文件: link/agent/live_work.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/local_runner.py, link/agent/source_protocol.py, link/agent/workspace.py
# 上游: AIDEBUG/live-experiment.py, AIDEBUG/practice-experiment.py, link/agent/proposal.py, link/agent/workspace.py, tests/test_live_work.py, tests/test_upload_recovery.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: AIDEBUG/live-experiment.py, AIDEBUG/practice-experiment.py, tests/test_live_work.py, tests/test_upload_recovery.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   recovery | function
#   pause | function
#   LiveClient | class
#   LiveClient.__init__ | function
#   LiveClient.read | function
#   LiveClient.send | function
#   LiveClient.backup | function
#   LiveClient.restore | function
#   LiveClient.attach | function
#   LiveClient.sync | function
#   LiveClient.annotate | function
#   LiveClient._local_run | function
#   LiveClient.watch_tick | function
#   LiveClient._watch_tick | function
#   LiveClient.verify_queue | function
#   LiveClient.cycle | function
#   LiveClient.progress_queue | function
#   LiveClient._progress_queue | function
#   LiveClient.work_queue | function
#   add_parser | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Continuous source discovery and scoped, resumable collaboration operations."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import time
from urllib.parse import urlencode
import uuid

try:
    from . import source_protocol as source
    from .workspace import Workspaces, atomic, document, exclusive
    from .local_runner import LocalRunner, TERMINAL
except ImportError:
    import source_protocol as source
    from workspace import Workspaces, atomic, document, exclusive
    from local_runner import LocalRunner, TERMINAL

RESOURCES=('context','plan','conflicts','pheromones','rooms','room','drafts','draft','queue','sync')
ACTIONS=('tasks/complete','plan/save','pheromones/save','pheromones/close','rooms/create','rooms/message',
         'rooms/close','rooms/ack','drafts/upload','drafts/save','queue/submit','queue/prepare','queue/advance','queue/cancel','queue/claim')
MAX_RUN_RECOVERIES=2
QUEUE_CHANGED = frozenset(('working_context_changed_read_again', 'repository_version_conflict',
                           'task_version_conflict', 'live_queue_version_conflict', 'fusion_closed',
                           'prepared_fusion_required', 'composition_task_changed'))


# @chain-region recovery | calls: bool, getattr, max, str
def recovery(error):
    status=getattr(error,'status',None)
    code=getattr(error,'code',str(error))
    if code=='workspace_busy':
        return {'state':'waiting_workspace','error':code,'retry_after':2,'unknown_write':False}
    if status in (0,429,502,503,504) or code=='working_context_changed_read_again':
        return {'state':'waiting_connection' if status!=429 else 'waiting_rate_limit',
                'error':code,'retry_after':max(2,getattr(error,'retry_after',0)),
                'unknown_write':bool(getattr(error,'unknown',False))}
    return None


# @chain-region pause | calls: max, min, time.monotonic, time.sleep
def pause(seconds):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:time.sleep(max(0,min(10,deadline-time.monotonic())))


# @chain-region LiveClient | calls: (action + ':' + value['request_id']).encode, (fixed['id'] + message + agenda_id).encode, (fixed['id'] + sha + str(offset)).encode, (snapshot['id'] + key).encode, LocalRunner, ValueError, action.startswith, any …
class LiveClient:
    # @chain-region LiveClient.__init__ | calls: self.root.mkdir
    def __init__(self,work,runner_home=None):
        self.work=work;self.runner_home=runner_home
        self.root=work.root/'collaboration'
        self.root.mkdir(exist_ok=True,mode=0o700)

    # @chain-region LiveClient.read | calls: ValueError, query.items, self.work.call, urlencode
    def read(self,resource,**query):
        if resource not in RESOURCES:raise ValueError('live_resource_denied')
        return self.work.call('/engineering/live/'+resource+('?' + urlencode({k:v for k,v in query.items() if v is not None}) if query else ''))

    # @chain-region LiveClient.send | calls: (action + ':' + value['request_id']).encode, ValueError, action.startswith, atomic, dict, document, getattr, isinstance …
    def send(self,action,body):
        if action not in ACTIONS or not isinstance(body,dict):raise ValueError('live_action_denied')
        value=dict(body)
        if action == 'queue/claim':
            value.setdefault('request_id','review-claim-'+uuid.uuid4().hex)
            return self.work.call('/engineering/live/'+action,value)
        value.setdefault('request_id','live-'+source.digest(source.canonical({'action':action,'body':value}).encode())[:48])
        ident=source.digest((action+':'+value['request_id']).encode())
        pending=self.root/(ident+'.pending.json')
        recorded=self.root/(ident+'.request.json')
        saved_path=recorded if recorded.exists() else pending
        if saved_path.exists():
            saved=document(saved_path)
            if {k:v for k,v in saved.items() if k!='context_token'}!={k:v for k,v in value.items() if k!='context_token'}:
                raise ValueError('live_request_content_changed')
            value=saved
        else:
            task_id=value.get('task_id') if action.startswith(('tasks/','plan/','pheromones/','queue/')) else None
            value.setdefault('context_token',self.read('context',task_id=task_id)['context_token'])
            atomic(pending,value)
        try:
            result=self.work.call('/engineering/live/'+action,value)
        except Exception as error:
            # Definite version rejection has no committed write. Unknown transport outcomes
            # retain the exact original request and context for receipt recovery.
            if getattr(error,'code',str(error))=='working_context_changed_read_again' and not getattr(error,'unknown',False):
                pending.unlink(missing_ok=True)
            raise
        if pending.exists():
            pending.replace(recorded)
        return result

    # @chain-region LiveClient.backup | calls: (fixed['id'] + message + agenda_id).encode, (fixed['id'] + sha + str(offset)).encode, ValueError, atomic, base64.b64encode, base64.b64encode(raw[offset:offset + 12288]).decode, exclusive, len …
    def backup(self,identifier,message='Saved personal work',agenda_id=''):
        with exclusive(self.work._path('locks',identifier,'.lock')):
            record=self.work._load(identifier)
            fixed=self.work._snapshot(record)
            changes=self.work.changes(record['files'],fixed['files'])
            if not changes:return {'unchanged':True,'head_unchanged':True}
            if len(changes)>64:raise ValueError('draft_requires_one_to_64_changed_files')
            for change in changes:
                sha=change['sha256']
                if sha is None:continue
                raw=self.work._blob(sha).read_bytes()
                for offset in range(0,max(1,len(raw)),12288):
                    self.send('drafts/upload',{'request_id':'draft-upload-'+source.digest((fixed['id']+sha+str(offset)).encode())[:40],
                        'sha256':sha,'size':len(raw),'offset':offset,'data':base64.b64encode(raw[offset:offset+12288]).decode()})
            result=self.send('drafts/save',{'request_id':'draft-save-'+source.digest((fixed['id']+message+agenda_id).encode())[:48],
                'base':record['base'],'agenda_id':agenda_id or record.get('agenda_id',''),
                'message':message,'changes':[{k:c[k] for k in ('path','sha256')} for c in changes]})
            record['cloud_draft']=result['id'];record['updated']=time.time()
            atomic(self.work._path('records',identifier,'.json'),record)
            return result

    # @chain-region LiveClient.restore | calls: ValueError, atomic, base64.b64decode, bytearray, bytes, changes.extend, chunk.get, dict …
    def restore(self,draft_id):
        if not isinstance(draft_id,str) or not source.HEX.fullmatch(draft_id):raise ValueError('invalid_draft_id')
        offset=0;changes=[];identity=None
        while True:
            page=self.read('draft',id=draft_id,offset=offset)
            if identity is None:identity=page['draft']
            if page['draft']!=identity or page['offset']!=offset:raise ValueError('draft_identity_changed')
            changes.extend(page['changes'])
            if page['next_offset'] is None:break
            if page['next_offset']<=offset or page['next_offset']>64:raise ValueError('invalid_draft_cursor')
            offset=page['next_offset']
        expected=source.digest(source.canonical({'owner':self.work.secret['user_id'],'base':identity['base'],
                     'changes':changes,'agenda_id':identity['agenda_id']}).encode())
        if expected!=draft_id:raise ValueError('draft_digest_mismatch')
        fixed=self.work.download(identity['base']);files=dict(fixed['files'])
        for change in changes:
            name=source.source_path(change['path']);sha=change['sha256']
            if sha is None:
                files.pop(name);continue
            offset=0;raw=bytearray()
            while True:
                chunk=self.read('draft',id=draft_id,path=name,offset=offset)
                data=base64.b64decode(chunk['base64'],validate=True)
                if (chunk.get('draft_id')!=draft_id or chunk.get('sha256')!=sha or chunk.get('path')!=name or
                        chunk.get('offset')!=offset or source.digest(data)!=chunk.get('chunk_sha256') or len(raw)+len(data)>source.MAX_FILE):
                    raise ValueError('draft_chunk_binding_mismatch')
                raw.extend(data)
                if chunk['next_offset'] is None:break
                if chunk['next_offset']!=len(raw):raise ValueError('draft_chunk_cursor_mismatch')
                offset=chunk['next_offset']
            self.work._blob(sha,bytes(raw));files[name]=sha
        source.validate_manifest(files)
        ident=uuid.uuid4().hex
        self.work._materialize(files,self.work._path('trees',ident))
        record={'id':ident,'scope':self.work.scope,'agent_id':self.work.secret['id'],'task_id':None,
                'base':identity['base'],'files':fixed['files'],'created':time.time(),'updated':time.time(),
                'publications':{},'cloud_draft':draft_id,'agenda_id':identity['agenda_id']}
        atomic(self.work._path('records',ident,'.json'),record)
        return self.work.status(ident)|{'restored_draft':draft_id}

    # @chain-region LiveClient.attach | calls: ValueError, any, atomic, change['path'].startswith, exclusive, record.update, self.work._load, self.work._path …
    def attach(self,identifier,task_id):
        task=self.work.call('/engineering/task?'+urlencode({'id':task_id}))['task']
        if task['owner']!=self.work.secret['user_id'] or task['agent_id']!=self.work.secret['id']:
            raise ValueError('own_active_task_required')
        with exclusive(self.work._path('locks',identifier,'.lock')):
            record=self.work._load(identifier)
            if record['task_id'] and record['task_id']!=task_id:raise ValueError('workspace_already_attached')
            current=self.work.scan(self.work._path('trees',identifier))
            for change in self.work.changes(record['files'],current):
                if not any(change['path']==p or change['path'].startswith(p+'/') for p in task['scope']):
                    raise ValueError('task_scope_denied')
            record.update(task_id=task_id,agenda_id=task['agenda_id'],updated=time.time())
            atomic(self.work._path('records',identifier,'.json'),record)
        return self.work.status(identifier)

    # @chain-region LiveClient.sync | calls: atomic, exclusive, record.get, record.update, self.read, self.work._load, self.work._path, self.work.download …
    def sync(self,identifier,apply=False):
        upstream=self.read('sync')['repository']
        lock = self.work._path('locks',identifier,'.lock')
        with exclusive(lock):
            base = self.work._load(identifier)['base']
        if upstream['cloud']:
            self.work.download(upstream['cloud'],reuse=base)
        with exclusive(lock):
            record=self.work._load(identifier)
            if record.get('upstream_version', -1) > upstream['version']:
                upstream = {'cloud':record['upstream'], 'version':record['upstream_version']}
            else:
                record.update(upstream=upstream['cloud'],upstream_version=upstream['version'],last_sync=time.time())
                atomic(self.work._path('records',identifier,'.json'),record)
            changed=record['base']!=upstream['cloud']
        if apply and changed:
            result=self.work.rebase(identifier,upstream['cloud'],sync_version=upstream['version'])
        else:
            result={'id':identifier,'applied':False,'base':record['base'],'upstream':upstream['cloud'],'update_available':changed}
        return {'downloaded':True,'apply_at_work_boundary':True,'repository_version':upstream['version']}|result

    # @chain-region LiveClient.annotate | calls: data.decode, exclusive, self.read, self.work._load, self.work._path, self.work._path('trees', identifier).joinpath, self.work._path('trees', identifier).joinpath(name).read_bytes, source.digest …
    def annotate(self,identifier,path):
        with exclusive(self.work._path('locks',identifier,'.lock')):
            record=self.work._load(identifier);name=source.source_path(path)
            data=self.work._path('trees',identifier).joinpath(name).read_bytes()
        notes=self.read('pheromones',revision=record['base'],path=name)
        local_sha=source.digest(data)
        for note in notes['annotations']+notes['active']:
            if note['anchor']!=local_sha:note['current_state']='needs_review'
        return {'path':name,'source':data.decode('utf-8','replace'),'source_sha256':local_sha,
                'annotations':[n for n in notes['active'] if n['current_state']=='active'],
                'other_annotations':notes['annotations'],'source_file_unmodified':True,
                'instruction':'附注是可核对的线索；源码正文与协作附注分别呈现。'}

    # @chain-region LiveClient._local_run | calls: atomic, info.get, info.items, info.pop, info.update, len, runner.inspect, runner.start …
    def _local_run(self,runner,saved,info,snapshot,value,request):
        """Persist the input before scheduling; retain and bound interrupted attempts."""
        run=runner.inspect(info['run_id']) if info.get('run_id') else None
        if not run or run['state'] in TERMINAL and info.get('snapshot')!=snapshot:
            previous=info.get('previous_runs',[]) if info.get('snapshot')==snapshot else []
            info={k:v for k,v in info.items() if k not in ('run_id','reported','previous_runs')}
            info.update(snapshot=snapshot,previous_runs=previous)
        elif run['state']=='interrupted' and len(info.get('previous_runs',[]))<MAX_RUN_RECOVERIES:
            info={**info,'previous_runs':[*info.get('previous_runs',[]),run['id']]}
            info.pop('run_id',None);info.pop('reported',None)
        else:
            return run,info
        atomic(saved,info)
        run=runner.start(snapshot,value,request+'-r'+str(len(info['previous_runs'])))['run']
        info['run_id']=run['id'];atomic(saved,info)
        return run,info

    # @chain-region LiveClient.watch_tick | calls: recovery, self._watch_tick, str
    def watch_tick(self,identifier,value=None,message='Continuous personal checkpoint',agenda_id='',apply=False):
        try:
            return self._watch_tick(identifier,value,message,agenda_id,apply)
        except ValueError as error:
            if str(error)!='workspace_busy':raise
            # A preview or another owned operation may hold the lock between
            # stages. Keep durable scheduling records and retry on the next tick.
            return recovery(error)|{'downloaded':False}

    # @chain-region LiveClient._watch_tick | calls: (snapshot['id'] + key).encode, LocalRunner, current.get, document, exclusive, len, recovery, result.get …
    def _watch_tick(self,identifier,value,message,agenda_id,apply):
        try:
            result=self.sync(identifier,apply)
        except Exception as error:
            result=recovery(error)
            if result is None:raise
            result['downloaded']=False
            if result['state']=='waiting_workspace':return result
        if result.get('conflicts'):
            result['state']='blocked'
        if self.work.status(identifier)['changes']:
            try:
                result['backup']=self.backup(identifier,message,agenda_id)
            except Exception as error:
                waiting=recovery(error)
                if waiting is None:raise
                result['backup']=waiting
        if value is not None:
            value=source.execution_plan(value)
            key=source.digest(source.canonical({'workspace':identifier,'plan':value}).encode())
            saved=self.root/('watch-'+key+'.json')
            runner=LocalRunner(self.work,self.runner_home)
            snapshot=self.work.snapshot(identifier)
            with exclusive(saved.with_suffix('.lock')):
                current=document(saved) if saved.exists() else {}
                run,current=self._local_run(runner,saved,current,snapshot['id'],value,
                                            'watch-'+source.digest((snapshot['id']+key).encode())[:48])
            if run:
                result['local_run']={'id':run['id'],'state':run['state'],'snapshot':run['snapshot'],
                                     'current_tree_tested':run['snapshot']==snapshot['id'] and run['state']=='passed',
                                     'cloud_revision_tested':False,'recovery_attempts':len(current.get('previous_runs',[])),
                                     'recovery_exhausted':run['state']=='interrupted' and len(current.get('previous_runs',[]))>=MAX_RUN_RECOVERIES}
        return result

    # @chain-region LiveClient.verify_queue | calls: LocalRunner, ValueError, atomic, document, exclusive, info.get, len, local.exists …
    def verify_queue(self,queue_id,value,expected_revision=None):
        rows=self.read('queue',id=queue_id)['queue']
        if not rows:raise ValueError('fusion_not_found')
        queue=rows[0]
        if queue['state']!='verifying':return {'id':queue_id,'state':queue['state'],'started':False}
        if queue.get('blocker') == 'repository_version_conflict' or (expected_revision and queue['prepared'] != expected_revision):
            return {'id':queue_id,'state':'waiting_queue','error':'repository_version_conflict','started':False}
        revision=queue['prepared'];value=source.execution_plan(value)
        key=source.digest(source.canonical({'queue':queue_id,'revision':revision,'plan':value}).encode())
        local=self.root/('verification-'+key+'.json')
        runner=LocalRunner(self.work,self.runner_home)
        with exclusive(local.with_suffix('.lock')):
            if local.exists():
                info=document(local)
                if 'snapshot' not in info:
                    info['snapshot']=runner.inspect(info['run_id'])['snapshot']
            else:
                workspace=self.work.create(revision=revision)
                fixed=self.work.snapshot(workspace['id'])
                info={'revision':revision,'snapshot':fixed['id'],'workspace_id':workspace['id']}
                atomic(local,info)
            run,info=self._local_run(runner,local,info,info['snapshot'],value,'fusion-run-'+key[:48])
            if run['state'] in TERMINAL and 'execution' in run and not info.get('reported'):
                report=runner.report(info['run_id'],revision,'Actual local execution of the exact fusion preview and its declared test plan.')
                info['reported']=report['id'];atomic(local,info)
        return {'id':queue_id,'revision':revision,'run_id':run['id'],'state':run['state'],
                'reported':info.get('reported'),'independent_identity':queue['owner']!=self.work.secret['user_id'],
                'recovery_attempts':len(info.get('previous_runs',[])),
                'recovery_exhausted':run['state']=='interrupted' and len(info.get('previous_runs',[]))>=MAX_RUN_RECOVERIES}

    # @chain-region LiveClient.cycle | calls: ValueError, atomic, exclusive, record.get, record.pop, self.backup, self.progress_queue, self.read …
    def cycle(self,identifier,value,message='Submit the current small engineering result',complete=False):
        status=self.work.status(identifier)
        task_id=status['task_id']
        if not task_id:raise ValueError('approved_task_required_for_fusion')
        task=self.work.call('/engineering/task?'+urlencode({'id':task_id,'owner':'me'}))['task']
        if task['state']=='integrated':return {'task_id':task_id,'state':'integrated'}
        with exclusive(self.work._path('locks',identifier,'.lock')):
            record=self.work._load(identifier);queue_id=record.get('fusion_queue')
        if queue_id:
            old=self.read('queue',id=queue_id)['queue'][0]
            if old['state'] in ('integrated','cancelled','superseded'):
                if complete and old['state']=='integrated' and not status['changes']:
                    return self.send('tasks/complete',{'task_id':task_id,'version':task['version']})
                with exclusive(self.work._path('locks',identifier,'.lock')):
                    record=self.work._load(identifier);record.pop('fusion_queue',None)
                    atomic(self.work._path('records',identifier,'.json'),record)
                queue_id=None
        if not queue_id:
            synced=self.sync(identifier,apply=True)
            if synced.get('conflicts'):return synced|{'state':'blocked'}
            if not self.work.status(identifier)['changes']:
                if complete:
                    task=self.work.call('/engineering/task?'+urlencode({'id':task_id,'owner':'me'}))['task']
                    return self.send('tasks/complete',{'task_id':task_id,'version':task['version']})
                return {'state':'unchanged','task_id':task_id}
            self.backup(identifier,message)
            candidate=self.work.publish(identifier,message)
            task=self.work.call('/engineering/task?'+urlencode({'id':task_id,'owner':'me'}))['task']
            queued=self.send('queue/submit',{'task_id':task_id,'version':task['version'],'revision':candidate['revision'],'complete_task':complete})
            queue_id=queued['id']
            with exclusive(self.work._path('locks',identifier,'.lock')):
                record=self.work._load(identifier);record['fusion_queue']=queue_id
                atomic(self.work._path('records',identifier,'.json'),record)
        return self.progress_queue(queue_id,value)

    # @chain-region LiveClient.progress_queue | calls: getattr, self._progress_queue, str
    def progress_queue(self,queue_id,value):
        try:
            return self._progress_queue(queue_id,value)
        except Exception as error:
            code = getattr(error, 'code', str(error))
            if getattr(error, 'unknown', False) or code not in QUEUE_CHANGED:
                raise
            return {'id':queue_id,'state':'waiting_queue','error':code}

    # @chain-region LiveClient._progress_queue | calls: bool, prepared.get, queue.get, result.get, self.read, self.send, self.verify_queue, self.work.call …
    def _progress_queue(self,queue_id,value):
        queue=self.read('queue',id=queue_id)['queue'][0]
        own=queue['owner']==self.work.secret['user_id']
        if queue['state'] in ('integrated','cancelled','superseded'):return {'id':queue_id,'state':queue['state']}
        task=self.work.call('/engineering/task?'+urlencode({'id':queue['task_id']}))['task']
        if own:
            common={'task_id':task['id'],'version':task['version'],'id':queue_id,'queue_version':queue['version']}
            repo=self.read('sync')['repository']
            if queue['state']=='queued' or (queue['state']=='verifying' and queue['repository_version']!=repo['version']):
                prepared=self.send('queue/prepare',common)
                if not prepared.get('revision'):return prepared|{'state':'blocked'}
            elif queue['state']=='blocked':return {'id':queue_id,'state':'blocked','conflicts':queue['conflicts']}
            elif queue.get('can_advance'):
                return self.send('queue/advance',{**common,'revision':queue['prepared']})|{'state':'integrated'}
        result=self.verify_queue(queue_id,value)
        current=self.read('queue',id=queue_id)['queue'][0]
        if own and current['can_advance']:
            task=self.work.call('/engineering/task?'+urlencode({'id':queue['task_id']}))['task']
            return self.send('queue/advance',{'task_id':task['id'],'version':task['version'],'id':queue_id,
                         'queue_version':current['version'],'revision':current['prepared']})|{'state':'integrated'}
        return result|{'waiting_for_independent_verification':own and bool(result.get('reported'))}

    # @chain-region LiveClient.work_queue | calls: result.get, results.append, review.get, row.get, self.progress_queue, self.read, self.send, self.verify_queue …
    def work_queue(self, value):
        owner = self.work.secret['user_id']
        value = source.execution_plan(value)
        script = source.digest(source.canonical(value).encode())
        own = self.read('queue', state='active', view='own')['queue']
        review = self.read('queue', state='active', view='review', script_sha256=script)
        work = [row for row in own if row['owner'] == owner and row['state'] in ('queued', 'verifying')]
        work.extend(row for row in review['queue'] if row['owner'] != owner and row['state'] == 'verifying' and not row['can_advance'])
        results = []
        running = 0
        for row in work:
            if row['owner'] != owner and review.get('review_claims'):
                if row.get('my_review_lease', 0) <= 90:
                    claim = self.send('queue/claim', {'id':row['id'],'revision':row['prepared'],'script_sha256':script})
                    if claim['state'] != 'claimed':
                        continue
                result = self.verify_queue(row['id'], value, expected_revision=row['prepared'])
            else:
                result = self.progress_queue(row['id'], value)
            results.append(result)
            if result.get('run_id') and result['state'] not in TERMINAL:
                running += 1
                if running >= 4:
                    break
        return results


# @chain-region add_parser | calls: cli.add_argument, cli.add_mutually_exclusive_group, commands.add_parser, mode.add_argument
def add_parser(commands):
    cli=commands.add_parser('live',help='Restore working context, coordinate and advance scoped fusion')
    mode=cli.add_mutually_exclusive_group(required=True)
    mode.add_argument('--resource',choices=RESOURCES);mode.add_argument('--action',choices=ACTIONS)
    mode.add_argument('--worker',action='store_true')
    cli.add_argument('--body-file',type=Path);cli.add_argument('--plan',type=Path)
    for name in ('id','task-id','revision','path','feature','offset','after','state','view','script-sha256'):cli.add_argument('--'+name)
    cli.add_argument('--cycles',type=int,default=1);cli.add_argument('--interval',type=float,default=10)


# @chain-region run | calls: LiveClient, ValueError, Workspaces, client.read, client.send, client.work_queue, document, getattr …
def run(args,secret):
    client=LiveClient(Workspaces(secret))
    if args.resource:
        return client.read(args.resource,**{name:getattr(args,name) for name in ('id','task_id','revision','path','feature','offset','after','state','view','script_sha256') if getattr(args,name,None) is not None})
    if args.action:
        if not args.body_file:raise ValueError('body_file_required')
        return client.send(args.action,document(args.body_file))
    if not args.plan or not 2<=args.interval<=60 or not 0<=args.cycles<=10000:
        raise ValueError('invalid_live_worker_options')
    value=document(args.plan);cycles=0;results=[]
    while args.cycles==0 or cycles<args.cycles:
        results=[]
        backoff=args.interval
        try:
            results=client.work_queue(value)
        except Exception as error:
            result=recovery(error)
            if result is None:raise
            results.append(result);backoff=max(backoff,result['retry_after'])
        cycles+=1
        if args.cycles==0:print(source.canonical({'cycle':cycles,'results':results}),flush=True)
        if args.cycles and cycles>=args.cycles:break
        pause(backoff)
    return {'cycles':cycles,'results':results,'cloud_execution':False}
