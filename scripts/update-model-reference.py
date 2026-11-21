# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: unique_object; read_json; text; positive_int; options; reference; build; main
# Impact: python -B scripts/code-atlas.py show scripts/update-model-reference.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build an offline model-reference candidate from a pinned models.dev snapshot.

No network, credentials or user settings. Inspect the report before promoting the
candidate Config/模型目录.json. Community facts never add relay wire rules.
"""
import argparse
import copy
import hashlib
import json
import math
import datetime
from pathlib import Path

PUBLISHERS = ('openai', 'anthropic', 'google', 'xai', 'deepseek', 'alibaba-cn',
              'moonshotai', 'zai', 'xiaomi', 'minimax', 'mistral', 'cohere',
              'perplexity', 'tencent-tokenhub', 'stepfun', 'longcat')
MARKER = 'models-dev-reference:'

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result

def read_json(path, limit):
    data = Path(path).read_bytes()
    if len(data) > limit:
        raise ValueError('Input exceeds size limit')
    return data, json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique_object)

def text(value, limit=200):
    return value if isinstance(value, str) and value.strip() == value and 0 < len(value) <= limit and all(ord(c) >= 32 and ord(c) != 127 for c in value) else None

def positive_int(value):
    return value if type(value) is int and 0 < value <= 10000000 else None

def options(value):
    result = []
    for option in value if isinstance(value, list) else []:
        if not isinstance(option, dict):
            continue
        if option.get('type') == 'effort':
            values = option.get('values')
            allowed = {'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'}
            if isinstance(values, list) and values and all(isinstance(v, str) and v in allowed for v in values):
                result.append({'type': 'effort', 'values': list(dict.fromkeys(values))})
        elif option.get('type') == 'toggle':
            result.append({'type': 'toggle'})
        elif option.get('type') == 'budget_tokens' and positive_int(option.get('max')):
            minimum = option.get('min', 1024)
            if type(minimum) is int and 0 <= minimum < option['max']:
                result.append({'type': 'budget_tokens', 'min': minimum, 'max': option['max']})
    return result

def reference(publisher, model, source_hash, date):
    identity = text(model.get('id'))
    if not identity:
        raise ValueError('Invalid model ID')
    limit = model.get('limit') if isinstance(model.get('limit'), dict) else {}
    modalities = model.get('modalities') if isinstance(model.get('modalities'), dict) else {}
    meta = {key: model[key] for key in ('name', 'family', 'description', 'release_date', 'last_updated') if text(model.get(key), 1200)}
    for key in ('reasoning', 'tool_call', 'structured_output'):
        if type(model.get(key)) is bool:
            meta[key] = model[key]
    meta['modalities'] = {key: list(dict.fromkeys(v for v in modalities.get(key, []) if v in {'text', 'image', 'audio', 'video', 'pdf', 'embedding', 'rerank'})) for key in ('input', 'output') if isinstance(modalities.get(key), list)}
    cost = model.get('cost') if isinstance(model.get('cost'), dict) else {}
    meta['cost'] = {key: cost[key] for key in ('input', 'output', 'cache_read', 'cache_write') if type(cost.get(key)) in (int, float) and math.isfinite(cost[key]) and 0 <= cost[key] <= 100000}
    row = {'provider': publisher, 'id': identity, 'family': meta.get('family', ''),
           'context_window': positive_int(limit.get('context')), 'max_input': positive_int(limit.get('input')), 'max_output': positive_int(limit.get('output')),
           'reasoning': model.get('reasoning') is True, 'reasoning_options': options(model.get('reasoning_options')),
           'tool_calls': None, 'vision': None, 'protocols': [], 'rules': [],
           'summary_zh': '原厂型号资料参考', 'verification': MARKER + date,
           'source_url': 'https://models.dev/api.json', 'reference_metadata': meta,
           'reference_source': {'name': 'models.dev', 'kind': 'community_reference', 'provider': publisher, 'model': identity, 'date': date, 'sha256': source_hash, 'url': 'https://models.dev/api.json'}}
    return row

def build(catalog, data, source_hash, date):
    if datetime.date.fromisoformat(date).isoformat() != date:
        raise ValueError('Date must use YYYY-MM-DD')
    if not isinstance(data, dict) or not isinstance(catalog.get('native_models'), list):
        raise ValueError('Invalid source/catalog shape')
    groups, rejected, counts = {}, [], {}
    for publisher in PUBLISHERS:
        block = data.get(publisher, {})
        models = block.get('models') if isinstance(block, dict) else None
        if not isinstance(models, dict):
            continue
        counts[publisher] = len(models)
        for identity, model in models.items():
            try:
                if not isinstance(model, dict) or identity != model.get('id'):
                    raise ValueError('Provider key and model ID differ')
                row = reference(publisher, model, source_hash, date)
                groups.setdefault(identity, []).append(row)
            except (ValueError, TypeError) as error:
                rejected.append({'provider': publisher, 'id': identity, 'error': str(error)})
    if sum(counts.values()) < 100 or rejected:
        raise ValueError('Incomplete or invalid selected source: ' + json.dumps(rejected))
    result = copy.deepcopy(catalog)
    retained = [row for row in result['native_models'] if not str(row.get('verification', '')).startswith(MARKER)]
    existing = {row['id']: row for row in retained}
    if len(existing) != len(retained):
        raise ValueError('Duplicate existing native model IDs')
    added, conflicts, preserved = [], [], []
    for identity, candidates in sorted(groups.items()):
        if len(candidates) != 1:
            conflicts.append({'id': identity, 'providers': [r['provider'] for r in candidates], 'action': 'no unqualified merge'})
            continue
        candidate = candidates[0]
        if identity in existing:
            row = existing[identity]
            if row.get('provider') != candidate['provider']:
                conflicts.append({'id': identity, 'existing': row.get('provider'), 'incoming': candidate['provider'], 'action': 'preserved existing'})
                continue
            differences = {k: {'existing': row.get(k), 'incoming': candidate[k]} for k in ('context_window', 'max_input', 'max_output', 'reasoning', 'reasoning_options') if row.get(k) != candidate[k]}
            row['reference_metadata'], row['reference_source'] = candidate['reference_metadata'], candidate['reference_source']
            if differences:
                preserved.append({'id': identity, 'differences': differences, 'action': 'preserved reviewed runtime facts'})
        else:
            retained.append(candidate)
            added.append(identity)
    result['native_models'] = retained
    result['reference_update'] = {'schema': 1, 'date': date, 'source_url': 'https://models.dev/api.json', 'source_sha256': source_hash,
                                  'license': 'MIT', 'publishers': list(PUBLISHERS), 'policy': 'Exact model IDs only. Reviewed runtime facts and relay rules retained. Community metadata is reference, not channel capability or billing proof.'}
    report = {'source_sha256': source_hash, 'date': date, 'providers': counts, 'sourceModels': sum(counts.values()), 'retainedReviewed': len(existing),
              'nativeModels': len(retained), 'added': added, 'ambiguous': conflicts, 'preservedFacts': preserved, 'rejected': rejected,
              'channelRulesUnchanged': result.get('models') == catalog.get('models'), 'userConfigurationRead': False}
    return result, report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    raw, data = read_json(args.source, 24 * 1024 * 1024)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != args.sha256:
        raise ValueError('Snapshot SHA256 mismatch')
    _, catalog = read_json(args.catalog, 16 * 1024 * 1024)
    inputs = {Path(args.source).resolve(), Path(args.catalog).resolve()}
    outputs = {Path(args.output).resolve(), Path(args.report).resolve()}
    if len(outputs) != 2 or inputs & outputs:
        raise ValueError('Candidate and report must be separate files outside the inputs')
    result, report = build(catalog, data, digest, args.date)
    for filename, value in ((args.output, result), (args.report, report)):
        Path(filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('sourceModels', 'retainedReviewed', 'nativeModels', 'channelRulesUnchanged')}, ensure_ascii=False))

if __name__ == '__main__':
    main()
