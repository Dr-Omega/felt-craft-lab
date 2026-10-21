"""Explicit, idempotent local Demo preparation. Credentials arrive on stdin only."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import sqlite3
from datetime import date, datetime, timezone
from PIL import Image, ImageOps
from werkzeug.security import generate_password_hash

ROOT=Path(__file__).resolve().parents[1]
DEMO_DATA=ROOT/'tmp/demo-data'
DEMO_DB=DEMO_DATA/'plaza.db'
MATERIAL=ROOT/'assets/generated/material/snapshot_ywn_psd_20261017'
sys.path.insert(0,str(ROOT/'backend'))
from services.plaza_db import PlazaDb
from services.plaza_auth import register_user, authenticate_user
from services.reward_system import RewardSystem, _utc_now_iso

def composite_fixture(post:dict)->bytes:
    def image(asset):
        relative=asset+'/composite' if asset.startswith('provided/') else asset
        source=(MATERIAL/(relative+'.png')).resolve()
        if not source.is_relative_to(MATERIAL.resolve()): raise ValueError('Invalid fixture asset')
        return Image.open(source).convert('RGBA')
    canvas=Image.new('RGBA',(1686,960),'#fffdf4')
    # Match CSS object-fit: contain, including upscaling lower-resolution backgrounds.
    bg=ImageOps.contain(image(post['background']),canvas.size,Image.Resampling.LANCZOS)
    canvas.alpha_composite(bg,((canvas.width-bg.width)//2,(canvas.height-bg.height)//2))
    for part in post['parts']:
        asset,x,y,w,h,*rotation=part
        frame=(round(w/100*canvas.width),round(h/100*canvas.height))
        piece=image(asset);piece.thumbnail(frame,Image.Resampling.LANCZOS)
        cx=(x+w/2)/100*canvas.width;cy=(y+h/2)/100*canvas.height
        if rotation:piece=piece.rotate(-rotation[0],resample=Image.Resampling.BICUBIC,expand=True)
        canvas.alpha_composite(piece,(round(cx-piece.width/2),round(cy-piece.height/2)))
    canvas.thumbnail((1200,800),Image.Resampling.LANCZOS)
    result=io.BytesIO();canvas.save(result,format='PNG');return result.getvalue()

def repair_previews(username:str,password:str,fixtures:list[dict])->dict:
    if DEMO_DB.resolve() != (ROOT/'tmp/demo-data/plaza.db').resolve() or not DEMO_DB.is_file():
        raise ValueError('Existing Demo storage only')
    db=PlazaDb(DEMO_DB)
    user=authenticate_user(db,username,password)
    if not user:raise ValueError('Existing Demo credentials differ')
    with db._connect() as conn:
        marker=conn.execute('SELECT user_id FROM demo_profile_accounts WHERE username=?',(username,)).fetchone()
        if not marker or marker['user_id']!=user.user_id:raise ValueError('Seeded Demo account only')
        posts=conn.execute('SELECT post_id,project_id,preview_filename FROM plaza_posts').fetchall()
        backup=DEMO_DATA/'backups'/('before-preview-repair-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.db')
        backup.parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(backup) as destination:conn.backup(destination)
    fixture_by_project={'demo-fixture-'+fixture['id']:fixture for fixture in fixtures}
    folder=DEMO_DATA/'uploads/plaza';folder.mkdir(parents=True,exist_ok=True)
    changed=[]
    with db._connect() as conn:
        for post in posts:
            fixture=fixture_by_project.get(post['project_id'])
            if fixture is None:continue
            png=composite_fixture(fixture);name=hashlib.sha256(png).hexdigest()[:32]+'.png'
            if name==post['preview_filename']:continue
            destination=folder/name
            if destination.exists() and destination.read_bytes()!=png:raise ValueError('Preview hash collision')
            if not destination.exists():destination.write_bytes(png)
            if conn.execute('UPDATE plaza_posts SET preview_filename=? WHERE post_id=? AND preview_filename=?',
                            (name,post['post_id'],post['preview_filename'])).rowcount:
                changed.append(fixture['id'])
    return {'updatedPreviews':changed,'backup':str(backup),'oldImagesPreserved':True,'formalDataChanged':False}

def reset_existing(username:str,password:str,clear_works:bool=False)->dict:
    if DEMO_DB.resolve() != (ROOT/'tmp/demo-data/plaza.db').resolve() or not DEMO_DB.is_file():
        raise ValueError('Existing Demo storage only')
    db=PlazaDb(DEMO_DB);rewards=RewardSystem(DEMO_DB)
    user=authenticate_user(db,username,password)
    if not user:raise ValueError('Existing Demo credentials differ')
    with db._connect() as conn:
        marker=conn.execute('SELECT user_id FROM demo_profile_accounts WHERE username=?',(username,)).fetchone()
        if not marker or marker['user_id']!=user.user_id:raise ValueError('Seeded Demo account only')
        message=conn.execute("SELECT message_id FROM reward_inbox WHERE user_id=? AND message_type='like' AND source_name='圆圆' ORDER BY created_at LIMIT 1",(user.user_id,)).fetchone()
        if not message:raise ValueError('Demo like email is missing; no account state changed')
        backup=DEMO_DATA/'backups'/('before-account-reset-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.db')
        backup.parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(backup) as destination:conn.backup(destination)
    with rewards._connect() as conn:
        wallet=rewards._ensure_wallet(conn,user.user_id)
        for currency,target in [('coins',500),('diamonds',66)]:
            rewards._credit(conn,user_id=user.user_id,currency=currency,amount=target-wallet[currency],reason='demo_reset',reference_id=backup.stem)
        conn.execute('UPDATE plaza_users SET onboarding_completed_version=0 WHERE user_id=?',(user.user_id,))
        conn.execute("UPDATE reward_inbox SET status='unclaimed',claimed_at=NULL,created_at=? WHERE message_id=? AND user_id=?",(_utc_now_iso(),message['message_id'],user.user_id))
        conn.execute('INSERT OR IGNORE INTO reward_daily_signins VALUES (?,?,?,?)',(user.user_id,date.today().isoformat(),0,_utc_now_iso()))
        removed_shares=0
        if clear_works:
            removed_shares=conn.execute('DELETE FROM plaza_posts WHERE user_id=?',(user.user_id,)).rowcount
            # Do not let login sync bring deleted creative work back from a snapshot.
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_snapshots'").fetchone():
                conn.execute('DELETE FROM workspace_snapshots WHERE user_id=?',(user.user_id,))
    current=db.find_user_by_id(user.user_id)
    state=rewards.dashboard(current)
    return {'username':current.username,'userId':current.user_id,'coins':state['wallet']['coins'],'diamonds':state['wallet']['diamonds'],
            'onboardingCompletedVersion':current.onboarding_completed_version,'unclaimedLikeEmails':sum(m['messageType']=='like' and m['status']!='claimed' for m in rewards.list_inbox(current)),
            'preservedSharedWorks':len(db.list_posts()),'removedOwnShares':removed_shares,
            'remainingOwnShares':sum(p.user_id==user.user_id for p in db.list_posts()),'backup':str(backup),'formalDataChanged':False}

def prepare(username:str,password:str,fixtures:list[dict])->dict:
    # Never accept a caller-supplied DB path or read/write the formal database.
    if DEMO_DB.resolve() != (ROOT/'tmp/demo-data/plaza.db').resolve():raise ValueError('Demo storage only')
    DEMO_DATA.mkdir(parents=True,exist_ok=True)
    db=PlazaDb(DEMO_DB);rewards=RewardSystem(DEMO_DB)
    with db._connect() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS demo_profile_accounts (username TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL)')
        marker=conn.execute('SELECT user_id FROM demo_profile_accounts WHERE username=?',(username,)).fetchone()
    user=db.find_user_by_username(username)
    fresh=user is None
    if user and (not marker or marker['user_id']!=user.user_id):
        raise ValueError('An existing non-seeded Demo account has this name; it was not changed.')
    if fresh:
        user=register_user(db,username,password,'child')
        with db._connect() as conn:
            conn.execute('INSERT INTO demo_profile_accounts VALUES (?,?,?)',(username,user.user_id,_utc_now_iso()))
    elif not authenticate_user(db,username,password):
        raise ValueError('Existing Demo credentials differ; no password or account data was overwritten.')
    with rewards._connect() as conn:
        rewards._ensure_wallet(conn,user.user_id)
        for currency,amount in [('coins',500),('diamonds',66)]:
            exists=conn.execute('SELECT 1 FROM reward_ledger WHERE user_id=? AND currency=? AND reference_id=?',(user.user_id,currency,'demo-account-initial-v1')).fetchone()
            if not exists:
                rewards._credit(conn,user_id=user.user_id,currency=currency,amount=amount,reason='demo_initial',reference_id='demo-account-initial-v1')
        # First login must show exactly 66, not silently add the normal daily diamond.
        conn.execute('INSERT OR IGNORE INTO reward_daily_signins VALUES (?,?,?,?)',(user.user_id,date.today().isoformat(),0,_utc_now_iso()))
    disabled_hash=generate_password_hash(secrets.token_urlsafe(32))
    def actor(name,role='child'):
        return db.find_user_by_username(name) or db.create_user(name,disabled_hash,role)
    spectators=[actor(f'演示观众{i:02d}') for i in range(1,max(p['likes'] for p in fixtures)+1)]
    liked_work=None
    for fixture in fixtures:
        owner=user if fixture.get('own') else actor(fixture['author'])
        project_id='demo-fixture-'+fixture['id']
        post=db.find_post_by_user_project(owner.user_id,project_id)
        if not post:
            png=composite_fixture(fixture);name=hashlib.sha256(png).hexdigest()[:32]+'.png'
            folder=DEMO_DATA/'uploads/plaza';folder.mkdir(parents=True,exist_ok=True)
            (folder/name).write_bytes(png)
            post=db.create_post(user_id=owner.user_id,project_id=project_id,title=fixture['title'],author_name=owner.username,
                                preview_filename=name,story_title=fixture['title'],story_text=fixture['story'])
        with rewards._connect() as conn:
            count=fixture['likes']-int(bool(fixture.get('own')))
            for spectator in spectators[:count]:
                conn.execute('INSERT OR IGNORE INTO plaza_likes VALUES (?,?,?)',(post.post_id,spectator.user_id,_utc_now_iso()))
        for index,review in enumerate(fixture['comments']):
            teacher=actor(review['author'],'art_teacher')
            with rewards._connect() as conn:
                conn.execute('''INSERT OR IGNORE INTO teacher_reviews
                    (review_id,post_id,teacher_id,score,comment,teacher_level,teacher_reward,child_reward,created_at)
                    VALUES (?,?,?,?,?,'beginner',0,0,?)''',
                    ('review_demo_'+post.post_id+'_'+str(index),post.post_id,teacher.user_id,9,review['text'],_utc_now_iso()))
        if fixture.get('own'):liked_work=post
    if liked_work:
        source=actor('圆圆')
        with rewards._connect() as conn:
            liked=conn.execute('SELECT 1 FROM plaza_likes WHERE post_id=? AND user_id=?',(liked_work.post_id,source.user_id)).fetchone()
        if not liked:rewards.like_post(source,liked_work)
    current=db.find_user_by_id(user.user_id)
    dashboard=rewards.dashboard(current)
    inbox=rewards.list_inbox(current)
    return {'username':current.username,'newAccount':fresh,'coins':dashboard['wallet']['coins'],'diamonds':dashboard['wallet']['diamonds'],
            'onboardingCompletedVersion':current.onboarding_completed_version,'sharedDemoWorks':len(db.list_posts()),
            'likeEmails':sum(item['messageType']=='like' for item in inbox),'storage':'tmp/demo-data/plaza.db',
            'simulatedCommunityData':True,'formalDataChanged':False}

if __name__=='__main__':
    request=json.load(sys.stdin)
    if request.get('reset') is True:
        print(json.dumps(reset_existing(request['username'],request['password'],request.get('clearWorks') is True),ensure_ascii=True))
        sys.exit(0)
    node=os.environ.get('FELT_DEMO_NODE') or shutil.which('node')
    if not node:raise SystemExit('Node.js is required to read the existing Demo scenes.')
    fixtures=json.loads(subprocess.check_output([node,str(ROOT/'scripts/export-demo-plaza-fixtures.cjs')],cwd=ROOT).decode('utf-8'))
    action=repair_previews if request.get('repairPreviews') is True else prepare
    print(json.dumps(action(request['username'],request['password'],fixtures),ensure_ascii=True))
