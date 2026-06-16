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

// 필터 상태 (축제·CCTV·유튜브 on/off)
let activeCategories = { festival: true, cctv: true, yt: true, news: true };

// 보기 모드: 'spot' | 'festival'(축제·공연) | 'live'(실시간 영상)
let viewMode = 'festival';

// 스팟 태그 필터 / 공연 장르 필터 (켜진 것만 표시)
const SPOT_TAGS = ['풍경', '맛집', '이색', '힐링', '놀라운', '실시간 현장'];
let activeSpotTags = new Set(SPOT_TAGS);
let activeGenres = new Set(); // 공연 데이터 로드 후 채움(처음엔 전부 켜짐)

// 공연(performances) 상태
let perfData = []; // 각 항목에 venues(공연장: 좌표 등) 포함
let perfOverlays = []; // 지도에 뜬 공연 핀
let PerfPinClass = null;
let currentPerf = null; // 현재 열린 공연 팝업

// 유튜브 라이브 영상 상태
let liveData = []; // live_videos 행 (is_active=true)
let liveGroups = []; // 같은 장소끼리 묶음 [{key, lat, lng, items:[]}]
let liveOverlays = []; // 지도에 뜬 라이브 핀
let LivePinClass = null;
let LiveClusterClass = null;
let currentLive = null; // 현재 열린 라이브 팝업
let expandedLiveGroup = null; // 펼쳐진(분리된) 그룹의 key

// 스팟(사용자 명소) 상태
let spotOverlays = []; // 지도에 뜬 스팟 핀들
let spotData = []; // 불러온 스팟(게시물) 목록
let pendingLatLng = null; // 우클릭/롱프레스/검색/지명으로 찍은 위치
let pendingPlace = null; // 검색·지명에서 온 구글 장소 {place_id, name} (직접 찍기면 null)
let pendingExistingPlaceId = null; // 같은 장소가 이미 있으면 그 DB place id
let placesService = null; // 구글 장소 검색 서비스
let searchResults = []; // 최근 검색 결과 목록
let spotPlaces = []; // 장소 단위로 묶은 목록(핀 1개=장소 1개)
let spotPhotoFiles = []; // 저장 대기 사진들 (최대 5장)
let spotMenuOpenedAt = 0; // 스팟 메뉴 연 시각(직후 클릭으로 닫힘 방지)
let currentSpot = null; // 현재 열린 스팟 팝업
let spotPhotoList = []; // 현재 팝업의 사진 목록
let spotPhotoIndex = 0; // 현재 보고 있는 사진 번호
const chosenSpotTags = new Set();
let lastSpotWrite = 0; // 스팟 저장 10초 제한
let SpotPinClass = null;
let dateFilter = 'today'; // 기본: 오늘 (첫 화면엔 오늘 핀만)
let customRange = { start: null, end: null };
let festSearchQuery = ''; // 공연 모드 검색 필터 (비면 전체)

// ── 팝업 뒤로가기 처리 (모바일: 뒤로가기로 팝업 닫기) ──
let popupPushed = false;
function pushPopupState() {
  if (popupPushed) return;
  popupPushed = true;
  try {
    history.pushState({ flarePopup: 1 }, '');
  } catch (e) {}
}
function afterManualPopupClose() {
  if (!popupPushed) return;
  popupPushed = false;
  if (history.state && history.state.flarePopup) {
    try {
      history.back();
    } catch (e) {}
  }
}
window.addEventListener('popstate', function () {
  popupPushed = false;
  const ov = document.getElementById('spot-overlay');
  const pn = document.getElementById('spot-panel');
  const pf = document.getElementById('perf-panel');
  if (ov && ov.classList.contains('show')) ov.classList.remove('show');
  if (pn && pn.classList.contains('show')) pn.classList.remove('show');
  if (pf && pf.classList.contains('show')) pf.classList.remove('show');
  const lv = document.getElementById('live-panel');
  if (lv && lv.classList.contains('show')) {
    lv.classList.remove('show');
    const box = document.getElementById('lv-videobox');
    if (box) box.innerHTML = '';
  }
});

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
    // 지명: 아이콘 표시 (주요 건물·가게가 또렷하게, 클릭도 잘 됨)
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'on' }],
  },
  {
    // 지명: 글자는 은은한 회색
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9a9aae' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#0a0a0f' }],
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
    styles: darkStyle, // 다크 테마
    clickableIcons: true, // 지명 클릭 허용(우리 스팟 흐름으로 가로챔)
    disableDefaultUI: true,
    gestureHandling: 'greedy', // 한 손가락 이동
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_CENTER,
    },
  });

  defineOverlayClasses(); // 핀·뭉치 클래스 정의 (지도 로드 후)

  // 빈 지도 클릭 → 흩어진 이름 다시 합치기 + 메뉴/팝업 닫기
  // 지명(POI)을 누르면 구글 기본창 대신 우리 "스팟 남기기"로 연결
  map.addListener('click', (e) => {
    if (e && e.placeId) {
      e.stop(); // 구글 기본 정보창 막기
      if (viewMode !== 'spot') return; // 스팟 모드에서만 스팟 남기기
      const rect = document
        .getElementById('map-container')
        .getBoundingClientRect();
      let x, y;
      if (e.domEvent && e.domEvent.clientX != null) {
        x = e.domEvent.clientX - rect.left;
        y = e.domEvent.clientY - rect.top;
      } else {
        const p = projectionHelper && projectionHelper.px(e.latLng);
        x = p ? p.x : rect.width / 2;
        y = p ? p.y : rect.height / 2;
      }
      handlePoiClick(e.placeId, e.latLng, x, y);
      return;
    }
    collapseSpider();
    closeSpotPanel(); // 바깥(빈 지도) 누르면 스팟 상세 팝업 닫기
    closePerfPanel(); // 공연 팝업도 닫기
    closeLivePanel(); // 라이브 팝업도 닫기
    if (expandedLiveGroup) {
      expandedLiveGroup = null; // 분리됐던 라이브 핀 다시 묶기
      renderLivePins();
    }
    // 메뉴를 막 연 직후(롱프레스 직후 자동 클릭)엔 닫지 않음 → 다른 곳 누를 때 닫힘
    if (Date.now() - spotMenuOpenedAt > 500) hideSpotContextMenu();
  });

  // 장소 검색 서비스 준비
  if (google.maps.places) {
    placesService = new google.maps.places.PlacesService(map);
  }
  // 지도 이동/줌이 끝나면 뭉치 다시 계산
  map.addListener('idle', recluster);
  map.addListener('zoom_changed', updatePinLabels);

  // 스팟: 지도 우클릭(PC) → 메뉴
  map.addListener('contextmenu', (e) => {
    if (!e.latLng) return;
    if (viewMode !== 'spot') return; // 스팟 모드에서만 스팟 남기기
    const de = e.domEvent;
    const rect = document
      .getElementById('map-container')
      .getBoundingClientRect();
    pendingPlace = null; // 직접 찍기 → 구글 장소 없음
    pendingExistingPlaceId = null;
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
  loadPerformances(); // 공연 불러오기
  loadLiveVideos(); // 유튜브 라이브 불러오기
  setupLiveResize(); // 라이브 팝업 드래그 크기조절
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
        openFestivalPanel(self.festival);
        selectPin(self); // 선택 → 하얀색 (팝업 연 뒤)
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
    constructor(post, count) {
      super();
      this.post = post;
      this.count = count || 1;
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
        '<span class="spot-ring"></span>' +
        '<div class="spot-drop"></div>' +
        (this.count > 1
          ? '<span class="spot-count">' + this.count + '</span>'
          : '') +
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

  // 공연 핀 (노란 물방울)
  PerfPinClass = class extends google.maps.OverlayView {
    constructor(perf) {
      super();
      this.perf = perf;
      const v = perf.venues;
      this.position = new google.maps.LatLng(v.latitude, v.longitude);
      this.div = null;
      this.isOngoing = isOngoingFestival(perf); // 오늘 진행 중?
      this.isLong =
        this.isOngoing && festivalDurationDays(perf) >= LONG_RUNNING_DAYS;
      this.isPast = isPastFestival(perf);
    }
    onAdd() {
      const div = document.createElement('div');
      div.className =
        'perf-pin' +
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
        '<span class="perf-ring"></span>' +
        '<div class="perf-drop"></div>' +
        badgeHtml +
        '<div class="perf-label">' +
        escapeHtml(this.perf.title || '공연') +
        '</div>';
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openPerfPanel(self.perf);
        selectPin(self); // 선택 → 하얀색 (팝업 연 뒤에 표시)
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
    setSelected(isSel) {
      if (this.div) this.div.classList.toggle('selected', isSel);
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

  // 유튜브 라이브 핀 (방송중=빨강, 꺼짐=회색)
  LivePinClass = class extends google.maps.OverlayView {
    constructor(item, fan) {
      super();
      this.item = item;
      this.fan = fan || null; // 같은 장소 분리 시 픽셀 오프셋 {dx,dy}
      this.position = new google.maps.LatLng(item.latitude, item.longitude);
      this.div = null;
    }
    onAdd() {
      const on = !!this.item.is_live;
      const kind = this.item.kind || 'stream';
      const isNews = kind === 'news';
      const badgeText = isNews ? 'NEWS' : 'LIVE';
      const div = document.createElement('div');
      div.className =
        'live-pin' + (on ? ' on' : ' off') + ' kind-' + kind;
      div.style.position = 'absolute';
      div.style.willChange = 'transform';
      div.innerHTML =
        (on ? '<span class="live-ring"></span>' : '') +
        '<div class="live-drop"></div>' +
        (on ? '<div class="live-badge">' + badgeText + '</div>' : '') +
        '<div class="live-label">' +
        escapeHtml(this.item.title || '라이브') +
        '</div>';
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openLivePanel(self.item);
        selectPin(self);
      });
      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const pt = this.getProjection().fromLatLngToDivPixel(this.position);
      if (pt) {
        const dx = this.fan ? this.fan.dx : 0;
        const dy = this.fan ? this.fan.dy : 0;
        this.div.style.transform =
          'translate(' + (pt.x - 8 + dx) + 'px,' + (pt.y - 16 + dy) + 'px)';
      }
    }
    setSelected(isSel) {
      if (this.div) this.div.classList.toggle('selected', isSel);
    }
    onRemove() {
      if (this.div) {
        this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
    }
  };

  // 같은 장소에 라이브가 여러 개일 때: 숫자 묶음 핀 (누르면 분리)
  LiveClusterClass = class extends google.maps.OverlayView {
    constructor(group) {
      super();
      this.group = group;
      this.position = new google.maps.LatLng(group.lat, group.lng);
      this.div = null;
    }
    onAdd() {
      const anyOn = this.group.items.some((it) => it.is_live);
      const allNews = this.group.items.every(
        (it) => (it.kind || 'stream') === 'news'
      );
      const div = document.createElement('div');
      div.className =
        'live-cluster' + (anyOn ? ' on' : ' off') + (allNews ? ' kind-news' : '');
      div.style.position = 'absolute';
      div.style.willChange = 'transform';
      div.textContent = this.group.items.length;
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        expandedLiveGroup = self.group.key; // 분리해서 펼치기
        renderLivePins();
      });
      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const pt = this.getProjection().fromLatLngToDivPixel(this.position);
      if (pt) {
        this.div.style.transform =
          'translate(' + (pt.x - 14) + 'px,' + (pt.y - 14) + 'px)';
      }
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
  if (festSearchQuery) {
    // 검색 중에는 날짜 필터를 무시하고 검색어로만 거름
    return matchesFestSearch([
      f.title,
      f.description,
      f.tags,
      f.place_name,
      f.location_name,
      f.address,
    ]);
  }
  return matchesDateFilter(f);
}

// 공연 모드 검색: 주어진 글자들 중 하나라도 검색어를 포함하면 true
function matchesFestSearch(parts) {
  if (!festSearchQuery) return true;
  const q = festSearchQuery.toLowerCase();
  return parts.some((t) => t && String(t).toLowerCase().includes(q));
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

  if (viewMode !== 'festival') return; // 축제·공연 모드에서만 축제 핀 생성

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
  buildPinsForCurrentFilter(); // 축제 핀
  renderPerfPins(); // 공연 핀 (날짜 필터 반영)
  rebuildSpotPlaces(); // 스팟도 (스팟은 사진 날짜 기준)
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
  closePerfPanel(); // 공연 팝업 닫기

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
  if (type === 'yt' || type === 'news') {
    renderLivePins(); // 유튜브 스트리밍 / 현지 뉴스 켜기·끄기
  } else if (type === 'cctv') {
    // CCTV는 데이터 연결 보류 상태
  } else {
    applyFilters(); // 축제 핀 갱신 (공연도 함께)
  }
}

// ── 스팟 태그 토글 (스팟 모드 카테고리) ──
function toggleSpotTag(el, tag) {
  if (activeSpotTags.has(tag)) {
    activeSpotTags.delete(tag);
    el.classList.remove('active-tag');
  } else {
    activeSpotTags.add(tag);
    el.classList.add('active-tag');
  }
  renderSpotPins();
}

// ── 공연 장르 토글 (축제·공연 모드 카테고리) ──
function toggleGenre(el, genre) {
  if (activeGenres.has(genre)) {
    activeGenres.delete(genre);
    el.classList.remove('active-perf');
  } else {
    activeGenres.add(genre);
    el.classList.add('active-perf');
  }
  renderPerfPins();
}

// ── 보기 모드 전환 (스팟 / 축제·공연 / 실시간 영상) ──
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;

  // 토글 모양 + 모드별 UI 표시(날짜·검색·카테고리)는 data 속성으로 제어
  const seg = document.getElementById('mode-seg');
  if (seg) seg.dataset.m = mode;
  document.body.dataset.mode = mode;

  // 열려 있던 팝업/메뉴 정리
  closePanel();
  closeSpotPanel();
  closePerfPanel();
  closeLivePanel();
  hideSpotContextMenu();
  closeSearchResults();

  // 선택(하양) 핀 해제 + 공연 검색 초기화
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
  festSearchQuery = '';
  const fsInput = document.getElementById('fest-search-input');
  if (fsInput) fsInput.value = '';
  const fsClear = document.getElementById('fest-search-clear');
  if (fsClear) fsClear.style.display = 'none';

  // 일단 모든 핀 제거 후, 모드에 맞는 핀만 다시 표시
  clearFestivalPins();
  clearPerfPins();
  clearLivePins();
  expandedLiveGroup = null;
  spotOverlays.forEach((s) => s.setMap(null));
  spotOverlays = [];

  if (mode === 'festival') {
    buildPinsForCurrentFilter(); // 축제(코랄)
    renderPerfPins(); // 공연(노랑)
  } else if (mode === 'spot') {
    renderSpotPins(); // 스팟(민트)
  } else if (mode === 'live') {
    renderLivePins(); // 유튜브 라이브(빨강/회색)
  }
}

// 축제 핀·뭉치 모두 제거 (모드 전환용)
function clearFestivalPins() {
  pinOverlays.forEach((p) => p.setMap(null));
  pinOverlays = [];
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];
  expandedCluster = null;
}

// 공연 핀 제거
function clearPerfPins() {
  perfOverlays.forEach((p) => p.setMap(null));
  perfOverlays = [];
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
      if (viewMode !== 'spot') return; // 스팟 모드에서만 스팟 남기기
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
        if (ll) {
          pendingPlace = null; // 직접 찍기 → 구글 장소 없음
          pendingExistingPlaceId = null;
          showSpotContextMenu(x, y, ll);
        }
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

// ── 우클릭/롱프레스/지명/검색 → 메뉴 표시 (장소정보는 호출부에서 설정) ──
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

  // 직접 찍기(구글 장소 아님)일 때만 50m 내 기존 장소 확인 → 추가할지 물어보기
  if (!pendingPlace) {
    const near = findNearbyPlace(pendingLatLng, 50);
    if (near) {
      const ok = confirm(
        '근처에 이미 "' +
          (near.name || '등록된 스팟') +
          '"이(가) 있어요.\n그 장소에 사진·글을 추가할까요?\n(취소하면 새 장소로 만들어요)'
      );
      pendingExistingPlaceId = ok ? near.id : null;
    }
  }

  // 어디에 저장되는지 팝업 상단에 표시
  const label = document.getElementById('spot-place-label');
  if (pendingExistingPlaceId) {
    const ex = spotPlaces.find((p) => p.id === pendingExistingPlaceId);
    label.textContent = '📍 ' + (ex ? ex.name : '기존 장소') + ' (여기에 추가)';
  } else if (pendingPlace && pendingPlace.name) {
    label.textContent = '📍 ' + pendingPlace.name;
  } else {
    label.textContent = '📍 지도에서 찍은 위치';
  }

  // 초기화
  spotPhotoFiles = [];
  chosenSpotTags.clear();
  renderSpotThumbs();
  document.getElementById('spot-author').value = '';
  // 검색·지명에서 왔으면 장소 이름을 제목 기본값으로
  document.getElementById('spot-title').value =
    pendingPlace && pendingPlace.name ? pendingPlace.name : '';
  document.getElementById('spot-desc').value = '';
  document.getElementById('spot-pw').value = '';
  document.getElementById('spot-msg').textContent = '';
  document
    .querySelectorAll('#spot-tags .spot-tag')
    .forEach((t) => t.classList.remove('on'));
  document.getElementById('spot-live-note').classList.remove('show');
  document.getElementById('spot-overlay').classList.add('show');
  pushPopupState(); // 뒤로가기로 닫을 수 있게
}
function closeSpotForm(e) {
  const ov = document.getElementById('spot-overlay');
  if (!e || e.target === ov) {
    const wasOpen = ov.classList.contains('show');
    ov.classList.remove('show');
    if (wasOpen) afterManualPopupClose();
  }
}

// ── 장소 검색 (버튼/엔터 시 1회, 결과 3~5개) ──
function runSpotSearch() {
  const q = document.getElementById('spot-search-input').value.trim();
  if (!q) return;
  const listEl = document.getElementById('spot-search-results');
  if (!placesService) {
    listEl.innerHTML = '<div class="sr-empty">검색 준비 중이에요. 잠시 후 다시 시도해주세요.</div>';
    listEl.classList.add('show');
    return;
  }
  listEl.innerHTML = '<div class="sr-empty">검색 중…</div>';
  listEl.classList.add('show');
  // 주변(현재 지도 중심) 우선, 없으면 전국 결과까지 포함됨
  placesService.textSearch(
    { query: q, location: map.getCenter(), radius: 30000 },
    (results, status) => {
      if (
        status !== google.maps.places.PlacesServiceStatus.OK ||
        !results ||
        !results.length
      ) {
        searchResults = [];
        listEl.innerHTML =
          '<div class="sr-empty">결과가 없어요. 다른 이름으로 검색해보세요.</div>';
        return;
      }
      searchResults = results.slice(0, 5);
      listEl.innerHTML = searchResults
        .map(
          (r, i) =>
            '<div class="sr-item" onclick="chooseSearchResult(' +
            i +
            ')"><div class="sr-nm">' +
            escapeHtml(r.name || '') +
            '</div><div class="sr-ad">' +
            escapeHtml(r.formatted_address || '') +
            '</div></div>'
        )
        .join('');
    }
  );
}
function chooseSearchResult(i) {
  const r = searchResults[i];
  if (!r || !r.geometry) return;
  closeSearchResults();
  document.getElementById('spot-search-input').value = '';
  closeSpotPanel(); // 열려 있던 상세 팝업 닫기
  const loc = r.geometry.location;
  pendingLatLng = loc;
  pendingPlace = { place_id: r.place_id, name: r.name };
  pendingExistingPlaceId = null;
  const exist = spotPlaces.find((p) => p.place_id === r.place_id);
  if (exist) pendingExistingPlaceId = exist.id; // 이미 있는 장소면 거기에 추가
  map.panTo(loc);
  map.setZoom(16);
  // 바로 모달 대신, 그 위치에 "스팟 남기기" 메뉴를 띄움
  const cont = document.getElementById('map-container');
  showSpotContextMenu(cont.clientWidth / 2, cont.clientHeight / 2, loc);
}
function closeSearchResults() {
  document.getElementById('spot-search-results').classList.remove('show');
}

// ── 지도 위 지명(POI) 클릭 → "스팟 남기기" 메뉴 ──
function handlePoiClick(placeId, latLng, x, y) {
  pendingLatLng = latLng;
  pendingExistingPlaceId = null;
  const exist = spotPlaces.find((p) => p.place_id === placeId);
  if (exist) {
    // 이미 등록된 같은 장소면 그 장소에 추가
    pendingPlace = { place_id: placeId, name: exist.name };
    pendingExistingPlaceId = exist.id;
  } else {
    // 새 지명 → 이름만 가볍게 가져와 채움(메뉴는 즉시 표시)
    pendingPlace = { place_id: placeId, name: '' };
    if (placesService) {
      placesService.getDetails(
        { placeId: placeId, fields: ['name'] },
        (res, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            res &&
            res.name
          )
            pendingPlace.name = res.name;
        }
      );
    }
  }
  showSpotContextMenu(x, y, latLng);
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

// ── 사진 날짜 추출: EXIF 촬영시각 → 없으면 파일 수정시각, ISO 문자열로 ──
function readPhotoDate(file) {
  return new Promise((resolve) => {
    const fallback = () =>
      file && file.lastModified
        ? new Date(file.lastModified).toISOString()
        : null;
    if (!file) return resolve(null);
    const fr = new FileReader();
    fr.onload = function () {
      try {
        const exif = parseExifDate(fr.result); // "YYYY:MM:DD HH:MM:SS"
        if (exif) {
          const iso = exif
            .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
            .replace(' ', 'T');
          const d = new Date(iso);
          if (!isNaN(d.getTime())) return resolve(d.toISOString());
        }
      } catch (e) {}
      resolve(fallback());
    };
    fr.onerror = () => resolve(fallback());
    fr.readAsArrayBuffer(file.slice(0, 131072)); // 앞 128KB면 EXIF 충분
  });
}
function parseExifDate(buf) {
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return null; // JPEG 아님
  let off = 2;
  const total = v.byteLength;
  while (off + 4 <= total) {
    const marker = v.getUint16(off);
    if (marker === 0xffe1) {
      const segStart = off + 4;
      if (v.getUint32(segStart) !== 0x45786966) return null; // "Exif"
      const tiff = segStart + 6;
      const little = v.getUint16(tiff) === 0x4949;
      const g16 = (o) => v.getUint16(o, little);
      const g32 = (o) => v.getUint32(o, little);
      const ifd0 = tiff + g32(tiff + 4);
      const findTag = (ifd, tag) => {
        const n = g16(ifd);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (g16(e) === tag) return e;
        }
        return -1;
      };
      const readAscii = (entry) => {
        const count = g32(entry + 4);
        const valOff = count <= 4 ? entry + 8 : tiff + g32(entry + 8);
        let s = '';
        for (let i = 0; i < count; i++) {
          const c = v.getUint8(valOff + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s;
      };
      let dateStr = null;
      const exifPtr = findTag(ifd0, 0x8769); // Exif sub-IFD
      if (exifPtr >= 0) {
        const exifIFD = tiff + g32(exifPtr + 8);
        const dto = findTag(exifIFD, 0x9003); // DateTimeOriginal
        if (dto >= 0) dateStr = readAscii(dto);
      }
      if (!dateStr) {
        const dt = findTag(ifd0, 0x0132); // DateTime
        if (dt >= 0) dateStr = readAscii(dt);
      }
      return dateStr || null;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + v.getUint16(off + 2);
  }
  return null;
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
    // 0) 첫 사진의 촬영시각(EXIF) → 없으면 파일 수정시각 (업로드 시점 메타)
    const takenAt = await readPhotoDate(spotPhotoFiles[0]);

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

    // 2) 장소 결정
    //    - 기존 장소에 추가(합치기): pendingExistingPlaceId 사용
    //    - 검색·지명(place_id 있음): 같은 place_id가 이미 있으면 재사용, 없으면 새로
    //    - 직접 찍기: 새 장소
    const lat = pendingLatLng.lat();
    const lng = pendingLatLng.lng();
    let placeId = pendingExistingPlaceId;

    if (!placeId && pendingPlace && pendingPlace.place_id) {
      const found = await supabaseClient
        .from('places')
        .select('id')
        .eq('place_id', pendingPlace.place_id)
        .maybeSingle();
      if (found.data) placeId = found.data.id;
    }

    if (!placeId) {
      const newPlace = {
        name: (pendingPlace && pendingPlace.name) || title,
        latitude: lat,
        longitude: lng,
      };
      if (pendingPlace && pendingPlace.place_id)
        newPlace.place_id = pendingPlace.place_id;
      const placeRes = await supabaseClient
        .from('places')
        .insert([newPlace])
        .select();
      if (placeRes.error) throw placeRes.error;
      placeId = placeRes.data[0].id;
    }

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
          taken_at: takenAt,
        },
      ]);
    if (postRes.error) throw postRes.error;

    lastSpotWrite = now;
    await loadSpots(); // 장소 단위로 다시 그리기(핀 중복 방지)

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
    if (p.is_live && new Date(p.created_at).getTime() < cutoff) return false;
    return true;
  });

  rebuildSpotPlaces(); // 날짜 필터 적용 + 장소 단위로 묶어 핀 표시
}

// ── 스팟 한 개가 현재 날짜 필터에 맞는지 (사진 업로드/촬영 시간 기준) ──
function spotInDateRange(post) {
  const iso = post.taken_at || post.created_at;
  if (!iso) return true;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return true;

  const today = new Date();
  const endToday = new Date(today);
  endToday.setHours(23, 59, 59, 999);
  let from, to;

  if (dateFilter === 'today') {
    from = new Date(today);
    from.setHours(0, 0, 0, 0);
    to = endToday;
  } else if (dateFilter === 'week') {
    from = new Date(today);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 7); // 최근 7일에 올라온 스팟
    to = endToday;
  } else if (dateFilter === 'month') {
    from = new Date(today);
    from.setHours(0, 0, 0, 0);
    from.setMonth(from.getMonth() - 1); // 최근 한 달
    to = endToday;
  } else if (dateFilter === 'custom') {
    if (!customRange.start || !customRange.end) return true;
    from = toDate(customRange.start);
    to = toDate(customRange.end);
    to.setHours(23, 59, 59, 999);
  } else {
    return true; // 필터 없음 = 전체
  }
  return t >= from && t <= to;
}

// ── 스팟을 날짜 필터로 거른 뒤 장소 단위로 묶어 다시 그리기 ──
function rebuildSpotPlaces() {
  const byPlace = {};
  spotData.forEach((post) => {
    if (!spotInDateRange(post)) return; // 날짜 필터에서 제외
    const pl = post.places;
    if (!byPlace[pl.id]) {
      byPlace[pl.id] = {
        id: pl.id,
        place_id: pl.place_id || null,
        name: pl.name,
        latitude: pl.latitude,
        longitude: pl.longitude,
        posts: [],
      };
    }
    byPlace[pl.id].posts.push(post);
  });
  spotPlaces = Object.values(byPlace);
  renderSpotPins();
}

// ── 좌표로 50m 등 근처 장소 찾기 (직접 찍기 합치기용) ──
function findNearbyPlace(latLng, meters) {
  const lat = latLng.lat();
  const lng = latLng.lng();
  let best = null;
  let bestD = meters;
  spotPlaces.forEach((p) => {
    const d = distMeters(lat, lng, p.latitude, p.longitude);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  });
  return best;
}
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 스팟 핀 다시 그리기 (스팟 모드 + 켜진 태그 반영) ──
function renderSpotPins() {
  spotOverlays.forEach((s) => s.setMap(null));
  spotOverlays = [];
  if (viewMode === 'spot') {
    spotPlaces.forEach((place) => {
      // 장소의 게시물 중 켜진 태그를 가진 게 하나라도 있으면 표시
      const show = place.posts.some((p) =>
        (p.tags || []).some((t) => activeSpotTags.has(t))
      );
      if (show) addSpotPin(place.posts[0], place.posts.length);
    });
  }
  updateSpotCount();
}
function addSpotPin(post, count) {
  if (!SpotPinClass || !map) return;
  const pin = new SpotPinClass(post, count);
  pin.setMap(map);
  spotOverlays.push(pin);
}
// 태그별 장소 개수 표시
function updateSpotCount() {
  SPOT_TAGS.forEach((tag) => {
    const el = document.querySelector('[data-tagcount="' + tag + '"]');
    if (!el) return;
    const n = spotPlaces.filter((pl) =>
      pl.posts.some((p) => (p.tags || []).includes(tag))
    ).length;
    el.textContent = n;
  });
}

// ── 스팟 상세 팝업 ──
function openSpotPanel(post) {
  currentSpot = post;
  closePanel(); // 축제 팝업 닫기
  closePerfPanel(); // 공연 팝업 닫기
  if (selectedPin) {
    selectedPin.setSelected(false); // 다른 핀 선택(하양) 해제
    selectedPin = null;
  }
  document.getElementById('sp-map-picker').classList.remove('show');

  // 출처 표시: 장소 선택(place_id 있음, 누르면 이동) vs 직접 찍은 좌표
  const place = post.places || {};
  const srcEl = document.getElementById('sp-source');
  if (srcEl) {
    if (place.place_id) {
      srcEl.className = 'sp-source place clickable';
      srcEl.textContent = '📍 ' + (place.name || '선택한 장소') + '  ›';
      const la = Number(place.latitude);
      const lo = Number(place.longitude);
      srcEl.onclick = () => {
        if (map && !isNaN(la) && !isNaN(lo)) {
          map.panTo({ lat: la, lng: lo });
          map.setZoom(Math.max(map.getZoom(), 16));
        }
      };
    } else {
      srcEl.className = 'sp-source custom';
      srcEl.textContent = '📌 직접 표시한 위치';
      srcEl.onclick = null;
    }
  }

  // 사진 캐러셀 준비 (여러 장이면 화살표/카운터)
  spotPhotoList = (post.photos || []).filter(Boolean);
  spotPhotoIndex = 0;
  const box = document.getElementById('sp-imgbox');
  box.classList.toggle('multi', spotPhotoList.length > 1);
  showSpotPhotoAt(0);

  document.getElementById('sp-title').textContent = post.title || '';
  document.getElementById('sp-author').textContent = post.author
    ? '올린 사람: ' + post.author
    : '';
  // 사진 촬영/업로드 날짜·시간 (메타데이터, 사용자 입력 아님)
  const dateEl = document.getElementById('sp-date');
  const dStr = fmtPhotoDate(post.taken_at);
  dateEl.textContent = dStr ? '📷 ' + dStr : '';
  dateEl.style.display = dStr ? 'block' : 'none';

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
  pushPopupState(); // 뒤로가기로 닫을 수 있게
}
function closeSpotPanel() {
  const pn = document.getElementById('spot-panel');
  const wasOpen = pn.classList.contains('show');
  pn.classList.remove('show');
  document.getElementById('sp-map-picker').classList.remove('show');
  if (wasOpen) afterManualPopupClose();
}
// 사진 날짜 표시용 포맷 (저장된 ISO → 한국식)
function fmtPhotoDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
// ── 스팟 사진 캐러셀 ──
function showSpotPhotoAt(i) {
  const box = document.getElementById('sp-imgbox');
  const imgEl = document.getElementById('sp-img');
  if (!spotPhotoList.length) {
    box.classList.remove('has-photo', 'pan-v', 'pan-h', 'loading');
    imgEl.removeAttribute('src');
    return;
  }
  spotPhotoIndex = (i + spotPhotoList.length) % spotPhotoList.length;
  const photo = spotPhotoList[spotPhotoIndex];

  box.classList.remove('has-photo', 'pan-v', 'pan-h');
  box.classList.add('loading');
  imgEl.onload = null;
  imgEl.onerror = null;
  imgEl.removeAttribute('src');

  imgEl.onload = function () {
    box.classList.remove('loading');
    box.classList.add('has-photo');
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
  if (imgEl.complete && imgEl.naturalWidth) imgEl.onload();

  // 카운터 (예: 2/5)
  document.getElementById('sp-counter').textContent =
    spotPhotoIndex + 1 + '/' + spotPhotoList.length;
}
function spotPhotoPrev(e) {
  if (e) e.stopPropagation();
  showSpotPhotoAt(spotPhotoIndex - 1);
}
function spotPhotoNext(e) {
  if (e) e.stopPropagation();
  showSpotPhotoAt(spotPhotoIndex + 1);
}
function openSpotPhoto() {
  const url = spotPhotoList[spotPhotoIndex];
  if (url) window.open(url, '_blank');
}

// ── 스팟 길찾기 ──
function toggleSpotMapPicker() {
  document.getElementById('sp-map-picker').classList.toggle('show');
}
function openSpotMap(type) {
  if (!currentSpot || !currentSpot.places) return;
  const pl = currentSpot.places;
  const lat = pl.latitude;
  const lng = pl.longitude;
  const name = pl.name || currentSpot.title || '목적지';
  const hasRealPlace = !!pl.place_id; // 검색·지명으로 만든 실제 장소
  let url = '';
  if (type === 'kakao') {
    // 좌표로 정확히 이동 + 이름 라벨
    url =
      'https://map.kakao.com/link/map/' +
      encodeURIComponent(name) +
      ',' +
      lat +
      ',' +
      lng;
  } else if (type === 'naver') {
    // 실제 장소면 장소명, 직접 찍기면 좌표로 검색
    url = hasRealPlace
      ? 'https://map.naver.com/p/search/' + encodeURIComponent(name)
      : 'https://map.naver.com/p/search/' + lat + ',' + lng;
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

// ====================================================
//  공연(performances) — 로딩 · 노란 핀 · 장르 · 팝업
// ====================================================

// 공연 + 공연장(좌표) 불러오기
async function loadPerformances() {
  const { data, error } = await supabaseClient
    .from('performances')
    .select('*, venues(*)')
    .eq('is_active', true);
  if (error) {
    console.log('❌ 공연 로드 에러:', error.message);
    return;
  }
  // 공연장 좌표 있는 것만 (핀 찍을 수 있는 것)
  perfData = (data || []).filter(
    (p) => p.venues && p.venues.latitude != null && p.venues.longitude != null
  );
  console.log('✅ 공연', perfData.length, '개 불러옴');

  buildGenreCategories(); // 장르 카테고리 자동 생성
  if (viewMode === 'festival') renderPerfPins();
}

// 장르 이모지 (없으면 기본)
function genreEmoji(g) {
  if (!g) return '🎵';
  if (g.includes('대중음악')) return '🎤';
  if (g.includes('뮤지컬')) return '🎭';
  if (g.includes('연극')) return '🎬';
  if (g.includes('클래식') || g.includes('서양음악')) return '🎻';
  if (g.includes('국악') || g.includes('한국음악')) return '🪕';
  if (g.includes('무용')) return '💃';
  if (g.includes('서커스') || g.includes('마술')) return '🎪';
  if (g.includes('복합')) return '🎨';
  if (g.includes('아동')) return '🧸';
  if (g.includes('축제')) return '🎉';
  return '🎵';
}

// 데이터에서 장르를 뽑아 카테고리 항목 자동 생성 (개수 많은 순, 전부 켜짐)
function buildGenreCategories() {
  const host = document.getElementById('cat-perf-genres');
  if (!host) return;

  const counts = {};
  perfData.forEach((p) => {
    const g = p.genre || p.tags;
    if (!g) return;
    counts[g] = (counts[g] || 0) + 1;
  });
  const genres = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  activeGenres = new Set(genres); // 처음엔 전부 켜기

  host.innerHTML = '';
  genres.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'filter-item active-perf';
    item.innerHTML =
      '<div class="filter-dot dot-perf"></div>' +
      '<span class="filter-text">' +
      escapeHtml(genreEmoji(g) + ' ' + g) +
      '</span>' +
      '<span class="filter-count">' +
      counts[g] +
      '</span>';
    item.addEventListener('click', () => toggleGenre(item, g));
    host.appendChild(item);
  });
}

// 공연 핀 다시 그리기 (축제·공연 모드 + 날짜 필터 + 켜진 장르)
function renderPerfPins() {
  clearPerfPins();
  if (viewMode !== 'festival') return;
  if (!PerfPinClass || !map) return;

  perfData.forEach((p) => {
    const g = p.genre || p.tags;
    if (!g || !activeGenres.has(g)) return; // 꺼진 장르 제외
    if (festSearchQuery) {
      // 검색 중: 날짜 무시, 검색어(제목·장르·장소·출연진·공연장)로 거름
      if (
        !matchesFestSearch([
          p.title,
          p.genre,
          p.tags,
          p.place_name,
          p.cast_members,
          p.venues && p.venues.name,
          p.venues && p.venues.address,
        ])
      )
        return;
    } else if (!matchesDateFilter(p)) {
      return; // 날짜 필터(공연기간 겹침)
    }
    const pin = new PerfPinClass(p);
    pin.setMap(map);
    perfOverlays.push(pin);
  });
}

// 공연 모드 검색 실행 (제목·장르·지역 등으로 필터)
function runFestSearch() {
  const input = document.getElementById('fest-search-input');
  const q = input ? (input.value || '').trim() : '';
  festSearchQuery = q;
  const clearBtn = document.getElementById('fest-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  buildPinsForCurrentFilter();
  renderPerfPins();
}

// 공연 모드 검색 해제 → 원래(날짜 필터) 상태로 복귀
function clearFestSearch() {
  festSearchQuery = '';
  const input = document.getElementById('fest-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('fest-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  buildPinsForCurrentFilter();
  renderPerfPins();
}

// 카테고리 전체 선택/해제
function setAllCategories(mode, on) {
  if (mode === 'spot') {
    activeSpotTags = on ? new Set(SPOT_TAGS) : new Set();
    document
      .querySelectorAll('#cat-spot .filter-item')
      .forEach((el) => el.classList.toggle('active-tag', on));
    renderSpotPins();
  } else if (mode === 'festival') {
    // 축제
    const festItem = document.querySelector('#cat-festival .filter-item');
    activeCategories.festival = on;
    if (festItem) festItem.classList.toggle('active-festival', on);
    // 공연 장르 전체
    document
      .querySelectorAll('#cat-perf-genres .filter-item')
      .forEach((el) => el.classList.toggle('active-perf', on));
    activeGenres = new Set();
    if (on) {
      perfData.forEach((p) => {
        const g = p.genre || p.tags;
        if (g) activeGenres.add(g);
      });
    }
    buildPinsForCurrentFilter();
    renderPerfPins();
  } else if (mode === 'live') {
    document.querySelectorAll('#cat-live .filter-item').forEach((el) => {
      let t = 'yt';
      if (el.querySelector('.dot-cctv')) t = 'cctv';
      else if (el.querySelector('.dot-news')) t = 'news';
      activeCategories[t] = on;
      el.classList.toggle('active-' + t, on);
    });
    renderLivePins();
  }
}

// 공연 팝업 열기
function openPerfPanel(p) {
  currentPerf = p;
  closePanel(); // 축제 팝업 닫기
  closeSpotPanel(); // 스팟 팝업 닫기

  const img = document.getElementById('pf-img');
  img.src = p.image_url || '';
  img.style.display = p.image_url ? 'block' : 'none';

  document.getElementById('pf-title').textContent = p.title || '공연';
  setPerfMeta('pf-genre', p.genre || p.tags, genreEmoji(p.genre || p.tags) + ' ');
  setPerfMeta('pf-place', p.place_name || (p.venues && p.venues.name), '📍 ');
  const dates = p.date_start
    ? p.date_start +
      (p.date_end && p.date_end !== p.date_start ? ' ~ ' + p.date_end : '')
    : '';
  setPerfMeta('pf-date', dates, '📅 ');
  setPerfMeta('pf-price', p.price, '💰 ');
  setPerfMeta('pf-cast', p.cast_members, '👤 ');

  const ticket = document.getElementById('pf-ticket');
  if (p.ticket_url) {
    ticket.href = p.ticket_url;
    ticket.classList.remove('hidden');
  } else {
    ticket.classList.add('hidden');
  }

  const panel = document.getElementById('perf-panel');
  panel.classList.remove('show');
  void panel.offsetWidth; // 애니메이션 재생용 리플로우
  panel.classList.add('show');
  panel.scrollTop = 0;
  pushPopupState(); // 뒤로가기로 닫기
}

// 정보 줄: 값 있으면 보이고, 없으면 줄 자체를 숨김
function setPerfMeta(id, val, prefix) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val && String(val).trim()) {
    el.textContent = prefix + String(val).trim();
    el.style.display = 'block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function closePerfPanel() {
  const pn = document.getElementById('perf-panel');
  const was = pn.classList.contains('show');
  pn.classList.remove('show');
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
  if (was) afterManualPopupClose();
}

// ====================================================
//  유튜브 라이브 — 로딩 · 장소묶기 · 핀 · 팝업
// ====================================================

async function loadLiveVideos() {
  const { data, error } = await supabaseClient
    .from('live_videos')
    .select('*')
    .eq('is_active', true);
  if (error) {
    console.log('❌ 라이브 로드 에러:', error.message);
    return;
  }
  liveData = (data || []).filter(
    (v) => v.latitude != null && v.longitude != null
  );
  console.log('✅ 라이브', liveData.length, '개 불러옴');
  buildLiveGroups();

  // 라이브가 하나라도 있으면 "곧 추가됩니다" 안내 숨김
  const notice = document.getElementById('live-notice');
  if (notice) notice.classList.toggle('has-live', liveData.length > 0);

  // 카테고리 개수 표시(종류별)
  const streamN = liveData.filter((v) => (v.kind || 'stream') !== 'news').length;
  const newsN = liveData.filter((v) => (v.kind || 'stream') === 'news').length;
  const cntYt = document.getElementById('cnt-yt');
  if (cntYt) cntYt.textContent = streamN;
  const cntNews = document.getElementById('cnt-news');
  if (cntNews) cntNews.textContent = newsN;

  if (viewMode === 'live') renderLivePins();
}

// 같은 좌표끼리 묶기 (소수 4자리 ≈ 11m)
function buildLiveGroups() {
  const byKey = {};
  liveData.forEach((v) => {
    const key = Number(v.latitude).toFixed(4) + ',' + Number(v.longitude).toFixed(4);
    if (!byKey[key]) {
      byKey[key] = {
        key,
        lat: Number(v.latitude),
        lng: Number(v.longitude),
        items: [],
      };
    }
    byKey[key].items.push(v);
  });
  liveGroups = Object.values(byKey);
}

function clearLivePins() {
  liveOverlays.forEach((p) => p.setMap(null));
  liveOverlays = [];
}

function addLivePin(item, fan) {
  const pin = new LivePinClass(item, fan);
  pin.setMap(map);
  liveOverlays.push(pin);
}
function addLiveCluster(group) {
  const c = new LiveClusterClass(group);
  c.setMap(map);
  liveOverlays.push(c);
}

// 종류별 표시 토글 확인 (뉴스/유튜브 스트리밍/교통)
function liveKindOn(item) {
  const k = item.kind || 'stream';
  if (k === 'news') return activeCategories.news;
  if (k === 'traffic') return activeCategories.cctv;
  return activeCategories.yt; // stream
}

// 라이브 핀 그리기 (영상 모드 + 종류별 카테고리 ON인 것만)
function renderLivePins() {
  clearLivePins();
  if (viewMode !== 'live') return;
  if (!LivePinClass || !map) return;

  liveGroups.forEach((g) => {
    const vis = g.items.filter(liveKindOn); // 켜진 종류만
    if (vis.length === 0) return;
    if (vis.length === 1) {
      addLivePin(vis[0], null);
    } else if (expandedLiveGroup === g.key) {
      // 펼침: 멤버들을 원형으로 분리 배치
      const N = vis.length;
      const R = 36;
      vis.forEach((it, i) => {
        const ang = (2 * Math.PI / N) * i - Math.PI / 2;
        addLivePin(it, { dx: Math.cos(ang) * R, dy: Math.sin(ang) * R });
      });
    } else {
      addLiveCluster({ ...g, items: vis }); // 숫자 묶음 (보이는 것만)
    }
  });
}

// 라이브 팝업 열기
function openLivePanel(item) {
  currentLive = item;
  closePanel();
  closeSpotPanel();
  closePerfPanel();

  // 배지: 뉴스=초록 NEWS / 그 외=빨강 LIVE
  const badge = document.getElementById('lv-badge');
  if (badge) {
    const isNews = (item.kind || 'stream') === 'news';
    badge.textContent = isNews ? 'NEWS' : 'LIVE';
    if (isNews) {
      badge.style.background = 'rgba(43,209,108,0.15)';
      badge.style.color = '#2bd16c';
      badge.style.border = '1px solid rgba(43,209,108,0.45)';
    } else {
      badge.style.background = 'rgba(255,78,69,0.15)';
      badge.style.color = '#ff4e45';
      badge.style.border = '1px solid rgba(255,78,69,0.4)';
    }
  }

  const box = document.getElementById('lv-videobox');
  const offline = document.getElementById('lv-offline');
  if (item.is_live) {
    // 방송 중 → 유튜브 임베드 재생 (음소거 자동재생)
    box.innerHTML =
      '<iframe src="https://www.youtube.com/embed/' +
      encodeURIComponent(item.video_id) +
      '?autoplay=1&mute=1&playsinline=1" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    box.style.display = 'block';
    if (offline) offline.style.display = 'none';
  } else {
    // 꺼짐 → 썸네일 + 안내
    box.innerHTML =
      '<img src="https://i.ytimg.com/vi/' +
      encodeURIComponent(item.video_id) +
      '/hqdefault.jpg" alt="" />';
    box.style.display = 'block';
    if (offline) offline.style.display = 'flex';
  }

  document.getElementById('lv-title').textContent = item.title || '라이브';
  setPerfMeta('lv-place', item.place_name, '📍 ');
  lvSetupDesc(item.description);
  const link = document.getElementById('lv-link');
  link.href = 'https://www.youtube.com/watch?v=' + item.video_id;

  // 현지 시간 표시 시작 (1분마다 갱신)
  startLiveClock(item.timezone);

  // 크기: 기본 '보통'으로 초기화
  setLiveSize(liveSizePref || 'm');

  // 한줄평 불러오기 (video_id 기준)
  lvCloseForm();
  loadLiveReviews(item.video_id);

  const panel = document.getElementById('live-panel');
  panel.classList.remove('show');
  void panel.offsetWidth;
  panel.classList.add('show');
  panel.scrollTop = 0;
  lvMeasureDesc(); // 설명이 한 줄 넘치면 더보기 노출
  pushPopupState();
}

function closeLivePanel() {
  const pn = document.getElementById('live-panel');
  const was = pn.classList.contains('show');
  pn.classList.remove('show');
  // 영상 정지: iframe 비우기
  const box = document.getElementById('lv-videobox');
  if (box) box.innerHTML = '';
  stopLiveClock(); // 현지시간 타이머 정지
  lvCloseForm();
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
  if (was) afterManualPopupClose();
}

// ── 팝업 크기 조절 (B: 단계 버튼) ──
let liveSizePref = 'm';
function setLiveSize(s) {
  liveSizePref = s;
  const panel = document.getElementById('live-panel');
  if (!panel) return;
  panel.classList.remove('size-m', 'size-l', 'size-xl');
  panel.classList.add('size-' + s);
  panel.style.width = ''; // 드래그로 늘린 폭 초기화 → 단계 폭 적용
  // 버튼 활성 표시
  document.querySelectorAll('.lv-sizes button').forEach((b) => {
    b.classList.toggle('on', b.dataset.s === s);
  });
}

// ── 현지 시간 시계 ──
let liveClockTimer = null;
function startLiveClock(tz) {
  stopLiveClock();
  const el = document.getElementById('lv-time');
  if (!el) return;
  if (!tz) {
    el.textContent = '';
    return;
  }
  const paint = () => {
    try {
      const t = new Intl.DateTimeFormat('ko-KR', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      el.textContent = '🕐 현지 시간 ' + t;
    } catch (e) {
      el.textContent = '';
    }
  };
  paint();
  liveClockTimer = setInterval(paint, 60000);
}
function stopLiveClock() {
  if (liveClockTimer) {
    clearInterval(liveClockTimer);
    liveClockTimer = null;
  }
}

// ====================================================
//  라이브 전용 한줄평 (축제와 분리, 같은 reviews 테이블 · content_id=video_id)
// ====================================================
let lvReviewVid = null;
let lvReviews = [];
let lvPickedRating = 0;
let lvLastWrite = 0;

async function loadLiveReviews(vid) {
  lvReviewVid = vid;
  lvReviews = [];
  const list = document.getElementById('lv-review-list');
  if (list) list.innerHTML = '<div class="rv-empty">불러오는 중…</div>';
  const rb = document.getElementById('lv-rating');
  if (rb) rb.textContent = '⭐ –';

  const { data, error } = await supabaseClient
    .from('reviews')
    .select('*')
    .eq('content_id', vid)
    .order('created_at', { ascending: false });
  if (lvReviewVid !== vid) return; // 그 사이 다른 라이브로 바뀌면 무시
  if (error) {
    console.log('라이브 한줄평 로드 에러:', error.message);
    lvReviews = [];
  } else {
    lvReviews = data || [];
  }
  renderLvRating();
  renderLvReviews();
}

function renderLvRating() {
  const box = document.getElementById('lv-rating');
  if (!box) return;
  if (lvReviews.length === 0) {
    box.textContent = '⭐ 아직 평가 없음';
    return;
  }
  const avg =
    lvReviews.reduce((s, r) => s + r.rating, 0) / lvReviews.length;
  box.textContent = '⭐ ' + avg.toFixed(1) + ' | ' + lvReviews.length + '명';
}

function renderLvReviews() {
  const list = document.getElementById('lv-review-list');
  if (!list) return;
  if (lvReviews.length === 0) {
    list.innerHTML = '<div class="rv-empty">한줄평이 없어요!</div>';
    return;
  }
  list.innerHTML = lvReviews
    .map((r) => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
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
        '" onclick="lvLikeReview(' +
        r.id +
        ')">♥ <span>' +
        r.likes +
        '</span></button>' +
        '<button class="del-btn" onclick="lvAskDelete(' +
        r.id +
        ')">🗑 삭제</button>' +
        '</div>' +
        '<div class="del-confirm" id="lvdc-' +
        r.id +
        '">' +
        '<input type="text" inputmode="numeric" placeholder="비밀번호" id="lvdcpw-' +
        r.id +
        '" />' +
        '<button class="dc-ok" onclick="lvDoDelete(' +
        r.id +
        ')">삭제</button>' +
        '<button class="dc-no" onclick="lvCancelDelete(' +
        r.id +
        ')">취소</button>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function lvOpenForm() {
  document.getElementById('lv-reviews').classList.add('form-open');
  document.getElementById('lv-rv-author').value = '';
  document.getElementById('lv-rv-pw').value = '';
  document.getElementById('lv-rv-content').value = '';
  document.getElementById('lv-rv-form-msg').textContent = '';
  lvPickedRating = 0;
  lvPaintStars(0);
}
function lvCloseForm() {
  const el = document.getElementById('lv-reviews');
  if (el) el.classList.remove('form-open');
}
function lvPickStar(n) {
  lvPickedRating = n;
  lvPaintStars(n);
}
function lvPaintStars(n) {
  document.querySelectorAll('#lv-star-pick span').forEach((s) => {
    s.classList.toggle('on', Number(s.dataset.v) <= n);
  });
}

async function lvSubmitReview() {
  const author = document.getElementById('lv-rv-author').value.trim();
  const pw = document.getElementById('lv-rv-pw').value.trim();
  const content = document.getElementById('lv-rv-content').value.trim();
  const msg = document.getElementById('lv-rv-form-msg');
  if (!lvReviewVid) return;
  if (!author) { msg.textContent = '아이디를 입력해주세요'; return; }
  if (!pw) { msg.textContent = '비밀번호를 입력해주세요'; return; }
  if (lvPickedRating === 0) { msg.textContent = '별점을 선택해주세요'; return; }
  if (!content) { msg.textContent = '한줄평을 입력해주세요'; return; }
  const now = Date.now();
  if (now - lvLastWrite < 10000) {
    msg.textContent = '10초 후에 다시 작성할 수 있어요';
    return;
  }
  const { data, error } = await supabaseClient
    .from('reviews')
    .insert([
      {
        content_id: lvReviewVid,
        author: author,
        password: pw,
        content: content,
        rating: lvPickedRating,
      },
    ])
    .select();
  if (error) {
    console.log('라이브 한줄평 등록 에러:', error.message);
    msg.textContent = '등록에 실패했어요. 잠시 후 다시 시도해주세요.';
    return;
  }
  lvLastWrite = now;
  if (data && data[0]) lvReviews.unshift(data[0]);
  lvCloseForm();
  renderLvReviews();
  renderLvRating();
}

async function lvLikeReview(id) {
  if (likedIds.has(id)) { toast('이미 좋아요한 한줄평이에요'); return; }
  const now = Date.now();
  if (now - lastReviewLike < 10000) {
    toast('좋아요는 10초에 한 번만 가능해요');
    return;
  }
  const r = lvReviews.find((x) => x.id === id);
  if (!r) return;
  const newLikes = (r.likes || 0) + 1;
  const { error } = await supabaseClient
    .from('reviews')
    .update({ likes: newLikes })
    .eq('id', id);
  if (error) { toast('잠시 후 다시 시도해주세요'); return; }
  r.likes = newLikes;
  likedIds.add(id);
  lastReviewLike = now;
  renderLvReviews();
}

function lvAskDelete(id) {
  document
    .querySelectorAll('#lv-reviews .del-confirm')
    .forEach((e) => e.classList.remove('show'));
  const el = document.getElementById('lvdc-' + id);
  if (el) el.classList.add('show');
}
function lvCancelDelete(id) {
  const el = document.getElementById('lvdc-' + id);
  if (el) el.classList.remove('show');
}
async function lvDoDelete(id) {
  const input = document.getElementById('lvdcpw-' + id);
  const pw = input ? input.value.trim() : '';
  if (!pw) { toast('비밀번호를 입력해주세요'); return; }
  const { data, error } = await supabaseClient
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('password', pw)
    .select();
  if (error) { toast('잠시 후 다시 시도해주세요'); return; }
  if (!data || data.length === 0) { toast('비밀번호가 달라요'); return; }
  lvReviews = lvReviews.filter((x) => x.id !== id);
  renderLvReviews();
  renderLvRating();
}

// ── 라이브 설명 (한 줄 + 더보기) ──
function lvSetupDesc(raw) {
  const wrap = document.getElementById('lv-desc');
  const textEl = document.getElementById('lv-desc-text');
  const moreBtn = document.getElementById('lv-desc-more');
  if (!raw || !String(raw).trim()) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  wrap.classList.remove('expanded');
  textEl.textContent = cleanText(raw);
  moreBtn.textContent = '더보기';
  moreBtn.style.display = 'none';
}
function lvMeasureDesc() {
  const wrap = document.getElementById('lv-desc');
  if (!wrap || wrap.style.display === 'none') return;
  const textEl = document.getElementById('lv-desc-text');
  const moreBtn = document.getElementById('lv-desc-more');
  wrap.classList.remove('expanded');
  const overflowing = textEl.scrollHeight > textEl.clientHeight + 2;
  moreBtn.style.display = overflowing ? 'inline-block' : 'none';
  moreBtn.textContent = '더보기';
}
function lvToggleDesc() {
  const wrap = document.getElementById('lv-desc');
  const moreBtn = document.getElementById('lv-desc-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? '접기' : '더보기';
}

// ── 팝업 크기 조절 (A: 모서리 드래그) ──
let liveResizeBound = false;
function setupLiveResize() {
  if (liveResizeBound) return;
  const handle = document.querySelector('#live-panel .lv-resize');
  const panel = document.getElementById('live-panel');
  if (!handle || !panel) return;
  liveResizeBound = true;
  let startX = 0,
    startW = 0,
    dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    let w = startW + (x - startX);
    const max = window.innerWidth * 0.92;
    w = Math.max(300, Math.min(max, w));
    panel.style.width = w + 'px';
    if (e.cancelable) e.preventDefault();
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
    e.stopPropagation();
  });
}

// ── 시작 ──
loadFestivals();
