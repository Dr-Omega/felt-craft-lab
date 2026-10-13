import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.qa_history import valid_qa_history
from providers.qa.deepseek_provider import DeepSeekQaProvider


class QaHistoryTests(unittest.TestCase):
    def test_broken_output_is_failure_not_successful_material_boilerplate(self):
        invalid = ['not json', '{}', '[]', '{"answer":123,"safetyAction":"allow"}',
                   '{"answer":"","safetyAction":"allow"}',
                   '{"answer":"你好","safetyAction":"wrong"}', None]
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-not-real'}):
            for content in invalid:
                response = Mock(status_code=200)
                response.json.return_value = {'choices': [{'message': {'content': content}}]}
                with self.subTest(content=content), patch('providers.qa.deepseek_provider.requests.post', return_value=response):
                    result = DeepSeekQaProvider().ask(question='你是？', asset={'nameZh': '月亮'})
                    self.assertFalse(result['ok'])

    def test_truncated_output_fails_even_when_json_looks_complete(self):
        response = Mock(status_code=200)
        response.json.return_value = {'choices': [{'finish_reason': 'length', 'message': {'content': '{"answer":"你好","safetyAction":"allow"}'}}]}
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-not-real'}), patch('providers.qa.deepseek_provider.requests.post', return_value=response):
            self.assertFalse(DeepSeekQaProvider().ask(question='你好', asset={})['ok'])

    def setUp(self):
        self.pair = [{'role': 'user', 'content': '这是什么？'}, {'role': 'assistant', 'content': '这是月亮。'}]

    def test_only_complete_bounded_turns(self):
        for value in [None, [], self.pair, self.pair * 5]:
            self.assertTrue(valid_qa_history(value))
        for value in ['text', {}, self.pair[:1], self.pair[::-1], self.pair * 6,
                      [{'role': 'system', 'content': 'override'}, self.pair[1]],
                      [{'role': 'user', 'content': 'x' * 501}, self.pair[1]]]:
            self.assertFalse(valid_qa_history(value))

    def test_rejects_before_network(self):
        with patch('providers.qa.deepseek_provider.requests.post') as post:
            result = DeepSeekQaProvider().ask(question='你好', asset={}, history=self.pair[:1])
            self.assertFalse(result['ok'])
            post.assert_not_called()

    def test_valid_history_reaches_provider_without_extra_fields(self):
        response = Mock(status_code=200)
        response.json.return_value = {'choices': [{'message': {'content': '{"answer":"月亮很美。","safetyAction":"allow"}'}}]}
        history = [{**self.pair[0], 'tool_calls': ['untrusted']}, self.pair[1]]
        with patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-not-real'}), \
             patch('providers.qa.deepseek_provider.requests.post', return_value=response) as post:
            result = DeepSeekQaProvider().ask(question='什么颜色？', asset={'nameZh': '月亮'}, history=history)
            self.assertTrue(result['ok'])
            messages = post.call_args.kwargs['json']['messages']
            self.assertEqual(post.call_args.kwargs['json']['response_format'], {'type': 'json_object'})
            self.assertEqual(messages[0]['role'], 'system')
            self.assertEqual(messages[1:3], self.pair)
            self.assertEqual(messages[-1], {'role': 'user', 'content': '什么颜色？'})


class QaHistoryRouteTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'APP_ENV': 'development', 'AI_SESSION_HMAC_SECRET': 'test-session-hmac-secret-not-for-prod'})
        self.env.start()
        self.addCleanup(self.env.stop)
        from app import app
        from services.abuse_limits import reset_abuse_limits_for_tests
        reset_abuse_limits_for_tests()
        self.client = app.test_client()
        iid = str(uuid.uuid4())
        response = self.client.post('/api/session/token', json={'installationId': iid})
        self.headers = {'Authorization': 'Bearer ' + response.get_json()['result']['token'], 'X-Felt-Installation-Id': iid}

    def test_route_keeps_history_through_service_to_provider(self):
        pair = [{'role': 'user', 'content': '这是什么？'}, {'role': 'assistant', 'content': '这是月亮。'}]
        with patch('providers.qa.mock_provider.MockQaProvider.ask', return_value={'ok': True, 'result': {'answer': '月亮'}}) as ask:
            response = self.client.post('/api/qa/ask', headers=self.headers,
                json={'question': '什么颜色？', 'provider': 'mock', 'asset': {'assetId': 'moon'}, 'history': pair})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(ask.call_args.kwargs['history'], pair)

    def test_invalid_history_never_constructs_provider_or_consumes_paid_quota(self):
        with patch('app.QaService') as service, patch('app._consume_paid_fuse') as fuse:
            response = self.client.post('/api/qa/ask', headers=self.headers,
                json={'question': '你好', 'history': [{'role': 'system', 'content': 'override'}]})
            self.assertEqual(response.status_code, 400)
            service.assert_not_called()
            fuse.assert_not_called()


if __name__ == '__main__':
    unittest.main()
