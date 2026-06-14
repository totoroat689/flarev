# ============================================
# Flare(V) KOPIS 공연 수집기  (kopis_collector.py)
# 버전: 1.0  /  수정일: 2026-06-15
# 역할: 공연예술통합전산망(KOPIS) Open API에서 공연 정보를 받아
#       performances(공연) / venues(공연장) 테이블에 저장 (Claude 사용 안 함 = 비용 0)
# 구조: venues(공연장) 1 : N performances(공연)  — 좌표는 venues에만 저장
# 규칙:
#   - 오늘 이후 공연만 대상 (과거 공연 X)
#   - KOPIS 제약: 한 번에 최대 31일 / 100건  → 월 단위로 쪼개 페이지 조회
#   - 호출 순서: 공연목록 → 공연상세(가격·공연장ID) → 공연시설상세(좌표, 처음 본 공연장만)
#   - 공연장은 한 번만 좌표를 받아 저장하고 재사용 (API 호출 절약)
#   - 좌표 없는 공연장의 공연은 저장하지 않음 (지도에 못 찍으므로)
#   - 이미 저장된 공연(content_id)은 건너뜀 → 여러 날에 나눠 이어받기 가능
#   - 하루 호출 한도(CALL_BUDGET)에 닿으면 깔끔히 멈춤
# 비고: KOPIS 응답은 XML (TourAPI는 JSON이라 파싱 방식만 다름)
# ============================================

import os
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta

import requests
from supabase import create_client


# ============================================
# 연결 설정
# - Supabase anon 키는 공개돼도 되는 키라 코드에 그대로 둠 (기존 수집기와 동일)
# - KOPIS 키는 금고(Secrets)에서 꺼내옴
# ============================================

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

KOPIS_KEY = os.environ["KOPIS_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# KOPIS 기본 정보
BASE = "http://www.kopis.or.kr/openApi/restful"
LIST_URL = f"{BASE}/pblprfr"            # 공연목록
DETAIL_URL = f"{BASE}/pblprfr"          # 공연상세: /pblprfr/{공연ID}
VENUE_URL = f"{BASE}/prfplc"            # 공연시설상세: /prfplc/{공연장ID}

ROWS_PER_PAGE = 100      # KOPIS 한 번에 최대 100건
WINDOW_DAYS = 30         # 한 조회 구간 길이 (KOPIS 최대 31일 → 안전하게 30)
MAX_WINDOWS = 12         # 오늘부터 최대 몇 개 구간(약 12개월)까지 볼지
CALL_BUDGET = 900        # 하루 호출 한도(개발키 ≈1000). 안전하게 900에서 멈춤
SLEEP_SEC = 0.2          # API 과부하 방지용 짧은 쉼

# 호출 카운터 (한도 관리)
_calls = {"n": 0}


# ============================================
# 유틸
# ============================================

def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def clean(value):
    """빈 값이면 None, 아니면 앞뒤 공백 제거한 문자열"""
    if is_empty(value):
        return None
    return str(value).strip()


def format_date(raw):
    """2026.07.03 → 2026-07-03, 이상하면 None"""
    if is_empty(raw):
        return None
    raw = str(raw).strip().replace(".", "-")
    parts = raw.split("-")
    if len(parts) != 3:
        return None
    y, m, d = parts
    if not (len(y) == 4 and y.isdigit() and m.isdigit() and d.isdigit()):
        return None
    return f"{y}-{m.zfill(2)}-{d.zfill(2)}"


def to_int(value):
    try:
        return int(str(value).strip())
    except (ValueError, TypeError, AttributeError):
        return None


def to_float(value):
    try:
        return float(str(value).strip())
    except (ValueError, TypeError, AttributeError):
        return None


def el_text(parent, tag):
    """XML 자식 태그의 텍스트 (없으면 None)"""
    if parent is None:
        return None
    child = parent.find(tag)
    if child is None:
        return None
    return clean(child.text)


def can_call():
    """남은 호출 한도가 있는지"""
    return _calls["n"] < CALL_BUDGET


def kopis_get(url, params):
    """KOPIS 호출 1회 (호출 수 +1, XML 루트 반환, 실패 시 None)"""
    _calls["n"] += 1
    try:
        res = requests.get(url, params=params, timeout=15)
        res.raise_for_status()
        return ET.fromstring(res.content)
    except Exception as e:
        print(f"    ⚠️ 호출 실패: {e}")
        return None


# ============================================
# 1단계: 공연목록 (한 구간을 페이지 넘기며 전부)
# ============================================

def fetch_list_window(stdate, eddate):
    """stdate~eddate 구간의 공연 목록(<db> 요소들)을 페이지 넘기며 모두 반환"""
    items = []
    page = 1
    while True:
        if not can_call():
            print("    ⏸️ 호출 한도 도달 — 목록 조회 중단")
            break
        params = {
            "service": KOPIS_KEY,
            "stdate": stdate,
            "eddate": eddate,
            "cpage": page,
            "rows": ROWS_PER_PAGE,
        }
        root = kopis_get(LIST_URL, params)
        if root is None:
            break
        dbs = root.findall("db")
        if not dbs:
            break  # 이 구간 더 없음
        items.extend(dbs)
        print(f"    · {stdate}~{eddate} {page}p: {len(dbs)}개 (구간누적 {len(items)})")
        if len(dbs) < ROWS_PER_PAGE:
            break  # 마지막 페이지
        page += 1
        time.sleep(SLEEP_SEC)
    return items


# ============================================
# 2단계: 공연상세 (가격·공연장ID·출연진 등)
# ============================================

def fetch_detail(content_id):
    if not can_call():
        return None
    root = kopis_get(f"{DETAIL_URL}/{content_id}", {"service": KOPIS_KEY})
    if root is None:
        return None
    return root.find("db")


# ============================================
# 3단계: 공연시설상세 (좌표) — 처음 본 공연장만
# ============================================

def fetch_venue(venue_id):
    if not can_call():
        return None
    root = kopis_get(f"{VENUE_URL}/{venue_id}", {"service": KOPIS_KEY})
    if root is None:
        return None
    return root.find("db")


# ============================================
# 기존 데이터 로드 (중복 건너뛰기 / 공연장 재사용)
# ============================================

def get_existing_performance_ids():
    result = supabase.table("performances")\
        .select("content_id")\
        .eq("source", "KOPIS")\
        .execute()
    ids = {row["content_id"] for row in result.data if row.get("content_id")}
    print(f"✅ 기존 KOPIS 공연 {len(ids)}개 확인 (건너뜀 대상)")
    return ids


def get_existing_venue_ids():
    result = supabase.table("venues").select("venue_id").execute()
    ids = {row["venue_id"] for row in result.data if row.get("venue_id")}
    print(f"✅ 기존 공연장 {len(ids)}개 확인 (재사용)")
    return ids


# ============================================
# 공연장 확보: DB에 있으면 재사용, 없으면 시설상세 호출해 저장
# 반환: True(좌표 있음, 사용 가능) / False(좌표 없음 → 공연 제외)
# ============================================

def ensure_venue(venue_id, known_good, known_bad):
    if is_empty(venue_id):
        return False
    if venue_id in known_good:
        return True
    if venue_id in known_bad:
        return False

    db = fetch_venue(venue_id)
    if db is None:
        known_bad.add(venue_id)
        return False

    lat = to_float(el_text(db, "la"))
    lng = to_float(el_text(db, "lo"))

    # 좌표 없으면 저장 안 함 (지도에 못 찍음)
    if lat is None or lng is None:
        known_bad.add(venue_id)
        print(f"      ⏭️ 공연장 좌표 없음 → 제외: {el_text(db, 'fcltynm')}")
        return False

    venue = {
        "venue_id": venue_id,
        "name": el_text(db, "fcltynm"),
        "address": el_text(db, "adres"),
        "latitude": lat,
        "longitude": lng,
        "tel": el_text(db, "telno"),
        "seat_scale": to_int(el_text(db, "seatscale")),
        "homepage": el_text(db, "relateurl"),
    }
    try:
        supabase.table("venues").upsert(venue, on_conflict="venue_id").execute()
        known_good.add(venue_id)
        print(f"      🏛️ 공연장 저장: {venue['name']}")
        return True
    except Exception as e:
        print(f"      ⚠️ 공연장 저장 실패({venue_id}): {e}")
        known_bad.add(venue_id)
        return False


# ============================================
# 목록 1건 + 상세 → performances 형식으로 변환
# ============================================

def build_performance(list_db, detail_db, venue_id):
    content_id = el_text(list_db, "mt20id")
    genre = el_text(list_db, "genrenm")

    # 예매 링크 (relates > relate > relateurl 첫 번째)
    ticket_url = None
    relates = detail_db.find("relates") if detail_db is not None else None
    if relates is not None:
        first = relates.find("relate")
        if first is not None:
            ticket_url = el_text(first, "relateurl")

    festival_flag = (el_text(detail_db, "festival") or "N").upper() == "Y"

    return {
        "content_id": content_id,
        "title": el_text(list_db, "prfnm"),
        "date_start": format_date(el_text(list_db, "prfpdfrom")),
        "date_end": format_date(el_text(list_db, "prfpdto")),
        "image_url": el_text(list_db, "poster"),
        "price": el_text(detail_db, "pcseguidance"),
        "tags": genre,          # festivals 호환용
        "genre": genre,         # 카테고리 필터용
        "place_name": el_text(list_db, "fcltynm"),
        "source": "KOPIS",
        "play_time": el_text(detail_db, "dtguidance"),
        "cast_members": el_text(detail_db, "prfcast"),
        "runtime": el_text(detail_db, "prfruntime"),
        "age_limit": el_text(detail_db, "prfage"),
        "pf_state": el_text(list_db, "prfstate"),
        "is_festival": festival_flag,
        "ticket_url": ticket_url,
        "venue_id": venue_id,
        "is_active": True,
    }


# ============================================
# 메인 실행
# ============================================

def main():
    print("🎤 Flare(V) KOPIS 공연 수집기 v1.0 시작!")
    print(f"   호출 한도: {CALL_BUDGET}회 / 구간: {WINDOW_DAYS}일 x 최대 {MAX_WINDOWS}개")
    print("=" * 50)

    existing_perf = get_existing_performance_ids()
    known_good = get_existing_venue_ids()   # 좌표 있는 공연장(DB)
    known_bad = set()                       # 이번 실행에서 좌표 없다고 확인된 공연장

    insert_count = 0
    skip_exist = 0
    skip_nocoord = 0
    fail_count = 0

    start = date.today()

    for w in range(MAX_WINDOWS):
        if not can_call():
            print("⏸️ 호출 한도 도달 — 수집 종료")
            break

        win_start = start + timedelta(days=w * (WINDOW_DAYS + 1))
        win_end = win_start + timedelta(days=WINDOW_DAYS)
        stdate = win_start.strftime("%Y%m%d")
        eddate = win_end.strftime("%Y%m%d")
        print(f"\n📡 구간 {w+1}/{MAX_WINDOWS}: {stdate} ~ {eddate}  (호출 {_calls['n']}/{CALL_BUDGET})")

        list_items = fetch_list_window(stdate, eddate)
        if not list_items:
            continue

        for list_db in list_items:
            if not can_call():
                print("    ⏸️ 호출 한도 도달 — 처리 중단")
                break

            content_id = el_text(list_db, "mt20id")
            title = el_text(list_db, "prfnm")
            if is_empty(content_id):
                continue

            # 이미 저장된 공연 → 건너뜀 (상세 호출도 안 함 = 한도 절약)
            if content_id in existing_perf:
                skip_exist += 1
                continue

            # 2단계: 상세 (가격·공연장ID)
            detail_db = fetch_detail(content_id)
            if detail_db is None:
                fail_count += 1
                continue
            venue_id = el_text(detail_db, "mt10id")

            # 3단계: 공연장 좌표 확보 (없으면 공연 제외)
            if not ensure_venue(venue_id, known_good, known_bad):
                skip_nocoord += 1
                existing_perf.add(content_id)  # 다음 실행에서 또 시도 안 하게
                continue

            # 저장
            perf = build_performance(list_db, detail_db, venue_id)
            if is_empty(perf["date_start"]):
                skip_nocoord += 1
                continue
            try:
                supabase.table("performances")\
                    .upsert(perf, on_conflict="content_id").execute()
                existing_perf.add(content_id)
                insert_count += 1
                print(f"    ➕ 저장: {title}  [{perf['genre']}]")
            except Exception as e:
                fail_count += 1
                print(f"    ⚠️ 저장 실패: {title} → {e}")

            time.sleep(SLEEP_SEC)

    print("\n" + "=" * 50)
    print("🎉 KOPIS 수집 완료!")
    print(f"   ➕ 새로 저장: {insert_count}개")
    print(f"   ⏭️ 이미 있어 건너뜀: {skip_exist}개")
    print(f"   ⏭️ 좌표 없어 제외: {skip_nocoord}개")
    print(f"   ❌ 실패: {fail_count}개")
    print(f"   📞 총 호출: {_calls['n']}/{CALL_BUDGET}회")
    if _calls["n"] >= CALL_BUDGET:
        print("   ℹ️ 한도까지 받았어요. 내일 다시 돌리면 이어서 받습니다.")


if __name__ == "__main__":
    main()
