# ============================================
# Flare(V) 정제 엔진  (refiner.py)
# 버전: 1.0  /  수정일: 2026-06-04
# 수정사항:
#   - Colab 노트북(블록2~7-B)을 단일 .py 파일로 정리
#   - API 키를 코드에서 제거 → GitHub Secrets(환경변수)에서 읽도록 변경
#   - 함수 정의를 먼저, 실제 실행(main)을 맨 아래로 재배치
#   - "사람 중간 확인" 단계 제거: 7-A 미리보기는 로그로만 남기고
#     7-B 저장을 자동 실행 (자동화용)
# 역할: raw_events(pending) → 중복 그룹핑 → 대표 선정/보완 → festivals 저장
# ============================================

import os
import json
import uuid
from datetime import date

import requests
from supabase import create_client
import anthropic


# ============================================
# 연결 설정
# - Supabase anon 키는 공개돼도 되는 키라 코드에 그대로 둠
# - 나머지 키(구글/Claude)는 금고(Secrets)에서 꺼내옴
# ============================================

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


# ============================================
# 공통 유틸
# ============================================

def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


# ============================================
# 함수: pending 데이터 가져오기
# ============================================

def get_pending_events():
    result = supabase.table("raw_events")\
        .select("*")\
        .eq("is_processed", "pending")\
        .execute()

    events = result.data
    print(f"✅ pending 데이터 {len(events)}개 가져옴")
    return events


# ============================================
# 함수: 진행 예정 축제 가져오기 (중복 비교 대상)
# ============================================

def get_active_festivals():
    today = date.today().isoformat()

    result = supabase.table("festivals")\
        .select("*")\
        .gte("date_end", today)\
        .execute()

    festivals = result.data
    print(f"✅ 진행 예정 축제 {len(festivals)}개 가져옴 (오늘 이후 종료)")
    return festivals


# ============================================
# 함수: 중복 판단 (Claude AI 그룹핑)
# ============================================

def group_duplicates(pending, active):
    items = []

    for e in pending:
        items.append({
            "id": e["id"],
            "source": "pending",
            "title": e.get("title", ""),
            "location_name": e.get("location_name", ""),
            "date_start": e.get("date_start", ""),
            "date_end": e.get("date_end", "")
        })

    for f in active:
        items.append({
            "id": f["id"],
            "source": "festival",
            "title": f.get("title", ""),
            "location_name": f.get("location_name", ""),
            "date_start": f.get("date_start", ""),
            "date_end": f.get("date_end", "")
        })

    id_to_title = {item["id"]: item["title"] for item in items}

    prompt = f"""
아래는 축제 데이터 목록입니다.
같은 축제끼리 그룹으로 묶어주세요.

판단 기준:
- 축제 이름이 유사하고
- 개최 장소가 유사하고
- 날짜가 겹치거나 비슷하면 같은 축제입니다
- 이름이 같아도 개최 연도나 월이 다르면 다른 축제입니다

축제 목록:
{json.dumps(items, ensure_ascii=False, indent=2)}

응답 형식 (JSON만 반환, 설명 없음):
[
  {{"ids": [1, 2, 3]}},
  {{"ids": [4]}}
]

- 중복 없는 단독 축제도 반드시 포함
- id는 위 목록의 id를 그대로 사용
"""

    response = claude.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )

    result_text = response.content[0].text.strip()
    result_text = result_text.replace("```json", "").replace("```", "").strip()
    groups = json.loads(result_text)

    id_to_group = {}
    for group in groups:
        new_group_id = str(uuid.uuid4())[:8]
        for item_id in group["ids"]:
            id_to_group[item_id] = new_group_id

    print(f"✅ 총 {len(groups)}개 그룹 생성")
    print(f"   중복 그룹: {sum(1 for g in groups if len(g['ids']) > 1)}개")
    print(f"   단독 축제: {sum(1 for g in groups if len(g['ids']) == 1)}개")

    return groups, id_to_group, id_to_title


# ============================================
# 함수: 대표 선정 + 빈칸 채우기
# ============================================

FILL_COLUMNS = [
    "title", "description", "location_name", "address",
    "latitude", "longitude", "date_start", "date_end",
    "tags", "source_url"
]


def build_representative(group, id_to_data):
    ids = group["ids"]
    members = [id_to_data[i] for i in ids if i in id_to_data]
    members.sort(key=lambda x: x.get("confidence_score") or 0, reverse=True)
    representative = dict(members[0])

    for col in FILL_COLUMNS:
        if is_empty(representative.get(col)):
            for member in members[1:]:
                if not is_empty(member.get(col)):
                    representative[col] = member[col]
                    break

    return representative, members


# ============================================
# 함수: 좌표 보완 + 지도표시 결정
# ============================================

def get_coordinates(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": address, "key": GOOGLE_API_KEY}
    try:
        r = requests.get(url, params=params)
        data = r.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
    except Exception:
        pass
    return None, None


def enrich(rep):
    log = []

    # 1. 좌표 없는데 장소 있으면 → 구글 API로 변환
    if is_empty(rep.get("latitude")) or is_empty(rep.get("longitude")):
        addr = rep.get("location_name") or rep.get("address")
        if not is_empty(addr):
            lat, lng = get_coordinates(addr)
            if lat is not None:
                rep["latitude"] = lat
                rep["longitude"] = lng
                log.append("좌표 채움")

    # 2. 지도 표시 결정 (좌표 있으면 표시)
    has_coord = not is_empty(rep.get("latitude")) and not is_empty(rep.get("longitude"))
    rep["is_active"] = has_coord

    # 3. 날짜 없으면 표시용 기록만 (값은 그대로 비워둠)
    no_date = is_empty(rep.get("date_start"))

    return rep, log, has_coord, no_date


# ============================================
# 함수: festivals 저장용 컬럼만 추리기
# ============================================

FESTIVAL_COLUMNS = [
    "title", "description", "location_name", "address",
    "latitude", "longitude", "date_start", "date_end",
    "tags", "source_url", "confidence_score",
    "is_active"
]


def clean_for_festival(rep):
    clean = {}
    for col in FESTIVAL_COLUMNS:
        if col in rep:
            clean[col] = rep[col]
    return clean


# ============================================
# 메인 실행
# - 흐름: pending 조회 → 진행예정 조회 → 그룹핑 → 대표/보완
#         → 중복 제외 후 festivals 저장 + raw_events processed 처리
# ============================================

def main():
    print("🔧 Flare(V) 정제 엔진 시작!")
    print("=" * 50)

    # 1. 데이터 가져오기
    pending_events = get_pending_events()
    if not pending_events:
        print("⚠️ 처리할 pending 데이터가 없어 종료합니다.")
        return

    active_festivals = get_active_festivals()

    # id로 원본 데이터 찾기용 사전
    id_to_data = {}
    for e in pending_events:
        id_to_data[e["id"]] = e
    for f in active_festivals:
        id_to_data[f["id"]] = f

    # 2. 중복 그룹핑
    groups, id_to_group, id_to_title = group_duplicates(pending_events, active_festivals)

    # 3. 대표 선정 + 보완
    representatives = []
    enriched_list = []
    for group in groups:
        rep, members = build_representative(group, id_to_data)
        rep = dict(rep)
        rep, log, has_coord, no_date = enrich(rep)
        representatives.append({
            "rep": rep,
            "member_ids": group["ids"]
        })
        enriched_list.append(rep)

        print(f"\n📍 [{rep.get('id')}] {rep.get('title')}")
        print(f"   장소: {rep.get('location_name')}")
        print(f"   좌표: {rep.get('latitude')}, {rep.get('longitude')}")
        print(f"   날짜: {rep.get('date_start')} ~ {rep.get('date_end')}"
              + ("  ⚠️날짜 미확인" if no_date else ""))
        print(f"   처리: {', '.join(log) if log else '보완 불필요'}")
        print(f"   지도표시: {'✅ 표시' if has_coord else '❌ 제외 (좌표 없음)'}")

    # 4. 저장 대상 결정 (이미 등록된 축제가 섞인 그룹은 건너뜀)
    festival_ids = set(f["id"] for f in active_festivals)

    to_save = []
    processed_ids = []
    skipped_groups = []

    for idx, r in enumerate(representatives):
        member_ids = r["member_ids"]
        has_existing = any(mid in festival_ids for mid in member_ids)

        if has_existing:
            # 이미 등록됨 → festivals 저장 안 함, 신규 raw만 processed 처리
            new_raw_ids = [mid for mid in member_ids if mid not in festival_ids]
            processed_ids.extend(new_raw_ids)
            skipped_groups.append({
                "title": r["rep"].get("title"),
                "new_pending": new_raw_ids
            })
        else:
            # 전부 신규 → festivals에 저장
            rep = enriched_list[idx]
            to_save.append(clean_for_festival(rep))
            processed_ids.extend(member_ids)

    # 미리보기(로그로만 기록)
    print("\n" + "=" * 50)
    print("📋 저장 요약")
    print(f"   ✅ festivals에 새로 저장: {len(to_save)}개")
    print(f"   ⏭️ 이미 등록돼 건너뜀: {len(skipped_groups)}개")
    print(f"   📝 processed로 변경될 raw_events: {len(processed_ids)}개")

    # 5. 실제 저장 (사람 확인 없이 자동 실행)
    print("\n💾 저장 시작...")

    success_save = 0
    fail_save = 0
    for item in to_save:
        try:
            supabase.table("festivals").insert(item).execute()
            success_save += 1
        except Exception as e:
            fail_save += 1
            print(f"  ⚠️ 저장 실패: {item.get('title')} → {e}")

    print(f"✅ festivals 저장 완료: {success_save}개 성공, {fail_save}개 실패")

    # 6. raw_events 상태 변경 (pending → processed)
    success_update = 0
    fail_update = 0
    for raw_id in processed_ids:
        try:
            supabase.table("raw_events")\
                .update({"is_processed": "processed"})\
                .eq("id", raw_id)\
                .execute()
            success_update += 1
        except Exception as e:
            fail_update += 1
            print(f"  ⚠️ 상태변경 실패: id {raw_id} → {e}")

    print(f"✅ raw_events 상태변경 완료: {success_update}개 성공, {fail_update}개 실패")

    print("\n" + "=" * 50)
    print("🎉 정제 완료!")
    print(f"   festivals: {success_save}개 저장")
    print(f"   raw_events: {success_update}개 processed 처리")


if __name__ == "__main__":
    main()
