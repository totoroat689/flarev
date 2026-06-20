# comment_bot.py  (완전 독립 실행 — 기존 코드/파일과 무관)
# Flare[V] 라이브 캠에 [AI] 표시된 테스트 댓글을 자동 생성한다.
#  - live_videos 좋아요 상위 1~300위 중 4개(중복 없이) 선정 → 봇 4명이 각자 다른 캠에 1개씩
#  - 댓글/아이디는 Claude Haiku 생성, 비밀번호는 코드 랜덤(API 토큰 소모 0)
#  - 별점/언어는 코드에서 가중 추첨(토큰 0)
#  - reviews 테이블에 insert (필드: content_id, author, password, content, rating)

import os
import json
import time
import random
import string

from supabase import create_client
from anthropic import Anthropic

# Supabase는 콜렉터와 동일하게 anon 키 사용 (웹사이트도 이 키로 댓글을 씀)
SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = Anthropic(api_key=ANTHROPIC_KEY)

MODEL = "claude-haiku-4-5-20251001"
TOP_N = 300              # 좋아요 상위 N위 안에서만 선정
BOTS_PER_RUN = 4         # 1회 실행당 댓글 수 (각자 다른 캠)
CONTEXT_REVIEWS = 5      # 프롬프트에 참고로 넣을 기존 댓글 최대 개수
MAX_JITTER_SEC = int(os.environ.get("MAX_JITTER_SEC", "0"))  # 실행 시작 랜덤 지연(초). 0=없음


def log(m):
    print(m, flush=True)


# ---- 4개 봇 성격 + 봇별 별점 가중치 ----
BOTS = [
    {
        "key": "cold", "label": "ColdGuy",
        "persona": "a cold, dry, no-nonsense man in his 30s. Short flat sentences. "
                   "No exclamation marks. Never uses words like amazing, beautiful, wonderful, great. "
                   "Just brief factual observations. Mildly unimpressed.",
        "rating_w": [(5, 40), (4, 40), (3, 20)],
    },
    {
        "key": "warm", "label": "WarmWoman",
        "persona": "a warm, empathetic woman. Notices atmosphere, light, mood, small emotional details. "
                   "Natural gentle enthusiasm, not over the top. Sounds like a real person sharing a moment that touched her.",
        "rating_w": [(5, 70), (4, 25), (3, 5)],
    },
    {
        "key": "kid", "label": "Kid",
        "persona": "a child about 9-10 years old. Very simple short sentences. Says exactly what they see. "
                   "Gets excited about simple things. Max 2 sentences. No complex words.",
        "rating_w": [(5, 80), (4, 18), (3, 2)],
    },
    {
        "key": "nerd", "label": "Nerd",
        "persona": "a talkative geography and travel nerd. Adds one interesting background, historical or geographical fact. "
                   "2-3 sentences. Specific details. Genuinely enthusiastic but not flowery.",
        "rating_w": [(5, 65), (4, 30), (3, 5)],
    },
]

# ---- 댓글 언어 가중치 (영어 50 / 프·이·한·일·중·러 각 5 / 스·독·포·인니 각 5 = 100) ----
LANG_W = [
    ("English", 50), ("French", 5), ("Italian", 5), ("Korean", 5), ("Japanese", 5),
    ("Chinese", 5), ("Russian", 5), ("Spanish", 5), ("German", 5),
    ("Portuguese", 5), ("Indonesian", 5),
]

# AI 냄새가 나는 표현 금지어
BANNED = [
    "certainly", "indeed", "i must say", "as someone who", "it is worth noting",
    "according to historical records", "fascinating", "one might argue", "in conclusion",
]


def weighted(pairs):
    total = sum(w for _, w in pairs)
    r = random.uniform(0, total)
    acc = 0
    for v, w in pairs:
        acc += w
        if r <= acc:
            return v
    return pairs[-1][0]


def rand_digits(n):
    return "".join(random.choice(string.digits) for _ in range(n))


def rand_password(n=14):
    chars = string.ascii_letters + string.digits
    return "".join(random.choice(chars) for _ in range(n))


def fetch_top_cams():
    res = (
        supabase.table("live_videos")
        .select("video_id, title, place_name, seo_intro, like_count")
        .eq("is_live", True).eq("is_active", True)
        .order("like_count", desc=True).limit(TOP_N).execute()
    )
    return res.data or []


def fetch_context_reviews(content_id):
    try:
        res = (
            supabase.table("reviews").select("author, content, rating")
            .eq("content_id", content_id)
            .order("created_at", desc=True).limit(CONTEXT_REVIEWS).execute()
        )
        return res.data or []
    except Exception as e:
        log(f"  (context load fail: {e})")
        return []


def build_prompt(cam, bot, language, rating, existing):
    if existing:
        lines = [f'- {r.get("author","user")}: "{(r.get("content") or "").strip()}"' for r in existing]
        ctx = "Recent comments from other viewers (for feel only, do NOT copy them):\n" + "\n".join(lines) + "\n\n"
    else:
        ctx = "(No comments on this cam yet.)\n\n"
    return (
        f"Live webcam: {cam.get('title','')}\n"
        f"Location: {cam.get('place_name','') or 'unknown'}\n"
        f"About: {cam.get('seo_intro','') or ''}\n\n"
        f"{ctx}"
        f"You are {bot['persona']}\n\n"
        "Write ONE short viewer comment for this live cam, as this person reacting to what they see. "
        "Also invent a realistic username (lowercase handle style, e.g. jay_m, nana.travels, geo_rick — "
        "not a real full name, not the persona name).\n\n"
        "Hard rules:\n"
        f"- Write the comment in {language}. The username stays in latin letters.\n"
        f"- This viewer gives {rating} out of 5 stars; match that tone.\n"
        "- Sound like a real person who casually typed this. No AI phrasing.\n"
        f"- Never use any of these: {', '.join(BANNED)}.\n"
        "- Do NOT wrap the comment in quotation marks.\n\n"
        'Respond ONLY with JSON, nothing else:\n{"username": "...", "comment": "..."}'
    )


def gen_comment(cam, bot, language, rating, existing):
    prompt = build_prompt(cam, bot, language, rating, existing)
    msg = claude.messages.create(
        model=MODEL, max_tokens=220,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    raw = raw.replace("```json", "").replace("```", "").strip()
    data = json.loads(raw)  # 실패하면 호출부 except가 처리
    username = (data.get("username") or "").strip() or ("viewer_" + rand_digits(4))
    comment = (data.get("comment") or "").strip()
    if not comment:
        raise ValueError("empty comment")
    return username, comment


def dedupe_author(username, used, existing_authors):
    base = username
    name = username
    while name.lower() in used or name.lower() in existing_authors:
        name = base + rand_digits(2)
    used.add(name.lower())
    return name


def main():
    random.seed()
    if MAX_JITTER_SEC > 0:
        j = random.randint(0, MAX_JITTER_SEC)
        log(f"⏳ jitter {j}s")
        time.sleep(j)

    log("===== comment bot 시작 =====")
    cams = fetch_top_cams()
    log(f"📂 상위 {TOP_N}위 라이브 캠 {len(cams)}개 조회")
    if not cams:
        log("대상 캠 없음 — 종료")
        return

    n = min(BOTS_PER_RUN, len(cams))
    picked_cams = random.sample(cams, n)            # 중복 없이 n개 캠
    picked_bots = random.sample(BOTS, len(BOTS))[:n]  # 봇도 섞어서 n명 (각자 다른 캠)

    used_names = set()
    inserted = 0
    for cam, bot in zip(picked_cams, picked_bots):
        language = weighted(LANG_W)
        rating = weighted(bot["rating_w"])
        title = (cam.get("title") or "")[:42]
        existing = fetch_context_reviews(cam["video_id"])

        try:
            username, comment = gen_comment(cam, bot, language, rating, existing)
        except Exception as e:
            log(f"  ⚠️ [{bot['label']}] 생성/파싱 실패 — 건너뜀 ({e})")
            continue

        existing_authors = set((r.get("author") or "").lower() for r in existing)
        username = dedupe_author(username, used_names, existing_authors)
        content = comment

        row = {
            "content_id": cam["video_id"],
            "author": username,
            "password": rand_password(),
            "content": content,
            "rating": rating,
        }
        try:
            supabase.table("reviews").insert([row]).execute()
            inserted += 1
            log(f"  ✅ [{bot['label']}/{language}/{rating}★] @{username} → {title}")
            log(f"      {content}")
        except Exception as e:
            log(f"  ❌ insert 실패 ({e})")

    log(f"🎉 완료: {inserted}개 등록")


if __name__ == "__main__":
    main()
