# ============================================
# Flare(V) 공공 API 수집기  (api_collector.py)
# 버전: 2.0  /  수정일: 2026-06-05
# 수정사항(v1.0 → v2.0):
#   - detailCommon2 호출 추가 → 설명(description) 수집
#   - detailIntro2 호출 추가 → 요금(price)·장소명(place_name)
#     ·프로그램(program)·운영시간(play_time) 수집
#   - 대표사진(image_url)을 목록 데이터에서 저장
#   - 상세 호출 실패해도 전체가 멈추지 않도록 방어 처리
# 역할: 한국관광공사 TourAPI에서 축제 정보를 받아
#       festivals 테이블에 직접 저장/갱신 (Claude 사용 안 함 = 비용 0)
# 규칙:
#   - 오늘 이후 시작/진행 중인 축제만 대상
#   - 날짜(시작일) 또는 좌표가 없으면 저장하지 않음
#   - content_id로 중복 판단: 없으면 추가, 있으면 최신 정보로 갱신
#   - source 컬럼에 "public" 기록
# ============================================

import os
import time
from datetime import date

import requests
from supabase import create_client


# ============================================
# 연결 설정
# - Supabase anon 키는 공개돼도 되는 키라 코드에 그대로 둠
# - TourAPI 키는 금고(Secrets)에서 꺼내옴
# ============================================

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

TOURAPI_KEY = os.environ["TOURAPI_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# TourAPI 기본 정보
BASE = "https://apis.data.go.kr/B551011/KorService2"
LIST_URL = f"{BASE}/searchFestival2"      # 축제 목록
COMMON_URL = f"{BASE}/detailCommon2"       # 공통 상세 (설명·홈페이지)
INTRO_URL = f"{BASE}/detailIntro2"         # 축제 상세 (요금·장소·프로그램·시간)
ROWS_PER_PAGE = 100


# ============================================
# 유틸
# ============================================

def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def format_date(raw):
    """20260505 → 2026-05-05, 이상하면 None"""
    if is_empty(raw):
        return None
    raw = str(raw).strip()
    if len(raw) != 8 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def clean(value):
    """빈 값이면 None, 아니면 앞뒤 공백 제거한 문자열"""
    if is_empty(value):
        return None
    return str(value).strip()


# ============================================
# 함수: 공공 API에서 축제 목록 받아오기 (페이지 전체)
# ============================================

def fetch_festival_list():
    today = date.today().strftime("%Y%m%d")
    all_items = []
    page = 1

    print(f"📡 공공 API 목록 수집 시작 (기준일: {today} 이후 시작 축제)")

    while True:
        params = {
            "serviceKey": TOURAPI_KEY,
            "MobileOS": "ETC",
            "MobileApp": "FlareV",
            "_type": "json",
            "numOfRows": ROWS_PER_PAGE,
            "pageNo": page,
            "arrange": "C",
            "eventStartDate": today,
        }

        try:
            res = requests.get(LIST_URL, params=params, timeout=15)
            res.raise_for_status()
            data = res.json()
        except Exception as e:
            print(f"  → ❌ {page}페이지 요청 실패: {e}")
            break

        try:
            body = data["response"]["body"]
            total_count = body.get("totalCount", 0)
            items_block = body.get("items", "")
            if not items_block:
                print(f"  → {page}페이지: 데이터 없음, 종료")
                break
            item = items_block["item"]
            page_items = [item] if isinstance(item, dict) else item
        except (KeyError, TypeError) as e:
            print(f"  → ❌ {page}페이지 응답 구조 예상과 다름: {e}")
            break

        all_items.extend(page_items)
        print(f"  → {page}페이지 수집: {len(page_items)}개 (누적 {len(all_items)}개)")

        if len(all_items) >= total_count or len(page_items) < ROWS_PER_PAGE:
            break
        page += 1

    print(f"📡 목록 수집 완료: 총 {len(all_items)}개")
    return all_items


# ============================================
# 함수: 상세 정보 한 건 가져오기 (공통)
# - 함수 하나로 detailCommon2 / detailIntro2 둘 다 처리
# - 실패하면 빈 dict 반환 (전체 멈추지 않게)
# ============================================

def fetch_detail(url, content_id, need_type=False):
    params = {
        "serviceKey": TOURAPI_KEY,
        "MobileOS": "ETC",
        "MobileApp": "FlareV",
        "_type": "json",
        "contentId": content_id,
    }
    if need_type:
        params["contentTypeId"] = "15"  # 축제·행사

    try:
        res = requests.get(url, params=params, timeout=15)
        res.raise_for_status()
        data = res.json()
        item = data["response"]["body"]["items"]["item"]
        return item[0] if isinstance(item, list) else item
    except Exception:
        return {}


# ============================================
# 함수: 홈페이지 글자에서 URL만 뽑기
# - "공식 홈페이지 https://..." 형태 → https://...
# ============================================

def extract_url(raw):
    if is_empty(raw):
        return None
    text = str(raw)
    idx = text.find("http")
    if idx == -1:
        return None
    # http부터 첫 공백 전까지
    url = text[idx:].split()[0]
    return url


# ============================================
# 함수: 목록 1건 + 상세 → festivals 형식으로 변환
# - 날짜/좌표 없으면 None (저장 제외)
# ============================================

def build_festival(item):
    date_start = format_date(item.get("eventstartdate"))
    date_end = format_date(item.get("eventenddate"))

    mapx = item.get("mapx")  # 경도
    mapy = item.get("mapy")  # 위도
    try:
        longitude = float(mapx) if not is_empty(mapx) else None
        latitude = float(mapy) if not is_empty(mapy) else None
    except (ValueError, TypeError):
        longitude = None
        latitude = None

    # 규칙: 날짜 또는 좌표 없으면 저장 안 함
    if is_empty(date_start) or latitude is None or longitude is None:
        return None

    content_id = str(item.get("contentid"))

    # 주소 합치기
    addr1 = item.get("addr1") or ""
    addr2 = item.get("addr2") or ""
    full_address = (addr1 + " " + addr2).strip()

    # --- 상세 호출 (실패해도 빈 dict라 안전) ---
    common = fetch_detail(COMMON_URL, content_id, need_type=False)
    intro = fetch_detail(INTRO_URL, content_id, need_type=True)

    festival = {
        "title": clean(item.get("title")),
        "location_name": clean(addr1) if addr1 else None,
        "address": full_address if full_address else None,
        "latitude": latitude,
        "longitude": longitude,
        "date_start": date_start,
        "date_end": date_end if date_end else date_start,
        "is_active": True,
        "source": "public",
        "content_id": content_id,
        # 새로 추가된 6개 칸
        "image_url": clean(item.get("firstimage")),
        "description": clean(common.get("overview")),
        "price": clean(intro.get("usetimefestival")),
        "place_name": clean(intro.get("eventplace")),
        "program": clean(intro.get("program")),
        "play_time": clean(intro.get("playtime")),
    }
    return festival


# ============================================
# 함수: 기존 공공 축제 content_id 가져오기
# ============================================

def get_existing_public():
    result = supabase.table("festivals")\
        .select("id, content_id")\
        .eq("source", "public")\
        .execute()

    existing = {}
    for row in result.data:
        cid = row.get("content_id")
        if cid:
            existing[str(cid)] = row
    print(f"✅ 기존 공공 축제 {len(existing)}개 확인")
    return existing


# ============================================
# 메인 실행
# ============================================

def main():
    print("🏛️ Flare(V) 공공 API 수집기 v2.0 시작!")
    print("=" * 50)

    # 1. 목록 받기
    raw_items = fetch_festival_list()
    if not raw_items:
        print("⚠️ 받아온 데이터가 없어 종료합니다.")
        return

    # 2. 기존 공공 축제 확인
    existing = get_existing_public()

    # 3. 한 건씩 상세 채워서 저장
    print(f"\n🔧 상세 정보 수집 + 저장 시작 (총 {len(raw_items)}개)")
    print("   ※ 축제마다 상세 호출 2번씩 → 시간이 좀 걸립니다\n")

    insert_count = 0
    update_count = 0
    skip_count = 0
    fail_count = 0

    for idx, item in enumerate(raw_items):
        festival = build_festival(item)

        # 날짜·좌표 없어서 제외
        if festival is None:
            skip_count += 1
            continue

        cid = festival["content_id"]
        title = festival.get("title")

        try:
            if cid not in existing:
                supabase.table("festivals").insert(festival).execute()
                insert_count += 1
                print(f"  ➕ ({idx+1}/{len(raw_items)}) 추가: {title}")
            else:
                row_id = existing[cid]["id"]
                supabase.table("festivals")\
                    .update(festival)\
                    .eq("id", row_id)\
                    .execute()
                update_count += 1
                print(f"  🔄 ({idx+1}/{len(raw_items)}) 갱신: {title}")
        except Exception as e:
            fail_count += 1
            print(f"  ⚠️ ({idx+1}/{len(raw_items)}) 저장 실패: {title} → {e}")

        # API 과부하 방지 (살짝 쉬기)
        time.sleep(0.3)

    print("\n" + "=" * 50)
    print("🎉 공공 수집 완료!")
    print(f"   ➕ 새로 추가: {insert_count}개")
    print(f"   🔄 갱신: {update_count}개")
    print(f"   ⏭️ 제외(날짜·좌표 없음): {skip_count}개")
    print(f"   ❌ 실패: {fail_count}개")


if __name__ == "__main__":
    main()
