from pathlib import Path

import pytest
from werkzeug.security import generate_password_hash

from services.plaza_db import PlazaDb
from services.reward_system import RewardError, RewardSystem


@pytest.fixture()
def domain(tmp_path: Path):
    db = PlazaDb(tmp_path / "plaza.db")
    rewards = RewardSystem(db.db_path)
    author = db.create_user("小作者", generate_password_hash("111"), "child")
    parent = db.create_user("家长甲", generate_password_hash("111"), "parent")
    art_teacher = db.create_user("美术老师甲", generate_password_hash("111"), "art_teacher")
    chinese_teacher = db.create_user("语文老师甲", generate_password_hash("111"), "chinese_teacher")
    post = db.create_post(
        user_id=author.user_id,
        project_id="project_collage",
        title="春日拼贴",
        author_name=author.username,
        preview_filename="preview.png",
        output_type="collage",
    )
    story = db.create_post(
        user_id=author.user_id,
        project_id="project_story",
        title="春日故事",
        author_name=author.username,
        preview_filename="story.png",
        output_type="story",
    )
    return db, rewards, author, parent, art_teacher, chinese_teacher, post, story


def test_daily_login_grants_only_one_diamond(domain):
    _, rewards, author, *_ = domain
    assert rewards.on_login(author) is True
    assert rewards.on_login(author) is False
    dashboard = rewards.dashboard(author)
    assert dashboard["wallet"]["diamonds"] == 1
    assert dashboard["wallet"]["coins"] == 0
    assert len(dashboard["ledger"]) == 1
    assert dashboard["ledger"][0]["reason"] == "daily_login"


def test_parent_like_creates_claimable_child_reward_once(domain):
    _, rewards, author, parent, *_, post, _ = domain
    stats = rewards.like_post(parent, post)
    assert stats == {"likeCount": 1, "likedByMe": True, "reviewCount": 0}
    with pytest.raises(RewardError, match="已经点过赞"):
        rewards.like_post(parent, post)

    messages = rewards.list_inbox(author)
    assert len(messages) == 1
    assert messages[0]["rewardCoins"] == 10
    claimed = rewards.claim_message(author, messages[0]["messageId"])
    assert claimed["wallet"]["coins"] == 10
    claimed_again = rewards.claim_message(author, messages[0]["messageId"])
    assert claimed_again["wallet"]["coins"] == 10

    with pytest.raises(RewardError, match="仅儿童"):
        rewards.list_inbox(parent)


def test_teacher_direction_and_level_boundary_rewards(domain):
    _, rewards, author, _, art_teacher, chinese_teacher, post, story = domain
    with rewards._connect() as conn:
        conn.execute(
            "INSERT INTO teacher_profiles (user_id, direction, review_count, updated_at) VALUES (?, 'art', 19, 'now')",
            (art_teacher.user_id,),
        )

    result = rewards.submit_review(art_teacher, post, score=9, comment="构图完整，颜色很有层次。")
    assert result["teacher"]["level"] == "intermediate"
    assert result["teacher"]["reviewCount"] == 20
    assert result["teacherRewardCoins"] == 30
    assert result["childRewardCoins"] == 35

    with pytest.raises(RewardError, match="只能点评故事卡"):
        rewards.submit_review(chinese_teacher, post, score=8, comment="故事表达清楚。")

    story_result = rewards.submit_review(chinese_teacher, story, score=8, comment="故事表达清楚。")
    assert story_result["teacherRewardCoins"] == 20
    assert story_result["childRewardCoins"] == 20

    messages = rewards.list_inbox(author)
    assert [message["messageType"] for message in messages] == ["review", "review"]


def test_conversion_and_feeding_are_idempotent(domain):
    _, rewards, author, *_ = domain
    rewards.on_login(author)
    converted = rewards.convert_diamonds(author, 1, "convert-1")
    assert converted["wallet"]["diamonds"] == 0
    assert converted["wallet"]["coins"] == 10
    repeated = rewards.convert_diamonds(author, 1, "convert-1")
    assert repeated["wallet"] == converted["wallet"]

    feeding = rewards.feed_bear(author, "apple", "coins", "feed-1")
    assert feeding["wallet"]["coins"] == 0
    repeated_feeding = rewards.feed_bear(author, "apple", "coins", "feed-1")
    assert repeated_feeding["wallet"] == feeding["wallet"]
