"""Selection and provider-boundary checks; never use a real key in tests."""
import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from app import ai_summary as ai
from app.main import app


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    ai._cache.clear()
    monkeypatch.setenv('OLLAMA_API_KEY', 'test-ollama-key')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('OLLAMA_MODEL', raising=False)


@pytest.fixture
def evidence():
    return {'selection': {'from': '2026-09-01', 'to': '2026-10-15', 'level': 'zcta',
                          'id': '11368', 'urgency': ['red'], 'dataset': 'station_closure', 'baseline_days': 60},
            'place': {'valid': 300, 'on_time_pct': 85, 'spec': 'below', 'control': 'out_of_control'}}


def provider(monkeypatch, calls):
    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={'done': True, 'message': {'content': json.dumps({
            'finding': 'Selected-period **briefing**.', 'next_step': "Review the selected area's flagged periods and call records.",
            'full_briefing': 'This expanded briefing adds context about the selected evidence. It does not change the statistical status.'})}},
                              request=httpx.Request('POST', url))
    monkeypatch.setattr(ai.httpx, 'post', post)


def test_exact_evidence_and_credential_go_only_to_ollama(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    result = ai.generate_summary(evidence)
    url, kwargs = calls[0]
    assert url == 'https://ollama.com/api/chat'
    assert kwargs['headers'] == {'Authorization': 'Bearer test-ollama-key'}
    assert json.loads(kwargs['json']['messages'][-1]['content']) == evidence
    assert kwargs['json']['stream'] is False
    assert 'format' not in kwargs['json']  # Ollama Cloud does not support structured output mode.
    assert result['text'] == "Selected-period **briefing**. Review the selected area's flagged periods and call records."
    assert result['finding'] == 'Selected-period **briefing**.'
    assert result['next_step'] == "Review the selected area's flagged periods and call records."
    assert result['full_briefing'].startswith('This expanded briefing')
    assert result['label'] == 'Watch'
    assert result['tone'] == 'watch'
    assert 'test-ollama-key' not in json.dumps(result)


def test_accepts_valid_json_wrapped_in_ollama_markdown_fence(monkeypatch, evidence):
    content = json.dumps({
        'finding': 'ZIP 11368 has a confirmed gap. Only **70% of 300 calls** met the target.',
        'next_step': "Review ZIP 11368's flagged periods and call records.",
        'full_briefing': 'The area is below its target and has a confirmed recent signal. Review the flagged periods and supporting calls.',
    })
    monkeypatch.setattr(ai.httpx, 'post', lambda url, **kw: httpx.Response(
        200, json={'done': True, 'done_reason': 'stop', 'message': {'content': f'```json\n{content}\n```'}},
        request=httpx.Request('POST', url)))
    result = ai.generate_summary(evidence)
    assert result['status'] == 'ok'
    assert result['finding'].startswith('ZIP 11368')
    assert result['next_step'] == "Review ZIP 11368's flagged periods and call records."


@pytest.mark.parametrize(('field', 'value'), [('from', '2026-09-02'), ('to', '2026-10-14'),
    ('id', '11369'), ('level', 'county'), ('urgency', ['yellow']), ('dataset', 'baseline'), ('baseline_days', 120)])
def test_changed_selection_does_not_reuse_old_summary(monkeypatch, evidence, field, value):
    calls = []
    provider(monkeypatch, calls)
    assert not ai.generate_summary(evidence)['cached']
    assert ai.generate_summary(evidence)['cached']
    changed = copy.deepcopy(evidence)
    changed['selection'][field] = value
    assert not ai.generate_summary(changed)['cached']
    assert len(calls) == 2


def test_evidence_model_key_and_expiry_invalidate_cache(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    clock = [0.0]
    monkeypatch.setattr(ai.time, 'monotonic', lambda: clock[0])
    ai.generate_summary(evidence)
    clock[0] = 601
    assert not ai.generate_summary(evidence)['cached']
    evidence['place']['valid'] = 301
    assert not ai.generate_summary(evidence)['cached']
    monkeypatch.setenv('OLLAMA_MODEL', 'different-model')
    assert not ai.generate_summary(evidence)['cached']
    monkeypatch.setenv('OLLAMA_API_KEY', 'different-key')
    assert not ai.generate_summary(evidence)['cached']
    assert len(calls) == 5


def test_openai_named_alias_and_missing_key(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    monkeypatch.delenv('OLLAMA_API_KEY')
    monkeypatch.setenv('OPENAI_API_KEY', 'ollama-alias')
    ai.generate_summary(evidence)
    assert calls[0][1]['headers']['Authorization'] == 'Bearer ollama-alias'
    monkeypatch.delenv('OPENAI_API_KEY')
    with pytest.raises(ai.SummaryUnavailable, match='Configure an Ollama'):
        ai.generate_summary(evidence)


def test_no_calls_never_contact_provider(monkeypatch, evidence):
    monkeypatch.setattr(ai.httpx, 'post', lambda *a, **k: pytest.fail('must not contact provider'))
    evidence['place']['valid'] = 0
    evidence['place']['spec'] = 'inconclusive'
    result = ai.generate_summary(evidence)
    assert result['status'] == 'no_data'
    assert (result['label'], result['tone']) == ('Too few calls', 'nodata')
    assert result['next_step']


@pytest.mark.parametrize(('queue', 'spec', 'valid', 'label', 'tone'), [
    ('act_now', 'below', 100, 'Critical', 'critical'),
    ('ongoing_gap', 'below', 100, 'Watch', 'watch'),
    ('recent_change', 'inconclusive', 100, 'Watch', 'watch'),
    ('meets_stable', 'meets', 100, 'Stable', 'stable'),
    ('needs_data', 'inconclusive', 318, 'Near goal', 'near'),
    ('needs_data', 'meets', 318, 'Stable', 'stable'),
    ('needs_data', 'below', 318, 'Watch', 'watch'),
    ('needs_data', 'inconclusive', 29, 'Too few calls', 'nodata'),
])
def test_status_color_matches_map_legend(monkeypatch, evidence, queue, spec, valid, label, tone):
    evidence['place']['queue'] = queue
    evidence['place']['spec'] = spec
    evidence['place']['valid'] = valid
    calls = []
    provider(monkeypatch, calls)
    result = ai.generate_summary(evidence)
    assert (result['label'], result['tone']) == (label, tone)


@pytest.mark.parametrize('content', [
    'plain text response',
    '{"finding":"Too many words", "next_step":"Review", "extra":"ignored"}',
    json.dumps({'finding': ' '.join(['word'] * 33), 'next_step': 'Review this area carefully with its supervisors today.',
                'full_briefing': 'The expanded information supports this finding. It remains evidence based.'}),
    json.dumps({'finding': 'No emphasis in this finding.', 'next_step': 'Review the periods and call records together.',
                'full_briefing': 'The expanded information supports this finding. It remains evidence based.'}),
    json.dumps({'finding': 'This **finding** is concise.', 'next_step': 'Review the periods and call records together.',
                'full_briefing': ' '.join(['detail'] * 76)}),
])
def test_invalid_structured_summary_is_rejected(monkeypatch, evidence, content):
    monkeypatch.setattr(ai.httpx, 'post', lambda url, **kw: httpx.Response(
        200, json={'done': True, 'message': {'content': content}},
        request=httpx.Request('POST', url)))
    with pytest.raises(ai.SummaryUnavailable):
        ai.generate_summary(evidence)
    assert not ai._cache


@pytest.mark.parametrize('status', [401, 403, 429, 500])
def test_provider_errors_hide_internals(monkeypatch, evidence, status):
    monkeypatch.setattr(ai.httpx, 'post', lambda url, **kwargs: httpx.Response(
        status, text='sensitive-provider-detail', request=httpx.Request('POST', url)))
    with pytest.raises(ai.SummaryUnavailable) as error:
        ai.generate_summary(evidence)
    assert 'sensitive-provider-detail' not in str(error.value)
    assert not ai._cache


@pytest.mark.parametrize('body', [{}, {'done': True, 'message': {'content': ''}},
    {'done': False, 'message': {'content': '{"finding":"Partial","next_step":"Review this area."}'}},
    {'done': True, 'done_reason': 'length', 'message': {'content': '{"finding":"Truncated","next_step":"Review this area."}'}}])
def test_invalid_or_incomplete_output_is_not_cached(monkeypatch, evidence, body):
    monkeypatch.setattr(ai.httpx, 'post', lambda url, **kw: httpx.Response(
        200, json=body, request=httpx.Request('POST', url)))
    with pytest.raises(ai.SummaryUnavailable):
        ai.generate_summary(evidence)
    assert not ai._cache


def test_timeout_is_sanitized(monkeypatch, evidence):
    def fail(*a, **kw):
        raise httpx.ReadTimeout('sensitive internals')
    monkeypatch.setattr(ai.httpx, 'post', fail)
    with pytest.raises(ai.SummaryUnavailable, match='unavailable or incomplete'):
        ai.generate_summary(evidence)


@pytest.mark.parametrize('query', ['', 'from=2026-09-01', 'to=2026-10-15',
    'from=invalid&to=2026-10-15', 'from=2026-10-15&to=2026-09-01'])
def test_requires_valid_explicit_dates(query):
    assert TestClient(app).get('/api/ai_summary?' + query).status_code == 400


@pytest.mark.parametrize(('level', 'id'), [('state', None), ('county', '36081'), ('zcta', '11368')])
def test_aggregate_evidence_matches_existing_routes(monkeypatch, level, id):
    captured = []
    monkeypatch.setattr(ai, 'generate_summary', lambda e: captured.append(e) or {'text': 'briefing', 'status': 'ok'})
    client = TestClient(app)
    params = {'from': '2026-09-01', 'to': '2026-10-15', 'level': level, 'dataset': 'station_closure', 'urgency': 'red'}
    if id:
        params['id'] = id
    result = client.get('/api/ai_summary', params=params)
    assert result.status_code == 200
    snapshot = client.get('/api/summary', params=params).json()
    evidence = captured[0]
    assert evidence['selection'] == snapshot['selection']
    assert all(snapshot['place'][k] == v for k, v in evidence['place'].items())
    assert evidence['stages'] == client.get('/api/stages', params=params).json()
    assert evidence['geography']['queue_counts'] == snapshot['queue_counts']
    assert len(evidence['geography']['top_areas']) <= 3
    children = {p['id']: p for p in snapshot['places']}
    for p in evidence['geography']['top_areas']:
        assert all(children[p['id']][k] == v for k, v in p.items())
    if level == 'zcta':
        assert evidence['geography']['top_areas'] == []
    assert 'incident_id' not in json.dumps(evidence)
    assert 't_received' not in json.dumps(evidence)


def test_provider_failure_is_503(monkeypatch):
    def fail(evidence):
        raise ai.SummaryUnavailable('Ollama is unavailable.')
    monkeypatch.setattr(ai, 'generate_summary', fail)
    r = TestClient(app).get('/api/ai_summary?from=2026-09-01&to=2026-10-15')
    assert r.status_code == 503
    assert r.json()['detail'] == 'Ollama is unavailable.'
