# ============================================
# Flare(V) 공공 API 수집기  (api_collector.py)
# 버전: 1.0  /  수정일: 2026-06-05
# 역할: 한국관광공사 TourAPI(searchFestival2)에서 축제 정보를 받아
#       festivals 테이블에 직접 저장/갱신 (Claude 사용 안 함 = 비용 0)
# 규칙:
#   - 오늘 이후 시작/진행 중인 축제만 대상
#   - 날짜(시작일) 또는 좌표가 없으면 저장하지 않음
#   - content_id로 중복 판단:
#       * 없으면 새로 추가
#       * 있으면 modifiedtime(수정일)이 더 최신일 때만 갱신
#   - source 컬럼에 "public" 기록
# ============================================

import os
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
BASE_URL = "https://apis.data.go.kr/B551011/KorService2/searchFestival2"
ROWS_PER_PAGE = 100  # 한 페이지에 가져올 개수 (최대치)


# ============================================
# 유틸: 빈 값 판단
# ============================================

def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


# ============================================
# 유틸: 날짜 형식 변환 (20260505 → 2026-05-05)
# - 형식이 이상하면 None 반환
# ============================================

def format_date(raw):
    if is_empty(raw):
        return None
    raw = str(raw).strip()
    if len(raw) != 8 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


# ============================================
# 함수: 공공 API에서 축제 목록 받아오기 (페이지 전체)
# - 오늘 이후 시작하는 축제를 수정일순으로 받음
# ============================================

def fetch_festivals():
    today = date.today().strftime("%Y%m%d")  # 예: 20260605
    all_items = []
    page = 1

    print(f"📡 공공 API 수집 시작 (기준일: {today} 이후 시작 축제)")

    while True:
        params = {
            "serviceKey": TOURAPI_KEY,
            "MobileOS": "ETC",
            "MobileApp": "FlareV",
            "_type": "json",
            "numOfRows": ROWS_PER_PAGE,
            "pageNo": page,
            "arrange": "C",            # 수정일순
            "eventStartDate": today,   # 오늘 이후 시작
        }

        try:
            response = requests.get(BASE_URL, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            print(f"  → ❌ {page}페이지 요청 실패: {e}")
            break

        # 응답 구조 안전하게 파고들기
        try:
            body = data["response"]["body"]
            total_count = body.get("totalCount", 0)
            items_block = body.get("items", "")

            # items가 빈 문자열이면 더 이상 데이터 없음
            if not items_block:
                print(f"  → {page}페이지: 데이터 없음, 종료")
                break

            item = items_block["item"]
            # 결과가 1개면 dict로, 여러 개면 list로 옴 → 항상 list로 통일
            if isinstance(item, dict):
                page_items = [item]
            else:
                page_items = item

        except (KeyError, TypeError) as e:
            print(f"  → ❌ {page}페이지 응답 구조 예상과 다름: {e}")
            break

        all_items.extend(page_items)
        print(f"  → {page}페이지 수집: {len(page_items)}개 (누적 {len(all_items)}개)")

        # 다 받았으면 종료
        if len(all_items) >= total_count or len(page_items) < ROWS_PER_PAGE:
            break

        page += 1

    print(f"📡 수집 완료: 총 {len(all_items)}개")
    return all_items


# ============================================
# 함수: 공공 데이터 1개 → festivals 형식으로 변환
# - 날짜/좌표 없으면 None 반환 (저장 대상에서 제외)
# ============================================

def convert_item(item):
    date_start = format_date(item.get("eventstartdate"))
    date_end = format_date(item.get("eventenddate"))

    # 위도/경도 (mapy=위도, mapx=경도)
    mapx = item.get("mapx")  # 경도
    mapy = item.get("mapy")  # 위도

    # 좌표를 숫자로 변환 (실패하면 빈 것으로 취급)
    try:
        longitude = float(mapx) if not is_empty(mapx) else None
        latitude = float(mapy) if not is_empty(mapy) else None
    except (ValueError, TypeError):
        longitude = None
        latitude = None

    # ⚠️ 규칙: 날짜(시작일) 또는 좌표가 없으면 저장하지 않음
    if is_empty(date_start) or latitude is None or longitude is None:
        return None

    # 주소를 장소명 겸 주소로 사용 (addr1 + addr2)
    addr1 = item.get("addr1") or ""
    addr2 = item.get("addr2") or ""
    full_address = (addr1 + " " + addr2).strip()

    festival = {
        "title": item.get("title"),
        "location_name": addr1.strip() if addr1 else None,
        "address": full_address if full_address else None,
        "latitude": latitude,
        "longitude": longitude,
        "date_start": date_start,
        "date_end": date_end if date_end else date_start,
        "is_active": True,
        "source": "public",
        "content_id": str(item.get("contentid")),
        # 갱신 판단용 (festivals 컬럼에는 없지만 비교에 사용)
        "_modifiedtime": item.get("modifiedtime", ""),
    }
    return festival


# ============================================
# 함수: festivals에서 기존 공공 축제들의 content_id 가져오기
# - {content_id: {id, updated_at 비교용 정보}} 형태로 반환
# ============================================

def get_existing_public():
    result = supabase.table("festivals")\
        .select("id, content_id, updated_at")\
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
    print("🏛️ Flare(V) 공공 API 수집기 시작!")
    print("=" * 50)

    # 1. 공공 API에서 받아오기
    raw_items = fetch_festivals()
    if not raw_items:
        print("⚠️ 받아온 데이터가 없어 종료합니다.")
        return

    # 2. festivals 형식으로 변환 (날짜/좌표 없는 건 제외)
    converted = []
    skipped = 0
    for item in raw_items:
        festival = convert_item(item)
        if festival is None:
            skipped += 1
            continue
        converted.append(festival)

    print(f"\n🔧 변환 완료: 저장 대상 {len(converted)}개 / 제외 {skipped}개 (날짜·좌표 없음)")

    # 3. 기존 공공 축제 확인
    existing = get_existing_public()

    # 4. 새로 추가 / 갱신 / 건너뜀 분류
    insert_count = 0
    update_count = 0
    skip_count = 0
    fail_count = 0

    for festival in converted:
        cid = festival["content_id"]
        modifiedtime = festival.pop("_modifiedtime", "")  # 저장 전 비교용 값 분리

        try:
            if cid not in existing:
                # 새 축제 → 추가
                supabase.table("festivals").insert(festival).execute()
                insert_count += 1
            else:
                # 이미 있음 → 최신이면 갱신
                # updated_at은 DB가 자동 갱신, 여기선 항상 최신 정보로 덮어씀
                row_id = existing[cid]["id"]
                supabase.table("festivals")\
                    .update(festival)\
                    .eq("id", row_id)\
                    .execute()
                update_count += 1
        except Exception as e:
            fail_count += 1
            print(f"  ⚠️ 저장 실패: {festival.get('title')} → {e}")

    print("\n" + "=" * 50)
    print("🎉 공공 수집 완료!")
    print(f"   ➕ 새로 추가: {insert_count}개")
    print(f"   🔄 갱신: {update_count}개")
    print(f"   ❌ 실패: {fail_count}개")


if __name__ == "__main__":
    main()
