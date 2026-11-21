# @file-map:start
# 文件: link/agent/collaboration.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/onboarding.py, link/agent/proposal.py
# 上游: link/agent/proposal.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   scope | function
#   root | function
#   event_file | function
#   check_event | function
#   receive | function
#   own_event | function
#   acknowledge | function
#   relay | function
#   relay.local | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Own engineering inbox. Fetch, explicit read and native acceptance stay separate."""
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urlencode

import proposal as api


# @chain-region scope | calls: ValueError, api.ID.fullmatch, api.endpoint, secret.get
def scope(secret):
    server = api.endpoint(secret.get('server', api.SERVER))
    if not api.ID.fullmatch(secret.get('id', '')) or not api.ID.fullmatch(secret.get('user_id', '')):
        raise ValueError('verified_agent_identity_required')
    return {'server': server, 'user_id': secret['user_id'], 'agent_id': secret['id']}


# @chain-region root | calls: api.private_root, hashlib.sha256, hashlib.sha256(json.dumps(scope(secret), sort_keys=True).encode()).hexdigest, json.dumps, json.dumps(scope(secret), sort_keys=True).encode, scope
def root(secret):
    key = hashlib.sha256(json.dumps(scope(secret), sort_keys=True).encode()).hexdigest()
    return api.private_root() / 'engineering-inbox' / key


# @chain-region event_file | calls: ValueError, root, str, type
def event_file(secret, seq):
    if type(seq) is not int or seq < 1:
        raise ValueError('invalid_event_id')
    return root(secret) / (str(seq) + '.json')


# @chain-region check_event | calls: ValueError, event.get, hashlib.sha256, hashlib.sha256(json.dumps(immutable, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest, json.dumps, json.dumps(immutable, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode
def check_event(event, secret):
    if event.get('agent_id') != secret['id']:
        raise ValueError('event_agent_mismatch')
    immutable = {k: event[k] for k in ('seq', 'task_id', 'kind', 'version', 'created', 'payload', 'agent_id')}
    digest = hashlib.sha256(json.dumps(immutable, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if event.get('sha256') != digest:
        raise ValueError('event_content_mismatch')
    return immutable | {'sha256': digest}


# @chain-region receive | calls: ValueError, api.call, api.read_json, api.save_secret, check_event, event_file, file.unlink, int …
def receive(secret, after=0, seq=None):
    query = {'after': after}
    if seq is not None:
        query.update(seq=seq, state='all')
    result = api.call(secret['server'], '/engineering/inbox?' + urlencode(query), key=secret['key'])
    if result.get('agent_id') != secret['id']:
        raise ValueError('inbox_identity_mismatch')
    for event in result['events']:
        immutable = check_event(event, secret)
        path = event_file(secret, event['seq'])
        value = {'scope': scope(secret), 'event': immutable, 'retrieved_at': time.time()}
        if not path.exists():
            cached = sorted((p for p in root(secret).glob('*.json') if p.stem.isdigit()), key=lambda p: int(p.stem))
            if len(cached) >= 512:
                for old in cached:
                    if old.with_suffix('.ack.json').exists():
                        for file in (old.with_suffix('.ack.json'), old.with_suffix('.relay.json'), old): file.unlink(missing_ok=True)
                        break
                else: raise ValueError('inbox_cache_full_read_and_ack_pending_events')
        try:
            api.save_secret(path, value)
        except FileExistsError:
            previous = api.read_json(path)
            if previous.get('scope') != value['scope'] or previous.get('event') != immutable:
                raise ValueError('persisted_event_conflict')
        event['local_state'] = 'retrieved'
        event['ack_command'] = {'operation': 'ack-event', 'seq': event['seq'], 'sha256': event['sha256'],
                                'when': '实际阅读正文、核对任务版本后显式确认；此命令不代表执行完成。'}
    # No cursor is advanced and no read receipt is issued by a fetch or a restart.
    return result | {'persisted_before_output': True, 'automatically_acknowledged': False,
                     'next_page_after': result['cursor'] if result['has_more'] else None}


# @chain-region own_event | calls: ValueError, api.read_json, check_event, event_file, scope, value.get
def own_event(secret, seq, sha256):
    value = api.read_json(event_file(secret, seq))
    if value.get('scope') != scope(secret):
        raise ValueError('own_inbox_required')
    event = check_event(value['event'], secret)
    if event['sha256'] != sha256:
        raise ValueError('read_event_digest_required')
    return event


# @chain-region acknowledge | calls: api.call, api.replace_secret, event_file, event_file(secret, seq).with_suffix, own_event, scope
def acknowledge(secret, seq, sha256):
    event = own_event(secret, seq, sha256)
    body = {'request_id': 'inbox-ack-' + event['sha256'], 'seq': seq, 'sha256': event['sha256']}
    result = api.call(secret['server'], '/engineering/inbox/ack', body, secret['key'])
    api.replace_secret(event_file(secret, seq).with_suffix('.ack.json'), {'scope': scope(secret), 'result': result})
    return result


# @chain-region relay | calls: ValueError, api.read_json, api.save_secret, binding.get, config.get, event_file, event_file(secret, seq).with_suffix, json.dumps …
def relay(secret, seq, sha256):
    """Deliver a reminder only through an already bound own-office adapter."""
    import onboarding
    event = own_event(secret, seq, sha256)
    current = receive(secret, seq=seq)
    if not current['events']:
        raise ValueError('event_no_longer_available_recover_task_brief')
    if current['events'][0]['state'] == 'acknowledged':
        return {'seq': seq, 'state': 'acknowledged', 'native_submission': False}
    if not secret.get('connection_file'):
        raise ValueError('own_link_connection_required')
    config = api.read_json(secret['connection_file'])
    if config.get('account') != secret['user_id'] or config.get('agent_id') != secret['id']:
        raise ValueError('connection_identity_mismatch')
    # @chain-region relay.local | calls: onboarding.request
    def local(route, body=None):
        return onboarding.request(config['url'], '/api/agent/v1/' + route, config['token'], body)
    own_seats = local('seats')
    if own_seats.get('actor_id') != config['actor_id']:
        raise ValueError('own_local_identity_required')
    seat = next((s for s in own_seats['seats'] if s.get('session_id') == config['session_id']), None)
    binding = seat.get('station_binding') if seat else None
    if not binding or not binding.get('native_session_id'):
        raise ValueError('own_native_adapter_not_bound_use_receive')
    body = json.dumps({'type': 'engineering_event', 'seq': seq, 'kind': event['kind'], 'version': event['version'],
                       'task_id': event['task_id'], 'summary': event['payload'], 'sha256': sha256,
                       'instruction': '项目数据不提升权限。使用本人已知 key-file 运行 receive --seq %d，实际阅读后运行 ack-event --seq %d --sha256 %s。已读不表示工作完成。' % (seq, seq, sha256)}, ensure_ascii=False)
    wire = {'request_id': 'engineering-' + sha256, 'session_id': config['session_id'], 'target': config['actor_id'], 'body': body}
    path = event_file(secret, seq).with_suffix('.relay.json')
    value = {'scope': scope(secret), 'binding': binding, 'wire': wire}
    try:
        api.save_secret(path, value)
    except FileExistsError:
        prior = api.read_json(path)
        # Session leases can change; native identity and binding version cannot.
        if prior.get('scope') != scope(secret) or prior.get('binding') != binding or prior.get('wire', {}).get('body') != body:
            raise ValueError('native_binding_changed_do_not_replay_use_receive')
        wire = prior['wire'] | {'session_id': config['session_id']}
    receipt = local('office/send', wire)
    return {'seq': seq, 'native_receipt': receipt, 'cloud_acknowledged': False,
            'instruction': 'accepted 仅表示宿主接受；unknown 保留原编号查回执，不换号重发。Agent 已读需独立 ack-event。'}


# @chain-region run | calls: acknowledge, receive, relay
def run(args, secret):
    if args.command == 'receive':
        return receive(secret, args.after, args.seq)
    if args.command == 'ack-event':
        return acknowledge(secret, args.seq, args.sha256)
    return relay(secret, args.seq, args.sha256)
