# manual_add.py
# 유튜브 라이브 링크를 직접 넣어 등록하는 "수동 추가" 스크립트.
#  - GitHub Actions(manual_add.yml)의 입력칸(MANUAL_URLS)으로 실행
#  - 자동 수집기의 "검색" 단계만 "URL -> video_id"로 바꾸고,
#    상세조회 / 거르기 / Claude 정제 / slug / 저장은 youtube_live_collector 함수를 그대로 재사용
#  - "지금 라이브 중"인 영상만 등록 (콜렉터의 filter_and_sort 규칙과 동일)
#  - source="manual"로 저장해 자동 수집분과 구분

import os
import re
import time

# 콜렉터의 검증된 함수들을 그대로 재사용 (동작/결과가 자동 수집과 동일)
from youtube_live_collector import (
    supabase,
    fetch_video_details,
    filter_and_sort,
    refine_with_claude,
    assign_slugs,
    log,
    MAX_TO_REFINE,
)

# 다양한 유튜브 URL 형태에서 11자리 video_id 추출
#  https://www.youtube.com/watch?v=ID , https://youtu.be/ID ,
#  https://www.youtube.com/live/ID , /embed/ID , /shorts/ID , 또는 ID 그 자체
_VID_RE = re.compile(r"(?:v=|/live/|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})")
_BARE_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_ids(text):
    """공백/쉼표/줄바꿈으로 구분된 입력에서 video_id 목록을 순서 유지하며 중복 없이 추출."""
    ids, seen = [], set()
    for token in re.split(r"[\s,]+", (text or "").strip()):
        if not token:
            continue
        m = _VID_RE.search(token)
        vid = m.group(1) if m else (token if _BARE_RE.match(token) else None)
        if vid and vid not in seen:
            seen.add(vid)
            ids.append(vid)
    return ids


def save_manual(rows):
    """콜렉터 save_rows와 동일한 필드로 저장하되 source='manual'로 표시."""
    if not rows:
        log("저장할 항목 없음")
        return 0
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
            "source": "manual",
        })
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
    return saved


def main():
    t0 = time.time()
    log("===== 수동 추가 시작 =====")

    raw = os.environ.get("MANUAL_URLS", "")
    ids = extract_ids(raw)
    if not ids:
        log("입력에서 유효한 유튜브 링크/ID를 찾지 못했습니다 — 종료")
        return
    log(f"🔗 입력에서 {len(ids)}개 ID 추출: {', '.join(ids)}")

    # 기존 등록 목록 (신규만 정제 + slug 중복 방지)
    existing, existing_slugs = set(), set()
    try:
        res = supabase.table("live_videos").select("video_id, slug").execute()
        for row in (res.data or []):
            if row.get("video_id"):
                existing.add(row["video_id"])
            if row.get("slug"):
                existing_slugs.add(row["slug"])
    except Exception as e:
        log(f"기존 목록 조회 오류: {e}")
    log(f"📂 기존 등록 {len(existing)}개")

    # 상세 정보 받기
    details = fetch_video_details(ids)
    found = {it.get("id") for it in details}

    # 링크별 결과 안내 (왜 빠졌는지 알 수 있게)
    for vid in ids:
        if vid not in found:
            log(f"  ⚠️ {vid}: 영상을 찾을 수 없음 (삭제/비공개/잘못된 링크)")
    for it in details:
        vid = it.get("id")
        snip = it.get("snippet", {})
        status = it.get("status", {})
        if vid in existing:
            log(f"  ↩️ {vid}: 이미 등록됨 — 건너뜀")
        elif snip.get("liveBroadcastContent") != "live":
            log(f"  ⏹️ {vid}: 지금 라이브 아님 — 건너뜀")
        elif not status.get("embeddable", False):
            log(f"  🚫 {vid}: 외부재생 불가 — 건너뜀")

    # 라이브 + 신규 + 외부재생 가능만 통과 (콜렉터 규칙 그대로)
    candidates = filter_and_sort(details, existing)
    candidates = candidates[:MAX_TO_REFINE]
    if not candidates:
        log("등록할 새 라이브가 없습니다 — 종료")
        return

    log("[정제] Claude로 위치/종류/소개 정제")
    rows = refine_with_claude(candidates)
    assign_slugs(rows, existing_slugs)

    log("[저장]")
    n = save_manual(rows)
    log(f"🎉 수동 추가 완료: {n}개 등록 (총 {int(time.time()-t0)}초)")


if __name__ == "__main__":
    main()
