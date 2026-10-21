"""Demo data is explicit, isolated, and never resets an account on launch."""
import importlib.util
from pathlib import Path
import pytest
from PIL import Image
import io

ROOT=Path(__file__).resolve().parents[2]
def load_script(name):
    spec=importlib.util.spec_from_file_location('demo_test_'+name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def test_demo_account_initial_state_and_idempotence(tmp_path,monkeypatch):
    module=load_script('prepare-demo-account')
    monkeypatch.setattr(module,'ROOT',tmp_path)
    monkeypatch.setattr(module,'DEMO_DATA',tmp_path/'tmp/demo-data')
    monkeypatch.setattr(module,'DEMO_DB',tmp_path/'tmp/demo-data/plaza.db')
    fixtures=[{'id':'test-moon','title':'月夜小船','author':'小禾','own':True,'likes':2,'background':'background_lake_moon_001','parts':[],
               'story':'小兔子把月饼带给朋友。','comments':[{'author':'美育老师','text':'颜色搭配清楚。'}]}]
    result=module.prepare('测试可乐','test-pass',fixtures)
    assert (result['coins'],result['diamonds'],result['onboardingCompletedVersion'],result['likeEmails'])==(500,66,0,1)
    db=module.PlazaDb(module.DEMO_DB);rewards=module.RewardSystem(module.DEMO_DB)
    user=module.authenticate_user(db,'测试可乐','test-pass');assert user is not None
    assert rewards.on_login(user) is False
    db.set_onboarding_completed_version(user.user_id,1)
    with rewards._connect() as conn:
        rewards._credit(conn,user_id=user.user_id,currency='coins',amount=7,reason='test',reference_id='test')
    again=module.prepare('测试可乐','test-pass',fixtures)
    assert (again['coins'],again['diamonds'],again['onboardingCompletedVersion'],again['likeEmails'])==(507,66,1,1)
    assert len(db.list_posts())==1
    with pytest.raises(ValueError,match='credentials differ'):
        module.prepare('测试可乐','wrong-pass',fixtures)
    email=rewards.list_inbox(user)[0]
    rewards.claim_message(user,email['messageId'])
    reset=module.reset_existing('测试可乐','test-pass')
    assert (reset['coins'],reset['diamonds'],reset['onboardingCompletedVersion'],reset['unclaimedLikeEmails'])==(500,66,0,1)
    assert Path(reset['backup']).is_file()
    assert len(db.list_posts())==1
    assert reset['userId']==user.user_id
    assert rewards.on_login(db.find_user_by_id(user.user_id)) is False
    assert rewards.claim_message(user,email['messageId'])['wallet']['coins']==510
    other=db.create_user('其他演示作者',user.password_hash)
    db.create_post(user_id=other.user_id,project_id='other-work',title='其他作品',author_name=other.username,preview_filename='other.png')
    from services.workspace_sync import WorkspaceSync
    sync=WorkspaceSync(db)
    with db._connect() as conn:
        conn.execute("INSERT INTO workspace_snapshots VALUES (?,1,'{}','now')",(user.user_id,))
        conn.execute("INSERT INTO workspace_snapshots VALUES (?,1,'{}','now')",(other.user_id,))
    cleared=module.reset_existing('测试可乐','test-pass',True)
    assert (cleared['removedOwnShares'],cleared['remainingOwnShares'],cleared['preservedSharedWorks'])==(1,0,1)
    assert cleared['unclaimedLikeEmails']==1
    assert sync.read(user.user_id)['document'] is None
    assert sync.read(other.user_id)['document']=={}

def test_demo_profile_does_not_change_formal_storage_configuration(tmp_path,monkeypatch):
    import dotenv
    module=load_script('local-test-gateway')
    settings={'APP_ENV':'development','QWEN_ASR_PROVIDER':'qwen_cloud_http','QA_PROVIDER':'deepseek','TTS_PROVIDER':'minimax',
              'IMAGE_PROVIDER':'seedream_ark','PLAZA_DB_PATH':str(tmp_path/'formal.db'),'PLAZA_UPLOAD_DIR':str(tmp_path/'formal-uploads'),'PORT':'8788'}
    monkeypatch.setattr(dotenv,'dotenv_values',lambda _:settings)
    monkeypatch.setattr(module,'ENV_FILE',Path(__file__))
    monkeypatch.setattr(module,'ROOT',tmp_path)
    for key,value in settings.items():monkeypatch.setenv(key,value)
    monkeypatch.setenv('ALLOW_SIMULATED_RECHARGE','false')
    monkeypatch.setenv('FELT_LOCAL_DEMO_PROFILE','0');module.load_configuration()
    import os
    assert os.environ['PLAZA_DB_PATH']==str(tmp_path/'formal.db') and os.environ['PORT']=='8788'
    monkeypatch.setenv('FELT_LOCAL_DEMO_PROFILE','1');module.load_configuration()
    assert os.environ['PLAZA_DB_PATH']==str(tmp_path/'tmp/demo-data/plaza.db') and os.environ['PORT']=='8789'
    assert not (tmp_path/'formal.db').exists()

def test_demo_composite_upscales_background_and_repair_preserves_posts(tmp_path,monkeypatch):
    module=load_script('prepare-demo-account')
    monkeypatch.setattr(module,'ROOT',tmp_path)
    monkeypatch.setattr(module,'DEMO_DATA',tmp_path/'tmp/demo-data')
    monkeypatch.setattr(module,'DEMO_DB',tmp_path/'tmp/demo-data/plaza.db')
    monkeypatch.setattr(module,'MATERIAL',tmp_path/'material')
    module.MATERIAL.mkdir()
    source=module.MATERIAL/'small.png'
    Image.new('RGBA',(843,480),'#128033').save(source)
    original=source.read_bytes()
    fixture={'id':'small','title':'小背景','author':'小禾','own':True,'likes':2,'background':'small','parts':[],
             'story':'故事保留','comments':[{'author':'美育老师','text':'点评保留'}]}
    preview=Image.open(io.BytesIO(module.composite_fixture(fixture)))
    assert preview.getpixel((0,0))==(18,128,51,255)
    module.prepare('测试可乐','test-pass',[fixture])
    db=module.PlazaDb(module.DEMO_DB)
    post=db.list_posts()[0]
    with db._connect() as conn:
        conn.execute("UPDATE plaza_posts SET preview_filename='old-small.png' WHERE post_id=?",(post.post_id,))
        before=[tuple(row) for row in conn.execute('SELECT * FROM reward_inbox')]
    missing={**fixture,'id':'deleted'}
    result=module.repair_previews('测试可乐','test-pass',[fixture,missing])
    assert result['updatedPreviews']==['small']
    assert Path(result['backup']).is_file()
    assert source.read_bytes()==original
    assert len(db.list_posts())==1
    assert db.list_posts()[0].post_id==post.post_id
    assert db.list_posts()[0].story_text==post.story_text
    with db._connect() as conn:
        assert [tuple(row) for row in conn.execute('SELECT * FROM reward_inbox')]==before
    assert module.repair_previews('测试可乐','test-pass',[fixture,missing])['updatedPreviews']==[]
