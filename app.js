// Flare[V] v3.9.11 / 2026-06-22
const SUPABASE_URL = 'https://pbrbzjxdjqqmhvhzhwlp.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let map;

let currentReviews = []; 
let likedIds = new Set(); 
let lastReviewWrite = 0; 
let lastReviewLike = 0; 

let selectedPin = null; 
let projectionHelper = null; 
let myLocationMarker = null; 

let activeCategories = { spot: true, yt: true, news: true, resort: true, hotel: true, train: true };


const SPOT_TAGS = ['Scenery', 'Food', 'Unique', 'Relaxing', 'Amazing', 'Live spot'];
let activeSpotTags = new Set(SPOT_TAGS);


let liveData = []; 
let liveGroups = []; 
let liveRendered = new Map();
let selectedLiveId = null; 
let LivePinClass = null;
let LiveClusterClass = null;
let currentLive = null; 
let expandedLiveGroup = null; 

let spotRendered = new Map(); 
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
  { featureType: 'landscape.natural', elementType: 'geometry.fill', stylers: [{ color: '#11111c' }] },
  { featureType: 'landscape.natural', elementType: 'labels.icon', stylers: [{ color: '#00142e' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#111120' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ color: '#06060a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9a9aae' }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0f' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0e1a0e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212135' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#22223a' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#141425' }] },
  { featureType: 'transit.station.airport', elementType: 'labels.icon', stylers: [{ color: '#000042' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1a2b' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#000000' }] },
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
    closeSpotPanel(); 
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

  map.addListener('idle', () => {
    if (!LivePinClass) return;
    if (fvRenderTimer) clearTimeout(fvRenderTimer);
    fvRenderTimer = setTimeout(() => {
      fvRenderTimer = null;
      renderLivePins();
      renderSpotPins();
    }, PIN_RENDER_DELAY_MS);
  });

  map.addListener('bounds_changed', () => {
    if (fvRenderTimer) {
      clearTimeout(fvRenderTimer);
      fvRenderTimer = null;
    }
  });

  loadSpots(); 
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
      else if (kind === 'train') badgeText = 'TRAIN';
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
    constructor(group, opts) {
      super();
      this.group = group;
      this.grid = !!(opts && opts.grid);
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
        if (self.grid) {
          map.panTo(self.position);
          map.setZoom(Math.min((map.getZoom() || 7) + 3, 16));
        } else {
          expandedLiveGroup = self.group.key; 
          renderLivePins();
        }
      });
      this.div = div;
      this.getPanes().overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const pt = this.getProjection().fromLatLngToDivPixel(this.position);
      if (pt) {
        this.div.style.transform =
          'translate(' + (pt.x - 14) + 'px,' + (pt.y - 22) + 'px)';
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












function applyFilters() {
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













function selectPin(pin) {
  if (selectedPin && selectedPin !== pin) selectedPin.setSelected(false);
  selectedPin = pin;
  selectedLiveId = pin && pin.item ? pin.item.video_id : null;
  pin.setSelected(true);
}





function formatReviewDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return m + '/' + day;
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

var deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredInstallPrompt = e;
});
window.addEventListener('appinstalled', function () {
  deferredInstallPrompt = null;
  var sub = document.getElementById('svc-install-sub');
  if (sub) sub.textContent = 'Installed';
});
function pwaIsStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
function pwaIsIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
async function pwaInstall() {
  var hint = document.getElementById('svc-install-hint');
  if (pwaIsStandalone()) {
    if (hint) {
      hint.textContent = 'The app is already installed.';
      hint.classList.add('show');
    }
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch (e) {}
    deferredInstallPrompt = null;
    return;
  }
  if (hint) {
    if (pwaIsIOS()) {
      hint.innerHTML =
        'On iPhone / iPad: tap the <b>Share</b> button, then <b>"Add to Home Screen."</b>';
    } else {
      hint.innerHTML =
        'Open this site in Chrome, then use the browser menu and choose <b>Install app</b> / <b>Add to Home screen.</b>';
    }
    hint.classList.add('show');
  }
}

function lvShare() {
  if (!currentLiveItem) return;
  var url =
    location.origin + '/?cam=' + encodeURIComponent(currentLiveItem.video_id);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      function () {
        toast('Link copied');
      },
      function () {
        lvShareFallback(url);
      }
    );
  } else {
    lvShareFallback(url);
  }
}
function lvShareFallback(url) {
  try {
    var t = document.createElement('textarea');
    t.value = url;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
    toast('Link copied');
  } catch (e) {
    toast('Copy failed');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (pwaIsStandalone()) {
    var si = document.getElementById('svc-install');
    if (si) si.style.display = 'none';
  }
});

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
  } else if (type === 'yt' || type === 'news' || type === 'resort' || type === 'hotel' || type === 'train') {
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


function refreshMap() {
  renderSpotPins();
  renderLivePins();
}

function setViewMode() {
  refreshMap();
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
        .classList.toggle('show', chosenSpotTags.has('Live spot'));
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

    const isLive = chosenSpotTags.has('Live spot');
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

function rebuildSpotPlaces() {
  const byPlace = {};
  spotData.forEach((post) => {
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
  if (!SpotPinClass || !map) {
    updateSpotCount();
    return;
  }
  const pb = fvPaddedBounds(0.25);
  const desired = new Map();
  if (activeCategories.spot) {
    spotPlaces.forEach((place) => {
      if (!fvInBounds(pb, place.latitude, place.longitude)) return;
      const count = place.posts.length;
      desired.set('P|' + place.id + '|' + count, {
        post: place.posts[0], count: count,
      });
    });
  }
  spotRendered.forEach((overlay, key) => {
    if (!desired.has(key)) {
      overlay.setMap(null);
      spotRendered.delete(key);
    }
  });
  desired.forEach((d, key) => {
    if (spotRendered.has(key)) return;
    const pin = new SpotPinClass(d.post, d.count);
    pin.setMap(map);
    spotRendered.set(key, pin);
  });
  updateSpotCount();
}

function updateSpotCount() {
  const el = document.getElementById('cnt-spot');
  if (el) el.textContent = spotPlaces.length;
}

function openSpotPanel(post) {
  currentSpot = post;
  if (selectedPin) {
    selectedPin.setSelected(false); 
    selectedPin = null;
  }
  selectedLiveId = null;
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








function setAllCategories(_mode, on) {
  ['spot', 'yt', 'news', 'resort', 'hotel', 'train'].forEach((t) => {
    activeCategories[t] = on;
  });
  document.querySelectorAll('#cat-list .filter-item').forEach((el) => {
    const t = el.dataset.cat;
    if (t) el.classList.toggle('active-' + t, on);
  });
  renderSpotPins();
  renderLivePins();
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
  const streamN = liveData.filter((v) => ['stream', 'live', null, undefined, ''].includes(v.kind) || (v.kind !== 'news' && v.kind !== 'resort' && v.kind !== 'hotel' && v.kind !== 'train')).length;
  const setC = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
  setC('cnt-yt', streamN);
  setC('cnt-news', kc('news'));
  setC('cnt-resort', kc('resort'));
  setC('cnt-hotel', kc('hotel'));
  setC('cnt-train', kc('train'));

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

const GRID_CLUSTER_ENABLED = true;
const GRID_CLUSTER_MAX_ZOOM = 6;
const GRID_CELL_PX = 64;
const PIN_RENDER_DELAY_MS = 0;
let fvRenderTimer = null;

function fvPaddedBounds(marginFrac) {
  if (!map || !map.getBounds) return null;
  const b = map.getBounds();
  if (!b) return null;
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  const south = sw.lat();
  const north = ne.lat();
  const west = sw.lng();
  const east = ne.lng();
  const crosses = east < west;
  const latPad = (north - south) * marginFrac;
  let lngSpan = east - west;
  if (crosses) lngSpan += 360;
  const lngPad = lngSpan * marginFrac;
  return {
    south: south - latPad,
    north: north + latPad,
    west: west - lngPad,
    east: east + lngPad,
    crosses: crosses,
  };
}

function fvInBounds(pb, lat, lng) {
  if (!pb) return true;
  if (lat < pb.south || lat > pb.north) return false;
  if (pb.crosses) return lng >= pb.west || lng <= pb.east;
  return lng >= pb.west && lng <= pb.east;
}

function clearLivePins() {
  liveRendered.forEach((o) => o.setMap(null));
  liveRendered.clear();
}

function liveKindOn(item) {
  const k = item.kind || 'stream';
  if (k === 'news') return activeCategories.news;
  if (k === 'resort') return activeCategories.resort;
  if (k === 'hotel') return activeCategories.hotel;
  if (k === 'train') return activeCategories.train;
  return activeCategories.yt;
}

function fvAddGroupDesired(desired, g, vis) {
  if (vis.length === 1) {
    const it = vis[0];
    desired.set('S|' + it.video_id + '|' + (it.is_live ? 1 : 0), {
      cls: 'pin', item: it, fan: null,
    });
  } else if (expandedLiveGroup === g.key) {
    const N = vis.length;
    const R = 36;
    vis.forEach((it, i) => {
      const ang = (2 * Math.PI / N) * i - Math.PI / 2;
      desired.set('F|' + it.video_id + '|' + N + '|' + (it.is_live ? 1 : 0), {
        cls: 'pin', item: it, fan: { dx: Math.cos(ang) * R, dy: Math.sin(ang) * R },
      });
    });
  } else {
    const anyOn = vis.some((it) => it.is_live);
    desired.set('C|' + g.key + '|' + vis.length + '|' + (anyOn ? 1 : 0), {
      cls: 'cluster', group: { ...g, items: vis },
    });
  }
}

function renderLivePins() {
  if (!LivePinClass || !map) return;
  const pb = fvPaddedBounds(0.25);
  const zoom = map.getZoom ? map.getZoom() : 12;
  const proj = map.getProjection ? map.getProjection() : null;
  const useGrid = GRID_CLUSTER_ENABLED && !!proj && zoom != null && zoom <= GRID_CLUSTER_MAX_ZOOM;

  const desired = new Map();

  if (useGrid) {
    const scale = Math.pow(2, zoom);
    const cells = new Map();
    liveGroups.forEach((g) => {
      if (!fvInBounds(pb, g.lat, g.lng)) return;
      const vis = g.items.filter(liveKindOn);
      if (vis.length === 0) return;
      const p = proj.fromLatLngToPoint(new google.maps.LatLng(g.lat, g.lng));
      const cx = Math.floor((p.x * scale) / GRID_CELL_PX);
      const cy = Math.floor((p.y * scale) / GRID_CELL_PX);
      const cellKey = cx + '_' + cy;
      let cell = cells.get(cellKey);
      if (!cell) {
        cell = { members: [], items: [] };
        cells.set(cellKey, cell);
      }
      cell.members.push({ g: g, vis: vis });
      vis.forEach((it) => cell.items.push(it));
    });
    cells.forEach((cell, cellKey) => {
      if (cell.members.length === 1) {
        fvAddGroupDesired(desired, cell.members[0].g, cell.members[0].vis);
      } else {
        let aLat = cell.members[0].g.lat;
        let aLng = cell.members[0].g.lng;
        let best = -1;
        cell.members.forEach((m) => {
          let s = 0;
          m.vis.forEach((it) => {
            const v = it.like_count || 0;
            if (v > s) s = v;
          });
          if (s > best) {
            best = s;
            aLat = m.g.lat;
            aLng = m.g.lng;
          }
        });
        const anyOn = cell.items.some((it) => it.is_live);
        desired.set('G|' + cellKey + '|' + cell.items.length + '|' + (anyOn ? 1 : 0), {
          cls: 'grid',
          group: { items: cell.items, key: 'grid_' + cellKey, lat: aLat, lng: aLng },
        });
      }
    });
  } else {
    liveGroups.forEach((g) => {
      if (!fvInBounds(pb, g.lat, g.lng)) return;
      const vis = g.items.filter(liveKindOn);
      if (vis.length === 0) return;
      fvAddGroupDesired(desired, g, vis);
    });
  }

  liveRendered.forEach((overlay, key) => {
    if (!desired.has(key)) {
      overlay.setMap(null);
      liveRendered.delete(key);
    }
  });

  desired.forEach((d, key) => {
    if (liveRendered.has(key)) return;
    let overlay;
    if (d.cls === 'pin') {
      overlay = new LivePinClass(d.item, d.fan);
    } else if (d.cls === 'grid') {
      overlay = new LiveClusterClass(d.group, { grid: true });
    } else {
      overlay = new LiveClusterClass(d.group);
    }
    overlay.setMap(map);
    liveRendered.set(key, overlay);
  });

  if (selectedLiveId) {
    let found = null;
    liveRendered.forEach((overlay) => {
      if (overlay.item && overlay.setSelected) {
        const sel = overlay.item.video_id === selectedLiveId;
        overlay.setSelected(sel);
        if (sel) found = overlay;
      }
    });
    if (found) selectedPin = found;
  }
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

// ===== Weather (Open-Meteo, free, no API key) =====
function fvGetUnit() { try { return localStorage.getItem('flarev_unit') === 'f' ? 'f' : 'c'; } catch (e) { return 'c'; } }
function fvSetUnit(u) { try { localStorage.setItem('flarev_unit', u); } catch (e) {} }
function fvWxText(code) {
  if (code === 0) return ['☀️', 'Clear'];
  if (code === 1) return ['🌤️', 'Mainly clear'];
  if (code === 2) return ['⛅', 'Partly cloudy'];
  if (code === 3) return ['☁️', 'Overcast'];
  if (code === 45 || code === 48) return ['🌫️', 'Fog'];
  if (code >= 51 && code <= 57) return ['🌦️', 'Drizzle'];
  if (code >= 61 && code <= 67) return ['🌧️', 'Rain'];
  if (code >= 71 && code <= 77) return ['🌨️', 'Snow'];
  if (code >= 80 && code <= 82) return ['🌧️', 'Showers'];
  if (code === 85 || code === 86) return ['🌨️', 'Snow showers'];
  if (code >= 95) return ['⛈️', 'Thunderstorm'];
  return ['🌡️', 'Weather'];
}
function fvRenderWx(el, data) {
  if (!el || !data) return;
  const u = fvGetUnit();
  const temp = u === 'f' ? Math.round(data.t * 9 / 5 + 32) : Math.round(data.t);
  const wx = fvWxText(data.code);
  el.innerHTML =
    wx[0] + ' ' + wx[1] +
    ' · 🌡️ <span class="wx-unit" role="button" tabindex="0" title="Switch °C / °F">' +
    temp + '°' + (u === 'f' ? 'F' : 'C') + '</span> · 💧 ' + data.h + '%';
  const ut = el.querySelector('.wx-unit');
  if (ut) ut.onclick = function (e) {
    e.stopPropagation();
    fvSetUnit(fvGetUnit() === 'c' ? 'f' : 'c');
    document.querySelectorAll('[data-wx]').forEach(function (n) {
      try { fvRenderWx(n, JSON.parse(n.getAttribute('data-wx'))); } catch (err) {}
    });
  };
}
function loadWeather(item, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const lat = parseFloat(item.latitude), lng = parseFloat(item.longitude);
  if (isNaN(lat) || isNaN(lng)) { el.style.display = 'none'; el.removeAttribute('data-wx'); return; }
  el.style.display = '';
  el.textContent = '⛅ …';
  fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng + '&current=temperature_2m,relative_humidity_2m,weather_code')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const c = j && j.current;
      if (!c || typeof c.temperature_2m !== 'number') { el.style.display = 'none'; return; }
      const data = { t: c.temperature_2m, h: c.relative_humidity_2m, code: c.weather_code };
      el.setAttribute('data-wx', JSON.stringify(data));
      fvRenderWx(el, data);
    })
    .catch(function () { el.style.display = 'none'; });
}

function openLivePanel(item) {
  currentLive = item;
  closeSpotPanel();

  const badge = document.getElementById('lv-badge');
  if (badge) {
    const k = item.kind || 'stream';
    let bt = 'LIVE', bg = 'rgba(255,78,69,0.15)', col = '#ff4e45', bd = 'rgba(255,78,69,0.4)';
    if (k === 'news') { bt = 'NEWS'; bg = 'rgba(131,149,167,0.18)'; col = '#8395a7'; bd = 'rgba(131,149,167,0.5)'; }
    else if (k === 'resort') { bt = 'RESORT'; bg = 'rgba(240,196,25,0.15)'; col = '#f0c419'; bd = 'rgba(240,196,25,0.45)'; }
    else if (k === 'hotel') { bt = 'HOTEL'; bg = 'rgba(90,185,255,0.15)'; col = '#5ab9ff'; bd = 'rgba(90,185,255,0.45)'; }
    else if (k === 'train') { bt = 'TRAIN'; bg = 'rgba(38,222,129,0.15)'; col = '#26de81'; bd = 'rgba(38,222,129,0.45)'; }
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
  loadWeather(item, 'lv-weather');
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
  selectedLiveId = null;
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
    .rpc('like_review', { p_id: String(id) });
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
    .rpc('delete_review', { p_id: String(id), p_pw: pw });
  if (error) { toast('Please try again in a moment'); return; }
  if (!data) { toast('Wrong password'); return; }
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
      document.querySelectorAll('#sidebar .nav-drop').forEach(function (o) {
        if (o !== dd) o.classList.remove('open');
      });
      dd.classList.toggle('open');
    });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('#sidebar .nav-drop')) return;
    document.querySelectorAll('#sidebar .nav-drop.open').forEach(function (o) { o.classList.remove('open'); });
  });
})();


const FV_CHAT_MSG_MAX = 300;
const FV_CHAT_KEEP = 500;
const FV_CHAT_POLL_MS = 5000;
const FV_CHAT_BG_MS = 8000;
const FV_CHAT_COOLDOWN_MS = 3000;
const FV_CHAT_COLORS = [
  '#ff8a80', '#7fd1ff', '#b6ff8a', '#ffd27f',
  '#d7a8ff', '#80f0d0', '#ff9ecd', '#a0c4ff',
];

const fvChatNick = 'guest_' + Math.floor(1000 + Math.random() * 9000);
let fvChatTimer = null;
let fvChatBgTimer = null;
let fvChatLastSend = 0;
let fvChatLoading = false;
let fvChatLastSeen = 0;
let fvChatBaselineSet = false;
let fvChatNoticeShown = false;

function fvChatIsOpen() {
  const box = document.getElementById('fv-chat');
  return box ? box.classList.contains('fv-chat-open') : false;
}

function fvChatColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FV_CHAT_COLORS[h % FV_CHAT_COLORS.length];
}

function fvChatTimeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  const day = Math.floor(hr / 24);
  return day + 'd';
}

function fvChatRender(rows) {
  const list = document.getElementById('fv-chat-list');
  if (!list) return;

  const nearBottom =
    list.scrollHeight - list.scrollTop - list.clientHeight < 60;

  list.innerHTML = '';

  if (!rows || rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fv-chat-empty';
    empty.textContent = 'No messages yet. Say hi!';
    list.appendChild(empty);
  } else {
    rows.forEach(function (r) {
      const row = document.createElement('div');
      row.className = 'fv-msg';

      const nm = document.createElement('span');
      nm.className = 'fv-msg-name';
      nm.style.color = fvChatColor(r.nickname);
      nm.textContent = r.nickname;

      const tx = document.createElement('span');
      tx.className = 'fv-msg-text';
      tx.textContent = r.message;

      const tm = document.createElement('span');
      tm.className = 'fv-msg-time';
      tm.textContent = fvChatTimeAgo(r.created_at);

      row.appendChild(nm);
      row.appendChild(tx);
      row.appendChild(tm);
      list.appendChild(row);
    });
  }

  const countEl = document.getElementById('fv-chat-count');
  if (countEl) countEl.textContent = rows && rows.length ? String(rows.length) : '';

  if (rows && rows.length) {
    const newest = new Date(rows[rows.length - 1].created_at).getTime();
    if (!isNaN(newest)) {
      fvChatLastSeen = newest;
      fvChatBaselineSet = true;
    }
  }

  if (nearBottom) list.scrollTop = list.scrollHeight;
}

async function fvChatLoad() {
  if (fvChatLoading) return;
  fvChatLoading = true;
  try {
    const res = await supabaseClient
      .from('chat_messages')
      .select('nickname,message,created_at')
      .order('created_at', { ascending: false })
      .limit(FV_CHAT_KEEP);
    if (res.error) throw res.error;
    const rows = (res.data || []).slice().reverse();
    fvChatRender(rows);
  } catch (e) {
    console.error('chat load error:', e);
    if (!fvChatNoticeShown) {
      const list = document.getElementById('fv-chat-list');
      if (list) {
        list.innerHTML = '';
        const note = document.createElement('div');
        note.className = 'fv-chat-empty';
        note.textContent = 'Chat is getting ready...';
        list.appendChild(note);
      }
      fvChatNoticeShown = true;
    }
  } finally {
    fvChatLoading = false;
  }
}

async function fvChatPeek() {
  try {
    const res = await supabaseClient
      .from('chat_messages')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (res.error) throw res.error;
    const rows = res.data || [];
    if (!rows.length) return;
    const newest = new Date(rows[0].created_at).getTime();
    if (isNaN(newest)) return;
    if (!fvChatBaselineSet) {
      fvChatLastSeen = newest;
      fvChatBaselineSet = true;
      return;
    }
    if (newest > fvChatLastSeen) {
      fvChatLastSeen = newest;
      if (!fvChatIsOpen()) fvChatNotify();
    }
  } catch (e) {
    console.error('chat peek error:', e);
  }
}

function fvChatNotify() {
  const fab = document.getElementById('fv-chat-fab');
  if (fab) fab.classList.add('fv-chat-fab-new');
}

async function fvChatSend() {
  const inputEl = document.getElementById('fv-chat-input');
  if (!inputEl) return;

  const msg = (inputEl.value || '').trim();
  if (!msg) return;

  const now = Date.now();
  if (now - fvChatLastSend < FV_CHAT_COOLDOWN_MS) {
    toast('Please wait a moment before sending again.');
    return;
  }

  const payload = { nickname: fvChatNick, message: msg.slice(0, FV_CHAT_MSG_MAX) };

  try {
    const res = await supabaseClient.from('chat_messages').insert(payload);
    if (res.error) throw res.error;
    fvChatLastSend = now;
    inputEl.value = '';
    await fvChatLoad();
  } catch (e) {
    console.error('chat send error:', e);
    const txt = (e && (e.message || e.details || e.hint || '')) + '';
    if (txt.indexOf('rate_limited') !== -1) {
      toast('You are sending too fast. Please slow down.');
    } else if (txt.toLowerCase().indexOf('row-level') !== -1 ||
               txt.toLowerCase().indexOf('permission') !== -1 ||
               txt.toLowerCase().indexOf('policy') !== -1) {
      toast('Chat is not set up yet. Please try again later.');
    } else {
      toast('Could not send. Please try again in a moment.');
    }
  }
}

function fvChatStartPolling() {
  fvChatStopPolling();
  fvChatTimer = setInterval(function () {
    if (fvChatIsOpen() && !document.hidden) fvChatLoad();
  }, FV_CHAT_POLL_MS);
}

function fvChatStopPolling() {
  if (fvChatTimer) {
    clearInterval(fvChatTimer);
    fvChatTimer = null;
  }
}

function fvChatStartBg() {
  fvChatStopBg();
  fvChatBgTimer = setInterval(function () {
    if (!document.hidden && !fvChatIsOpen()) fvChatPeek();
  }, FV_CHAT_BG_MS);
}

function fvChatStopBg() {
  if (fvChatBgTimer) {
    clearInterval(fvChatBgTimer);
    fvChatBgTimer = null;
  }
}

function fvChatToggle() {
  const box = document.getElementById('fv-chat');
  const fab = document.getElementById('fv-chat-fab');
  if (!box) return;
  const open = box.classList.toggle('fv-chat-open');
  if (fab) {
    fab.classList.toggle('fv-chat-fab-on', open);
    if (open) fab.classList.remove('fv-chat-fab-new');
  }
  if (open) {
    fvChatLoad();
    fvChatStartPolling();
    const inputEl = document.getElementById('fv-chat-input');
    if (inputEl) setTimeout(function () { inputEl.focus(); }, 50);
  } else {
    fvChatStopPolling();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('fv-chat-fab')) return;
  const pill = document.getElementById('fv-chat-me-pill');
  if (pill) {
    const dot = document.createElement('span');
    dot.className = 'fv-chat-me-dot';
    dot.style.background = fvChatColor(fvChatNick);
    const nm = document.createElement('span');
    nm.textContent = fvChatNick;
    pill.appendChild(dot);
    pill.appendChild(nm);
  }
  fvChatPeek();
  fvChatStartBg();
});

document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    fvChatStopPolling();
    fvChatStopBg();
  } else {
    fvChatStartBg();
    if (fvChatIsOpen()) {
      fvChatLoad();
      fvChatStartPolling();
    } else {
      fvChatPeek();
    }
  }
});
