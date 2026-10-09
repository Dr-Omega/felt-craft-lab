import base64
import hashlib
import pytest
from services.plaza_db import PlazaDb
from services.workspace_sync import WorkspaceSync, TABLES
from services.reward_system import RewardError

@pytest.fixture
def workspace(tmp_path):
    db=PlazaDb(tmp_path/'sync.db')
    a,b=db.create_user('first','unused'),db.create_user('second','unused')
    return WorkspaceSync(db),a.user_id,b.user_id

def doc(user):
    return {'schema':'account-workspace/1','userId':user,'tables':{name:[] for name in TABLES},'recolor':{},'files':[]}

def test_two_terminals_revision_conflict_and_account_isolation(workspace):
    sync,a,b=workspace
    document=doc(a)
    assert sync.read(a)=={'revision':0,'document':None}
    assert sync.put(a,0,document)['revision']==1
    with pytest.raises(RewardError,match='另一终端'): sync.put(a,0,document)
    assert sync.read(a)['document']==document
    assert sync.read(b)['document'] is None
    with pytest.raises(RewardError): sync.put(b,0,document)
    document['tables']['projects']=[{'scene':{'userId':b}}]
    with pytest.raises(RewardError): sync.put(a,1,document)

def test_chunk_integrity_missing_and_private_ownership(workspace):
    sync,a,b=workspace
    data=b'actual png/audio bytes'; sha=hashlib.sha256(data).hexdigest()
    document=doc(a);document['files']=[{'key':'felt-resource://preview/test.png','size':len(data),'sha256':sha,'chunks':[sha]}]
    with pytest.raises(RewardError): sync.put(a,0,document)
    assert sync.read(a)['revision']==0
    with pytest.raises(RewardError): sync.chunk(a,sha,base64.b64encode(b'wrong').decode())
    sync.chunk(a,sha,base64.b64encode(data).decode())
    sync.chunk(a,sha,base64.b64encode(data).decode())
    assert base64.b64decode(sync.chunk(a,sha)['base64'])==data
    with pytest.raises(RewardError): sync.chunk(b,sha)
    assert sync.put(a,0,document)['revision']==1
    assert sync.read(a)['document']==document
    document['files'][0]['size'] += 1
    with pytest.raises(RewardError): sync.put(a,1,document)
    assert sync.read(a)['revision']==1

def test_reject_orphan_story_and_personal_version(workspace):
    sync,a,_=workspace
    for name,record in [('storyCards',{'workId':'missing'}),('personalAssetVersions',{'personalAssetId':'missing'})]:
        document=doc(a);document['tables'][name]=[record]
        with pytest.raises(RewardError): sync.put(a,0,document)
