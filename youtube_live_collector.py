# ============================================
# Flare(V) 유튜브 라이브 웹캠 수집기  (youtube_live_collector.py)
# 버전: 1.5 / 2026-06-17 (resort/hotel 검색어·분류 + 좋아요/조회수/동시시청자 저장)
# 역할: "webcam live" 라이브 검색 → 외부재생 가능 + 라이브 중 + 신규만 추려서
#       Claude로 위치/좌표/카테고리/설명을 정제한 뒤 live_videos에 바로 공개 저장
# 실행: 수동 (GitHub Actions의 "Run workflow" 버튼)
# 비용:
#   - 유튜브: search.list 100유닛/회, videos.list 1유닛/회(50개 묶음)
#             SEARCH_PAGES 만큼만 검색 (기본 3페이지 = 약 300유닛, 하루 한도의 3%)
#   - Claude: 신규 후보만 1회 호출로 묶어서 정제 (보통 몇 센트)
# 거르기 규칙 (Claude 쓰기 전에 먼저 걸러 비용 절약):
#   - status.embeddable = False  → 외부 사이트 재생 불가 → 제외 (검은화면 방지)
#   - liveBroadcastContent != 'live'  → 지금 라이브 아님 → 제외
#   - 이미 DB에 있는 video_id  → 제외 (중복/재정제 방지)
# 정렬: 동시시청자(concurrentViewers) 우선, 없으면 조회수(viewCount) 내림차순
# ============================================

import os
import json
import time

import requests
from supabase import create_client
from anthropic import Anthropic

# ============================================
# 연결 설정
#  - Supabase anon 키는 공개돼도 되는 키라 코드에 그대로 둠 (다른 수집기와 동일)
#  - 유튜브/Claude 키는 금고(Secrets)에서 꺼냄
# ============================================
SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

YOUTUBE_KEY = os.environ["GOOGLE_API_KEY"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = Anthropic(api_key=ANTHROPIC_KEY)

# ============================================
# 설정값 (여기만 바꾸면 동작 조절됨)
# ============================================
# 검색어 목록 — 여기에 추가/삭제만 하면 됨 (검색어 1개당 약 100~150유닛)
# 검색어마다 다른 웹캠이 잡혀서, 합치면 수백 개 후보가 모임
SEARCH_QUERIES = [
    "webcam live",
    "live cam 4k",
    "live camera",
    "beach live cam",
    "city live stream",
    "라이브 캠",
    "실시간 라이브 캠",
    "live webcam 24/7",
    "resort live cam",
    "hotel live cam",
]
SEARCH_PAGES = 2               # 검색어당 페이지 수 (1페이지=50개, 100유닛). 2 = 검색어당 약 200유닛
MAX_TO_REFINE = 500            # Claude로 정제할 최대 후보 수 (인기순 상위부터). 500=사실상 전부
CLAUDE_MODEL = "claude-sonnet-4-6"  # 위치 추론 정확도 위해 Sonnet. 더 싸게는 haiku로 교체 가능

YT_SEARCH = "https://www.googleapis.com/youtube/v3/search"
YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos"


# ============================================
# 1) 유튜브에서 여러 검색어로 라이브 검색 → video_id 목록 (합쳐서 중복 제거)
# ============================================
def _search_one_query(query):
    """검색어 하나를 SEARCH_PAGES 만큼 페이지 넘기며 video_id 모으기"""
    ids = []
    page_token = None
    for _ in range(SEARCH_PAGES):
        params = {
            "key": YOUTUBE_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "eventType": "live",   # 지금 라이브 중인 영상만
            "order": "viewCount",  # (라이브에선 무시될 수 있어 뒤에서 다시 정렬)
            "maxResults": 50,
        }
        if page_token:
            params["pageToken"] = page_token
        r = requests.get(YT_SEARCH, params=params, timeout=20)
        if r.status_code != 200:
            print(f"  검색 오류({query}):", r.status_code, r.text[:200])
            break
        data = r.json()
        for it in data.get("items", []):
            vid = it.get("id", {}).get("videoId")
            if vid:
                ids.append(vid)
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.3)
    return ids


def search_live_video_ids():
    all_ids = []
    for q in SEARCH_QUERIES:
        got = _search_one_query(q)
        print(f"  🔎 '{q}' → {len(got)}개")
        all_ids.extend(got)
        time.sleep(0.3)
    # 중복 제거 (순서 유지)
    seen = set()
    uniq = []
    for v in all_ids:
        if v not in seen:
            seen.add(v)
            uniq.append(v)
    print(f"🔎 검색어 {len(SEARCH_QUERIES)}개 합산 → 중복 제거 후 {len(uniq)}개 영상 ID")
    return uniq


# ============================================
# 2) 영상 상세 받기 (50개씩 묶어 호출) → 거르기 + 정렬
# ============================================
def fetch_video_details(video_ids):
    rows = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        params = {
            "key": YOUTUBE_KEY,
            "part": "snippet,statistics,status,liveStreamingDetails",
            "id": ",".join(chunk),
            "maxResults": 50,
        }
        r = requests.get(YT_VIDEOS, params=params, timeout=20)
        if r.status_code != 200:
            print("상세 오류:", r.status_code, r.text[:300])
            continue
        for it in r.json().get("items", []):
            rows.append(it)
        time.sleep(0.3)
    return rows


def filter_and_sort(items, existing_ids):
    kept = []
    for it in items:
        vid = it.get("id")
        snip = it.get("snippet", {})
        status = it.get("status", {})
        stats = it.get("statistics", {})
        live = it.get("liveStreamingDetails", {})

        # 거르기 규칙
        if not vid or vid in existing_ids:
            continue
        if not status.get("embeddable", False):   # 외부 재생 불가 → 제외
            continue
        if snip.get("liveBroadcastContent") != "live":  # 지금 라이브 아님 → 제외
            continue

        concurrent = int(live.get("concurrentViewers", 0) or 0)
        views = int(stats.get("viewCount", 0) or 0)
        likes = int(stats.get("likeCount", 0) or 0)
        kept.append({
            "video_id": vid,
            "title": snip.get("title", ""),
            "description": (snip.get("description") or "")[:600],
            "channel_id": snip.get("channelId", ""),
            "concurrent": concurrent,
            "views": views,
            "likes": likes,
        })

    # 인기순: 동시시청자 우선, 없으면 조회수
    kept.sort(key=lambda x: (x["concurrent"], x["views"]), reverse=True)
    print(f"✅ 거르기 후 {len(kept)}개 (외부재생 가능 + 라이브 + 신규)")
    return kept


# ============================================
# 3) Claude로 위치/좌표/카테고리/설명 정제
#    - 20개씩 나눠서 호출 (출력이 잘리지 않게)
#    - 24시간 웹캠 여부 판단은 하지 않음 (요청대로 제외)
#    - 위치를 못 잡으면 skip=true 로 표시해 건너뜀
# ============================================
BATCH_SIZE = 20  # 한 번에 정제할 개수 (작게 나눠 JSON 잘림 방지)


def _refine_batch(chunk, by_id):
    brief = [
        {"video_id": c["video_id"], "title": c["title"], "description": c["description"][:300]}
        for c in chunk
    ]
    prompt = (
        "다음은 유튜브 라이브 영상 목록이다. 각 영상의 제목·설명을 보고 "
        "촬영 위치를 추론해 아래 JSON 배열만 출력하라. 설명/코드블록/그 외 텍스트는 절대 쓰지 말 것.\n\n"
        "각 원소 형식:\n"
        "{\n"
        '  "video_id": 원본 그대로,\n'
        '  "title": 한국어로 짧고 깔끔하게 다듬은 제목 (지명 포함, 30자 이내),\n'
        '  "place_name": 사람이 읽는 위치명 (예: "서울 홍대입구역", "일본 도쿄 가부키초"),\n'
        '  "latitude": 위도 숫자, "longitude": 경도 숫자,\n'
        '  "timezone": IANA 시간대 (예: "Asia/Seoul", "Europe/Rome"),\n'
        '  "category": ["도심","자연","바다","해외"] 중 하나,\n'
        '  "kind": one of "news" (news channel / live news broadcast), '
        '"resort" (holiday resort / ski resort / beach resort cam), '
        '"hotel" (hotel cam), or "stream" (general scenery / city / nature webcam),\n'
        '  "description": one short English sentence (max 80 chars),\n'
        '  "skip": true if the location cannot be determined, otherwise false\n'
        "}\n\n"
        "If the location is not clear, do not guess: set skip=true. "
        "A news-station live (e.g. 24h news channel) is kind=\"news\"; "
        "a resort cam is kind=\"resort\"; a hotel cam is kind=\"hotel\"; "
        "general street/beach/nature scenery cams are kind=\"stream\". "
        "Use category from [\"city\",\"nature\",\"beach\",\"overseas\"].\n\n"
        "목록:\n" + json.dumps(brief, ensure_ascii=False)
    )

    msg = claude.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
    except Exception as e:
        print("  배치 JSON 파싱 실패:", e)
        return []

    out = []
    for p in parsed:
        if p.get("skip"):
            continue
        vid = p.get("video_id")
        if not vid or vid not in by_id:
            continue
        lat, lng = p.get("latitude"), p.get("longitude")
        if lat is None or lng is None:
            continue
        out.append({
            "video_id": vid,
            "title": (p.get("title") or by_id[vid]["title"])[:80],
            "description": (p.get("description") or "")[:200],
            "place_name": p.get("place_name") or "",
            "latitude": float(lat),
            "longitude": float(lng),
            "timezone": p.get("timezone") or None,
            "category": p.get("category") or None,
            "kind": (p.get("kind") if p.get("kind") in ("news", "resort", "hotel") else "stream"),
            "channel_id": by_id[vid]["channel_id"],
            "view_count": by_id[vid].get("views", 0),
            "like_count": by_id[vid].get("likes", 0),
            "concurrent_viewers": by_id[vid].get("concurrent", 0),
        })
    return out


def refine_with_claude(candidates):
    if not candidates:
        return []
    by_id = {c["video_id"]: c for c in candidates}
    out = []
    total_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(candidates), BATCH_SIZE):
        chunk = candidates[i:i + BATCH_SIZE]
        n = i // BATCH_SIZE + 1
        print(f"  🤖 정제 배치 {n}/{total_batches} ({len(chunk)}개)…")
        out.extend(_refine_batch(chunk, by_id))
        time.sleep(0.5)
    print(f"🤖 Claude 정제 후 {len(out)}개 등록 대상")
    return out


# ============================================
# 4) Supabase 저장 (바로 공개: is_active=true, is_live=true, source='auto')
# ============================================
def save_rows(rows):
    if not rows:
        print("저장할 항목 없음")
        return
    payload = []
    for r in rows:
        payload.append({
            "video_id": r["video_id"],
            "title": r["title"],
            "description": r["description"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "place_name": r["place_name"],
            "category": r["category"],
            "kind": r["kind"],
            "timezone": r["timezone"],
            "channel_id": r["channel_id"],
            "view_count": r.get("view_count", 0),
            "like_count": r.get("like_count", 0),
            "concurrent_viewers": r.get("concurrent_viewers", 0),
            "is_live": True,
            "is_active": True,
            "source": "auto",
        })
    # video_id 중복이면 무시 (unique 제약). upsert ignore.
    try:
        supabase.table("live_videos").upsert(
            payload, on_conflict="video_id", ignore_duplicates=True
        ).execute()
        print(f"💾 {len(payload)}개 저장 시도 완료 (중복은 자동 무시)")
    except Exception as e:
        print("저장 오류:", e)


# ============================================
# 메인
# ============================================
def main():
    # 이미 있는 video_id 모으기 (신규만 정제하려고)
    existing = set()
    try:
        res = supabase.table("live_videos").select("video_id").execute()
        existing = {row["video_id"] for row in (res.data or [])}
    except Exception as e:
        print("기존 목록 조회 오류:", e)
    print(f"📂 기존 등록 {len(existing)}개")

    ids = search_live_video_ids()
    if not ids:
        print("검색 결과 없음 — 종료")
        return

    details = fetch_video_details(ids)
    candidates = filter_and_sort(details, existing)
    candidates = candidates[:MAX_TO_REFINE]  # 비용 통제

    rows = refine_with_claude(candidates)
    save_rows(rows)
    print("🎉 완료")


if __name__ == "__main__":
    main()
