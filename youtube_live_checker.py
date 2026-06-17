# ============================================
# Flare[V] 유튜브 라이브 상태 점검기  (youtube_live_checker.py)
# 버전: 1.1  /  수정일: 2026-06-17  (조회수/좋아요/동시접속자 통계 갱신 추가)
# 역할: live_videos(is_active=true)의 영상들이 지금도 방송 중인지 30분마다 확인.
#       - 방송 중      → is_live=true,  last_live_at=지금
#       - 꺼짐/없음     → is_live=false (핀은 회색으로 표시됨, 숨기지 않음)
#       - 30일 넘게 한 번도 안 켜짐 → is_active=false 로 숨김 (삭제 아님)
#       - 함께 view_count / like_count / concurrent_viewers 를 최신값으로 갱신
#         (수집할 때 한 번만 찍히면 옛날 숫자가 되므로, 나중 순위 페이지용으로 신선하게 유지)
# 실행: GitHub Actions 스케줄(30분마다) + 수동 버튼
# 비용: videos.list 는 part 개수와 무관하게 1유닛/회(50개 묶음). 통계를 같이 받아도 비용 동일.
# 메모:
#   - Supabase anon 키는 공개돼도 되는 키라 수집기와 동일하게 코드에 둠
#     (live_videos 테이블은 anon 에 UPDATE 권한(GRANT)이 있어 갱신 가능)
#   - 유튜브 키는 금고(Secrets)의 GOOGLE_API_KEY 사용 (수집기와 동일)
#   - '방송 중' 판정: snippet.liveBroadcastContent == 'live' 이고
#     liveStreamingDetails.actualEndTime(종료시각)이 없으면 라이브로 봄
#   - 동시접속자(concurrentViewers)는 라이브 중일 때만 값이 옴 → 꺼지면 0으로 둠
#   - 조회수/좋아요는 유튜브에서 사라진(삭제/비공개) 영상은 기존 값 유지(0으로 덮지 않음)
# ============================================

import os
import time
from datetime import datetime, timezone, timedelta

import requests
from supabase import create_client

# ============================================
# 연결 설정 (수집기와 동일)
# ============================================
SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

YOUTUBE_KEY = os.environ["GOOGLE_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ============================================
# 설정값 (여기만 바꾸면 동작 조절됨)
# ============================================
HIDE_AFTER_DAYS = 30  # 이 일수 넘게 한 번도 안 켜지면 숨김(is_active=false)

YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_dt(s):
    """ISO 문자열 → datetime(UTC). 실패하면 None."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


# ============================================
# 1) 유튜브에서 상태 + 통계 확인 (50개씩 묶어 호출)
#    반환: { video_id: {"live": bool, "views": int, "likes": int, "concurrent": int} }
#    (유튜브에 없으면 그 video_id 키 자체가 없음 → 삭제/비공개로 간주)
# ============================================
def fetch_status_and_stats(video_ids):
    info = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        params = {
            "key": YOUTUBE_KEY,
            "part": "snippet,liveStreamingDetails,statistics",
            "id": ",".join(chunk),
            "maxResults": 50,
        }
        r = requests.get(YT_VIDEOS, params=params, timeout=20)
        if r.status_code != 200:
            print("상태 조회 오류:", r.status_code, r.text[:200])
            continue
        for it in r.json().get("items", []):
            vid = it.get("id")
            snip = it.get("snippet", {})
            live = it.get("liveStreamingDetails", {})
            stats = it.get("statistics", {})
            is_live = (
                snip.get("liveBroadcastContent") == "live"
                and not live.get("actualEndTime")
            )
            info[vid] = {
                "live": bool(is_live),
                "views": int(stats.get("viewCount", 0) or 0),
                "likes": int(stats.get("likeCount", 0) or 0),
                "concurrent": int(live.get("concurrentViewers", 0) or 0),
            }
        time.sleep(0.3)
    return info


# ============================================
# 2) 변경된 행들을 Supabase에 일괄 저장
#    - 전체 행을 그대로 upsert → NOT NULL 컬럼 누락 걱정 없음
#    - 기본 키(id)는 제외(건드리지 않음), video_id 충돌 시 UPDATE
# ============================================
def save_rows(rows):
    if not rows:
        return
    payload = [{k: v for k, v in r.items() if k != "id"} for r in rows]
    for i in range(0, len(payload), 100):
        chunk = payload[i:i + 100]
        try:
            supabase.table("live_videos").upsert(
                chunk, on_conflict="video_id"
            ).execute()
        except Exception as e:
            print("저장 오류:", e)


# ============================================
# 메인
# ============================================
def main():
    # 활성(지도에 떠 있는) 라이브 전부 불러오기
    try:
        res = supabase.table("live_videos").select("*").eq("is_active", True).execute()
        rows = res.data or []
    except Exception as e:
        print("목록 조회 오류:", e)
        return

    print(f"📂 점검 대상(활성) {len(rows)}개")
    if not rows:
        print("점검할 라이브 없음 — 종료")
        return

    ids = [r["video_id"] for r in rows if r.get("video_id")]
    info = fetch_status_and_stats(ids)

    now = now_iso()
    cutoff = datetime.now(timezone.utc) - timedelta(days=HIDE_AFTER_DAYS)

    changed = []
    n_live = n_off = n_missing = n_hidden = 0

    for r in rows:
        vid = r.get("video_id")
        data = info.get(vid)

        if data is None:
            # 유튜브에 없음(삭제/비공개) → 꺼짐 처리, 통계는 기존 값 유지
            live_now = False
            n_missing += 1
        else:
            live_now = data["live"]
            # 통계 최신화 (조회수/좋아요는 항상, 동시접속자는 라이브일 때만 의미 있음)
            r["view_count"] = data["views"]
            r["like_count"] = data["likes"]
            r["concurrent_viewers"] = data["concurrent"] if live_now else 0

        r["is_live"] = live_now
        r["last_checked_at"] = now

        if live_now:
            r["last_live_at"] = now
            n_live += 1
        else:
            n_off += 1
            last = parse_dt(r.get("last_live_at")) or parse_dt(r.get("created_at"))
            if last is not None and last < cutoff:
                r["is_active"] = False
                n_hidden += 1

        changed.append(r)

    save_rows(changed)

    print(
        f"✅ 라이브 {n_live} / 꺼짐 {n_off}"
        f" (유튜브에 없음 {n_missing} 포함) / 이번에 숨김 {n_hidden}"
    )
    print("🎉 완료")


if __name__ == "__main__":
    main()
