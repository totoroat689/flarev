# ============================================
# Flare[V] 유튜브 라이브 웹캠 수집기  (youtube_live_collector.py)
# 버전: 1.9 / 2026-06-25 (보안: service_role 키로 전환 + 1000행 한도 해결 + 친절한 키 확인)
# 역할: "webcam live" 라이브 검색 → 외부재생 가능 + 라이브 중 + 신규만 추려서
#       Claude로 위치/좌표/kind/설명/소개글/볼거리/국가를 정제(전부 영어)한 뒤 live_videos에 저장
# 변경(1.9):
#   - Supabase 연결을 anon(코드 박힘) → service_role(Secrets) 로 전환 (보안)
#   - 기존 캠 목록 조회를 페이지 나눠 읽기로 (캠 1000개 넘어도 중복체크 정상)
#   - 필수 비밀키가 없으면 친절히 알려주고 종료 (require_env)
#   - 단계마다 진행 로그를 실시간 출력 (어디까지 갔는지 눈으로 보임)
#   - 유튜브/Claude 요청에 타임아웃 + 재시도 (한 요청이 무한정 매달려 러너가 죽는 것 방지)
#   - 저장을 100개씩 분할 (큰 한 방 저장이 멈추는 것 방지)
# 변경(1.7):
#   - 상세페이지(/cam/<slug>/)용 필드 추가 생성: country, seo_intro(소개 문단),
#     seo_highlights(볼거리 목록), channel_title(채널명), slug(주소)
#   - 근거가 부족하면 억지로 지어내지 말고 빈 값으로 (가짜 정보 방지)
# 실행: 수동 (GitHub Actions의 "Run workflow" 버튼)
# 비용:
#   - 유튜브: search.list 100유닛/회, videos.list 1유닛/회(50개 묶음)
#             검색어 10개 x SEARCH_PAGES(2) = 약 2,000유닛 (하루 한도 10,000의 20%)
#   - Claude: 신규 후보만 묶어서 정제 (보통 몇 센트)
# 거르기 규칙 (Claude 쓰기 전에 먼저 걸러 비용 절약):
#   - status.embeddable = False  → 외부 사이트 재생 불가 → 제외 (검은화면 방지)
#   - liveBroadcastContent != 'live'  → 지금 라이브 아님 → 제외
#   - 이미 DB에 있는 video_id  → 제외 (중복/재정제 방지)
# 정렬: 동시시청자(concurrentViewers) 우선, 없으면 조회수(viewCount) 내림차순
# ============================================

import os
import re
import sys
import json
import time

import requests
from supabase import create_client
from anthropic import Anthropic

# ============================================
# 연결 설정
#  - Supabase 쓰기는 service_role 키 사용 (금고/Secrets에서 꺼냄, 절대 코드에 박지 않음)
#    live_videos 는 anon 에게 읽기만 허용하므로, 쓰기 작업은 service_role 이 필요함
#  - 유튜브/Claude 키도 금고(Secrets)에서 꺼냄
# ============================================
SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"


def require_env(name):
    """필수 환경변수를 친절하게 확인. 없으면 무엇이 빠졌는지 알려주고 종료."""
    val = os.environ.get(name)
    if not val:
        raise SystemExit(
            f"❌ 필수 비밀키 '{name}' 가 없습니다. "
            f"GitHub 저장소 → Settings → Secrets and variables → Actions 에 "
            f"'{name}' 를 등록했는지 확인하세요."
        )
    return val


SUPABASE_KEY = require_env("SUPABASE_SERVICE_KEY")
YOUTUBE_KEY = require_env("GOOGLE_API_KEY")
ANTHROPIC_KEY = require_env("ANTHROPIC_API_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = Anthropic(api_key=ANTHROPIC_KEY)


def fetch_all_rows(table, columns, match=None, page_size=1000):
    """Supabase 는 한 번에 최대 1000행만 주므로, 페이지를 나눠 전부 가져온다.
    match: {"컬럼": 값} 형태의 등호 필터 (선택)."""
    out = []
    start = 0
    while True:
        q = supabase.table(table).select(columns)
        if match:
            for k, v in match.items():
                q = q.eq(k, v)
        res = q.range(start, start + page_size - 1).execute()
        batch = res.data or []
        out.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return out

# 로그가 모였다가 한꺼번에 나오지 않고 실시간으로 보이게 (멈춤처럼 보이는 것 방지)
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def log(msg):
    print(msg, flush=True)


# 유튜브 요청: 타임아웃 + 재시도 (한 요청이 무한정 매달리는 것 방지)
def yt_get(url, params, tries=3):
    for attempt in range(1, tries + 1):
        try:
            r = requests.get(url, params=params, timeout=15)
            return r
        except Exception as e:
            log(f"    요청 실패({attempt}/{tries}): {e}")
            time.sleep(2 * attempt)
    return None

# ============================================
# 설정값 (여기만 바꾸면 동작 조절됨)
# ============================================
# 검색어 목록 — 여기에 추가/삭제만 하면 됨 (검색어 1개당 약 100~150유닛)
# 검색어마다 다른 웹캠이 잡혀서, 합치면 수백 개 후보가 모임
SEARCH_QUERIES = [
    #"webcam live",
    #"beach live cam",
    #"city live stream",
    "라이브 캠",
    #"live webcam 24/7",
    "resort live cam",
    "hotel live cam",
    "train live",
    #"store live",
    "camera trực tiếp",
    "กล้องวงจรปิด สด",
    "pantauan cctv langsung",
    "camera đường phố",
    "ดูสด cctv",
    "live walking",
]
SEARCH_PAGES = 2               # 검색어당 페이지 수 (1페이지=50개, 100유닛). 2 = 검색어당 약 200유닛
MAX_TO_REFINE = 500            # Claude로 정제할 최대 후보 수 (인기순 상위부터). 500=사실상 전부
CLAUDE_MODEL = "claude-sonnet-4-6"  # 위치 추론 정확도 위해 Sonnet. 더 싸게는 haiku로 교체 가능

YT_SEARCH = "https://www.googleapis.com/youtube/v3/search"
YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos"


# ============================================
# 주소(slug) 만들기: 제목 → 영어 소문자-하이픈, 중복이면 -2, -3 …
# ============================================
def slugify(text, fallback="cam"):
    s = (text or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if len(s) > 60:
        s = s[:60].rstrip("-")
    return s or fallback


def assign_slugs(rows, used):
    for r in rows:
        base = slugify(r.get("title") or r.get("place_name"))
        slug = base
        i = 2
        while slug in used:
            slug = base + "-" + str(i)
            i += 1
        used.add(slug)
        r["slug"] = slug


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
        r = yt_get(YT_SEARCH, params)
        if r is None:
            log(f"  검색 건너뜀({query}): 응답 없음")
            break
        if r.status_code != 200:
            log(f"  검색 오류({query}): {r.status_code} {r.text[:200]}")
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
    log(f"🔎 검색 시작 (검색어 {len(SEARCH_QUERIES)}개)")
    for n, q in enumerate(SEARCH_QUERIES, 1):
        got = _search_one_query(q)
        log(f"  🔎 [{n}/{len(SEARCH_QUERIES)}] '{q}' → {len(got)}개")
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
    total = (len(video_ids) + 49) // 50
    log(f"📥 상세 정보 받기 ({len(video_ids)}개, {total}묶음)")
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        params = {
            "key": YOUTUBE_KEY,
            "part": "snippet,statistics,status,liveStreamingDetails",
            "id": ",".join(chunk),
            "maxResults": 50,
        }
        r = yt_get(YT_VIDEOS, params)
        if r is None:
            log(f"  상세 건너뜀 묶음 {i//50+1}/{total}: 응답 없음")
            continue
        if r.status_code != 200:
            log(f"  상세 오류 {i//50+1}/{total}: {r.status_code} {r.text[:200]}")
            continue
        for it in r.json().get("items", []):
            rows.append(it)
        log(f"  📥 묶음 {i//50+1}/{total} 완료 (누적 {len(rows)})")
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
            "channel_title": snip.get("channelTitle", ""),
            "concurrent": concurrent,
            "views": views,
            "likes": likes,
        })

    # 인기순: 동시시청자 우선, 없으면 조회수
    kept.sort(key=lambda x: (x["concurrent"], x["views"]), reverse=True)
    print(f"✅ 거르기 후 {len(kept)}개 (외부재생 가능 + 라이브 + 신규)")
    return kept


# ============================================
# 3) Claude로 위치/좌표/kind/설명 정제 (전부 영어로 출력)
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
        "You are given a list of YouTube live videos. For each one, infer the "
        "filming location from its title/description and output ONLY a JSON array. "
        "Do not write any explanation, code block, or other text.\n\n"
        "Each element format:\n"
        "{\n"
        '  "video_id": keep the original exactly,\n'
        '  "title": a short clean English title including the place name (max 60 chars),\n'
        '  "place_name": human-readable location in English (e.g. "Hongdae, Seoul", "Kabukicho, Tokyo"),\n'
        '  "country": English country name (e.g. "United States", "Japan"),\n'
        '  "latitude": number, "longitude": number,\n'
        '  "timezone": IANA timezone (e.g. "Asia/Seoul", "Europe/Rome"),\n'
        '  "kind": one of "news" (news channel / live news broadcast), '
        '"resort" (holiday resort / ski resort / beach resort cam), '
        '"hotel" (hotel cam), "train" (train / railway / on-board or railway-station live cam), '
        'or "stream" (general scenery / city / nature webcam),\n'
        '  "description": one short English sentence (max 80 chars),\n'
        '  "seo_intro": 2-3 English sentences describing what this cam shows and where '
        "(only if the title/description give enough to say something true; otherwise \"\"),\n"
        '  "seo_highlights": array of 2-5 short English bullet strings of what viewers can see '
        '(only if you genuinely know; otherwise []),\n'
        '  "skip": true if the location cannot be determined, otherwise false\n'
        "}\n\n"
        "Important: do NOT invent facts. If the title/description do not give enough to "
        'write a truthful seo_intro or highlights, leave them empty ("" or []). '
        "If the location itself is unclear, set skip=true.\n"
        'A news-station live (e.g. 24h news channel) is kind="news"; '
        'a resort cam is kind="resort"; a hotel cam is kind="hotel"; '
        'a train / railway / station cam is kind="train"; '
        'general street/beach/nature scenery cams are kind="stream".\n\n'
        "List:\n" + json.dumps(brief, ensure_ascii=False)
    )

    msg = None
    for attempt in range(1, 4):
        try:
            msg = claude.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8000,
                messages=[{"role": "user", "content": prompt}],
                timeout=120,
            )
            break
        except Exception as e:
            log(f"    Claude 호출 실패({attempt}/3): {e}")
            time.sleep(3 * attempt)
    if msg is None:
        log("    이 배치 건너뜀 (Claude 응답 없음)")
        return []
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
        hl = p.get("seo_highlights") or []
        if not isinstance(hl, list):
            hl = []
        hl = [str(x)[:120] for x in hl][:5]
        out.append({
            "video_id": vid,
            "title": (p.get("title") or by_id[vid]["title"])[:80],
            "description": (p.get("description") or "")[:200],
            "place_name": p.get("place_name") or "",
            "country": p.get("country") or None,
            "latitude": float(lat),
            "longitude": float(lng),
            "timezone": p.get("timezone") or None,
            "kind": (p.get("kind") if p.get("kind") in ("news", "resort", "hotel", "train") else "stream"),
            "channel_id": by_id[vid]["channel_id"],
            "channel_title": by_id[vid].get("channel_title") or None,
            "seo_intro": (p.get("seo_intro") or "").strip()[:600] or None,
            "seo_highlights": hl,
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
    log(f"🤖 Claude 정제 시작 ({len(candidates)}개, {total_batches}배치)")
    for i in range(0, len(candidates), BATCH_SIZE):
        chunk = candidates[i:i + BATCH_SIZE]
        n = i // BATCH_SIZE + 1
        log(f"  🤖 정제 배치 {n}/{total_batches} ({len(chunk)}개)…")
        out.extend(_refine_batch(chunk, by_id))
        time.sleep(0.5)
    log(f"🤖 Claude 정제 후 {len(out)}개 등록 대상")
    return out


# ============================================
# 4) Supabase 저장 (바로 공개: is_active=true, is_live=true, source='auto')
# ============================================
def save_rows(rows):
    if not rows:
        log("저장할 항목 없음")
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
            "country": r.get("country"),
            "kind": r["kind"],
            "timezone": r["timezone"],
            "channel_id": r["channel_id"],
            "channel_title": r.get("channel_title"),
            "slug": r.get("slug"),
            "seo_intro": r.get("seo_intro"),
            "seo_highlights": r.get("seo_highlights", []),
            "view_count": r.get("view_count", 0),
            "like_count": r.get("like_count", 0),
            "concurrent_viewers": r.get("concurrent_viewers", 0),
            "is_live": True,
            "is_active": True,
            "source": "auto",
        })
    # video_id 중복이면 무시 (unique 제약). 100개씩 나눠 저장 (큰 한 방 멈춤 방지)
    saved = 0
    total = (len(payload) + 99) // 100
    log(f"💾 저장 시작 ({len(payload)}개, {total}묶음)")
    for i in range(0, len(payload), 100):
        part = payload[i:i + 100]
        try:
            supabase.table("live_videos").upsert(
                part, on_conflict="video_id", ignore_duplicates=True
            ).execute()
            saved += len(part)
            log(f"  💾 묶음 {i//100+1}/{total} 저장 완료 (누적 {saved})")
        except Exception as e:
            log(f"  저장 오류 묶음 {i//100+1}/{total}: {e}")
    log(f"💾 저장 끝 ({saved}개 시도, 중복은 자동 무시)")


# ============================================
# 메인
# ============================================
def main():
    t0 = time.time()
    log("===== 수집기 v1.8 시작 =====")
    # 이미 있는 video_id 모으기 (신규만 정제하려고)
    existing = set()
    existing_slugs = set()
    try:
        rows = fetch_all_rows("live_videos", "video_id, slug")
        for row in rows:
            if row.get("video_id"):
                existing.add(row["video_id"])
            if row.get("slug"):
                existing_slugs.add(row["slug"])
    except Exception as e:
        log(f"기존 목록 조회 오류: {e}")
    log(f"📂 기존 등록 {len(existing)}개")

    log("[1단계] 검색")
    ids = search_live_video_ids()
    if not ids:
        log("검색 결과 없음 — 종료")
        return

    log("[2단계] 상세 받기 + 거르기")
    details = fetch_video_details(ids)
    candidates = filter_and_sort(details, existing)
    candidates = candidates[:MAX_TO_REFINE]  # 비용 통제

    log("[3단계] Claude 정제")
    rows = refine_with_claude(candidates)
    assign_slugs(rows, existing_slugs)  # 주소(slug) 배정 (중복 방지)

    log("[4단계] 저장")
    save_rows(rows)
    log(f"🎉 완료 (총 {int(time.time()-t0)}초)")


if __name__ == "__main__":
    main()
