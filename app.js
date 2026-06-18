// Flare[V] v3.8.0 / 2026-06-17
const SUPABASE_URL = 'https://pbrbzjxdjqqmhvhzhwlp.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let festivalData = [];
let map;
let pinOverlays = []; 
let currentFestival = null; 

let currentContentId = null; 
let currentReviews = []; 
let pickedRating = 0; 
let likedIds = new Set(); 
let lastReviewWrite = 0; 
let lastReviewLike = 0; 
const LABEL_ZOOM = 11;

let selectedPin = null; 
let clusterMarkers = []; 
let expandedCluster = null; 
let projectionHelper = null; 
let FlarePinClass = null; 
let ClusterMarkerClass = null; 
let myLocationMarker = null; 
const CLUSTER_RADIUS = 48; 
const LONG_RUNNING_DAYS = 14; 

let activeCategories = { spot: true, festival: true, yt: true, news: true, resort: true, hotel: true };

let viewMode = 'live';

const SPOT_TAGS = ['풍경', '맛집', '이색', '힐링', '놀라운', '실시간 현장'];
let activeSpotTags = new Set(SPOT_TAGS);
let activeGenres = new Set(); 

let perfData = []; 
let perfOverlays = []; 
let PerfPinClass = null;
let currentPerf = null; 

let liveData = []; 
let liveGroups = []; 
let liveOverlays = []; 
let LivePinClass = null;
let LiveClusterClass = null;
let currentLive = null; 
let expandedLiveGroup = null; 

let spotOverlays = []; 
let spotData = []; 
let pendingLatLng = null; 
let pendingPlace = null; 
let pendingExistingPlaceId = null; 
let placesService = null; 
let searchResults = []; 
let spotPlaces = []; 
let pickResults = [];
let pickSearchPlace = null;
let pickIdleListener = null;
let geocoder = null;
let pickedAddress = null;
let currentLiveItem = null;
let spotPhotoFiles = []; 
let spotMenuOpenedAt = 0; 
let currentSpot = null; 
let spotPhotoList = []; 
let spotPhotoIndex = 0; 
const chosenSpotTags = new Set();
let lastSpotWrite = 0; 
let SpotPinClass = null;
let dateFilter = 'today'; 
let customRange = { start: null, end: null };
let festSearchQuery = '';

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
    stylers: [{ visibility: 'off' }], 
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
    elementType: 'labels.icon',
    stylers: [{ visibility: 'on' }],
  },
  {
    
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

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.5, lng: 127.8 },
    zoom: 7,
    styles: darkStyle, 
    clickableIcons: true, 
    disableDefaultUI: true,
    gestureHandling: 'greedy', 
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_CENTER,
    },
  });

  defineOverlayClasses(); 

  map.addListener('click', (e) => {
    if (e && e.placeId) {
      e.stop(); 
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
    closeSpotPanel(); 
    closePerfPanel(); 
    closeLivePanel(); 
    if (expandedLiveGroup) {
      expandedLiveGroup = null; 
      renderLivePins();
    }
    
    if (Date.now() - spotMenuOpenedAt > 500) hideSpotContextMenu();
  });

  if (google.maps.places) {
    placesService = new google.maps.places.PlacesService(map);
  }
  
  map.addListener('idle', recluster);
  map.addListener('zoom_changed', updatePinLabels);

  map.addListener('contextmenu', (e) => {
    if (!e.latLng) return;
    const de = e.domEvent;
    const rect = document
      .getElementById('map-container')
      .getBoundingClientRect();
    pendingPlace = null; 
    pendingExistingPlaceId = null;
    showSpotContextMenu(
      de.clientX - rect.left,
      de.clientY - rect.top,
      e.latLng
    );
  });
  
  setupLongPress();

  if (festivalData.length > 0) showFestivalPins();
  loadSpots(); 
  loadPerformances(); 
  loadLiveVideos(); 
  setupLiveResize(); 
}

function defineOverlayClasses() {
  
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

  FlarePinClass = class extends google.maps.OverlayView {
    constructor(festival) {
      super();
      this.festival = festival;
      this.position = new google.maps.LatLng(
        festival.latitude,
        festival.longitude
      );
      this.div = null;
      this.isOngoing = isOngoingFestival(festival); 
      this.isLong =
        this.isOngoing &&
        festivalDurationDays(festival) >= LONG_RUNNING_DAYS; 
      this.isPast = isPastFestival(festival); 
      this.passesFilter = true; 
      this.spiderOffset = null; 
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
          ? '<div class="sangsi-badge">ALWAYS</div>'
          : '<div class="now-badge">NOW</div>'
        : '';
      div.innerHTML =
        '<div class="flare-dot"></div>' +
        badgeHtml +
        '<div class="flare-label">' +
        escapeHtml(this.festival.title || 'Festival') +
        '</div>';

      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openFestivalPanel(self.festival);
        selectPin(self); 
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

    setVisible(visible) {
      if (!this.div) return;
      this.div.style.display = visible ? 'block' : 'none';
    }

    setSelected(isSel) {
      if (!this.div) return;
      this.div.classList.toggle('selected', isSel);
    }

    
    setSpider(offset, animate) {
      this.spiderOffset = offset;
      if (this.div) {
        this.div.classList.toggle('spider', !!offset);
        this.div.classList.toggle(
          'label-left',
          !!(offset && offset.labelLeft)
        );

        if (animate) {
          
          this.div.style.transition =
            'transform 0.2s cubic-bezier(0.34, 1.4, 0.6, 1)';
          
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

  ClusterMarkerClass = class extends google.maps.OverlayView {
    constructor(position, members) {
      super();
      this.position = position;
      this.members = members;
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
        expandCluster(self); 
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
        escapeHtml(this.post.title || 'Spot') +
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

  PerfPinClass = class extends google.maps.OverlayView {
    constructor(perf) {
      super();
      this.perf = perf;
      const v = perf.venues;
      this.position = new google.maps.LatLng(v.latitude, v.longitude);
      this.div = null;
      this.isOngoing = isOngoingFestival(perf); 
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
          ? '<div class="sangsi-badge">ALWAYS</div>'
          : '<div class="now-badge">NOW</div>'
        : '';
      div.innerHTML =
        '<span class="perf-ring"></span>' +
        '<div class="perf-drop"></div>' +
        badgeHtml +
        '<div class="perf-label">' +
        escapeHtml(this.perf.title || 'Show') +
        '</div>';
      const self = this;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        openPerfPanel(self.perf);
        selectPin(self); 
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

  LivePinClass = class extends google.maps.OverlayView {
    constructor(item, fan) {
      super();
      this.item = item;
      this.fan = fan || null; 
      this.position = new google.maps.LatLng(item.latitude, item.longitude);
      this.div = null;
    }
    onAdd() {
      const on = !!this.item.is_live;
      const kind = this.item.kind || 'stream';
      const isNews = kind === 'news';
      let badgeText = 'LIVE';
      if (kind === 'news') badgeText = 'NEWS';
      else if (kind === 'resort') badgeText = 'RESORT';
      else if (kind === 'hotel') badgeText = 'HOTEL';
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
        escapeHtml(this.item.title || 'Live') +
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
        expandedLiveGroup = self.group.key; 
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
    console.log('load error:', error.message);
    return;
  }

  festivalData = data;
  console.log('festivals loaded:', data.length);

  if (map) showFestivalPins();
}

function showFestivalPins() {
  buildPinsForCurrentFilter();
}

function passesCurrentFilter(f) {
  if (!activeCategories.festival) return false;
  if (festSearchQuery) {
    
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

function matchesFestSearch(parts) {
  if (!festSearchQuery) return true;
  const q = festSearchQuery.toLowerCase();
  return parts.some((t) => t && String(t).toLowerCase().includes(q));
}

function buildPinsForCurrentFilter() {
  if (!map || !FlarePinClass) return; 
  
  closePanel();

  pinOverlays.forEach((p) => p.setMap(null));
  pinOverlays = [];
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];
  expandedCluster = null;

  if (viewMode !== 'festival') return; 

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
  if (!map || typeof map.getZoom !== 'function') return; 
  const zoomedIn = map.getZoom() >= LABEL_ZOOM;
  pinOverlays.forEach((pin) => pin.setZoomed(zoomedIn));
}

function recluster() {
  if (!projectionHelper || !projectionHelper.getProjection()) return;

  if (expandedCluster) {
    expandedCluster.members.forEach((p) => p.setSpider(null));
    expandedCluster = null;
  }
  
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];

  const pts = [];
  pinOverlays.forEach((pin) => {
    if (!pin.passesFilter) return;
    const px = projectionHelper.px(pin.position);
    if (px) pts.push({ pin: pin, px: px });
  });

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
      
      group[0].pin.setVisible(true);
    } else {
      
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

function expandCluster(cm) {
  
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
  cm.hide(); 

  const n = cm.members.length;
  
  const radius = 23 + n * 5;

  let startAngle;
  if (n === 2) {
    startAngle = 0; 
  } else if (n === 3) {
    startAngle = -Math.PI / 2; 
  } else {
    startAngle = -Math.PI / 2 + Math.PI / n; 
  }

  cm.members.forEach((pin) => {
    pin.setVisible(true);
    pin.setSpider({ dx: 0, dy: 0, labelLeft: false });
  });

  requestAnimationFrame(() => {
    cm.members.forEach((pin, idx) => {
      const angle = startAngle + (2 * Math.PI * idx) / n;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      const labelLeft = dx < -2; 
      pin.setSpider({ dx: dx, dy: dy, labelLeft: labelLeft }, true);
    });
  });
}

function collapseSpider() {
  if (!expandedCluster) return;
  const cm = expandedCluster;
  expandedCluster = null; 

  cm.members.forEach((pin) => {
    pin.setSpider({ dx: 0, dy: 0, labelLeft: false }, true);
  });

  setTimeout(() => {
    cm.members.forEach((pin) => {
      pin.setSpider(null);
      pin.setVisible(false);
    });
    cm.show();
  }, 200);
}

function toDate(str) {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

function festivalDurationDays(f) {
  if (!f.date_start) return 0;
  const start = toDate(f.date_start);
  const end = toDate(f.date_end) || start;
  return Math.round((end - start) / 86400000) + 1;
}

function matchesDateFilter(f) {
  
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
    return true; 
  }

  return start <= to && end >= from;
}

function applyFilters() {
  buildPinsForCurrentFilter(); 
  renderPerfPins(); 
  rebuildSpotPlaces(); 
}

function cleanText(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n') 
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function cleanInline(s) {
  return cleanText(s).replace(/\s*\n\s*/g, ' ').trim();
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function setupPanelImage(f) {
  const box = document.getElementById('panel-img');
  const img = document.getElementById('panel-img-el');

  box.classList.remove('has-photo', 'pan-v', 'pan-h');
  img.onload = null;
  img.onerror = null;

  const url = f.image_url && String(f.image_url).trim();
  if (!url) {
    img.removeAttribute('src'); 
    return;
  }

  img.onload = function () {
    box.classList.add('has-photo');
    box.classList.remove('pan-v', 'pan-h');
    const boxRatio = box.clientWidth / box.clientHeight;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    if (!imgRatio || !boxRatio) return;
    
    if (imgRatio > boxRatio * 1.05) box.classList.add('pan-h');
    else if (imgRatio < boxRatio * 0.95) box.classList.add('pan-v');
    
  };
  img.onerror = function () {
    
    box.classList.remove('has-photo', 'pan-v', 'pan-h');
    img.removeAttribute('src');
  };

  img.src = url;
  
  if (img.complete && img.naturalWidth) img.onload();
}

function openPhoto() {
  const box = document.getElementById('panel-img');
  if (!box.classList.contains('has-photo')) return;
  if (currentFestival && currentFestival.image_url) {
    window.open(currentFestival.image_url, '_blank');
  }
}

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
  moreBtn.textContent = 'More';
  moreBtn.style.display = 'none'; 
}

function measureDesc() {
  const wrap = document.getElementById('panel-desc');
  if (wrap.style.display === 'none') return;
  const textEl = document.getElementById('panel-desc-text');
  const moreBtn = document.getElementById('panel-desc-more');
  wrap.classList.remove('expanded');
  const overflowing = textEl.scrollHeight > textEl.clientHeight + 2;
  moreBtn.style.display = overflowing ? 'inline-block' : 'none';
  moreBtn.textContent = 'More';
}

function toggleDesc() {
  const wrap = document.getElementById('panel-desc');
  const moreBtn = document.getElementById('panel-desc-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? 'Less' : 'More';
}

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
  moreBtn.textContent = 'More';
  moreBtn.style.display = 'none'; 
}

function measureProgram() {
  const wrap = document.getElementById('panel-program');
  if (wrap.style.display === 'none') return;
  const body = document.getElementById('panel-program-body');
  const moreBtn = document.getElementById('panel-program-more');
  wrap.classList.remove('expanded');
  const overflowing = body.scrollHeight > body.clientHeight + 2;
  moreBtn.style.display = overflowing ? 'inline-block' : 'none';
  moreBtn.textContent = 'More';
}

function toggleProgram() {
  const wrap = document.getElementById('panel-program');
  const moreBtn = document.getElementById('panel-program-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? 'Less' : 'More';
}

function openFestivalPanel(f) {
  const panel = document.getElementById('info-panel');
  closeSpotPanel(); 
  closePerfPanel(); 

  document.getElementById('map-picker').classList.remove('show');

  currentFestival = f; 

  setupPanelImage(f);

  const titleEl = document.getElementById('panel-title');
  titleEl.textContent = f.title || 'Untitled';

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

  setupDescription(f);
  setupProgram(f);

  setupReviews(f);

  panel.classList.remove('show');
  void panel.offsetWidth; 
  panel.classList.add('show');
  panel.scrollTop = 0;

  requestAnimationFrame(() => {
    fitTitle(titleEl);
    measureDesc();
    measureProgram();
  });
}

function fitTitle(el) {
  const sizes = [1, 0.92, 0.85, 0.78]; 
  
  for (let i = 0; i < sizes.length; i++) {
    el.style.fontSize = sizes[i] + 'rem';
    if (el.scrollWidth <= el.clientWidth) break;
  }
}

function closePanel() {
  document.getElementById('info-panel').classList.remove('show');
  document.getElementById('map-picker').classList.remove('show');
  
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
}

function selectPin(pin) {
  if (selectedPin && selectedPin !== pin) selectedPin.setSelected(false);
  selectedPin = pin;
  pin.setSelected(true);
}

function setupReviews(f) {
  const area = document.getElementById('panel-img');
  const talkBtn = document.getElementById('talk-btn');
  const row = document.getElementById('reaction-row');

  area.classList.remove('reviews-open', 'form-open');
  talkBtn.classList.remove('open');
  document.getElementById('talk-label').textContent = 'Reviews';

  const cid = f.content_id && String(f.content_id).trim();
  currentContentId = cid || null;
  currentReviews = [];

  if (!cid) {
    
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';

  const box = document.getElementById('rating-box');
  box.textContent = 'Loading reviews…';
  box.classList.add('none');

  loadReviews(cid).then(() => {
    
    if (currentContentId !== cid) return;
    renderRatingBox();
    renderReviewList();
  });
}

async function loadReviews(contentId) {
  const { data, error } = await supabaseClient
    .from('reviews')
    .select('*')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false });
  if (error) {
    console.log('review load error:', error.message);
    currentReviews = [];
    return;
  }
  currentReviews = data || [];
}

function renderRatingBox() {
  const box = document.getElementById('rating-box');
  if (currentReviews.length === 0) {
    box.textContent = 'No reviews yet';
    box.classList.add('none');
    return;
  }
  box.classList.remove('none');
  const avg =
    currentReviews.reduce((s, r) => s + r.rating, 0) /
    currentReviews.length;
  box.textContent =
    '⭐ ' + avg.toFixed(1) + ' | ' + currentReviews.length + ' ratings';
}

function renderReviewList() {
  const list = document.getElementById('review-list');
  if (currentReviews.length === 0) {
    list.innerHTML = '<div class="rv-empty">No reviews yet!</div>';
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
        ')">🗑 Delete</button>' +
        '</div>' +
        '<div class="del-confirm" id="dc-' +
        r.id +
        '">' +
        '<input type="text" inputmode="numeric" placeholder="Password" id="dcpw-' +
        r.id +
        '" />' +
        '<button class="dc-ok" onclick="doDeleteReview(' +
        r.id +
        ')">Delete</button>' +
        '<button class="dc-no" onclick="cancelDeleteReview(' +
        r.id +
        ')">Cancel</button>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

function formatReviewDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return m + '/' + day;
}

function toggleReviews() {
  const area = document.getElementById('panel-img');
  const btn = document.getElementById('talk-btn');
  const label = document.getElementById('talk-label');
  const open = !area.classList.contains('reviews-open');
  closeReviewForm();
  area.classList.toggle('reviews-open', open);
  btn.classList.toggle('open', open);
  label.textContent = open ? 'Hide reviews' : 'Reviews';
  if (open) renderReviewList();
}

async function likeReview(id) {
  if (likedIds.has(id)) {
    toast('You already liked this review');
    return;
  }
  const now = Date.now();
  if (now - lastReviewLike < 10000) {
    toast('You can like once every 10 seconds');
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
    toast('Please try again in a moment');
    return;
  }
  r.likes = newLikes;
  likedIds.add(id);
  lastReviewLike = now;
  renderReviewList();
}

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

async function doDeleteReview(id) {
  const input = document.getElementById('dcpw-' + id);
  const pw = input ? input.value.trim() : '';
  if (!pw) {
    toast('Please enter the password');
    return;
  }
  
  const { data, error } = await supabaseClient
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('password', pw)
    .select();
  if (error) {
    toast('Please try again in a moment');
    return;
  }
  if (!data || data.length === 0) {
    toast('Wrong password');
    return;
  }
  currentReviews = currentReviews.filter((x) => x.id !== id);
  renderReviewList();
  renderRatingBox();
}

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

async function submitReview() {
  const author = document.getElementById('rv-author').value.trim();
  const pw = document.getElementById('rv-pw').value.trim();
  const content = document.getElementById('rv-content').value.trim();
  const msg = document.getElementById('rv-form-msg');

  if (!currentContentId) return;
  if (!author) {
    msg.textContent = 'Please enter a name';
    return;
  }
  if (!pw) {
    msg.textContent = 'Please enter the password';
    return;
  }
  if (pickedRating === 0) {
    msg.textContent = 'Please pick a rating';
    return;
  }
  if (!content) {
    msg.textContent = 'Please write a review';
    return;
  }

  const now = Date.now();
  if (now - lastReviewWrite < 10000) {
    msg.textContent = 'You can post again in 10 seconds';
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
    console.log('review submit error:', error.message);
    msg.textContent = 'Failed to submit. Please try again in a moment.';
    return;
  }

  lastReviewWrite = now;
  if (data && data[0]) currentReviews.unshift(data[0]);
  closeReviewForm();
  renderReviewList();
  renderRatingBox();
}

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

function searchFestival() {
  if (!currentFestival) return;
  const f = currentFestival;

  let year;
  if (f.date_start) {
    year = f.date_start.slice(0, 4); 
  } else {
    year = String(new Date().getFullYear()); 
  }

  const parts = [year, f.place_name || f.location_name, f.title].filter(
    (s) => s && String(s).trim()
  );
  const q = encodeURIComponent(parts.join(' '));
  window.open('https://www.google.com/search?q=' + q, '_blank');
}

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
      'Destination'
  );
  let url = '';

  if (type === 'kakao') {
    url = `https://map.kakao.com/?q=${place}`;
  } else if (type === 'naver') {
    url = `https://map.naver.com/v5/search/${place}`;
  } else if (type === 'google') {
    
    url =
      lat && lng
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${place}`;
  }

  if (url) window.open(url, '_blank');
}

function setDate(el, type) {
  document
    .querySelectorAll('.date-btn')
    .forEach((b) => b.classList.remove('active'));
  el.classList.add('active');

  const rangeBox = document.getElementById('date-range');

  if (type === 'custom') {
    
    rangeBox.classList.add('show');
    const s = document.getElementById('range-start').value;
    const e = document.getElementById('range-end').value;
    
    dateFilter = s && e ? 'custom' : 'none';
  } else {
    
    rangeBox.classList.remove('show');
    document.getElementById('range-start').value = '';
    document.getElementById('range-end').value = '';
    customRange = { start: null, end: null };
    dateFilter = type;
  }

  applyFilters();
}

function setCustomRange() {
  const s = document.getElementById('range-start').value;
  const e = document.getElementById('range-end').value;
  customRange.start = s || null;
  customRange.end = e || null;

  if (s && e) dateFilter = 'custom';

  applyFilters();
}

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
    renderSpotPins();
  } else if (type === 'yt' || type === 'news' || type === 'resort' || type === 'hotel') {
    renderLivePins();
  } else {
    applyFilters();
  }
}

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

function refreshMap() {
  renderSpotPins();
  renderLivePins();
}

function setViewMode() {
  refreshMap();
}

function clearFestivalPins() {
  pinOverlays.forEach((p) => p.setMap(null));
  pinOverlays = [];
  clusterMarkers.forEach((c) => c.setMap(null));
  clusterMarkers = [];
  expandedCluster = null;
}

function clearPerfPins() {
  perfOverlays.forEach((p) => p.setMap(null));
  perfOverlays = [];
}

function isOngoingFestival(f) {
  if (!f.date_start) return false; 
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = toDate(f.date_start);
  const end = toDate(f.date_end) || start;
  return start <= today && today <= end;
}

function isPastFestival(f) {
  if (!f.date_start) return false; 
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = toDate(f.date_end) || toDate(f.date_start);
  return end < today; 
}

function goToMyLocation() {
  const btn = document.getElementById('locate-btn');

  if (!navigator.geolocation) {
    alert('Location is not available in this browser 😢');
    return;
  }

  btn.classList.add('locating'); 

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
          'Location permission is blocked.\nEnable location in your browser settings (lock icon near the address bar) 📍'
        );
      } else {
        alert('Could not find your location. Please try again in a moment.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

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

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('menu-toggle');
  const isOpen = sidebar.classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
  
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

function openModal() {
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('show');
  }
}

function openContact() {
  
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

  if (!content) {
    statusEl.textContent = 'Please enter a message.';
    statusEl.className = 'contact-status err';
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusEl.textContent = 'Please check your email format.';
    statusEl.className = 'contact-status err';
    return;
  }

  sendBtn.disabled = true;
  statusEl.textContent = 'Sending...';
  statusEl.className = 'contact-status';

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ email: email || null, content: content }]);

  sendBtn.disabled = false;

  if (error) {
    console.log('message send error:', error.message);
    statusEl.textContent = 'Failed to send. Please try again in a moment.';
    statusEl.className = 'contact-status err';
    return;
  }

  statusEl.textContent = 'Your message was sent. Thank you! 🎆';
  statusEl.className = 'contact-status ok';
  emailEl.value = '';
  contentEl.value = '';
  setTimeout(() => {
    document.getElementById('contact-overlay').classList.remove('show');
  }, 1500);
}

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
        if (ll) {
          pendingPlace = null; 
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
        return; 
    }
    clearTimeout(timer);
  };
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchmove', cancel);
}

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

function startNewSpot() {
  pendingLatLng = null;
  pendingPlace = null;
  pendingExistingPlaceId = null;
  pickSearchPlace = null;
  pickedAddress = null;
  openSpotForm();
}

function updateSpotLocationLabel() {
  const row = document.getElementById('spot-locrow');
  const titleEl = document.getElementById('spot-loc-title');
  const subEl = document.getElementById('spot-loc-sub');
  const goEl = document.getElementById('spot-loc-go');
  if (!row || !titleEl) return;
  if (!pendingLatLng) {
    row.classList.remove('set');
    titleEl.textContent = 'Set location';
    subEl.textContent = 'Pick the spot on the map';
    goEl.textContent = 'Set';
    return;
  }
  row.classList.add('set');
  let name;
  if (pendingExistingPlaceId) {
    const ex = spotPlaces.find((p) => p.id === pendingExistingPlaceId);
    name = (ex ? ex.name : 'Existing place') + ' (add here)';
  } else if (pendingPlace && pendingPlace.name) {
    name = pendingPlace.name;
  } else if (pickedAddress) {
    name = pickedAddress;
  } else {
    name = 'Pinned location';
  }
  titleEl.textContent = '📍 ' + name;
  subEl.textContent = 'Tap to change location';
  goEl.textContent = 'Change';
}

function enterSpotPickMode() {
  if (!map) return;
  document.getElementById('spot-overlay').classList.remove('show');
  document.body.classList.add('spot-picking');
  pickSearchPlace = null;
  closeSearchResults();
  const input = document.getElementById('spot-pick-input');
  if (input) input.value = '';
  const res = document.getElementById('spot-pick-results');
  if (res) res.classList.remove('show');
  document.getElementById('spot-pick').classList.add('show');
  if (pendingLatLng) map.panTo(pendingLatLng);
  updatePickWhere();
  if (!pickIdleListener) {
    pickIdleListener = map.addListener('center_changed', updatePickWhere);
  }
}

function updatePickWhere() {
  const el = document.getElementById('spot-pick-where');
  if (!el) return;
  if (pickSearchPlace && pickSearchPlace.loc && map) {
    const c = map.getCenter();
    if (
      distMeters(
        c.lat(),
        c.lng(),
        pickSearchPlace.loc.lat(),
        pickSearchPlace.loc.lng()
      ) < 40
    ) {
      el.innerHTML = '📍 <b>' + escapeHtml(pickSearchPlace.name) + '</b>';
      return;
    }
  }
  el.textContent = '📍 The center of the map will be set';
}

function confirmSpotPick() {
  if (!map) return;
  const c = map.getCenter();
  pendingLatLng = c;
  pendingPlace = null;
  pendingExistingPlaceId = null;
  pickedAddress = null;

  exitSpotPick();
  document.getElementById('spot-overlay').classList.add('show');

  if (
    pickSearchPlace &&
    pickSearchPlace.loc &&
    distMeters(c.lat(), c.lng(), pickSearchPlace.loc.lat(), pickSearchPlace.loc.lng()) < 40
  ) {
    pendingPlace = { place_id: pickSearchPlace.place_id, name: pickSearchPlace.name };
    const ex = spotPlaces.find((p) => p.place_id === pendingPlace.place_id);
    if (ex) pendingExistingPlaceId = ex.id;
    finalizePickedLocation();
    return;
  }

  showLocRowResolving();
  resolvePinLabel(c, (poi, address) => {
    if (poi && poi.place_id) {
      pendingPlace = { place_id: poi.place_id, name: poi.name };
      const ex = spotPlaces.find((p) => p.place_id === poi.place_id);
      if (ex) pendingExistingPlaceId = ex.id;
    } else {
      pickedAddress = address || null;
      const near = findNearbyPlace(c, 50);
      if (near) {
        const ok = confirm(
          'There is already "' +
            (near.name || 'a spot') +
            '" nearby.\nAdd to that place?\n(Cancel to create a new location)'
        );
        pendingExistingPlaceId = ok ? near.id : null;
      }
    }
    finalizePickedLocation();
  });
}

function finalizePickedLocation() {
  const t = document.getElementById('spot-title');
  const nm = (pendingPlace && pendingPlace.name) || pickedAddress;
  if (t && !t.value && nm) t.value = nm;
  updateSpotLocationLabel();
}

function showLocRowResolving() {
  const row = document.getElementById('spot-locrow');
  if (!row) return;
  row.classList.add('set');
  document.getElementById('spot-loc-title').textContent = '📍 Checking location...';
  document.getElementById('spot-loc-sub').textContent = 'Getting the address';
  document.getElementById('spot-loc-go').textContent = 'Change';
}

function resolvePinLabel(latLng, cb) {
  let done = false;
  const finish = (poi, addr) => {
    if (done) return;
    done = true;
    cb(poi, addr);
  };
  const timer = setTimeout(() => finish(null, null), 5000);
  if (placesService) {
    try {
      placesService.nearbySearch(
        { location: latLng, radius: 30 },
        (results, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            results &&
            results.length &&
            results[0].place_id
          ) {
            clearTimeout(timer);
            finish({ place_id: results[0].place_id, name: results[0].name }, null);
          } else {
            reverseGeocodeAddr(latLng, (addr) => {
              clearTimeout(timer);
              finish(null, addr);
            });
          }
        }
      );
      return;
    } catch (e) {}
  }
  reverseGeocodeAddr(latLng, (addr) => {
    clearTimeout(timer);
    finish(null, addr);
  });
}

function reverseGeocodeAddr(latLng, cb) {
  if (!geocoder) {
    try {
      geocoder = new google.maps.Geocoder();
    } catch (e) {
      cb(null);
      return;
    }
  }
  geocoder.geocode({ location: latLng }, (results, status) => {
    if (status === 'OK' && results && results.length) {
      cb(cleanAddr(results[0].formatted_address));
    } else {
      cb(null);
    }
  });
}

function cleanAddr(s) {
  if (!s) return null;
  const t = s.replace(/\s*\d{5}(-\d{4})?\s*$/, '').trim();
  return t || s;
}

function cancelSpotPick() {
  exitSpotPick();
  document.getElementById('spot-overlay').classList.add('show');
}

function exitSpotPick() {
  document.getElementById('spot-pick').classList.remove('show');
  document.body.classList.remove('spot-picking');
  if (pickIdleListener) {
    google.maps.event.removeListener(pickIdleListener);
    pickIdleListener = null;
  }
}

function runPickSearch() {
  const q = document.getElementById('spot-pick-input').value.trim();
  if (!q) return;
  const listEl = document.getElementById('spot-pick-results');
  if (!placesService) {
    listEl.innerHTML = '<div class="sr-empty">Search is warming up. Please try again shortly.</div>';
    listEl.classList.add('show');
    return;
  }
  listEl.innerHTML = '<div class="sr-empty">Searching...</div>';
  listEl.classList.add('show');
  placesService.textSearch(
    { query: q, location: map.getCenter(), radius: 30000 },
    (results, status) => {
      if (
        status !== google.maps.places.PlacesServiceStatus.OK ||
        !results ||
        !results.length
      ) {
        pickResults = [];
        listEl.innerHTML = '<div class="sr-empty">No results. Try another name.</div>';
        return;
      }
      pickResults = results.slice(0, 5);
      listEl.innerHTML = pickResults
        .map(
          (r, i) =>
            '<div class="sr-item" onclick="choosePickResult(' +
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

function choosePickResult(i) {
  const r = pickResults[i];
  if (!r || !r.geometry) return;
  const loc = r.geometry.location;
  pickSearchPlace = { place_id: r.place_id, name: r.name, loc: loc };
  document.getElementById('spot-pick-results').classList.remove('show');
  document.getElementById('spot-pick-input').value = r.name || '';
  map.panTo(loc);
  map.setZoom(16);
  updatePickWhere();
}

function openSpotForm() {
  hideSpotContextMenu();

  if (pendingLatLng && !pendingPlace) {
    const near = findNearbyPlace(pendingLatLng, 50);
    if (near) {
      const ok = confirm(
        'There is already "' +
          (near.name || 'a spot') +
          '" nearby.\nAdd your photos/notes to that place?\n(Cancel to create a new place)'
      );
      pendingExistingPlaceId = ok ? near.id : null;
    }
  }

  updateSpotLocationLabel();

  spotPhotoFiles = [];
  chosenSpotTags.clear();
  renderSpotThumbs();
  document.getElementById('spot-author').value = '';
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
  pushPopupState(); 
}
function closeSpotForm(e) {
  const ov = document.getElementById('spot-overlay');
  if (!e || e.target === ov) {
    const wasOpen = ov.classList.contains('show');
    ov.classList.remove('show');
    if (wasOpen) afterManualPopupClose();
  }
}

function runSpotSearch() {
  const q = document.getElementById('spot-search-input').value.trim();
  if (!q) return;
  const listEl = document.getElementById('spot-search-results');
  if (!placesService) {
    listEl.innerHTML = '<div class="sr-empty">Search is starting up. Please try again in a moment.</div>';
    listEl.classList.add('show');
    return;
  }
  listEl.innerHTML = '<div class="sr-empty">Searching…</div>';
  listEl.classList.add('show');
  
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
          '<div class="sr-empty">No results. Try a different name.</div>';
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
  closeSpotPanel();
  const loc = r.geometry.location;
  pendingLatLng = loc;
  pendingPlace = { place_id: r.place_id, name: r.name };
  pendingExistingPlaceId = null;
  const exist = spotPlaces.find((p) => p.place_id === r.place_id);
  if (exist) pendingExistingPlaceId = exist.id;
  map.panTo(loc);
  map.setZoom(16);
  const cont = document.getElementById('map-container');
  showSpotContextMenu(cont.clientWidth / 2, cont.clientHeight / 2, loc);
}
function closeSearchResults() {
  document.getElementById('spot-search-results').classList.remove('show');
}

function handlePoiClick(placeId, latLng, x, y) {
  pendingLatLng = latLng;
  pendingExistingPlaceId = null;
  const exist = spotPlaces.find((p) => p.place_id === placeId);
  if (exist) {
    
    pendingPlace = { place_id: placeId, name: exist.name };
    pendingExistingPlaceId = exist.id;
  } else {
    
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
    this.value = '';
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
        (blob) => (blob ? resolve(blob) : reject(new Error('compression failed'))),
        'image/jpeg',
        0.8
      );
    };
    img.onerror = () => reject(new Error('image read failed'));
    img.src = URL.createObjectURL(file);
  });
}

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
        const exif = parseExifDate(fr.result); 
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
    fr.readAsArrayBuffer(file.slice(0, 131072)); 
  });
}
function parseExifDate(buf) {
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return null; 
  let off = 2;
  const total = v.byteLength;
  while (off + 4 <= total) {
    const marker = v.getUint16(off);
    if (marker === 0xffe1) {
      const segStart = off + 4;
      if (v.getUint32(segStart) !== 0x45786966) return null; 
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
      const exifPtr = findTag(ifd0, 0x8769);
      if (exifPtr >= 0) {
        const exifIFD = tiff + g32(exifPtr + 8);
        const dto = findTag(exifIFD, 0x9003);
        if (dto >= 0) dateStr = readAscii(dto);
      }
      if (!dateStr) {
        const dt = findTag(ifd0, 0x0132);
        if (dt >= 0) dateStr = readAscii(dt);
      }
      return dateStr || null;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + v.getUint16(off + 2);
  }
  return null;
}

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

async function saveSpot() {
  const author = document.getElementById('spot-author').value.trim();
  const title = document.getElementById('spot-title').value.trim();
  const desc = document.getElementById('spot-desc').value.trim();
  const pw = document.getElementById('spot-pw').value.trim();
  const msg = document.getElementById('spot-msg');
  const btn = document.getElementById('spot-save-btn');

  if (spotPhotoFiles.length === 0) {
    msg.textContent = 'Please add at least 1 photo';
    return;
  }
  if (!author) {
    msg.textContent = 'Please enter a name';
    return;
  }
  if (!title) {
    msg.textContent = 'Please enter a title';
    return;
  }
  if (chosenSpotTags.size === 0) {
    msg.textContent = 'Please pick at least 1 tag';
    return;
  }
  if (!pw) {
    msg.textContent = 'Please enter the password';
    return;
  }
  const now = Date.now();
  if (now - lastSpotWrite < 10000) {
    msg.textContent = 'You can save again in 10 seconds';
    return;
  }
  if (!pendingLatLng) {
    msg.textContent = 'Please set the location first using "Set location".';
    return;
  }

  btn.disabled = true;
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Saving…';

  try {
    
    const takenAt = await readPhotoDate(spotPhotoFiles[0]);

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
        name: (pendingPlace && pendingPlace.name) || pickedAddress || title,
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
    await loadSpots(); 

    msg.style.color = 'var(--live)';
    msg.textContent = 'Your spot has been added! 🎉';
    setTimeout(() => {
      document.getElementById('spot-overlay').classList.remove('show');
      msg.style.color = '#ff5577';
    }, 900);
  } catch (err) {
    console.log('spot save error:', err.message || err);
    msg.style.color = '#ff5577';
    msg.textContent = 'Failed to save. Please try again in a moment.';
  } finally {
    btn.disabled = false;
  }
}

async function loadSpots() {
  const { data, error } = await supabaseClient
    .from('posts')
    .select('*, places(*)')
    .order('created_at', { ascending: false });
  if (error) {
    console.log('spot load error:', error.message);
    return;
  }
  
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  spotData = (data || []).filter((p) => {
    if (!p.places || !p.places.latitude) return false;
    if (p.is_live && new Date(p.created_at).getTime() < cutoff) return false;
    return true;
  });

  rebuildSpotPlaces(); 
}

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
    from.setDate(from.getDate() - 7); 
    to = endToday;
  } else if (dateFilter === 'month') {
    from = new Date(today);
    from.setHours(0, 0, 0, 0);
    from.setMonth(from.getMonth() - 1); 
    to = endToday;
  } else if (dateFilter === 'custom') {
    if (!customRange.start || !customRange.end) return true;
    from = toDate(customRange.start);
    to = toDate(customRange.end);
    to.setHours(23, 59, 59, 999);
  } else {
    return true; 
  }
  return t >= from && t <= to;
}

function rebuildSpotPlaces() {
  const byPlace = {};
  spotData.forEach((post) => {
    if (!spotInDateRange(post)) return; 
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

function renderSpotPins() {
  spotOverlays.forEach((s) => s.setMap(null));
  spotOverlays = [];
  if (activeCategories.spot) {
    spotPlaces.forEach((place) => {
      addSpotPin(place.posts[0], place.posts.length);
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

function updateSpotCount() {
  const el = document.getElementById('cnt-spot');
  if (el) el.textContent = spotPlaces.length;
}

function openSpotPanel(post) {
  currentSpot = post;
  closePanel(); 
  closePerfPanel(); 
  if (selectedPin) {
    selectedPin.setSelected(false); 
    selectedPin = null;
  }
  document.getElementById('sp-map-picker').classList.remove('show');

  const place = post.places || {};
  const srcEl = document.getElementById('sp-source');
  if (srcEl) {
    if (place.place_id) {
      srcEl.className = 'sp-source place clickable';
      srcEl.textContent = '📍 ' + (place.name || 'Selected place') + '  ›';
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
      srcEl.textContent = '📌 Pinned location';
      srcEl.onclick = null;
    }
  }

  spotPhotoList = (post.photos || []).filter(Boolean);
  spotPhotoIndex = 0;
  const box = document.getElementById('sp-imgbox');
  box.classList.toggle('multi', spotPhotoList.length > 1);
  showSpotPhotoAt(0);

  document.getElementById('sp-title').textContent = post.title || '';
  document.getElementById('sp-author').textContent = post.author
    ? 'Posted by: ' + post.author
    : '';
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
  pushPopupState(); 
}
function closeSpotPanel() {
  const pn = document.getElementById('spot-panel');
  const wasOpen = pn.classList.contains('show');
  pn.classList.remove('show');
  document.getElementById('sp-map-picker').classList.remove('show');
  if (wasOpen) afterManualPopupClose();
}

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

function toggleSpotMapPicker() {
  document.getElementById('sp-map-picker').classList.toggle('show');
}
function openSpotMap(type) {
  if (!currentSpot || !currentSpot.places) return;
  const pl = currentSpot.places;
  const lat = pl.latitude;
  const lng = pl.longitude;
  const name = pl.name || currentSpot.title || 'Destination';
  const hasRealPlace = !!pl.place_id; 
  let url = '';
  if (type === 'kakao') {
    
    url =
      'https://map.kakao.com/link/map/' +
      encodeURIComponent(name) +
      ',' +
      lat +
      ',' +
      lng;
  } else if (type === 'naver') {
    
    url = hasRealPlace
      ? 'https://map.naver.com/p/search/' + encodeURIComponent(name)
      : 'https://map.naver.com/p/search/' + lat + ',' + lng;
  } else if (type === 'google') {
    url =
      'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  }
  if (url) window.open(url, '_blank');
}

async function reportSpot() {
  if (!currentSpot) return;
  if (!confirm('Report this spot? It will be sent to the developer.')) return;
  const text =
    '[Spot report] post id=' +
    currentSpot.id +
    ' / title: ' +
    (currentSpot.title || '') +
    ' / author: ' +
    (currentSpot.author || '');
  const { error } = await supabaseClient
    .from('messages')
    .insert([{ email: null, content: text }]);
  if (error) {
    toast('Failed to send the report');
    return;
  }
  toast('Report received. Thank you.');
}

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

async function loadPerformances() {
  const { data, error } = await supabaseClient
    .from('performances')
    .select('*, venues(*)')
    .eq('is_active', true);
  if (error) {
    console.log('show load error:', error.message);
    return;
  }
  
  perfData = (data || []).filter(
    (p) => p.venues && p.venues.latitude != null && p.venues.longitude != null
  );
  console.log('shows loaded:', perfData.length);

  buildGenreCategories(); 
  if (viewMode === 'festival') renderPerfPins();
}

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
  activeGenres = new Set(genres); 

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

function renderPerfPins() {
  clearPerfPins();
  if (viewMode !== 'festival') return;
  if (!PerfPinClass || !map) return;

  perfData.forEach((p) => {
    const g = p.genre || p.tags;
    if (!g || !activeGenres.has(g)) return; 
    if (festSearchQuery) {
      
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
      return; 
    }
    const pin = new PerfPinClass(p);
    pin.setMap(map);
    perfOverlays.push(pin);
  });
}

function runFestSearch() {
  const input = document.getElementById('fest-search-input');
  const q = input ? (input.value || '').trim() : '';
  festSearchQuery = q;
  const clearBtn = document.getElementById('fest-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  buildPinsForCurrentFilter();
  renderPerfPins();
}

function clearFestSearch() {
  festSearchQuery = '';
  const input = document.getElementById('fest-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('fest-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  buildPinsForCurrentFilter();
  renderPerfPins();
}

function setAllCategories(_mode, on) {
  ['spot', 'yt', 'news', 'resort', 'hotel'].forEach((t) => {
    activeCategories[t] = on;
  });
  document.querySelectorAll('#cat-list .filter-item').forEach((el) => {
    const t = el.dataset.cat;
    if (t) el.classList.toggle('active-' + t, on);
  });
  renderSpotPins();
  renderLivePins();
}

function openPerfPanel(p) {
  currentPerf = p;
  closePanel(); 
  closeSpotPanel(); 

  const img = document.getElementById('pf-img');
  img.src = p.image_url || '';
  img.style.display = p.image_url ? 'block' : 'none';

  document.getElementById('pf-title').textContent = p.title || 'Show';
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
  void panel.offsetWidth; 
  panel.classList.add('show');
  panel.scrollTop = 0;
  pushPopupState(); 
}

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

async function loadLiveVideos() {
  const { data, error } = await supabaseClient
    .from('live_videos')
    .select('*')
    .eq('is_active', true);
  if (error) {
    console.log('live load error:', error.message);
    return;
  }
  liveData = (data || []).filter(
    (v) => v.latitude != null && v.longitude != null
  );
  console.log('live loaded:', liveData.length);
  buildLiveGroups();

  const notice = document.getElementById('live-notice');
  if (notice) notice.classList.toggle('has-live', liveData.length > 0);

  const kc = (k) => liveData.filter((v) => (v.kind || 'stream') === k).length;
  const streamN = liveData.filter((v) => ['stream', 'live', null, undefined, ''].includes(v.kind) || (v.kind !== 'news' && v.kind !== 'resort' && v.kind !== 'hotel')).length;
  const setC = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
  setC('cnt-yt', streamN);
  setC('cnt-news', kc('news'));
  setC('cnt-resort', kc('resort'));
  setC('cnt-hotel', kc('hotel'));

  renderLivePins();
  renderSpotPins();
  buildHomeMegamenu();
  handleDeepLink();
}

function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const cam = params.get('cam');

  if (params.get('contact') && typeof openContact === 'function') {
    setTimeout(openContact, 300);
  }

  const country = params.get('country');
  if (country) {
    const pts = liveData.filter(
      (v) => (v.country || '').toLowerCase() === country.toLowerCase()
    );
    if (pts.length && map) {
      const b = new google.maps.LatLngBounds();
      pts.forEach((v) =>
        b.extend({ lat: parseFloat(v.latitude), lng: parseFloat(v.longitude) })
      );
      map.fitBounds(b);
    }
  }

  if (cam) {
    const item = liveData.find((v) => v.video_id === cam);
    if (item) {
      if (map) {
        map.panTo({ lat: parseFloat(item.latitude), lng: parseFloat(item.longitude) });
        if (map.getZoom() < 13) map.setZoom(14);
      }
      setTimeout(() => openLivePanel(item), 450);
    }
  }
}

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

function liveKindOn(item) {
  const k = item.kind || 'stream';
  if (k === 'news') return activeCategories.news;
  if (k === 'resort') return activeCategories.resort;
  if (k === 'hotel') return activeCategories.hotel;
  return activeCategories.yt;
}

function renderLivePins() {
  clearLivePins();
  if (!LivePinClass || !map) return;

  liveGroups.forEach((g) => {
    const vis = g.items.filter(liveKindOn); 
    if (vis.length === 0) return;
    if (vis.length === 1) {
      addLivePin(vis[0], null);
    } else if (expandedLiveGroup === g.key) {
      
      const N = vis.length;
      const R = 36;
      vis.forEach((it, i) => {
        const ang = (2 * Math.PI / N) * i - Math.PI / 2;
        addLivePin(it, { dx: Math.cos(ang) * R, dy: Math.sin(ang) * R });
      });
    } else {
      addLiveCluster({ ...g, items: vis }); 
    }
  });
}

function openLivePanel(item) {
  currentLive = item;
  closePanel();
  closeSpotPanel();
  closePerfPanel();

  const badge = document.getElementById('lv-badge');
  if (badge) {
    const k = item.kind || 'stream';
    let bt = 'LIVE', bg = 'rgba(255,78,69,0.15)', col = '#ff4e45', bd = 'rgba(255,78,69,0.4)';
    if (k === 'news') { bt = 'NEWS'; bg = 'rgba(43,209,108,0.15)'; col = '#2bd16c'; bd = 'rgba(43,209,108,0.45)'; }
    else if (k === 'resort') { bt = 'RESORT'; bg = 'rgba(240,196,25,0.15)'; col = '#f0c419'; bd = 'rgba(240,196,25,0.45)'; }
    else if (k === 'hotel') { bt = 'HOTEL'; bg = 'rgba(90,185,255,0.15)'; col = '#5ab9ff'; bd = 'rgba(90,185,255,0.45)'; }
    badge.textContent = bt;
    badge.style.background = bg;
    badge.style.color = col;
    badge.style.border = '1px solid ' + bd;
  }

  const box = document.getElementById('lv-videobox');
  const offline = document.getElementById('lv-offline');
  if (item.is_live) {
    
    box.innerHTML =
      '<iframe src="https://www.youtube.com/embed/' +
      encodeURIComponent(item.video_id) +
      '?autoplay=1&mute=1&playsinline=1" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    box.style.display = 'block';
    if (offline) offline.style.display = 'none';
  } else {
    
    box.innerHTML =
      '<img src="https://i.ytimg.com/vi/' +
      encodeURIComponent(item.video_id) +
      '/hqdefault.jpg" alt="" />';
    box.style.display = 'block';
    if (offline) offline.style.display = 'flex';
  }

  currentLiveItem = item;
  document.getElementById('lv-title').textContent = item.title || 'Live';
  document.getElementById('lv-title').classList.toggle('has-page', !!item.slug);
  const vpBtn = document.getElementById('lv-viewpage');
  if (vpBtn) vpBtn.style.display = item.slug ? '' : 'none';
  setPerfMeta('lv-place', item.place_name, '📍 ');
  lvSetupDesc(item.description);

  startLiveClock(item.timezone);

  setLiveSize(liveSizePref || 'm');

  lvCloseForm();
  loadLiveReviews(item.video_id);

  const panel = document.getElementById('live-panel');
  panel.classList.remove('show');
  void panel.offsetWidth;
  panel.classList.add('show');
  panel.scrollTop = 0;
  lvMeasureDesc(); 
  pushPopupState();
}

function lvOpenFullPage() {
  if (currentLiveItem && currentLiveItem.slug) {
    window.location.href = '/cam/' + currentLiveItem.slug + '/';
  }
}

function lvGoToLocation() {
  if (!currentLiveItem || !map) return;
  const lat = parseFloat(currentLiveItem.latitude);
  const lng = parseFloat(currentLiveItem.longitude);
  if (isNaN(lat) || isNaN(lng)) return;
  map.panTo({ lat: lat, lng: lng });
  if (map.getZoom() < 13) map.setZoom(14);
}

function closeLivePanel() {
  const pn = document.getElementById('live-panel');
  const was = pn.classList.contains('show');
  pn.classList.remove('show');
  
  const box = document.getElementById('lv-videobox');
  if (box) box.innerHTML = '';
  stopLiveClock();
  lvCloseForm();
  if (selectedPin) {
    selectedPin.setSelected(false);
    selectedPin = null;
  }
  if (was) afterManualPopupClose();
}

let liveSizePref = 'm';
function setLiveSize(s) {
  liveSizePref = s;
  const panel = document.getElementById('live-panel');
  if (!panel) return;
  panel.classList.remove('size-m', 'size-l', 'size-xl');
  panel.classList.add('size-' + s);
  panel.style.width = '';
  document.querySelectorAll('.lv-sizes button').forEach((b) => {
    b.classList.toggle('on', b.dataset.s === s);
  });
}

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
      el.textContent = '🕐 Local time ' + t;
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

let lvReviewVid = null;
let lvReviews = [];
let lvPickedRating = 0;
let lvLastWrite = 0;

async function loadLiveReviews(vid) {
  lvReviewVid = vid;
  lvReviews = [];
  const list = document.getElementById('lv-review-list');
  if (list) list.innerHTML = '<div class="rv-empty">Loading…</div>';
  const rb = document.getElementById('lv-rating');
  if (rb) rb.textContent = '⭐ –';

  const { data, error } = await supabaseClient
    .from('reviews')
    .select('*')
    .eq('content_id', vid)
    .order('created_at', { ascending: false });
  if (lvReviewVid !== vid) return; 
  if (error) {
    console.log('live review load error:', error.message);
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
    box.textContent = '⭐ No reviews yet';
    return;
  }
  const avg =
    lvReviews.reduce((s, r) => s + r.rating, 0) / lvReviews.length;
  box.textContent = '⭐ ' + avg.toFixed(1) + ' | ' + lvReviews.length + ' ratings';
}

function renderLvReviews() {
  const list = document.getElementById('lv-review-list');
  if (!list) return;
  if (lvReviews.length === 0) {
    list.innerHTML = '<div class="rv-empty">No reviews yet!</div>';
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
        ')">🗑 Delete</button>' +
        '</div>' +
        '<div class="del-confirm" id="lvdc-' +
        r.id +
        '">' +
        '<input type="text" inputmode="numeric" placeholder="Password" id="lvdcpw-' +
        r.id +
        '" />' +
        '<button class="dc-ok" onclick="lvDoDelete(' +
        r.id +
        ')">Delete</button>' +
        '<button class="dc-no" onclick="lvCancelDelete(' +
        r.id +
        ')">Cancel</button>' +
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
  if (!author) { msg.textContent = 'Please enter a name'; return; }
  if (!pw) { msg.textContent = 'Please enter the password'; return; }
  if (lvPickedRating === 0) { msg.textContent = 'Please pick a rating'; return; }
  if (!content) { msg.textContent = 'Please write a review'; return; }
  const now = Date.now();
  if (now - lvLastWrite < 10000) {
    msg.textContent = 'You can post again in 10 seconds';
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
    console.log('live review submit error:', error.message);
    msg.textContent = 'Failed to submit. Please try again in a moment.';
    return;
  }
  lvLastWrite = now;
  if (data && data[0]) lvReviews.unshift(data[0]);
  lvCloseForm();
  renderLvReviews();
  renderLvRating();
}

async function lvLikeReview(id) {
  if (likedIds.has(id)) { toast('You already liked this review'); return; }
  const now = Date.now();
  if (now - lastReviewLike < 10000) {
    toast('You can like once every 10 seconds');
    return;
  }
  const r = lvReviews.find((x) => x.id === id);
  if (!r) return;
  const newLikes = (r.likes || 0) + 1;
  const { error } = await supabaseClient
    .from('reviews')
    .update({ likes: newLikes })
    .eq('id', id);
  if (error) { toast('Please try again in a moment'); return; }
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
  if (!pw) { toast('Please enter the password'); return; }
  const { data, error } = await supabaseClient
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('password', pw)
    .select();
  if (error) { toast('Please try again in a moment'); return; }
  if (!data || data.length === 0) { toast('Wrong password'); return; }
  lvReviews = lvReviews.filter((x) => x.id !== id);
  renderLvReviews();
  renderLvRating();
}

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
  moreBtn.textContent = 'More';
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
  moreBtn.textContent = 'More';
}
function lvToggleDesc() {
  const wrap = document.getElementById('lv-desc');
  const moreBtn = document.getElementById('lv-desc-more');
  const expanded = wrap.classList.toggle('expanded');
  moreBtn.textContent = expanded ? 'Less' : 'More';
}

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

loadFestivals();

(function () {
  var bm = document.getElementById('bar-mode');
  if (!bm) return;
  bm.addEventListener('click', function () {
    if (window.innerWidth > 768) return;
    bm.classList.add('open');
  });
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 768) return;
    if (!bm.contains(e.target)) bm.classList.remove('open');
  });
})();

// ===== v3.6 상단바: 필터 패널 슬라이드 + 홈 메가메뉴 =====
function toggleFilterPanel() {
  var open = document.body.classList.toggle('filters-open');
  var p = document.getElementById('filter-panel');
  var t = document.querySelector('.bar-cats');
  if (p) p.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (t) { t.setAttribute('aria-expanded', open ? 'true' : 'false'); t.classList.toggle('on', open); }
}
function closeFilterPanel() {
  document.body.classList.remove('filters-open');
  var p = document.getElementById('filter-panel');
  var t = document.querySelector('.bar-cats');
  if (p) p.setAttribute('aria-hidden', 'true');
  if (t) { t.setAttribute('aria-expanded', 'false'); t.classList.remove('on'); }
}
document.addEventListener('click', function (e) {
  if (!document.body.classList.contains('filters-open')) return;
  var p = document.getElementById('filter-panel');
  var t = document.querySelector('.bar-cats');
  if (p && p.contains(e.target)) return;
  if (t && t.contains(e.target)) return;
  closeFilterPanel();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeFilterPanel();
});

var JS_CONT = {
  'south korea':'Asia','korea':'Asia','japan':'Asia','china':'Asia','taiwan':'Asia','thailand':'Asia',
  'vietnam':'Asia','indonesia':'Asia','philippines':'Asia','malaysia':'Asia','singapore':'Asia','india':'Asia',
  'nepal':'Asia','sri lanka':'Asia','united arab emirates':'Asia','israel':'Asia','turkey':'Asia','hong kong':'Asia',
  'united states':'North America','usa':'North America','canada':'North America','mexico':'North America',
  'costa rica':'North America','panama':'North America','jamaica':'North America','cuba':'North America','bahamas':'North America',
  'brazil':'South America','argentina':'South America','chile':'South America','peru':'South America','colombia':'South America','ecuador':'South America',
  'united kingdom':'Europe','uk':'Europe','ireland':'Europe','france':'Europe','spain':'Europe','portugal':'Europe',
  'italy':'Europe','germany':'Europe','netherlands':'Europe','belgium':'Europe','switzerland':'Europe','austria':'Europe',
  'poland':'Europe','czech republic':'Europe','czechia':'Europe','greece':'Europe','sweden':'Europe','norway':'Europe',
  'finland':'Europe','denmark':'Europe','iceland':'Europe','croatia':'Europe','hungary':'Europe','romania':'Europe','russia':'Europe','ukraine':'Europe',
  'south africa':'Africa','namibia':'Africa','kenya':'Africa','tanzania':'Africa','egypt':'Africa','morocco':'Africa','nigeria':'Africa','botswana':'Africa',
  'australia':'Oceania','new zealand':'Oceania','fiji':'Oceania'
};
var CONT_ORDER = ['Asia','Europe','North America','South America','Africa','Oceania','Other'];
function jcslug(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'other';}
function jcont(c){return JS_CONT[(c||'').trim().toLowerCase()]||'Other';}

function buildHomeMegamenu() {
  var host = document.getElementById('home-mega');
  if (!host) return;
  var byc = {};
  (liveData || []).forEach(function (v) {
    var c = (v.country || '').trim();
    if (c) byc[c] = (byc[c] || 0) + 1;
  });
  if (!Object.keys(byc).length) { host.innerHTML = '<div class="mega-empty">No live cams yet</div>'; return; }
  var cont = {};
  Object.keys(byc).forEach(function (c) { var k = jcont(c); (cont[k] = cont[k] || []).push([c, byc[c]]); });
  var conts = [], grps = [], first = true;
  CONT_ORDER.forEach(function (k) {
    if (!cont[k]) return;
    cont[k].sort(function (a, b) { return b[1] - a[1]; });
    var total = cont[k].reduce(function (s, x) { return s + x[1]; }, 0);
    var cid = jcslug(k), on = first ? ' on' : '';
    conts.push('<button class="cont' + on + '" data-c="' + cid + '">' + k + ' <i>' + total + '</i></button>');
    var links = cont[k].map(function (x) { return '<a href="/live/' + jcslug(x[0]) + '/">' + x[0] + ' <i>' + x[1] + '</i></a>'; }).join('');
    grps.push('<div class="cgrp' + on + '" data-c="' + cid + '">' + links + '</div>');
    first = false;
  });
  host.innerHTML = '<div class="mega-body"><div class="mega-conts">' +
    conts.join('') + '</div><div class="mega-countries">' + grps.join('') + '</div></div>';
  host.querySelectorAll('.cont').forEach(function (b) {
    function show() {
      var c = b.dataset.c;
      host.querySelectorAll('.cont').forEach(function (x) { x.classList.toggle('on', x.dataset.c === c); });
      host.querySelectorAll('.cgrp').forEach(function (g) { g.classList.toggle('on', g.dataset.c === c); });
    }
    b.addEventListener('mouseenter', show);
    b.addEventListener('click', show);
  });
}

(function () {
  document.querySelectorAll('#sidebar .nav-drop').forEach(function (dd) {
    var tr = dd.querySelector('.nav-trigger');
    if (!tr) return;
    tr.addEventListener('click', function () {
      if (window.innerWidth > 768) return;
      document.querySelectorAll('#sidebar .nav-drop').forEach(function (o) {
        if (o !== dd) o.classList.remove('open');
      });
      dd.classList.toggle('open');
    });
  });
  document.addEventListener('click', function (e) {
    if (window.innerWidth > 768) return;
    if (e.target.closest('#sidebar .nav-drop')) return;
    document.querySelectorAll('#sidebar .nav-drop.open').forEach(function (o) { o.classList.remove('open'); });
  });
})();
