# ============================================
# Flare[V] 유튜브 라이브 상태 점검기  (youtube_live_checker.py)
# 버전: 1.2  /  수정일: 2026-06-25  (보안: service_role 전환 + 1000행 한도 해결 + 바뀐 칸만 갱신)
# 역할: live_videos(is_active=true)의 영상들이 지금도 방송 중인지 주기적으로 확인.
#       - 방송 중      → is_live=true,  last_live_at=지금
#       - 꺼짐/없음     → is_live=false (핀은 회색으로 표시됨, 숨기지 않음)
#       - 30일 넘게 한 번도 안 켜짐 → is_active=false 로 숨김 (삭제 아님)
#       - 함께 view_count / like_count / concurrent_viewers 를 최신값으로 갱신
#         (수집할 때 한 번만 찍히면 옛날 숫자가 되므로, 나중 순위 페이지용으로 신선하게 유지)
# 실행: GitHub Actions 스케줄(30분마다) + 수동 버튼
# 비용: videos.list 는 part 개수와 무관하게 1유닛/회(50개 묶음). 통계를 같이 받아도 비용 동일.
# 메모:
#   - Supabase 쓰기는 service_role 키(Secrets의 SUPABASE_SERVICE_KEY) 사용
#     (live_videos 는 anon 에게 읽기만 허용 → 갱신은 service_role 이라야 가능)
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
# 연결 설정 (수집기와 동일: service_role 키를 Secrets 에서 꺼냄)
#   live_videos 는 anon 에게 읽기만 허용하므로, 갱신(쓰기)에는 service_role 이 필요함
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

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_all_rows(table, columns, match=None, page_size=1000):
    """Supabase 는 한 번에 최대 1000행만 주므로, 페이지를 나눠 전부 가져온다."""
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
#    - 바뀐 칸 + video_id 만 보냄 (통째로 덮어쓰지 않음 → 더 안전/가벼움)
#    - 대상 행은 이미 존재하므로 video_id 충돌 시 UPDATE 로 처리됨
# ============================================
def save_rows(rows):
    if not rows:
        return
    for i in range(0, len(rows), 100):
        chunk = rows[i:i + 100]
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
    # 활성(지도에 떠 있는) 라이브 전부 불러오기 (1000개 넘어도 전부)
    try:
        rows = fetch_all_rows("live_videos", "*", match={"is_active": True})
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

        # 바뀐 칸 + video_id 만 담는다 (통째로 덮어쓰지 않음)
        upd = {"video_id": vid, "last_checked_at": now}

        if data is None:
            # 유튜브에 없음(삭제/비공개) → 꺼짐 처리, 통계는 기존 값 유지
            live_now = False
            n_missing += 1
        else:
            live_now = data["live"]
            upd["view_count"] = data["views"]
            upd["like_count"] = data["likes"]
            upd["concurrent_viewers"] = data["concurrent"] if live_now else 0

        upd["is_live"] = live_now

        if live_now:
            upd["last_live_at"] = now
            n_live += 1
        else:
            n_off += 1
            last = parse_dt(r.get("last_live_at")) or parse_dt(r.get("created_at"))
            if last is not None and last < cutoff:
                upd["is_active"] = False
                n_hidden += 1

        changed.append(upd)

    save_rows(changed)

    print(
        f"✅ 라이브 {n_live} / 꺼짐 {n_off}"
        f" (유튜브에 없음 {n_missing} 포함) / 이번에 숨김 {n_hidden}"
    )
    print("🎉 완료")


if __name__ == "__main__":
    main()
