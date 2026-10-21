"""The launcher must distinguish a running old prompt from current source code."""
import hashlib
from pathlib import Path


def test_health_identifies_loaded_qa_provider_source():
    from app import app
    import providers.qa.deepseek_provider as provider

    response = app.test_client().get('/api/health')
    assert response.status_code == 200
    assert response.json['qaPersonaRevision'] == hashlib.sha256(Path(provider.__file__).read_bytes()).hexdigest()
    import services.story_rewrite_service as story
    assert response.json['storyRewriteRevision'] == hashlib.sha256(Path(story.__file__).read_bytes()).hexdigest()
    from services.plaza_routes import PLAZA_UI_REVISION
    assert response.json['plazaUiRevision'] == PLAZA_UI_REVISION
