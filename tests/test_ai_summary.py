"""Selection-grounding and provider-boundary tests; no live credentials required."""
import copy
import json
from types import SimpleNamespace

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
            'place': {'valid': 300, 'on_time': 255, 'on_time_pct': 85, 'spec': 'below',
                      'control': 'out', 'queue': 'act_now'}, 'messages': []}


def provider(monkeypatch, calls):
    def post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={'done': True, 'message': {'content': 'Selected-period summary.'}},
                              request=httpx.Request('POST', url))
    monkeypatch.setattr(ai.httpx, 'post', post)


def test_exact_evidence_is_sent_to_ollama_only(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    result = ai.generate_summary(evidence)
    url, kwargs = calls[0]
    assert url == 'https://ollama.com/api/chat'
    assert kwargs['headers'] == {'Authorization': 'Bearer test-ollama-key'}
    assert json.loads(kwargs['json']['messages'][1]['content']) == evidence
    assert kwargs['json']['stream'] is False
    assert result['text'] == 'Selected-period summary.'
    assert 'test-ollama-key' not in json.dumps(result)


@pytest.mark.parametrize(('field', 'value'), [('from', '2026-09-02'), ('to', '2026-10-14'),
    ('id', '11369'), ('level', 'county'), ('urgency', ['yellow']), ('dataset', 'baseline'), ('baseline_days', 120)])
def test_changed_selection_does_not_reuse_cached_summary(monkeypatch, evidence, field, value):
    calls = []
    provider(monkeypatch, calls)
    assert not ai.generate_summary(evidence)['cached']
    assert ai.generate_summary(evidence)['cached']
    changed = copy.deepcopy(evidence)
    changed['selection'][field] = value
    assert not ai.generate_summary(changed)['cached']
    assert len(calls) == 2


def test_cache_tracks_evidence_model_key_and_expiry(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    clock = [0.0]
    monkeypatch.setattr(ai.time, 'monotonic', lambda: clock[0])
    ai.generate_summary(evidence)
    clock[0] = 601
    assert not ai.generate_summary(evidence)['cached']
    evidence['place']['valid'] = 301
    assert not ai.generate_summary(evidence)['cached']
    monkeypatch.setenv('OLLAMA_MODEL', 'another-model')
    assert not ai.generate_summary(evidence)['cached']
    monkeypatch.setenv('OLLAMA_API_KEY', 'other-key')
    assert not ai.generate_summary(evidence)['cached']
    assert len(calls) == 5


def test_alias_and_missing_key(monkeypatch, evidence):
    calls = []
    provider(monkeypatch, calls)
    monkeypatch.delenv('OLLAMA_API_KEY')
    monkeypatch.setenv('OPENAI_API_KEY', 'ollama-alias')
    ai.generate_summary(evidence)
    assert calls[0][1]['headers']['Authorization'] == 'Bearer ollama-alias'
    monkeypatch.delenv('OPENAI_API_KEY')
    with pytest.raises(ai.SummaryUnavailable, match='configure an Ollama'):
        ai.generate_summary(evidence)


def test_no_valid_calls_never_contacts_provider(monkeypatch, evidence):
    monkeypatch.setattr(ai.httpx, 'post', lambda *a, **k: pytest.fail('must not contact provider'))
    evidence['place']['valid'] = 0
    assert ai.generate_summary(evidence)['status'] == 'no_data'


@pytest.mark.parametrize('status', [401, 403, 429, 500])
def test_provider_failures_are_sanitized(monkeypatch, evidence, status):
    def post(url, **kwargs):
        return httpx.Response(status, text='secret-provider-detail', request=httpx.Request('POST', url))
    monkeypatch.setattr(ai.httpx, 'post', post)
    with pytest.raises(ai.SummaryUnavailable) as error:
        ai.generate_summary(evidence)
    assert 'secret-provider-detail' not in str(error.value)
    assert not ai._cache


@pytest.mark.parametrize('body', [{}, {'done': True, 'message': {'content': ''}},
    {'done': False, 'message': {'content': 'Partial'}},
    {'done': True, 'done_reason': 'length', 'message': {'content': 'Truncated'}}])
def test_bad_provider_output_is_not_cached(monkeypatch, evidence, body):
    monkeypatch.setattr(ai.httpx, 'post', lambda url, **kw: httpx.Response(
        200, json=body, request=httpx.Request('POST', url)))
    with pytest.raises(ai.SummaryUnavailable):
        ai.generate_summary(evidence)
    assert not ai._cache


def test_timeout_is_sanitized(monkeypatch, evidence):
    def fail(*args, **kwargs):
        raise httpx.ReadTimeout('sensitive internals')
    monkeypatch.setattr(ai.httpx, 'post', fail)
    with pytest.raises(ai.SummaryUnavailable, match='unavailable or incomplete'):
        ai.generate_summary(evidence)


@pytest.mark.parametrize('query', ['', 'from=2026-09-01', 'to=2026-10-15',
    'from=invalid&to=2026-10-15', 'from=2026-10-15&to=2026-09-01'])
def test_endpoint_requires_valid_explicit_dates(query):
    assert TestClient(app).get('/api/ai_summary?' + query).status_code == 400


def test_endpoint_matches_selected_place_statistics(monkeypatch):
    captured = []
    def generate(evidence):
        captured.append(evidence)
        return {'text': 'Evidence-grounded summary.', 'status': 'ok', 'model': 'test', 'cached': False}
    monkeypatch.setattr(ai, 'generate_summary', generate)
    client = TestClient(app)
    query = 'from=2026-09-01&to=2026-10-15&level=zcta&id=11368&dataset=station_closure&urgency=red'
    result = client.get('/api/ai_summary?' + query)
    assert result.status_code == 200
    summary = client.get('/api/summary?' + query).json()
    assert captured[0]['selection'] == summary['selection']
    assert captured[0]['place']['baseline'] == summary['place']['baseline']
    for key, value in captured[0]['place'].items():
        assert summary['place'][key] == value
    payload = json.dumps(captured[0])
    assert 'incident_id' not in payload and 't_received' not in payload


def test_endpoint_provider_error_is_503(monkeypatch):
    def fail(evidence):
        raise ai.SummaryUnavailable('Ollama is unavailable.')
    monkeypatch.setattr(ai, 'generate_summary', fail)
    result = TestClient(app).get('/api/ai_summary?from=2026-09-01&to=2026-10-15')
    assert result.status_code == 503
    assert result.json()['detail'] == 'Ollama is unavailable.'
