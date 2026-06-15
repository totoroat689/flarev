# ============================================
# Flare(V) ITS CCTV 연결 테스트  (cctv_test.py)
# 버전: 0.1 (테스트 전용)  /  수정일: 2026-06-15
# 목적: GitHub Actions(서버)에서 국가교통정보센터(ITS) CCTV API가
#       - 연결되는지
#       - 어떤 데이터(좌표·이름·영상주소)가 오는지
#       만 확인. Supabase 저장 없음. 로그로만 출력.
# 실행: GitHub Actions에서 수동 실행 → 로그 확인
# ============================================

import os
import json
import urllib.request
import urllib.parse
import ssl

API_KEY = os.environ["ITS_KEY"]

# 9000 포트가 막히는 경우를 대비해 http/https 둘 다 시도
BASES = [
    "https://openapi.its.go.kr:9000/cctvInfo",
    "http://openapi.its.go.kr:9000/cctvInfo",
]

# 작은 영역(서울 도심 일부)으로 가볍게 테스트
PARAMS = {
    "apiKey": API_KEY,
    "type": "ex",        # ex: 고속도로 / its: 국도
    "cctvType": "4",     # 4: 실시간 스트리밍(HLS, HTTPS)
    "minX": "126.95",
    "maxX": "127.10",
    "minY": "37.50",
    "maxY": "37.60",
    "getType": "json",
}

# SSL 인증서 검증 완화(테스트용)
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def try_fetch(base):
    url = base + "?" + urllib.parse.urlencode(PARAMS)
    print(f"\n📡 요청: {base}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FlareV/0.1"})
        with urllib.request.urlopen(req, timeout=30, context=CTX) as res:
            raw = res.read().decode("utf-8", errors="replace")
        print(f"  ✅ 연결 성공 (응답 길이: {len(raw)} 글자)")
        return raw
    except Exception as e:
        print(f"  ❌ 실패: {type(e).__name__} - {e}")
        return None


def main():
    print("🎥 ITS CCTV 연결 테스트 시작")
    print("=" * 50)

    raw = None
    for base in BASES:
        raw = try_fetch(base)
        if raw:
            break

    if not raw:
        print("\n⚠️ 두 방식 모두 연결 실패. 서버에서도 막히는 듯합니다.")
        print("   → 다른 경로(공공데이터포털 버전 등)를 찾아야 합니다.")
        return

    # JSON 파싱 시도
    print("\n--- 응답 분석 ---")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("  JSON이 아님. 앞부분 미리보기:")
        print("  " + raw[:500])
        return

    # ITS 응답 구조: response > data (목록)
    items = []
    if isinstance(data, dict):
        resp = data.get("response", data)
        items = resp.get("data") or resp.get("datas") or []
        if isinstance(items, dict):
            items = [items]

    print(f"  📦 받아온 CCTV 개수: {len(items)}")

    # 앞 3개만 핵심 필드 출력
    for i, it in enumerate(items[:3]):
        print(f"\n  [{i+1}]")
        print(f"     이름(cctvname): {it.get('cctvname')}")
        print(f"     좌표: x={it.get('coordx')}, y={it.get('coordy')}")
        url = str(it.get("cctvurl", ""))
        print(f"     영상주소(cctvurl): {url[:90]}...")
        print(f"     형식: type={it.get('cctvtype')} format={it.get('cctvformat')}")

    if items:
        print("\n🎉 성공! 서버에서 CCTV 데이터를 받아옵니다.")
        print("   → 다음 단계: 전국 수집 + Supabase 저장 + 지도 핀")
    else:
        print("\n⚠️ 연결은 됐지만 이 영역에 CCTV가 0개. 영역/타입을 바꿔 재시도 필요.")


if __name__ == "__main__":
    main()
