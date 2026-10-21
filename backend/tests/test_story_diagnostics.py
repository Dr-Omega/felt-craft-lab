import json
from unittest.mock import patch

import requests

from services.story_rewrite_service import rewrite_story

CONTEXT = {'workId': 'diagnostic-work', 'completionStatus': 'completed', 'subject': {'name': '福娃'}, 'stickers': []}
TRACE_ID = 'e2ea2a96-f4c5-48cf-a6bd-2ad3eb60c15f'


def test_timeout_has_story_specific_message_and_safe_correlated_diagnostics():
    for exception, stage in [(requests.ConnectTimeout(), 'connect_timeout'), (requests.ReadTimeout(), 'read_timeout')]:
        with patch.dict('os.environ', {'QWEN_STORY_API_KEY': 'do-not-log-key'}), \
             patch('services.story_rewrite_service.requests.post', side_effect=exception) as post, \
             patch('services.story_rewrite_service._log') as log:
            result = rewrite_story(work_id='diagnostic-work', text='private-story-text', context=CONTEXT, request_id=TRACE_ID)
        assert result['error']['code'] == 'QA_TIMEOUT'
        assert result['error']['requestId'] == TRACE_ID
        assert '故事' in result['error']['message']
        records = [json.loads(call.args[0]) for call in log.warning.call_args_list]
        assert records[-1]['stage'] == stage
        assert records[-1]['requestId'] == TRACE_ID
        assert records[-1]['elapsedMs'] >= 0
        assert 'private-story-text' not in str(log.mock_calls)
        assert 'do-not-log-key' not in str(log.mock_calls)
        assert post.call_count == 1  # no silent paid retries
