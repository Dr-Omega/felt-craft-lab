"""Missing service setup must not direct children into endless network retries."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.shared_error_map import shared_error


class ServiceFailureMessagesTests(unittest.TestCase):
    def test_missing_configuration_is_actionable_without_revealing_credentials(self):
        for code in ("ASR_MISSING_API_KEY", "QA_MISSING_API_KEY", "STORY_MISSING_API_KEY", "TTS_MISSING_API_KEY", "TTS_MISSING_GROUP_ID", "IMAGE_MISSING_API_KEY"):
            with self.subTest(code=code):
                error = shared_error(code=code)
                self.assertEqual(error["code"], "UNKNOWN")
                self.assertFalse(error["retryable"])
                self.assertIn("管理员", error["message"])
                self.assertNotIn("API_KEY", error["message"])

    def test_transient_network_errors_remain_retryable(self):
        self.assertTrue(shared_error(code="ASR_NETWORK_ERROR")["retryable"])


if __name__ == "__main__":
    unittest.main()
