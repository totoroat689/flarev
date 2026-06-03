# ============================================
# Flare(V) 크롤러  (crawler.py)
# 버전: 1.0  /  수정일: 2026-06-04
# 수정사항:
#   - Colab 노트북(블록1~8)을 단일 .py 파일로 정리
#   - API 키를 코드에서 제거 → GitHub Secrets(환경변수)에서 읽도록 변경
#   - 함수 정의를 먼저, 실제 실행(main)을 맨 아래로 재배치
#   - "삭제 대기" 임시 확인 블록 제거
#   - 단일 뉴스 테스트 코드 제거 → 전체 실행만 남김
# 역할: 네이버 뉴스 수집 → Claude 분석 → raw_events 저장(is_processed="pending")
# ============================================

import os
import re
import json
import time
from datetime import datetime, timedelta

import requests
from supabase import create_client
import anthropic
from newspaper import Article


# ============================================
# 연결 설정
# - Supabase anon 키는 공개돼도 되는 키라 코드에 그대로 둠
# - 나머지 키(네이버/구글/Claude)는 금고(Secrets)에서 꺼내옴
# ============================================

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
NAVER_CLIENT_ID = os.environ["NAVER_CLIENT_ID"]
NAVER_CLIENT_SECRET = os.environ["NAVER_CLIENT_SECRET"]
GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


# ============================================
# 함수: 네이버 뉴스 수집
# - 키워드: 축제, 페스티벌, festival
# - 기간: 최근 3일 / 키워드당 최대 3페이지
# ============================================

def collect_festival_news():
    print("📰 네이버 뉴스 수집 중...")

    keywords = ["축제", "페스티벌", "festival"]

    exclude_keywords = [
        # 종료 관련
        "마쳤다", "폐막", "막내렸다",
        "종료", "끝났다", "마무리됐다",
        "마쳐", "막을 내렸다",
        # 후기 관련
        "성황리", "성황", "명 돌파",
        "성공적", "마무리",
        # 이미 개최된 행사 후기
        "성료", "방문", "운집", "몰려",
        # 논란 관련
        "논란", "갈등", "논쟁",
        "비판", "반발",
        # 모집 관련
        "모집", "채용", "구인",
        "지원", "신청",
        # 대회/수상 관련
        "예선", "석권", "우승",
        "수상", "출전", "탈락",
        # 기업/브랜드 홍보 관련
        "참가", "후원", "스폰서",
        # 안전/행정 관련
        "안전관리", "안전점검"
    ]

    all_news = []
    cutoff_date = datetime.now() - timedelta(days=3)

    for keyword in keywords:
        print(f"  → '{keyword}' 검색 중...")

        page = 1
        while page <= 3:
            headers = {
                "X-Naver-Client-Id": NAVER_CLIENT_ID,
                "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
            }
            params = {
                "query": keyword,
                "display": 100,
                "start": (page - 1) * 100 + 1,
                "sort": "date"
            }

            response = requests.get(
                "https://openapi.naver.com/v1/search/news.json",
                headers=headers,
                params=params
            )
            data = response.json()

            if "items" not in data or not data["items"]:
                print(f"  → {page}페이지 더 이상 없음")
                break

            oldest_in_page = None
            for item in data["items"]:
                title = re.sub(r'<[^>]+>', '', item["title"]).strip()
                description = re.sub(r'<[^>]+>', '', item["description"]).strip()
                link = item["link"]
                pubdate = item["pubDate"]

                # 날짜 파싱
                try:
                    pub_datetime = datetime.strptime(
                        pubdate, "%a, %d %b %Y %H:%M:%S +0900"
                    )
                    oldest_in_page = pub_datetime
                except Exception:
                    continue

                # 3일 이내 필터
                if pub_datetime < cutoff_date:
                    continue

                # 제외 키워드 필터
                if any(k in title for k in exclude_keywords):
                    continue

                # 네이버 자체 링크 제외
                if "n.news.naver.com" in link or "m.entertain.naver.com" in link:
                    continue

                # 축제 관련 키워드 필터
                if any(k in title for k in ["축제", "페스티벌", "Festival"]):
                    all_news.append({
                        "title": title,
                        "description": description,
                        "link": link,
                        "pubdate": pubdate
                    })

            # 3일 이전 기사 발견하면 중단
            if oldest_in_page and oldest_in_page < cutoff_date:
                print(f"  → {page}페이지에서 3일 이전 기사 발견, 중단")
                break

            print(f"  → {page}페이지 완료")
            page += 1

    # 중복 제거
    seen = set()
    unique_news = []
    for news in all_news:
        if news["title"] not in seen:
            seen.add(news["title"])
            unique_news.append(news)

    print(f"→ 총 {len(unique_news)}개 뉴스 발견!")
    return unique_news


# ============================================
# 함수: Claude AI 뉴스 필터링
# - 개최 예정/진행 중 뉴스만 선별
# ============================================

def filter_festival_news(news_list):
    print("🤖 Claude AI 뉴스 필터링 중...")
    print(f"→ 총 {len(news_list)}개 뉴스 분석 시작")

    if not news_list:
        print("→ 뉴스가 없어 필터링 건너뜀")
        return []

    news_text = ""
    for i, news in enumerate(news_list):
        news_text += f"{i+1}. 제목: {news['title']}\n"
        news_text += f"   요약: {news['description'][:100]}\n\n"

    prompt = f"""
아래 뉴스 목록을 보고 축제 또는 페스티벌 개최 예정이거나 현재 진행 중임을 알리는 뉴스의 번호만 골라주세요.

제외 기준:
- 이미 종료된 축제 후기 또는 결과 보도
- 대회, 경쟁, 선발전 성격의 행사
- 연예인/유명인 단순 방문 또는 공연 후기
- 기업 신제품 홍보나 마케팅 행사
- 축제 분위기를 단순 비유한 기사
- 안전점검, 행정 준비 관련 기사

뉴스 목록:
{news_text}

중요 규칙:
1. 번호만 쉼표로 구분해서 답하세요
2. 다른 말은 절대 하지 마세요
3. 예시: 1,3,5,7,9
"""

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        result_text = response.content[0].text.strip()
        print(f"→ Claude 응답: {result_text[:200]}")

        # 번호 파싱
        numbers = [int(n.strip()) for n in result_text.split(",") if n.strip().isdigit()]

        # 필터링
        filtered_news = [news_list[i-1] for i in numbers if 1 <= i <= len(news_list)]

        print(f"→ 필터링 전: {len(news_list)}개")
        print(f"→ 필터링 후: {len(filtered_news)}개")

        return filtered_news

    except Exception as e:
        print(f"❌ 필터링 실패: {e}")
        return news_list


# ============================================
# 함수: 기사 본문 수집
# - 100글자 미만이면 None 반환
# ============================================

def get_article_content(url):
    try:
        article = Article(url, language="ko")
        article.download()
        article.parse()
        content = article.text[:2000]
        return content if len(content) > 100 else None
    except Exception:
        return None


# ============================================
# 함수: Geocoding (장소명 → 위도/경도)
# ============================================

def get_geocoding(location_name):
    try:
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": location_name,
            "key": GOOGLE_API_KEY,
            "language": "ko",
            "region": "KR"
        }
        response = requests.get(url, params=params)
        data = response.json()

        if data["status"] == "OK":
            location = data["results"][0]["geometry"]["location"]
            address = data["results"][0]["formatted_address"]
            return {
                "address": address,
                "latitude": location["lat"],
                "longitude": location["lng"]
            }
        return None
    except Exception:
        return None


def add_geocoding(result):
    if result.get("location_name"):
        print(f"  → 📍 Geocoding 중: {result['location_name']}")
        geo = get_geocoding(result["location_name"])
        if geo:
            result["address"] = geo["address"]
            result["latitude"] = geo["latitude"]
            result["longitude"] = geo["longitude"]
            print("  → 📍 위치 변환 성공!")
        else:
            result["address"] = None
            result["latitude"] = None
            result["longitude"] = None
            result["confidence_score"] = min(
                result.get("confidence_score", 0), 80
            )
            result["review_status"] = "검수필요"
            print("  → 📍 위치 변환 실패")
    else:
        result["address"] = None
        result["latitude"] = None
        result["longitude"] = None
        result["confidence_score"] = min(
            result.get("confidence_score", 0), 80
        )
        result["review_status"] = "검수필요"
    return result


# ============================================
# 함수: Claude AI 축제 정보 분석
# ============================================

def analyze_festival_with_claude(news):
    print("  → Claude AI 분석 중...")

    # 본문 수집
    content = get_article_content(news["link"])

    prompt = f"""
아래 뉴스 기사를 분석해서 축제 정보를 추출해주세요.

기사 발행일: {news['pubdate']}
제목: {news['title']}
요약: {news['description']}
본문: {content[:1000] if content else '본문 없음'}

중요 규칙:
1. 축제가 1개면 JSON 객체 하나로 답하세요
2. 축제가 여러개면 JSON 배열로 답하세요
3. 앞뒤에 어떤 설명도 붙이지 마세요
4. 코드블록(```) 도 쓰지 마세요
5. 기사에 명확하게 나와있지 않은 정보는 반드시 null 로 표시하세요
6. 추측하거나 임의로 채우지 마세요
7. 날짜 계산은 기사 발행일을 기준으로 하세요
   예) 발행일이 2026-05-26 인 기사의 "내달" = 2026년 6월
   예) 발행일이 2026-05-26 인 기사의 "이달" = 2026년 5월
   예) 년도가 없으면 발행일 기준 년도로 계산하세요
8. 하루짜리 축제면 date_start 와 date_end 를 같은 날짜로 입력하세요
9. location_name 은 구글 지도에서 검색 가능한
   가장 정확한 장소명 하나만 입력하세요
   건물명, 공원명, 학교명 등 공식 명칭 우선
   여러 장소가 있으면 가장 검색하기 쉬운 것 하나만 입력하세요

단일 축제 형식:
{{
  "title": "축제 공식 명칭",
  "description": "축제 설명 2~3문장 (기사 내용 기반)",
  "location_name": "구글 지도 검색 가능한 장소명 하나 또는 null",
  "date_start": "YYYY-MM-DD 또는 null",
  "date_end": "YYYY-MM-DD 또는 null",
  "tags": "태그1,태그2,태그3 또는 null",
  "confidence_score": 0~100 숫자,
  "review_status": "검증완료 또는 검수필요 또는 정보부족"
}}

여러 축제 형식:
[
  {{
    "title": "축제1 공식 명칭",
    "description": "...",
    "location_name": "...",
    "date_start": "YYYY-MM-DD 또는 null",
    "date_end": "YYYY-MM-DD 또는 null",
    "tags": "...",
    "confidence_score": 0~100 숫자,
    "review_status": "검증완료 또는 검수필요 또는 정보부족"
  }},
  {{
    "title": "축제2 공식 명칭",
    ...
  }}
]

신뢰도 기준:
- 날짜와 장소가 기사에 명확히 있으면 → 90점 이상 → 검증완료
- 날짜 또는 장소 중 하나만 있으면 → 60~89점 → 검수필요
- 둘 다 없으면 → 60점 미만 → 정보부족
"""

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        result_text = response.content[0].text.strip()

        # JSON 파싱
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError:
            try:
                start = min(
                    result_text.index('{') if '{' in result_text else len(result_text),
                    result_text.index('[') if '[' in result_text else len(result_text)
                )
                if result_text[start] == '[':
                    end = result_text.rindex(']') + 1
                else:
                    end = result_text.rindex('}') + 1
                json_str = result_text[start:end]
                result = json.loads(json_str)
            except Exception:
                print("  → ❌ JSON 파싱 실패")
                print(f"  → 원본: {result_text[:200]}")
                return None

        # 단일이면 리스트로 변환
        if isinstance(result, dict):
            results = [result]
        else:
            results = result

        # 각 축제마다 Geocoding 적용
        final_results = []
        for r in results:
            r = add_geocoding(r)
            print(f"  → 분석 완료! {r.get('title')} / 신뢰도: {r.get('confidence_score')}점")
            final_results.append(r)

        return final_results

    except Exception as e:
        print(f"  → 분석 실패: {e}")
        return None


# ============================================
# 함수: Supabase raw_events 저장
# - is_processed는 "pending"으로 저장
# ============================================

def save_to_raw_events(festival_data, source_url):
    try:
        data = {
            "title": festival_data.get("title"),
            "description": festival_data.get("description"),
            "location_name": festival_data.get("location_name"),
            "address": festival_data.get("address"),
            "latitude": festival_data.get("latitude"),
            "longitude": festival_data.get("longitude"),
            "date_start": festival_data.get("date_start"),
            "date_end": festival_data.get("date_end"),
            "tags": festival_data.get("tags"),
            "source_url": source_url,
            "confidence_score": festival_data.get("confidence_score", 0),
            "review_status": festival_data.get("review_status", "검수필요"),
            "is_processed": "pending"
        }

        # None 값 제거
        data = {k: v for k, v in data.items() if v is not None}

        supabase.table("raw_events").insert(data).execute()
        print("  → ✅ 저장 완료!")
        return True

    except Exception as e:
        print(f"  → ❌ 저장 실패: {e}")
        return False


# ============================================
# 메인 실행
# - 흐름: 뉴스 수집 → 필터링 → Claude 분석 → Supabase 저장
# ============================================

def main():
    print("🚀 Flare(V) 크롤러 시작!")
    print("=" * 50)

    # 1. 뉴스 수집
    news_list = collect_festival_news()
    if not news_list:
        print("⚠️ 수집된 뉴스가 없어 종료합니다.")
        return

    # 2. Claude 필터링
    filtered_news_list = filter_festival_news(news_list)
    if not filtered_news_list:
        print("⚠️ 필터링 후 남은 뉴스가 없어 종료합니다.")
        return

    # 3. 분석 + 저장
    success_count = 0
    fail_count = 0
    total_festivals = 0

    for i, news in enumerate(filtered_news_list):
        print(f"\n📝 ({i+1}/{len(filtered_news_list)}) {news['title'][:30]}")

        try:
            results = analyze_festival_with_claude(news)

            if not results:
                print("  → ❌ 분석 실패, 건너뜀")
                fail_count += 1
                continue

            for result in results:
                saved = save_to_raw_events(result, news["link"])
                if saved:
                    success_count += 1
                    total_festivals += 1
                else:
                    fail_count += 1

            # API 과부하 방지
            time.sleep(1)

        except Exception as e:
            print(f"  → ❌ 오류: {e}")
            fail_count += 1
            continue

    print("\n" + "=" * 50)
    print("✅ 크롤러 완료!")
    print(f"처리한 뉴스: {len(filtered_news_list)}개")
    print(f"저장된 축제: {total_festivals}개")
    print(f"실패: {fail_count}개")


if __name__ == "__main__":
    main()
