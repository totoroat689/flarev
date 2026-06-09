// ============================================
// Supabase 연결 설정
// ============================================
const SUPABASE_URL = 'https://pbrbzjxdjqqmhvhzhwlp.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 상태 변수 ──
let festivalData = [];
let map;
let pinOverlays = []; // 핀 객체들 (필터링용)
let currentFestival = null; // 현재 열린 축제 (길찾기/검색/사진용)
// 한줄평(리뷰) 상태
let currentContentId = null; // 현재 축제의 content_id
let currentReviews = []; // 현재 축제의 한줄평 목록
let pickedRating = 0; // 쓰기 폼에서 고른 별점
let likedIds = new Set(); // 이 세션에서 좋아요한 한줄평 id
let lastReviewWrite = 0; // 한줄평 쓰기 10초 제한
let lastReviewLike = 0; // 좋아요 10초 제한
const LABEL_ZOOM = 11;

// 핀 색 변경(선택)·뭉치기용 상태
let selectedPin = null; // 현재 팝업 열린(노란) 핀
let clusterMarkers = []; // 숫자 뭉치 마커들
let expandedCluster = null; // 펼쳐진(흩어진) 뭉치
let projectionHelper = null; // 화면 좌표 계산 도우미
let FlarePinClass = null; // 핀 클래스 (지도 로드 후 정의)
let ClusterMarkerClass = null; // 뭉치 클래스 (지도 로드 후 정의)
let myLocationMarker = null; // 내 위치 파란 점
const CLUSTER_RADIUS = 48; // 이 픽셀 거리 안에 있으면 한 뭉치로 묶음
const LONG_RUNNING_DAYS = 14; // 진행중이며 기간이 이 일수 이상이면 '상시'

// 필터 상태
let activeCategories = { festival: true, spot: true };

// 스팟(사용자 명소) 상태
let spotOverlays = []; // 지도에 뜬 스팟 핀들
let spotData = []; // 불러온 스팟(게시물) 목록
let pendingLatLng = null; // 우클릭/롱프레스로 찍은 위치
let spotPhotoFiles = []; // 저장 대기 사진들 (최대 5장)
let spotMenuOpenedAt = 0; // 스팟 메뉴 연 시각(직후 클릭으로 닫힘 방지)
let currentSpot = null; // 현재 열린 스팟 팝업
const chosenSpotTags = new Set();
let lastSpotWrite = 0; // 스팟 저장 10초 제한
let SpotPinClass = null;
let dateFilter = 'week'; // 기본: 이번 주
let customRange = { start: null, end: null };

// ── 구글 지도 다크 스타일 ──
const darkStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0d0d14' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b80' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0f' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a1a2e' }],
  },
  {
    featureType: 'road',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }], // 국도/도로 라벨 숨김
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#212135' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#22223a' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#070710' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#111120' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#0e1a0e' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#141425' }],
  },
];

// ── 지도 초기화 ──
function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.5, lng: 127.8 },
    zoom: 7,
    styles: darkStyle,
    disableDefaultUI: true,
    gestureHandling: 'greedy', // 한 손가락 이동
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_CENTER,
    },
  });

  defineOverlayClasses(); // 핀·뭉치 클래스 정의 (지도 로드 후)

  // 빈 지도 클릭 → 흩어진 이름 다시 합치기 + 메뉴/팝업 닫기
  map.addListener('click', () => {
    collapseSpider();
    // 메뉴를 막 연 직후(롱프레스 직후 자동 클릭)엔 닫지 않음 → 다른 곳 누를 때 닫힘
    if (Date.now() - spotMenuOpenedAt > 500) hideSpotContextMenu();
  });
  // 지도 이동/줌이 끝나면 뭉치 다시 계산
  map.addListener('idle', recluster);
  map.addListener('zoom_changed', updatePinLabels);

  // 스팟: 지도 우클릭(PC) → 메뉴
  map.addListener('contextmenu', (e) => {
    if (!e.latLng) return;
    const de = e.domEvent;
    const rect = document
      .getElementById('map-container')
      .getBoundingClientRect();
    showSpotContextMenu(
      de.clientX - rect.left,
      de.clientY - rect.top,
      e.latLng
    );
  });
  // 스팟: 모바일 길게 누르기 → 메뉴
  setupLongPress();

  if (festivalData.length > 0) showFestivalPins();
  loadSpots(); // 스팟 불러오기
}

// ── 핀·뭉치 클래스 정의 (google.maps 로드된 뒤 실행) ──
function defineOverlayClasses() {
  // 화면 픽셀 좌표 계산용 도우미 (뭉치 거리 계산에 사용)
  class ProjectionHelper extends google.maps.OverlayView {
    onAdd() {}
    draw() {}
    onRemove() {}
    px(latLng) {
      const proj = this.getProjection();
      return proj ? proj.fromLatLngToContainerPixel(latLng) : null;
    }
    latLngAt(x, y) {
      const proj = this.getProjection();
      return proj
        ? proj.fromContainerPixelToLatLng(new google.maps.Point(x, y))
        : null;
    }
  }
  projectionHelper = new ProjectionHelper();
  projectionHelper.setMap(map);

  // 축제 핀
  FlarePinClass = class extends google.maps.OverlayView {
    constructor(festival) {
      super();
      this.festival = festival;
      this.position = new google.maps.LatLng(
        festival.latitude,
        festival.longitude
      );
      this.div = null;
      this.isOngoing = isOngoingFestival(festival); // 진행 중 여부
      this.isLong =
        this.isOngoing &&
        festivalDurationDays(festival) >= LONG_RUNNING_DAYS; // 진행중·장기(상시)
      this.isPast = isPastFestival(festival); // 지난 축제 여부
      this.passesFilter = true; // 필터 통과 여부
      this.spiderOffset = null; // 흩어질 때 위치 보정값
    }

    onAdd() {
      const div = document.createElement('div');
      div.className =
        'flare-pin' +
        (this.isOngoing ? ' ongoing' : '') +
        (this.isPast ? ' past' : '');
      div.style.position = 'absolute';
      div.style.willChange = 'transform';
      const badgeHtml = this.isOngoing
        ? this.isLong
          ? '<div class="sangsi-badge">상시</div>'
          : '<div class="now-badge">NOW</div>'
        : '';
      div.innerHTML =
        '<div class="flare-dot"></div>' +
        badgeHtml +
        '<div class="flare-label">' +
        escapeHtml(this.festival.title || '축제') +
        '</div>';

      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        selectPin(self); // 노란색으로 표시
        openFestivalPanel(self.festival);
      });

      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const point = this.getProjection().fromLatLngToDivPixel(
        this.position
      );
      if (point) {
        let x = point.x - 7;
        let y = point.y - 7;
        if (this.spiderOffset) {
          x += this.spiderOffset.dx;
          y += this.spiderOffset.dy;
        }
        this.div.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      }
    }

    setZoomed(isZoomed) {
      if (!this.div) return;
      this.div.classList.toggle('zoomed', isZoomed);
    }

    // 화면에 보일지 숨길지
    setVisible(visible) {
      if (!this.div) return;
      this.div.style.display = visible ? 'block' : 'none';
    }

    // 선택(팝업 열림) → 노란색
    setSelected(isSel) {
      if (!this.div) return;
      this.div.classList.toggle('selected', isSel);
    }

    // 흩어지기: offset 있으면 펼침, null이면 제자리
    // offset.labelLeft 가 true면 이름표를 왼쪽으로 뺌
    // animate=true 면 흩어짐/합쳐짐 순간에만 0.2초 미끄러지는 효과
    setSpider(offset, animate) {
      this.spiderOffset = offset;
      if (this.div) {
        this.div.classList.toggle('spider', !!offset);
        this.div.classList.toggle(
          'label-left',
          !!(offset && offset.labelLeft)
        );

        if (animate) {
          // 이 순간에만 부드럽게 미끄러지도록 transition 켬
          this.div.style.transition =
            'transform 0.2s cubic-bezier(0.34, 1.4, 0.6, 1)';
          // 0.2초 뒤 transition 제거 → 지도 이동 시 출렁임 방지
          clearTimeout(this._spiderTimer);
          this._spiderTimer = setTimeout(() => {
            if (this.div) this.div.style.transition = '';
          }, 220);
        }
      }
      this.draw();
    }

    onRemove() {
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
    }
  };

  // 숫자 뭉치 마커
  ClusterMarkerClass = class extends google.maps.OverlayView {
    constructor(position, members) {
      super();
      this.position = position; // 뭉치 중심 좌표
      this.members = members; // 이 뭉치에 속한 핀들
      this.div = null;
    }
    onAdd() {
      const div = document.createElement('div');
      div.className = 'flare-cluster';
      div.style.willChange = 'transform';
      div.textContent = this.members.length;
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        expandCluster(self); // 누르면 이름 흩뿌리기
      });
      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const p = this.getProjection().fromLatLngToDivPixel(this.position);
      if (p) {
        this.div.style.transform =
          'translate(' + (p.x - 18) + 'px,' + (p.y - 18) + 'px)';
      }
    }
    hide() {
      if (this.div) this.div.style.display = 'none';
    }
    show() {
      if (this.div) this.div.style.display = 'flex';
    }
    onRemove() {
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
    }
  };

  // 스팟 핀 (민트 물방울)
  SpotPinClass = class extends google.maps.OverlayView {
    constructor(post) {
      super();
      this.post = post;
      const p = post.places;
      this.position = new google.maps.LatLng(p.latitude, p.longitude);
      this.div = null;
    }
    onAdd() {
      const div = document.createElement('div');
      div.className = 'spot-pin';
      div.style.position = 'absolute';
      div.style.willChange = 'transform';
      div.innerHTML =
        '<div class="spot-drop"></div>' +
        '<div class="spot-label">' +
        escapeHtml(this.post.title || '스팟') +
        '</div>';
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openSpotPanel(self.post);
      });
      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const pt = this.getProjection().fromLatLngToDivPixel(this.position);
      if (pt) {
        this.div.style.transform =
          'translate(' + (pt.x - 8) + 'px,' + (pt.y - 16) + 'px)';
      }
    }
    setVisible(v) {
      if (this.div) this.div.style.display = v ? 'block' : 'none';
    }
    onRemove() {
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
    }
  };
}
async function loadFestivals() {
  document.getElementById('loading').style.display = 'block';

  const { data, error } = await supabaseClient
    .from('festivals')
    .select('*')
    .eq('is_active', true);

  document.getElementById('loading').style.display = 'none';

  if (error) {
    console.log('❌ 에러:', error.message);
    return;
  }

  festivalData = data;
  console.log('✅ 축제', data.length, '개 불러옴');

  if (map) showFestivalPins();
}

// ── 핀 표시 (현재 필터에 맞는 핀만 생성 → 첫 로딩 가볍게) ──
function showFestivalPins() {
  buildPinsForCurrentFilter();
}

// 현재 필터(카테고리+날짜)를 통과하는 축제인지
function passesCurrentFilter(f) {
  if (!activeCategories.festival) return false;
  return matchesDateFilter(f);
}

// 필터에 맞는 핀만 새로 생성 (나머지는 아예 안 만들어 가볍게)
function buildPinsForCurrentFilter() {
  if (!map || !FlarePinClass) return; // 지도 로드 전이면 건너뜀
  // 열린 팝업/선택 핀 정리
  closePanel();

  // 기존 핀·뭉치 모두 제거
  pinOverlays.forEach((p) => p.setMap(null));
  pinOverlays = [];
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];
  expandedCluster = null;

  let visibleCount = 0;
  festivalData.forEach((f) => {
    if (!f.latitude || !f.longitude) return;
    if (!passesCurrentFilter(f)) return;
    const pin = new FlarePinClass(f);
    pin.passesFilter = true;
    pin.setMap(map);
    pinOverlays.push(pin);
    visibleCount++;
  });

  document.getElementById('cnt-festival').textContent = visibleCount;
  updatePinLabels();
  recluster();
}

function updatePinLabels() {
  if (!map || typeof map.getZoom !== 'function') return; // 지도 로드 전 방어
  const zoomedIn = map.getZoom() >= LABEL_ZOOM;
  pinOverlays.forEach((pin) => pin.setZoomed(zoomedIn));
}

// ── 뭉치 계산: 가까운 핀끼리 묶어서 숫자로 ──
function recluster() {
  if (!projectionHelper || !projectionHelper.getProjection()) return;

  // 흩어진 상태가 있으면 먼저 제자리로
  if (expandedCluster) {
    expandedCluster.members.forEach((p) => p.setSpider(null));
    expandedCluster = null;
  }
  // 기존 숫자 뭉치 제거
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];

  // 필터 통과한 핀들의 화면 좌표 모으기
  const pts = [];
  pinOverlays.forEach((pin) => {
    if (!pin.passesFilter) return;
    const px = projectionHelper.px(pin.position);
    if (px) pts.push({ pin: pin, px: px });
  });

  // 가까운 것끼리 그룹화
  const used = new Set();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const group = [pts[i]];
    used.add(i);
    for (let j = i + 1; j < pts.length; j++) {
      if (used.has(j)) continue;
      const dx = pts[i].px.x - pts[j].px.x;
      const dy = pts[i].px.y - pts[j].px.y;
      if (Math.hypot(dx, dy) < CLUSTER_RADIUS) {
        group.push(pts[j]);
        used.add(j);
      }
    }

    if (group.length === 1) {
      // 혼자면 그냥 핀 표시
      group[0].pin.setVisible(true);
    } else {
      // 여러 개면 핀 숨기고 숫자 뭉치 생성
      let latSum = 0;
      let lngSum = 0;
      group.forEach((o) => {
        o.pin.setVisible(false);
        latSum += o.pin.position.lat();
        lngSum += o.pin.position.lng();
      });
      const center = new google.maps.LatLng(
        latSum / group.length,
        lngSum / group.length
      );
      const cm = new ClusterMarkerClass(
        center,
        group.map((o) => o.pin)
      );
      cm.setMap(map);
      clusterMarkers.push(cm);
    }
  }
}

// ── 뭉치 펼치기: 이름을 겹치지 않게 흩뿌리기 ──
// 2개=좌우, 3개=삼각형, 그 이상=다각형(골고루)
function expandCluster(cm) {
  // 다른 뭉치가 펼쳐져 있으면 즉시(애니메이션 없이) 접고 새로 펼침
  if (expandedCluster && expandedCluster !== cm) {
    const prev = expandedCluster;
    prev.members.forEach((p) => {
      p.setSpider(null);
      p.setVisible(false);
    });
    prev.show();
    expandedCluster = null;
  }

  expandedCluster = cm;
  cm.hide(); // 숫자 숨김

  const n = cm.members.length;
  // 흩어지는 거리 (이전의 절반)
  const radius = 23 + n * 5;

  // 시작 각도: 2개는 좌우(수평), 그 외는 위에서 시작
  // 수평선에 정확히 겹치지 않도록 살짝 기울임
  let startAngle;
  if (n === 2) {
    startAngle = 0; // 0도(오른쪽) / 180도(왼쪽) → 좌우 배치
  } else if (n === 3) {
    startAngle = -Math.PI / 2; // 위 꼭짓점부터 → 삼각형
  } else {
    startAngle = -Math.PI / 2 + Math.PI / n; // 다각형, 살짝 회전
  }

  // 1단계: 모든 핀을 숫자 자리(중심)에서 시작 (애니메이션 출발점)
  cm.members.forEach((pin) => {
    pin.setVisible(true);
    pin.setSpider({ dx: 0, dy: 0, labelLeft: false });
  });

  // 2단계: 다음 프레임에 각자 방향으로 퍼지기 (0.2초 애니메이션)
  requestAnimationFrame(() => {
    cm.members.forEach((pin, idx) => {
      const angle = startAngle + (2 * Math.PI * idx) / n;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      const labelLeft = dx < -2; // 왼쪽 핀은 이름표도 왼쪽으로
      pin.setSpider({ dx: dx, dy: dy, labelLeft: labelLeft }, true);
    });
  });
}

// ── 흩어진 이름 다시 합치기 (애니메이션) ──
function collapseSpider() {
  if (!expandedCluster) return;
  const cm = expandedCluster;
  expandedCluster = null; // 즉시 비워서 중복 호출 방지

  // 1단계: 핀들을 숫자 자리(중심)로 0.2초 모으기
  cm.members.forEach((pin) => {
    pin.setSpider({ dx: 0, dy: 0, labelLeft: false }, true);
  });

  // 2단계: 다 모인 뒤(0.2초) 핀 숨기고 숫자 다시 표시
  setTimeout(() => {
    cm.members.forEach((pin) => {
      pin.setSpider(null);
      pin.setVisible(false);
    });
    cm.show();
  }, 200);
}

// ── 날짜 비교 도우미 ──
function toDate(str) {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

// 축제 총 기간(일수). 시작=종료면 1일. 종료일 없으면 1일로 봄.
function festivalDurationDays(f) {
  if (!f.date_start) return 0;
  const start = toDate(f.date_start);
  const end = toDate(f.date_end) || start;
  return Math.round((end - start) / 86400000) + 1;
}

// 축제가 현재 날짜 필터에 맞는지
function matchesDateFilter(f) {
  // 날짜 없는 축제는 표시하지 않음
  if (!f.date_start) return false;

  const start = toDate(f.date_start);
  const end = toDate(f.date_end) || start;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let from, to;

  if (dateFilter === 'today') {
    from = new Date(today);
    to = new Date(today);
  } else if (dateFilter === 'week') {
    from = new Date(today);
    to = new Date(today);
    to.setDate(to.getDate() + 7);
  } else if (dateFilter === 'month') {
    from = new Date(today);
    to = new Date(today);
    to.setMonth(to.getMonth() + 1);
  } else if (dateFilter === 'custom') {
    if (!customRange.start || !customRange.end) return true;
    from = toDate(customRange.start);
    to = toDate(customRange.end);
  } else {
    return true; // 필터 없음 = 전체
  }

  // 축제 기간이 [from, to]와 겹치면 표시
  return start <= to && end >= from;
}

// ── 필터 적용: 필터가 바뀌면 해당하는 핀만 다시 생성 ──
function applyFilters() {
  buildPinsForCurrentFilter();
}

// ── HTML 태그/특수문자 정리 (설명·프로그램 등 공공 데이터용) ──
function cleanText(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n') // 줄바꿈 태그 → 실제 줄바꿈
    .replace(/<[^>]+>/g, '') // 그 외 태그 제거
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// 한 줄짜리 정보용(줄바꿈을 공백으로)
function cleanInline(s) {
  return cleanText(s).replace(/\s*\n\s*/g, ' ').trim();
}
// 이름표 등에 넣을 때 태그 깨짐 방지용 escape
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 메타 한 줄 채우기 (값 없으면 줄 숨김) ──
function setMetaRow(rowId, textId, value) {
  const row = document.getElementById(rowId);
  const txt = document.getElementById(textId);
  const v = value && String(value).trim();
  if (v) {
    txt.textContent = cleanInline(v);
    row.style.display = 'flex';
  } else {
    row.style.display = 'none';
  }
}

// ── 팝업 사진 설정 (있을 때만 표시 + 잘리는 쪽 자동 훑기) ──
function setupPanelImage(f) {
  const box = document.getElementById('panel-img');
  const img = document.getElementById('panel-img-el');

  box.classList.remove('has-photo', 'pan-v', 'pan-h');
  img.onload = null;
  img.onerror = null;

  const url = f.image_url && String(f.image_url).trim();
  if (!url) {
    img.removeAttribute('src'); // 사진 없음 → 기본 아이콘
    return;
  }

  img.onload = function () {
    box.classList.add('has-photo');
    box.classList.remove('pan-v', 'pan-h');
    const boxRatio = box.clientWidth / box.clientHeight;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    if (!imgRatio || !boxRatio) return;
    // 사진이 박스보다 옆으로 넘치면 가로 훑기, 위아래로 넘치면 세로 훑기
    if (imgRatio > boxRatio * 1.05) box.classList.add('pan-h');
    else if (imgRatio < boxRatio * 0.95) box.classList.add('pan-v');
    // 거의 같은 비율이면 움직이지 않음
  };
  img.onerror = function () {
    // 사진 로드 실패 → 기본 아이콘으로 되돌림
    box.classList.remove('has-photo', 'pan-v', 'pan-h');
    img.removeAttribute('src');
  };

  img.src = url;
  // 캐시된 이미지는 onload가 안 뜰 수 있어 보강
  if (img.complete && img.naturalWidth) img.onload();
}

// ── 사진 클릭 → 원본 새 탭 (사진 있을 때만) ──
function openPhoto() {
  const box = document.getElementById('panel-img');
  if (!box.classList.contains('has-photo')) return;
  if (currentFestival && currentFestival.image_url) {
    window.open(currentFestival.image_url, '_blank');
  }
}

// ── 설명 설정 (3줄 + 더보기) ──
function setupDescription(f) {
  const wrap = document.getElementById('panel-desc');
  const textEl = document.getElementById('panel-desc-text');
  const moreBtn = document.getElementById('panel-desc-more');

  const raw = f.description;
  if (!raw || !String(raw).trim()) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  wrap.classList.remove('expanded');
  textEl.textContent = cleanText(raw);
  moreBtn.textContent = '더보기';
  moreBtn.style.display = 'none'; // 넘칠 때만 measureDesc가 표시
}

// ── 설명이 3줄 넘는지 확인해 '더보기' 노출 (패널이 보인 뒤 측정) ──
function measureDesc() {
  const wrap = document.getElementById('panel-desc');
  if (wrap.style.display === 'none') return;
  const textEl = document.getElementById('panel-desc-text');
  const moreBtn = document.getElementById('panel-desc-more');
  wrap.classList.remove('expanded');
  const overflowing = textEl.scrollHeight > textEl.clientHeight + 2;
  moreBtn.style.display = overflowing ? 'inline-block' : 'none';
  moreBtn.textContent = '더보기';
}

function toggleDesc() {
  const wrap = document.getElementById('panel-desc');
  const moreBtn = document.getElementById('panel-desc-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? '접기' : '더보기';
}

// ── 프로그램 설정 (2줄 + 더보기) ──
function setupProgram(f) {
  const wrap = document.getElementById('panel-program');
  const body = document.getElementById('panel-program-body');
  const moreBtn = document.getElementById('panel-program-more');
  const raw = f.program;
  if (!raw || !String(raw).trim()) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  wrap.classList.remove('expanded');
  body.textContent = cleanText(raw);
  moreBtn.textContent = '더보기';
  moreBtn.style.display = 'none'; // 넘칠 때만 measureProgram이 표시
}

// ── 프로그램이 2줄 넘는지 확인해 '더보기' 노출 (패널이 보인 뒤 측정) ──
function measureProgram() {
  const wrap = document.getElementById('panel-program');
  if (wrap.style.display === 'none') return;
  const body = document.getElementById('panel-program-body');
  const moreBtn = document.getElementById('panel-program-more');
  wrap.classList.remove('expanded');
  const overflowing = body.scrollHeight > body.clientHeight + 2;
  moreBtn.style.display = overflowing ? 'inline-block' : 'none';
  moreBtn.textContent = '더보기';
}

function toggleProgram() {
  const wrap = document.getElementById('panel-program');
  const moreBtn = document.getElementById('panel-program-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? '접기' : '더보기';
}

// ── 정보 패널 열기 ──
function openFestivalPanel(f) {
  const panel = document.getElementById('info-panel');
  closeSpotPanel(); // 스팟 팝업 닫기

  // 길찾기 메뉴는 매번 닫고 시작 (다른 축제 누를 때 초기화)
  document.getElementById('map-picker').classList.remove('show');

  currentFestival = f; // 길찾기/검색/사진용 저장

  // 사진
  setupPanelImage(f);

  // 제목
  const titleEl = document.getElementById('panel-title');
  titleEl.textContent = f.title || '제목 없음';

  // 정보 줄 (없으면 자동 숨김): 📍장소 📅날짜 🕐운영시간 💰요금
  setMetaRow('row-place', 'panel-place', f.place_name || f.location_name);
  setMetaRow(
    'row-date',
    'panel-date',
    f.date_start
      ? f.date_start +
          (f.date_end && f.date_end !== f.date_start
            ? ' ~ ' + f.date_end
            : '')
      : ''
  );
  setMetaRow('row-time', 'panel-time', f.play_time);
  setMetaRow('row-price', 'panel-price', f.price);

  // 설명 / 프로그램
  setupDescription(f);
  setupProgram(f);

  // 한줄평 영역 초기화 (펼침/폼 닫고, content_id 있으면 불러오기)
  setupReviews(f);

  // 애니메이션 재생을 위해 클래스 재적용
  panel.classList.remove('show');
  void panel.offsetWidth; // 리플로우 트릭
  panel.classList.add('show');
  panel.scrollTop = 0;

  // 패널이 화면에 뜬 뒤: 제목 크기 맞춤 + 설명/프로그램 더보기 측정
  requestAnimationFrame(() => {
    fitTitle(titleEl);
    measureDesc();
    measureProgram();
  });
}

// ── 제목 길이에 따라 글자 크기 줄여 한 줄 유지 ──
function fitTitle(el) {
  const sizes = [1, 0.92, 0.85, 0.78]; // rem 단계
  // 넘치면 한 단계씩 줄임 (마지막 단계까지 넘치면 ...으로 잘림)
  for (let i = 0; i < sizes.length; i++) {
    el.style.fontSize = sizes[i] + 'rem';
    if (el.scrollWidth <= el.clientWidth) break;
  }
}

function closePanel() {
  document.getElementById('info-panel').classList.remove('show');
  document.getElementById('map-picker').classList.remove('show');
  // 노란 핀 다시 핑크로
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
}

// ── 핀 선택(노란색) 처리 ──
function selectPin(pin) {
  if (selectedPin && selectedPin !== pin) selectedPin.setSelected(false);
  selectedPin = pin;
  pin.setSelected(true);
}

// ====================================================
//  한줄평(리뷰) + 별점 시스템
// ====================================================

// ── 팝업 열 때 한줄평 영역 초기화 ──
function setupReviews(f) {
  const area = document.getElementById('panel-img');
  const talkBtn = document.getElementById('talk-btn');
  const row = document.getElementById('reaction-row');

  // 펼침/폼 상태 초기화
  area.classList.remove('reviews-open', 'form-open');
  talkBtn.classList.remove('open');
  document.getElementById('talk-label').textContent = '한줄평';

  const cid = f.content_id && String(f.content_id).trim();
  currentContentId = cid || null;
  currentReviews = [];

  if (!cid) {
    // content_id 없는 축제: 한줄평 영역 숨김
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';

  // 로딩 표시 후 비동기로 불러오기
  const box = document.getElementById('rating-box');
  box.textContent = '평가 불러오는 중…';
  box.classList.add('none');

  loadReviews(cid).then(() => {
    // 그 사이 다른 축제로 바뀌었으면 무시
    if (currentContentId !== cid) return;
    renderRatingBox();
    renderReviewList();
  });
}

// ── Supabase에서 한줄평 불러오기 (최신순) ──
async function loadReviews(contentId) {
  const { data, error } = await supabaseClient
    .from('reviews')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false });
  if (error) {
    console.log('한줄평 로드 에러:', error.message);
    currentReviews = [];
    return;
  }
  currentReviews = data || [];
}

// ── 별점 합산 표시 (조명탄 자리) ──
function renderRatingBox() {
  const box = document.getElementById('rating-box');
  if (currentReviews.length === 0) {
    box.textContent = '아직 평가 없음';
    box.classList.add('none');
    return;
  }
  box.classList.remove('none');
  const avg =
    currentReviews.reduce((s, r) => s + r.rating, 0) /
    currentReviews.length;
  box.textContent =
    '⭐ ' + avg.toFixed(1) + ' | ' + currentReviews.length + '명';
}

// ── 한줄평 목록 그리기 ──
function renderReviewList() {
  const list = document.getElementById('review-list');
  if (currentReviews.length === 0) {
    list.innerHTML = '<div class="rv-empty">한줄평이 없어요!</div>';
    return;
  }
  list.innerHTML = currentReviews
    .map((r) => {
      const stars =
        '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      const liked = likedIds.has(r.id) ? ' liked' : '';
      return (
        '<div class="review">' +
        '<div class="r-top">' +
        '<span class="r-author">' +
        escapeHtml(r.author) +
        '</span>' +
        '<span class="r-stars">' +
        stars +
        '</span>' +
        '<span class="r-date">' +
        formatReviewDate(r.created_at) +
        '</span>' +
        '</div>' +
        '<div class="r-content">' +
        escapeHtml(r.content) +
        '</div>' +
        '<div class="r-actions">' +
        '<button class="like-btn' +
        liked +
        '" onclick="likeReview(' +
        r.id +
        ')">♥ <span>' +
        r.likes +
        '</span></button>' +
        '<button class="del-btn" onclick="askDeleteReview(' +
        r.id +
        ')">🗑 삭제</button>' +
        '</div>' +
        '<div class="del-confirm" id="dc-' +
        r.id +
        '">' +
        '<input type="text" inputmode="numeric" placeholder="비밀번호" id="dcpw-' +
        r.id +
        '" />' +
        '<button class="dc-ok" onclick="doDeleteReview(' +
        r.id +
        ')">삭제</button>' +
        '<button class="dc-no" onclick="cancelDeleteReview(' +
        r.id +
        ')">취소</button>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

// 날짜 표시: 'YYYY-MM-DD...' → 'MM/DD'
function formatReviewDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return m + '/' + day;
}

// ── 한줄평 펼치기/닫기 ──
function toggleReviews() {
  const area = document.getElementById('panel-img');
  const btn = document.getElementById('talk-btn');
  const label = document.getElementById('talk-label');
  const open = !area.classList.contains('reviews-open');
  closeReviewForm();
  area.classList.toggle('reviews-open', open);
  btn.classList.toggle('open', open);
  label.textContent = open ? '한줄평 닫기' : '한줄평';
  if (open) renderReviewList();
}

// ── 좋아요 (세션 중복 방지 + 10초 제한) ──
async function likeReview(id) {
  if (likedIds.has(id)) {
    toast('이미 좋아요한 한줄평이에요');
    return;
  }
  const now = Date.now();
  if (now - lastReviewLike < 10000) {
    toast('좋아요는 10초에 한 번만 가능해요');
    return;
  }
  const r = currentReviews.find((x) => x.id === id);
  if (!r) return;
  const newLikes = (r.likes || 0) + 1;
  const { error } = await supabaseClient
    .from('reviews')
    .update({ likes: newLikes })
    .eq('id', id);
  if (error) {
    toast('잠시 후 다시 시도해주세요');
    return;
  }
  r.likes = newLikes;
  likedIds.add(id);
  lastReviewLike = now;
  renderReviewList();
}

// ── 삭제: 비밀번호 입력 칸 펼치기 ──
function askDeleteReview(id) {
  document
    .querySelectorAll('.del-confirm')
    .forEach((e) => e.classList.remove('show'));
  const el = document.getElementById('dc-' + id);
  if (el) el.classList.add('show');
}
function cancelDeleteReview(id) {
  const el = document.getElementById('dc-' + id);
  if (el) el.classList.remove('show');
}

// ── 삭제 실행 (비밀번호 일치 시에만) ──
async function doDeleteReview(id) {
  const input = document.getElementById('dcpw-' + id);
  const pw = input ? input.value.trim() : '';
  if (!pw) {
    toast('비밀번호를 입력해주세요');
    return;
  }
  // 비밀번호 일치하는 행만 삭제 → 삭제된 행이 0이면 비번 불일치
  const { data, error } = await supabaseClient
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('password', pw)
    .select();
  if (error) {
    toast('잠시 후 다시 시도해주세요');
    return;
  }
  if (!data || data.length === 0) {
    toast('비밀번호가 달라요');
    return;
  }
  currentReviews = currentReviews.filter((x) => x.id !== id);
  renderReviewList();
  renderRatingBox();
}

// ── 쓰기 폼 ──
function openReviewForm() {
  document.getElementById('panel-img').classList.add('form-open');
  document.getElementById('rv-author').value = '';
  document.getElementById('rv-pw').value = '';
  document.getElementById('rv-content').value = '';
  document.getElementById('rv-form-msg').textContent = '';
  pickedRating = 0;
  paintStars(0);
}
function closeReviewForm() {
  document.getElementById('panel-img').classList.remove('form-open');
}

function paintStars(n) {
  document.querySelectorAll('#star-pick span').forEach((s) => {
    s.classList.toggle('on', Number(s.dataset.v) <= n);
  });
}

// ── 한줄평 등록 ──
async function submitReview() {
  const author = document.getElementById('rv-author').value.trim();
  const pw = document.getElementById('rv-pw').value.trim();
  const content = document.getElementById('rv-content').value.trim();
  const msg = document.getElementById('rv-form-msg');

  if (!currentContentId) return;
  if (!author) {
    msg.textContent = '아이디를 입력해주세요';
    return;
  }
  if (!pw) {
    msg.textContent = '비밀번호를 입력해주세요';
    return;
  }
  if (pickedRating === 0) {
    msg.textContent = '별점을 선택해주세요';
    return;
  }
  if (!content) {
    msg.textContent = '한줄평을 입력해주세요';
    return;
  }

  const now = Date.now();
  if (now - lastReviewWrite < 10000) {
    msg.textContent = '10초 후에 다시 작성할 수 있어요';
    return;
  }

  const { data, error } = await supabaseClient
    .from('reviews')
    .insert([
      {
        content_id: currentContentId,
        author: author,
        password: pw,
        content: content,
        rating: pickedRating,
      },
    ])
    .select();

  if (error) {
    console.log('한줄평 등록 에러:', error.message);
    msg.textContent = '등록에 실패했어요. 잠시 후 다시 시도해주세요.';
    return;
  }

  lastReviewWrite = now;
  if (data && data[0]) currentReviews.unshift(data[0]);
  closeReviewForm();
  renderReviewList();
  renderRatingBox();
}

// ── 작은 알림 토스트 ──
function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
    'background:#222;color:#fff;padding:8px 14px;border-radius:20px;' +
    'font-size:0.74rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ── 제목 옆 링크: 구글에 축제명 검색 ──
function searchFestival() {
  if (!currentFestival) return;
  const f = currentFestival;

  // 연도: 축제 시작일의 연도가 있으면 그걸, 없으면 올해
  let year;
  if (f.date_start) {
    year = f.date_start.slice(0, 4); // 'YYYY-MM-DD' → 'YYYY'
  } else {
    year = String(new Date().getFullYear()); // 올해
  }

  // "연도 + 장소 + 행사이름" 조합 (빈 값은 자연스럽게 생략)
  const parts = [year, f.place_name || f.location_name, f.title].filter(
    (s) => s && String(s).trim()
  );
  const q = encodeURIComponent(parts.join(' '));
  window.open('https://www.google.com/search?q=' + q, '_blank');
}

// ── 길찾기 지도 선택 ──
function toggleMapPicker() {
  document.getElementById('map-picker').classList.toggle('show');
}

function openMap(type) {
  if (!currentFestival) return;
  const lat = currentFestival.latitude;
  const lng = currentFestival.longitude;
  const place = encodeURIComponent(
    currentFestival.place_name ||
      currentFestival.location_name ||
      currentFestival.address ||
      currentFestival.title ||
      '목적지'
  );
  let url = '';

  if (type === 'kakao') {
    url = `https://map.kakao.com/?q=${place}`;
  } else if (type === 'naver') {
    url = `https://map.naver.com/v5/search/${place}`;
  } else if (type === 'google') {
    // 좌표가 있으면 정확한 좌표로, 없으면 장소명으로
    url =
      lat && lng
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${place}`;
  }

  if (url) window.open(url, '_blank');
}

// ── 날짜 버튼 ──
function setDate(el, type) {
  document
    .querySelectorAll('.date-btn')
    .forEach((b) => b.classList.remove('active'));
  el.classList.add('active');

  const rangeBox = document.getElementById('date-range');

  if (type === 'custom') {
    // 직접 입력: 날짜 칸 뿅
    rangeBox.classList.add('show');
    const s = document.getElementById('range-start').value;
    const e = document.getElementById('range-end').value;
    // 아직 둘 다 안 골랐으면 전체 표시, 다 골랐으면 기간 필터
    dateFilter = s && e ? 'custom' : 'none';
  } else {
    // 다른 버튼: 날짜 칸 숨기고 입력값 초기화
    rangeBox.classList.remove('show');
    document.getElementById('range-start').value = '';
    document.getElementById('range-end').value = '';
    customRange = { start: null, end: null };
    dateFilter = type;
  }

  applyFilters();
}

// ── 기간 직접 설정 ──
function setCustomRange() {
  const s = document.getElementById('range-start').value;
  const e = document.getElementById('range-end').value;
  customRange.start = s || null;
  customRange.end = e || null;

  if (s && e) dateFilter = 'custom';

  applyFilters();
}

// ── 카테고리 토글 ──
function toggleFilter(el, type) {
  const activeClass = 'active-' + type;
  if (el.classList.contains(activeClass)) {
    el.classList.remove(activeClass);
    activeCategories[type] = false;
  } else {
    el.classList.add(activeClass);
    activeCategories[type] = true;
  }
  if (type === 'spot') {
    renderSpotPins(); // 스팟만 다시 표시/숨김
  } else {
    applyFilters(); // 축제 핀 갱신
  }
}

// ── 진행 중 축제인지 판단 (오늘이 시작~종료 사이) ──
function isOngoingFestival(f) {
  if (!f.date_start) return false; // 날짜 미정은 제외
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = toDate(f.date_start);
  const end = toDate(f.date_end) || start;
  return start <= today && today <= end;
}

// ── 지난 축제인지 판단 (종료일이 어제 이하 = 오늘보다 이전) ──
function isPastFestival(f) {
  if (!f.date_start) return false; // 날짜 미정은 제외
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = toDate(f.date_end) || toDate(f.date_start);
  return end < today; // 종료일이 오늘보다 앞 → 지난 축제
}

// ── 내 위치로 이동 ──
function goToMyLocation() {
  const btn = document.getElementById('locate-btn');

  if (!navigator.geolocation) {
    alert('이 브라우저에서는 위치 기능을 쓸 수 없어요 😢');
    return;
  }

  btn.classList.add('locating'); // 빙글빙글 표시

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove('locating');
      const latLng = new google.maps.LatLng(
        pos.coords.latitude,
        pos.coords.longitude
      );
      map.panTo(latLng);
      map.setZoom(13);
      showMyLocationDot(latLng);
    },
    (err) => {
      btn.classList.remove('locating');
      if (err.code === err.PERMISSION_DENIED) {
        alert(
          '위치 권한이 거부되어 있어요.\n브라우저 주소창 옆 자물쇠 아이콘에서 위치를 "허용"으로 바꿔주세요 📍'
        );
      } else {
        alert('위치를 찾지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ── 내 위치 파란 점 표시 ──
function showMyLocationDot(latLng) {
  if (myLocationMarker) {
    myLocationMarker.setMap(null);
    myLocationMarker = null;
  }

  class MyDot extends google.maps.OverlayView {
    constructor(position) {
      super();
      this.position = position;
      this.div = null;
    }
    onAdd() {
      const div = document.createElement('div');
      div.className = 'my-location-dot';
      div.style.position = 'absolute';
      div.style.willChange = 'transform';
      this.div = div;
      this.getPanes().overlayLayer.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const p = this.getProjection().fromLatLngToDivPixel(this.position);
      if (p) {
        this.div.style.transform =
          'translate(' + (p.x - 8) + 'px,' + (p.y - 8) + 'px)';
      }
    }
    onRemove() {
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
    }
  }

  myLocationMarker = new MyDot(latLng);
  myLocationMarker.setMap(map);
}

// ── 모바일 사이드바 ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('menu-toggle');
  const isOpen = sidebar.classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
  // 버튼도 메뉴 따라 이동 + 아이콘 전환 (☰ ↔ ✕)
  btn.classList.toggle('menu-open', isOpen);
  btn.textContent = isOpen ? '✕' : '☰';
}
function closeSidebar() {
  const btn = document.getElementById('menu-toggle');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
  btn.classList.remove('menu-open');
  btn.textContent = '☰';
}

// ── 모달 ──
function openModal() {
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('show');
  }
}

// ── 개발자에게 메시지 보내기 ──
function openContact() {
  // 모바일에서 메뉴 열린 상태면 닫기
  closeSidebar();
  document.getElementById('contact-status').textContent = '';
  document.getElementById('contact-status').className = 'contact-status';
  document.getElementById('contact-overlay').classList.add('show');
}

function closeContact(e) {
  if (!e || e.target === document.getElementById('contact-overlay')) {
    document.getElementById('contact-overlay').classList.remove('show');
  }
}

async function sendContact() {
  const emailEl = document.getElementById('contact-email');
  const contentEl = document.getElementById('contact-content');
  const statusEl = document.getElementById('contact-status');
  const sendBtn = document.getElementById('contact-send-btn');

  const email = emailEl.value.trim();
  const content = contentEl.value.trim();

  // 간단한 입력 검증
  if (!content) {
    statusEl.textContent = '내용을 입력해주세요.';
    statusEl.className = 'contact-status err';
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusEl.textContent = '이메일 형식을 확인해주세요.';
    statusEl.className = 'contact-status err';
    return;
  }

  // 전송 중 표시
  sendBtn.disabled = true;
  statusEl.textContent = '보내는 중...';
  statusEl.className = 'contact-status';

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ email: email || null, content: content }]);

  sendBtn.disabled = false;

  if (error) {
    console.log('메시지 전송 에러:', error.message);
    statusEl.textContent = '전송에 실패했어요. 잠시 후 다시 시도해주세요.';
    statusEl.className = 'contact-status err';
    return;
  }

  // 성공
  statusEl.textContent = '메시지가 전달되었어요. 감사합니다! 🎆';
  statusEl.className = 'contact-status ok';
  emailEl.value = '';
  contentEl.value = '';
  // 1.5초 뒤 자동으로 닫기
  setTimeout(() => {
    document.getElementById('contact-overlay').classList.remove('show');
  }, 1500);
}

// ====================================================
//  스팟(사용자 명소) 만들기·표시
// ====================================================

// ── 모바일 길게 누르기 → 메뉴 ──
function setupLongPress() {
  const el = document.getElementById('map');
  let timer = null;
  let sx = 0,
    sy = 0;
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      timer = setTimeout(() => {
        const rect = document
          .getElementById('map-container')
          .getBoundingClientRect();
        const x = sx - rect.left;
        const y = sy - rect.top;
        const ll = projectionHelper && projectionHelper.latLngAt(x, y);
        if (ll) showSpotContextMenu(x, y, ll);
      }, 480);
    },
    { passive: true }
  );
  const cancel = (e) => {
    if (e && e.touches && e.touches[0]) {
      const t = e.touches[0];
      if (Math.abs(t.clientX - sx) < 10 && Math.abs(t.clientY - sy) < 10)
        return; // 거의 안 움직였으면 유지
    }
    clearTimeout(timer);
  };
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchmove', cancel);
}

// ── 우클릭/롱프레스 메뉴 ──
function showSpotContextMenu(x, y, latLng) {
  pendingLatLng = latLng;
  spotMenuOpenedAt = Date.now();
  const menu = document.getElementById('spot-ctx');
  const cont = document.getElementById('map-container');
  menu.style.left = Math.min(x, cont.clientWidth - 160) + 'px';
  menu.style.top = Math.min(y, cont.clientHeight - 60) + 'px';
  menu.classList.add('show');
}
function hideSpotContextMenu() {
  document.getElementById('spot-ctx').classList.remove('show');
}

// ── 저장 모달 열기/닫기 ──
function openSpotForm() {
  hideSpotContextMenu();
  if (!pendingLatLng) return;
  // 초기화
  spotPhotoFiles = [];
  chosenSpotTags.clear();
  renderSpotThumbs();
  document.getElementById('spot-author').value = '';
  document.getElementById('spot-title').value = '';
  document.getElementById('spot-desc').value = '';
  document.getElementById('spot-pw').value = '';
  document.getElementById('spot-msg').textContent = '';
  document
    .querySelectorAll('#spot-tags .spot-tag')
    .forEach((t) => t.classList.remove('on'));
  document.getElementById('spot-live-note').classList.remove('show');
  document.getElementById('spot-overlay').classList.add('show');
}
function closeSpotForm(e) {
  if (!e || e.target === document.getElementById('spot-overlay')) {
    document.getElementById('spot-overlay').classList.remove('show');
  }
}

// ── 사진 고르기 + 썸네일(최대 5장, 추가/삭제) ──
function pickSpotPhoto() {
  document.getElementById('spot-file').click();
}
document
  .getElementById('spot-file')
  .addEventListener('change', function () {
    const picked = Array.from(this.files || []);
    for (const f of picked) {
      if (spotPhotoFiles.length >= 5) break;
      spotPhotoFiles.push(f);
    }
    this.value = ''; // 같은 파일 다시 고를 수 있게 초기화
    renderSpotThumbs();
  });

function renderSpotThumbs() {
  const wrap = document.getElementById('spot-thumbs');
  if (!wrap) return;
  let html = spotPhotoFiles
    .map(
      (f, i) =>
        '<div class="spot-thumb">' +
        '<img src="' +
        URL.createObjectURL(f) +
        '" alt="">' +
        '<button type="button" class="thumb-del" onclick="removeSpotPhoto(' +
        i +
        ')">✕</button>' +
        '</div>'
    )
    .join('');
  if (spotPhotoFiles.length < 5) {
    html +=
      '<div class="spot-photo-add" onclick="pickSpotPhoto()">＋</div>';
  }
  wrap.innerHTML = html;
}

function removeSpotPhoto(i) {
  spotPhotoFiles.splice(i, 1);
  renderSpotThumbs();
}

// ── 사진 압축(가로 1600px 이하 JPEG) ──
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX) {
        height = Math.round((height * MAX) / width);
        width = MAX;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('압축 실패'))),
        'image/jpeg',
        0.8
      );
    };
    img.onerror = () => reject(new Error('이미지 읽기 실패'));
    img.src = URL.createObjectURL(file);
  });
}

// ── 태그 토글 ──
(function initSpotTags() {
  const wrap = document.getElementById('spot-tags');
  if (!wrap) return;
  wrap.querySelectorAll('.spot-tag').forEach((t) => {
    t.addEventListener('click', () => {
      const name = t.dataset.t;
      if (t.classList.toggle('on')) chosenSpotTags.add(name);
      else chosenSpotTags.delete(name);
      document
        .getElementById('spot-live-note')
        .classList.toggle('show', chosenSpotTags.has('실시간 현장'));
    });
  });
})();

// ── 스팟 저장 (사진 업로드 → places/posts 기록) ──
async function saveSpot() {
  const author = document.getElementById('spot-author').value.trim();
  const title = document.getElementById('spot-title').value.trim();
  const desc = document.getElementById('spot-desc').value.trim();
  const pw = document.getElementById('spot-pw').value.trim();
  const msg = document.getElementById('spot-msg');
  const btn = document.getElementById('spot-save-btn');

  if (spotPhotoFiles.length === 0) {
    msg.textContent = '사진을 1장 이상 추가해주세요';
    return;
  }
  if (!author) {
    msg.textContent = '닉네임을 입력해주세요';
    return;
  }
  if (!title) {
    msg.textContent = '제목을 입력해주세요';
    return;
  }
  if (chosenSpotTags.size === 0) {
    msg.textContent = '태그를 1개 이상 골라주세요';
    return;
  }
  if (!pw) {
    msg.textContent = '비밀번호를 입력해주세요';
    return;
  }
  const now = Date.now();
  if (now - lastSpotWrite < 10000) {
    msg.textContent = '10초 후에 다시 저장할 수 있어요';
    return;
  }
  if (!pendingLatLng) {
    msg.textContent = '위치 정보가 없어요. 지도를 다시 눌러주세요.';
    return;
  }

  btn.disabled = true;
  msg.style.color = 'var(--muted)';
  msg.textContent = '저장하는 중…';

  try {
    // 1) 사진 여러 장 압축 + 업로드 → URL 배열
    const photoUrls = [];
    for (const file of spotPhotoFiles) {
      const blob = await compressImage(file);
      const path =
        'spots/' +
        Date.now() +
        '_' +
        Math.random().toString(36).slice(2, 8) +
        '.jpg';
      const up = await supabaseClient.storage
        .from('spot-photos')
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const pub = supabaseClient.storage
        .from('spot-photos')
        .getPublicUrl(path);
      photoUrls.push(pub.data.publicUrl);
    }

    // 2) 장소 만들기 (직접 찍기 → 새 장소)
    const lat = pendingLatLng.lat();
    const lng = pendingLatLng.lng();
    const placeRes = await supabaseClient
      .from('places')
      .insert([{ name: title, latitude: lat, longitude: lng }])
      .select();
    if (placeRes.error) throw placeRes.error;
    const placeId = placeRes.data[0].id;

    // 3) 게시물 기록
    const isLive = chosenSpotTags.has('실시간 현장');
    const postRes = await supabaseClient
      .from('posts')
      .insert([
        {
          place_id_fk: placeId,
          author: author,
          password: pw,
          title: title,
          description: desc,
          photos: photoUrls,
          tags: Array.from(chosenSpotTags),
          is_live: isLive,
        },
      ])
      .select('*, places(*)');
    if (postRes.error) throw postRes.error;

    lastSpotWrite = now;
    // 지도에 바로 추가
    const post = postRes.data[0];
    spotData.unshift(post);
    if (activeCategories.spot) addSpotPin(post);
    updateSpotCount();

    msg.style.color = 'var(--live)';
    msg.textContent = '스팟이 등록됐어요! 🎉';
    setTimeout(() => {
      document.getElementById('spot-overlay').classList.remove('show');
      msg.style.color = '#ff5577';
    }, 900);
  } catch (err) {
    console.log('스팟 저장 에러:', err.message || err);
    msg.style.color = '#ff5577';
    msg.textContent = '저장에 실패했어요. 잠시 후 다시 시도해주세요.';
  } finally {
    btn.disabled = false;
  }
}

// ── 스팟 불러오기 ──
async function loadSpots() {
  const { data, error } = await supabaseClient
    .from('posts')
    .select('*, places(*)')
    .order('created_at', { ascending: false });
  if (error) {
    console.log('스팟 로드 에러:', error.message);
    return;
  }
  // 실시간(24시간) 지난 것 숨김 + 좌표 있는 것만
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  spotData = (data || []).filter((p) => {
    if (!p.places || !p.places.latitude) return false;
    if (p.is_live && new Date(p.created_at).getTime() < cutoff)
      return false;
    return true;
  });
  renderSpotPins();
}

// ── 스팟 핀 다시 그리기 (카테고리 on/off 반영) ──
function renderSpotPins() {
  spotOverlays.forEach((s) => s.setMap(null));
  spotOverlays = [];
  if (activeCategories.spot) {
    spotData.forEach((post) => addSpotPin(post));
  }
  updateSpotCount();
}
function addSpotPin(post) {
  if (!SpotPinClass || !map) return;
  const pin = new SpotPinClass(post);
  pin.setMap(map);
  spotOverlays.push(pin);
}
function updateSpotCount() {
  document.getElementById('cnt-spot').textContent = activeCategories.spot
    ? spotData.length
    : 0;
}

// ── 스팟 상세 팝업 ──
function openSpotPanel(post) {
  currentSpot = post;
  closePanel(); // 축제 팝업 닫기
  document.getElementById('sp-map-picker').classList.remove('show');

  // 사진: 이전 스팟 사진이 남지 않게 즉시 비우고 로딩 표시 (Fix 3)
  const box = document.getElementById('sp-imgbox');
  const imgEl = document.getElementById('sp-img');
  box.classList.remove('has-photo', 'pan-v', 'pan-h', 'loading');
  imgEl.onload = null;
  imgEl.onerror = null;
  imgEl.removeAttribute('src');

  const photo = post.photos && post.photos[0];
  if (photo) {
    box.classList.add('loading');
    imgEl.onload = function () {
      box.classList.remove('loading');
      box.classList.add('has-photo');
      // 사진 크기 확인 → 잘리는 쪽으로 천천히 훑기 (Fix 4)
      const boxRatio = box.clientWidth / box.clientHeight;
      const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
      if (imgRatio && boxRatio) {
        if (imgRatio > boxRatio * 1.05) box.classList.add('pan-h');
        else if (imgRatio < boxRatio * 0.95) box.classList.add('pan-v');
      }
    };
    imgEl.onerror = function () {
      box.classList.remove('loading');
    };
    imgEl.src = photo;
    // 캐시된 이미지는 onload가 안 뜰 수 있어 보강
    if (imgEl.complete && imgEl.naturalWidth) imgEl.onload();
  }
  document.getElementById('sp-title').textContent = post.title || '';
  document.getElementById('sp-author').textContent = post.author
    ? '올린 사람: ' + post.author
    : '';
  const descEl = document.getElementById('sp-desc');
  descEl.textContent = post.description || '';
  descEl.style.display = post.description ? 'block' : 'none';

  const tagsEl = document.getElementById('sp-tags');
  tagsEl.innerHTML = (post.tags || [])
    .map((t) => '<span class="sp-tag">' + escapeHtml(t) + '</span>')
    .join('');

  const panel = document.getElementById('spot-panel');
  panel.classList.remove('show');
  void panel.offsetWidth;
  panel.classList.add('show');
  panel.scrollTop = 0;
}
function closeSpotPanel() {
  document.getElementById('spot-panel').classList.remove('show');
  document.getElementById('sp-map-picker').classList.remove('show');
}
function openSpotPhoto() {
  if (currentSpot && currentSpot.photos && currentSpot.photos[0]) {
    window.open(currentSpot.photos[0], '_blank');
  }
}

// ── 스팟 길찾기 ──
function toggleSpotMapPicker() {
  document.getElementById('sp-map-picker').classList.toggle('show');
}
function openSpotMap(type) {
  if (!currentSpot || !currentSpot.places) return;
  const lat = currentSpot.places.latitude;
  const lng = currentSpot.places.longitude;
  const place = encodeURIComponent(currentSpot.title || '목적지');
  let url = '';
  if (type === 'kakao') {
    url = 'https://map.kakao.com/?q=' + place;
  } else if (type === 'naver') {
    url = 'https://map.naver.com/v5/search/' + place;
  } else if (type === 'google') {
    url =
      'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
  if (url) window.open(url, '_blank');
}

// ── 신고하기 (개발자 메시지로 전송) ──
async function reportSpot() {
  if (!currentSpot) return;
  if (!confirm('이 스팟을 신고할까요? 개발자에게 전달돼요.')) return;
  const text =
    '[스팟 신고] post id=' +
    currentSpot.id +
    ' / 제목: ' +
    (currentSpot.title || '') +
    ' / 작성자: ' +
    (currentSpot.author || '');
  const { error } = await supabaseClient
    .from('messages')
    .insert([{ email: null, content: text }]);
  if (error) {
    toast('신고 전송에 실패했어요');
    return;
  }
  toast('신고가 접수됐어요. 감사합니다.');
}

// ── 별점 입력: 마우스 올리면 채워짐, 클릭하면 고정 ──
(function initStarPicker() {
  const pick = document.getElementById('star-pick');
  if (!pick) return;
  pick.querySelectorAll('span').forEach((s) => {
    s.addEventListener('mouseover', () =>
      paintStars(Number(s.dataset.v))
    );
    s.addEventListener('click', () => {
      pickedRating = Number(s.dataset.v);
      paintStars(pickedRating);
    });
  });
  pick.addEventListener('mouseleave', () => paintStars(pickedRating));
})();

// ── 시작 ──
loadFestivals();
