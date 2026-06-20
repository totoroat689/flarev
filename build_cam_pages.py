# ============================================
# Flare[V] 캠 상세페이지 생성기  (build_cam_pages.py)
# 버전: 2.0 / 2026-06-17
# 역할: live_videos 에서 좋아요 상위 N개 → /cam/<slug>/index.html 정적 페이지 생성.
#       + sitemap.xml, "근처 캠"(실제 썸네일), 내용 빈약하면 noindex 자동.
# v2.0 변경:
#   - 칩 마우스오버 툴팁: LIVE(며칠째), #N most liked(좋아요 수), Sunset/Sunrise(현지 시각)
#   - 일출/일몰 실제 계산(좌표 기반) → "Sunset soon / Sunset time" 정밀 표시
#   - 댓글: 라이브 리뷰(reviews 테이블)를 브라우저에서 직접 로드(최대 높이 스크롤) + 작성 팝업
#   - 근처 캠: 이모지 → 유튜브 실제 썸네일
#   - Open in map: 채도 어둡게 + /?cam=<video_id> 딥링크 (지도에서 팝업 열림)
#   - 상단 Spots: /?view=spots&date=month 로 이동
#   - 메타데이터(라이브시작/게시일/구독자/채널로고/국가 등)는 값이 있으면 표시, 없으면 자동 숨김
# 실행: GitHub Actions. 비용: AI·유튜브 안 씀(0). DB 읽기만.
# ============================================

import os
import html
import json
import math
from datetime import datetime, timezone
from urllib.parse import quote

from supabase import create_client

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

SITE = "https://flarev.co"
TOP_N = None            # None = 전체 생성 (slug 있는 활성 캠 전부). 숫자로 두면 그 개수만.
NEARBY_COUNT = 6
OUT_ROOT = "."
INTRO_MIN = 40


def esc(s):
    return html.escape(str(s if s is not None else ""))


def human(n):
    try:
        n = int(n or 0)
    except Exception:
        return "0"
    if n >= 1_000_000:
        return f"{n/1_000_000:.0f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}K"
    return str(n)


def as_highlights(v):
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    if isinstance(v, str) and v.strip():
        try:
            d = json.loads(v)
            if isinstance(d, list):
                return [str(x) for x in d if str(x).strip()]
        except Exception:
            return []
    return []


def is_thin(cam):
    intro = (cam.get("seo_intro") or "").strip()
    hl = as_highlights(cam.get("seo_highlights"))
    return len(intro) < INTRO_MIN and len(hl) == 0


def thumb(vid, q="mqdefault"):
    return f"https://i.ytimg.com/vi/{vid}/{q}.jpg"


import re as _re


def cslug(s):
    s = (s or "").lower()
    s = _re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "other"


# 나라 → 대륙 매핑 (AI가 내보내는 영어 국가명 기준). 없으면 "Other".
COUNTRY_CONTINENT = {
    "south korea": "Asia", "korea": "Asia", "japan": "Asia", "china": "Asia", "taiwan": "Asia",
    "thailand": "Asia", "vietnam": "Asia", "indonesia": "Asia", "philippines": "Asia",
    "malaysia": "Asia", "singapore": "Asia", "india": "Asia", "nepal": "Asia", "sri lanka": "Asia",
    "united arab emirates": "Asia", "israel": "Asia", "turkey": "Asia", "hong kong": "Asia",
    "united states": "North America", "usa": "North America", "canada": "North America",
    "mexico": "North America", "costa rica": "North America", "panama": "North America",
    "jamaica": "North America", "cuba": "North America", "bahamas": "North America",
    "brazil": "South America", "argentina": "South America", "chile": "South America",
    "peru": "South America", "colombia": "South America", "ecuador": "South America",
    "united kingdom": "Europe", "uk": "Europe", "ireland": "Europe", "france": "Europe",
    "spain": "Europe", "portugal": "Europe", "italy": "Europe", "germany": "Europe",
    "netherlands": "Europe", "belgium": "Europe", "switzerland": "Europe", "austria": "Europe",
    "poland": "Europe", "czech republic": "Europe", "czechia": "Europe", "greece": "Europe",
    "sweden": "Europe", "norway": "Europe", "finland": "Europe", "denmark": "Europe",
    "iceland": "Europe", "croatia": "Europe", "hungary": "Europe", "romania": "Europe",
    "russia": "Europe", "ukraine": "Europe",
    "south africa": "Africa", "namibia": "Africa", "kenya": "Africa", "tanzania": "Africa",
    "egypt": "Africa", "morocco": "Africa", "nigeria": "Africa", "botswana": "Africa",
    "australia": "Oceania", "new zealand": "Oceania", "fiji": "Oceania",
}
CONTINENT_ORDER = ["Asia", "Europe", "North America", "South America", "Africa", "Oceania", "Other"]


def continent_of(country):
    return COUNTRY_CONTINENT.get((country or "").strip().lower(), "Other")


def build_menu_data(rows):
    """대륙 → [(country, count, cslug)] (라이브가 있는 나라만)."""
    by_country = {}
    for r in rows:
        c = (r.get("country") or "").strip()
        if not c:
            continue
        by_country.setdefault(c, 0)
        by_country[c] += 1
    cont = {}
    for country, n in by_country.items():
        cont.setdefault(continent_of(country), []).append((country, n, cslug(country)))
    for k in cont:
        cont[k].sort(key=lambda x: -x[1])
    ordered = [(c, cont[c]) for c in CONTINENT_ORDER if c in cont]
    return ordered


def build_bar(menu):
    conts, grps, first = [], [], True
    for cont_name, countries in menu:
        cid = cslug(cont_name)
        total = sum(n for _, n, _ in countries)
        on = " on" if first else ""
        conts.append(f'<button class="cont{on}" data-c="{cid}">{esc(cont_name)} <i>{total}</i></button>')
        links = "".join(
            f'<a href="/live/{cs}/">{esc(cn)} <i>{n}</i></a>' for cn, n, cs in countries
        )
        grps.append(f'<div class="cgrp{on}" data-c="{cid}">{links}</div>')
        first = False

    cats = (
        '<div class="nav-drop nav-disabled"><span class="nav-trigger">Categories</span>'
        '<div class="mega mega-cats"><div class="filter-list">'
        '<div class="filter-item active-spot"><div class="filter-dot dot-spot"></div><span class="filter-text">Spots</span></div>'
        '<div class="filter-item active-yt"><div class="filter-dot dot-yt"></div><span class="filter-text">Live</span></div>'
        '<div class="filter-item active-news"><div class="filter-dot dot-news"></div><span class="filter-text">Local news</span></div>'
        '<div class="filter-item active-resort"><div class="filter-dot dot-resort"></div><span class="filter-text">Resort</span></div>'
        '<div class="filter-item active-hotel"><div class="filter-dot dot-hotel"></div><span class="filter-text">Hotel</span></div>'
        '</div></div></div>'
    )

    nav = (
        '<nav id="sidebar">'
        '<div class="logo-wrap"><div class="logo" onclick="location.href=\'/\'" style="cursor:pointer">FLARE<span>[V]</span></div>'
        '<span class="logo-flare"></span><span class="logo-light"></span></div>'
        + cats +
        '<a class="bar-link" href="/top/">Ranking</a>'
        '<div class="nav-drop"><span class="nav-trigger">Live cams</span>'
        '<div class="mega" id="live-mega"><div class="mega-body"><div class="mega-conts">' + "".join(conts) + '</div>'
        '<div class="mega-countries">' + "".join(grps) + '</div></div></div></div>'
        '<span class="bar-spacer"></span>'
        '<a class="contact-btn" href="/?contact=1">Message</a>'
        '</nav>'
    )
    js = (
        "<script>(function(){var root=document.getElementById('live-mega');if(!root)return;"
        "function show(c){root.querySelectorAll('.cont').forEach(function(b){b.classList.toggle('on',b.dataset.c===c);});"
        "root.querySelectorAll('.cgrp').forEach(function(g){g.classList.toggle('on',g.dataset.c===c);});}"
        "root.querySelectorAll('.cont').forEach(function(b){"
        "b.addEventListener('mouseenter',function(){show(b.dataset.c);});"
        "b.addEventListener('click',function(){show(b.dataset.c);});});"
        "document.querySelectorAll('.nav-drop').forEach(function(dd){var tr=dd.querySelector('.nav-trigger');"
        "if(tr)tr.addEventListener('click',function(){if(window.innerWidth<=760)dd.classList.toggle('open');});});"
        "})();</script>"
    )
    return nav + js


# ============================================
# 페이지 HTML
# ============================================
def render_page(cam, rank, nearby, menu_html):
    vid = cam.get("video_id") or ""
    title = cam.get("title") or "Live Cam"
    place = cam.get("place_name") or ""
    country = cam.get("country") or ""
    tz = cam.get("timezone") or ""
    slug = cam.get("slug") or vid
    intro = (cam.get("seo_intro") or "").strip()
    hl = as_highlights(cam.get("seo_highlights"))
    channel = cam.get("channel_title") or ""
    lat = cam.get("latitude")
    lng = cam.get("longitude")
    likes = int(cam.get("like_count") or 0)
    views = cam.get("view_count") or 0
    watching = int(cam.get("concurrent_viewers") or 0)

    # 메타데이터(있으면 표시) — 아직 비어있을 수 있음
    live_start = cam.get("live_started_at") or ""
    published = cam.get("published_at") or ""
    subs = cam.get("subscriber_count")
    channel_logo = cam.get("channel_logo") or ""

    canonical = f"{SITE}/cam/{slug}/"
    page_title = f"{title} — Watch {place} Live | Flare[V]" if place else f"{title} | Flare[V]"
    meta_desc = intro[:155] if intro else f"Watch {place} live, 24/7, on Flare[V] — live web cams around the world on one map."
    thin = is_thin(cam)
    robots = '<meta name="robots" content="noindex,follow" />' if thin else ""

    # 칩 (data-tip = 마우스오버 툴팁)
    chips = ['<span class="chip live" id="chip-live"><span class="dot"></span> LIVE</span>']
    if rank:
        chips.append(f'<span class="chip rank" data-tip="{likes:,} likes">🔥 #{rank} most liked</span>')
    if watching > 0:
        chips.append(f'<span class="chip" data-tip="{watching:,} watching right now">👀 {watching:,} watching</span>')
    chips.append('<span class="chip see dn" id="chip-dn">🕐 —</span>')
    chips_html = "\n          ".join(chips)

    # 정보표
    facts = []
    if place:
        facts.append(f'<tr><td class="k">Location</td><td class="v">{esc(place)}</td></tr>')
    if country:
        facts.append(f'<tr><td class="k">Country</td><td class="v">{esc(country)}</td></tr>')
    if tz:
        facts.append('<tr><td class="k">Local time</td><td class="v lt">—</td></tr>')
    if lat is not None and lng is not None:
        facts.append(f'<tr><td class="k">Coordinates</td><td class="v">{float(lat):.3f}, {float(lng):.3f}</td></tr>')
    if watching > 0:
        facts.append(f'<tr><td class="k">Watching now</td><td class="v">{watching:,}</td></tr>')
    facts.append(f'<tr><td class="k">Total views</td><td class="v">{human(views)}</td></tr>')
    facts.append(f'<tr><td class="k">Likes</td><td class="v">{human(likes)}</td></tr>')
    if subs:
        facts.append(f'<tr><td class="k">Subscribers</td><td class="v">{human(subs)}</td></tr>')
    if live_start:
        facts.append(f'<tr><td class="k">Streaming since</td><td class="v">{esc(live_start[:10])}</td></tr>')
    if published:
        facts.append(f'<tr><td class="k">Published</td><td class="v">{esc(published[:10])}</td></tr>')
    if channel:
        logo = f'<img class="ch-logo" src="{esc(channel_logo)}" alt="" />' if channel_logo else ""
        facts.append(f'<tr><td class="k">Channel</td><td class="v">{logo}{esc(channel)}</td></tr>')
    facts_html = "\n            ".join(facts)

    about_html = f'<section><h2>About this cam</h2><p>{esc(intro)}</p></section>' if intro else ""
    see_html = ""
    if hl:
        items = "".join(f"<li>{esc(x)}</li>" for x in hl)
        see_html = f'<section><h2>What you’ll see</h2><ul class="see-list">{items}</ul></section>'

    if tz:
        best_html = ('<section><h2>Best time to watch</h2>'
                     '<p>It’s currently <b class="bn">—</b> at this location — '
                     '<span class="bt">checking local conditions…</span></p></section>')
    else:
        best_html = ('<section><h2>Best time to watch</h2>'
                     '<p>This camera streams live around the clock.</p></section>')

    # 근처 캠 (실제 썸네일)
    cards = []
    for nb in nearby:
        nbvid = nb.get("video_id") or ""
        nb_place = nb.get("place_name") or nb.get("country") or ""
        cards.append(
            f'<a class="card" href="/cam/{esc(nb.get("slug") or nbvid)}/">'
            f'<div class="th"><img loading="lazy" src="{thumb(nbvid)}" alt="" /></div>'
            f'<div class="cap"><div class="nm">{esc((nb.get("title") or "")[:48])}</div>'
            f'<div class="cs">{esc(nb_place)}</div></div></a>'
        )
    nearby_html = ""
    if cards:
        nearby_html = ('<section><h2>Nearby &amp; similar cams</h2>'
                       f'<div class="cards">{"".join(cards)}</div></section>')

    # JSON-LD
    jsonld = {"@context": "https://schema.org", "@type": "VideoObject", "name": title,
              "description": meta_desc, "thumbnailUrl": [thumb(vid, "hqdefault")],
              "uploadDate": (published or cam.get("created_at") or "")[:10] or None,
              "embedUrl": f"https://www.youtube.com/embed/{vid}", "isLiveBroadcast": True,
              "contentUrl": f"https://www.youtube.com/watch?v={vid}"}
    jsonld = {k: v for k, v in jsonld.items() if v is not None}
    crumb_country = esc(country) if country else "Live cams"
    breadcrumb = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": crumb_country, "item": SITE + "/?view=spots&date=month"},
        {"@type": "ListItem", "position": 3, "name": title, "item": canonical}]}
    jsonld_html = ('<script type="application/ld+json">' + json.dumps(jsonld, ensure_ascii=False) + "</script>\n"
                   '<script type="application/ld+json">' + json.dumps(breadcrumb, ensure_ascii=False) + "</script>")

    repl = {
        "__ROBOTS__": robots, "__PAGETITLE__": esc(page_title), "__METADESC__": esc(meta_desc),
        "__CANONICAL__": canonical, "__JSONLD__": jsonld_html, "__CRUMB_COUNTRY__": crumb_country,
        "__CRUMB_HREF__": (f"/?view=live&country={quote(country)}" if country else "/"),
        "__BAR__": menu_html, "__BARCSS__": BAR_CSS,
        "__H1__": esc(page_title.split(" | ")[0]), "__VID__": esc(vid),
        "__EMBED__": f"https://www.youtube.com/embed/{vid}?autoplay=1&mute=1&playsinline=1",
        "__PIPNAME__": esc(title[:28]), "__CHIPS__": chips_html, "__FACTS__": facts_html,
        "__ABOUT__": about_html, "__SEE__": see_html, "__BEST__": best_html, "__NEARBY__": nearby_html,
        "__MAPHREF__": f"{SITE}/?cam={esc(vid)}",
        "__TZ__": esc(tz), "__LAT__": (str(float(lat)) if lat is not None else ""),
        "__LNG__": (str(float(lng)) if lng is not None else ""),
        "__LIVESTART__": esc(live_start), "__SBURL__": SUPABASE_URL, "__SBKEY__": SUPABASE_KEY,
    }
    out = TEMPLATE
    for k, v in repl.items():
        out = out.replace(k, v)
    return out, thin


def _haversine_km(lat1, lng1, lat2, lng2):
    # 두 좌표(위도/경도) 사이의 거리를 km 단위로 계산
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# 같은 종류(kind)일 때 거리를 이 비율로 줄여서 더 가깝게 취급(=우선순위 가산점)
SAME_KIND_FACTOR = 0.6


def pick_nearby(cam, pool):
    # 거리 우선: 현재 캠과 실제로 가까운 캠을 먼저, 같은 종류면 가산점으로 위로.
    # 좌표가 없는 캠은 인기순으로 뒤에 채운다.
    me = cam.get("video_id")
    my_kind = cam.get("kind")
    candidates = [c for c in pool if c.get("video_id") != me]

    def has_coords(c):
        return c.get("latitude") is not None and c.get("longitude") is not None

    try:
        my_lat = float(cam.get("latitude"))
        my_lng = float(cam.get("longitude"))
        my_has_coords = True
    except (TypeError, ValueError):
        my_has_coords = False

    if my_has_coords:
        with_coords = []
        without_coords = []
        for c in candidates:
            if has_coords(c):
                try:
                    d = _haversine_km(my_lat, my_lng, float(c["latitude"]), float(c["longitude"]))
                except (TypeError, ValueError):
                    without_coords.append(c)
                    continue
                # 같은 종류면 유효 거리를 줄여 더 가깝게(=먼저) 보이도록
                if my_kind and c.get("kind") == my_kind:
                    d *= SAME_KIND_FACTOR
                with_coords.append((d, c))
            else:
                without_coords.append(c)
        with_coords.sort(key=lambda x: x[0])
        # 좌표 없는 캠은 인기순으로 뒤에 채움
        without_coords.sort(key=lambda c: -(c.get("like_count") or 0))
        ordered = [c for _, c in with_coords] + without_coords
    else:
        # 현재 캠 좌표가 없으면 같은 나라 먼저, 그다음 인기순
        same = [c for c in candidates if c.get("country") and c.get("country") == cam.get("country")]
        others = [c for c in candidates if c not in same]
        same.sort(key=lambda c: -(c.get("like_count") or 0))
        others.sort(key=lambda c: -(c.get("like_count") or 0))
        ordered = same + others

    return ordered[:NEARBY_COUNT]


def inject_featured_links(rows):
    """홈 index.html의 <!--FEATURED_START--> ~ <!--FEATURED_END--> 구간에
    인기 캠(좋아요 상위, 색인 가능) 링크를 자동으로 채워 넣는다 (SEO 내부링크/크롤링 경로)."""
    idx_path = os.path.join(OUT_ROOT, "index.html")
    if not os.path.exists(idx_path):
        print("index.html 없음 — featured 링크 주입 건너뜀")
        return
    featured = [c for c in rows if not is_thin(c)][:20]
    items = []
    for c in featured:
        slug = c.get("slug") or c.get("video_id")
        if not slug:
            continue
        label = (c.get("title") or c.get("place_name") or slug).strip()
        if len(label) > 70:
            label = label[:67].rstrip() + "…"
        items.append(f'            <li><a href="/cam/{esc(slug)}/">{esc(label)}</a></li>')
    if not items:
        print("featured 대상 없음 — 주입 건너뜀")
        return
    block = "<!--FEATURED_START-->\n" + "\n".join(items) + "\n            <!--FEATURED_END-->"
    html_txt = open(idx_path, encoding="utf-8").read()
    new_txt, n = _re.subn(
        r"<!--FEATURED_START-->.*?<!--FEATURED_END-->",
        lambda m: block,            # 람다 사용: 라벨 속 역슬래시/그룹참조 오해석 방지
        html_txt, flags=_re.S,
    )
    if n == 0:
        print("index.html에 FEATURED 마커 없음 — 주입 건너뜀")
        return
    with open(idx_path, "w", encoding="utf-8") as f:
        f.write(new_txt)
    print(f"🔗 홈 featured 링크 {len(items)}개 주입 완료")


def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    res = (sb.table("live_videos").select("*").eq("is_active", True)
           .not_.is_("slug", "null").order("like_count", desc=True).execute())
    rows = res.data or []
    print(f"📂 활성+slug 있는 캠 {len(rows)}개")
    if not rows:
        print("만들 페이지 없음 — 종료")
        return
    top = rows if TOP_N is None else rows[:TOP_N]
    print(f"🏗️  페이지 생성 대상 {len(top)}개")

    menu = build_menu_data(rows)
    menu_html = build_bar(menu)

    sitemap_urls = [SITE + "/", SITE + "/top/"]
    made = 0
    skipped_noindex = 0
    for i, cam in enumerate(top):
        nearby = pick_nearby(cam, rows)
        page, thin = render_page(cam, i + 1, nearby, menu_html)
        slug = cam.get("slug") or cam.get("video_id")
        d = os.path.join(OUT_ROOT, "cam", slug)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        made += 1
        if thin:
            skipped_noindex += 1
        else:
            sitemap_urls.append(f"{SITE}/cam/{slug}/")
        if made % 50 == 0:
            print(f"  … {made}/{len(top)} 생성")

    # 나라별 목록 페이지
    by_country = {}
    for c in rows:
        cn = (c.get("country") or "").strip()
        if cn:
            by_country.setdefault(cn, []).append(c)
    for cn, cams in by_country.items():
        cams = sorted(cams, key=lambda x: -(x.get("like_count") or 0))
        d = os.path.join(OUT_ROOT, "live", cslug(cn))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(render_country_page(cn, cams, menu_html))
        sitemap_urls.append(f"{SITE}/live/{cslug(cn)}/")
    print(f"🌍 나라 목록 페이지 {len(by_country)}개")

    # 순위 페이지
    d = os.path.join(OUT_ROOT, "top")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write(render_top_page(rows, menu_html))
    print("🏆 순위 페이지 생성")

    inject_featured_links(rows)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url in sitemap_urls:
        lines.append(f"  <url><loc>{url}</loc><lastmod>{now}</lastmod></url>")
    lines.append("</urlset>")
    with open(os.path.join(OUT_ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"🗺️  sitemap.xml ({len(sitemap_urls)} URL) | 🎉 완료 {made}개 (색인제외 noindex {skipped_noindex}개)")


# ============================================
# 템플릿 (확정 레이아웃 + 툴팁/일출일몰/댓글/썸네일)
# ============================================
TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>__PAGETITLE__</title>
<meta name="description" content="__METADESC__" />
<link rel="canonical" href="__CANONICAL__" />
__ROBOTS__
<meta property="og:type" content="video.other" />
<meta property="og:title" content="__PAGETITLE__" />
<meta property="og:description" content="__METADESC__" />
<meta property="og:url" content="__CANONICAL__" />
<meta property="og:image" content="https://i.ytimg.com/vi/__VID__/hqdefault.jpg" />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
__JSONLD__
<style>
  :root{--bg:#0a0a0f;--panel:#14141f;--panel2:#1a1a26;--border:rgba(255,255,255,0.07);
    --text:#f0f0f5;--muted:#6b6b80;--sidebar:#10101a;--mint:#6bffb8;--mint-bg:rgba(107,255,184,0.12);
    --red:#ff4e45;--gold:#f0c419;--festival:#ff6b6b;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:'Noto Sans KR',system-ui,-apple-system,sans-serif;line-height:1.6;}
  a{color:inherit;text-decoration:none;}
  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:24px;
    padding:11px 22px;background:rgba(10,10,15,0.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
  .logo{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:2px;line-height:1;position:relative;}
  .logo span{color:var(--festival);animation:breath 3.5s ease-in-out infinite;}
  @keyframes breath{0%,100%{text-shadow:0 0 10px rgba(255,107,107,0.55);}50%{text-shadow:0 0 22px rgba(255,107,107,1),0 0 38px rgba(255,107,107,0.6);}}
  .nav{display:flex;gap:18px;font-size:0.85rem;color:var(--muted);align-items:center;}
  .nav>a:hover{color:var(--text);} .bar-link{color:var(--muted);font-weight:600;} .bar-link:hover{color:var(--text);} .bar-spacer{flex:1;} .bar-link{color:var(--muted);font-weight:600;} .bar-link:hover{color:var(--text);} .bar-spacer{flex:1;}
  .nav-drop{position:relative;}
  .nav-trigger{cursor:pointer;}
  .nav-drop:hover .nav-trigger{color:var(--text);}
  .mega{position:absolute;top:calc(100% + 12px);left:0;transform:translateY(8px);
    background:rgba(16,16,26,0.98);backdrop-filter:blur(16px);border:1px solid var(--border);
    border-radius:16px;padding:14px;width:min(620px,92vw);box-shadow:0 24px 60px rgba(0,0,0,0.6);
    opacity:0;visibility:hidden;transition:opacity .2s ease,transform .2s ease;z-index:50;}
  .nav-drop:hover .mega{opacity:1;visibility:visible;transform:translateY(0);}
  .nav-drop.open .mega{opacity:1;visibility:visible;transform:none;}
  .mega::before{content:"";position:absolute;top:-12px;left:0;right:0;height:12px;}
  .mega-top{display:flex;align-items:center;gap:8px;font-weight:800;font-size:0.9rem;color:var(--gold);
    background:rgba(240,196,25,0.1);border:1px solid rgba(240,196,25,0.3);border-radius:11px;
    padding:11px 14px;margin-bottom:12px;transition:filter .15s;}
  .mega-top:hover{filter:brightness(1.12);}
  .mega-body{display:grid;grid-template-columns:150px 1fr;gap:10px;}
  .mega-conts{display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--border);padding-right:8px;}
  .cont{display:flex;justify-content:space-between;align-items:center;background:transparent;border:none;
    color:var(--text);font-family:inherit;font-size:0.82rem;font-weight:600;text-align:left;
    padding:8px 10px;border-radius:9px;cursor:pointer;transition:background .15s;}
  .cont i{color:var(--muted);font-style:normal;font-size:0.72rem;}
  .cont:hover,.cont.on{background:var(--mint-bg);color:var(--mint);}
  .cont.on i{color:var(--mint);}
  .mega-countries{position:relative;min-height:150px;}
  .cgrp{display:none;grid-template-columns:1fr 1fr;gap:4px;animation:fadein .25s ease;}
  .cgrp.on{display:grid;}
  @keyframes fadein{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  .cgrp a{font-size:0.8rem;color:var(--text);padding:7px 9px;border-radius:8px;display:flex;justify-content:space-between;gap:8px;transition:background .15s;}
  .cgrp a:hover{background:rgba(255,255,255,0.06);color:var(--mint);}
  .cgrp a i{color:var(--muted);font-style:normal;font-size:0.72rem;}
  @media(max-width:760px){
    .nav{gap:12px;font-size:0.8rem;}
    .mega{position:fixed;left:8px;right:8px;top:58px;transform:none;width:auto;max-height:70vh;overflow:auto;}
    .nav-drop:hover .mega{transform:none;}
    .mega-body{grid-template-columns:1fr;}
    .mega-conts{flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid var(--border);padding:0 0 8px;}
  }
  .wrap{max-width:1160px;margin:0 auto;padding:22px 22px 70px;}
  .crumb{font-size:0.75rem;color:var(--muted);margin-bottom:12px;}
  .crumb a:hover{color:var(--mint);}
  h1{font-size:1.55rem;line-height:1.3;margin:0 0 18px;}
  .grid{display:grid;grid-template-columns:600px 1fr;gap:28px;align-items:start;transition:grid-template-columns .25s ease;}
  .grid.theater{grid-template-columns:1fr;} .grid.theater .left{position:static;}
  .left{position:sticky;top:80px;align-self:start;}
  .videowrap{position:relative;aspect-ratio:16/9;background:#000;border-radius:16px;}
  .vidinner{position:absolute;inset:0;border-radius:16px;overflow:hidden;border:1px solid var(--border);background:#000;}
  .vidinner iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
  .vidinner.pip{position:fixed;width:340px;aspect-ratio:16/9;z-index:60;border-color:rgba(107,255,184,0.5);box-shadow:0 14px 38px rgba(0,0,0,0.6);}
  .pip-bar{display:none;}
  .vidinner.pip .pip-bar{display:flex;align-items:center;justify-content:space-between;position:absolute;top:0;left:0;right:0;height:28px;padding:0 6px 0 10px;z-index:4;font-size:0.7rem;font-weight:700;color:#fff;cursor:grab;background:linear-gradient(rgba(0,0,0,0.75),rgba(0,0,0,0));touch-action:none;}
  #pipClose{background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:0.72rem;padding:3px 7px;line-height:1;}
  .drag-layer{display:none;}
  .vidinner.pip .drag-layer{display:block;position:absolute;inset:0;z-index:3;cursor:grab;touch-action:none;}
  .vidinner.pip.dragging,.vidinner.pip.dragging .pip-bar,.vidinner.pip.dragging .drag-layer{cursor:grabbing;}
  .vidinner.pip .sizectl{display:none;}
  .sizectl{position:absolute;top:10px;right:10px;z-index:6;display:flex;gap:4px;background:rgba(10,10,15,0.72);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:10px;padding:4px;}
  .sizectl button{border:none;background:transparent;color:var(--muted);font-size:0.74rem;font-weight:700;padding:5px 12px;border-radius:7px;cursor:pointer;font-family:inherit;}
  .sizectl button.on{background:var(--mint);color:#06231a;}
  @media(max-width:760px){.sizectl{display:none;}}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px;}
  .chip{display:inline-flex;align-items:center;gap:5px;font-size:0.76rem;font-weight:700;padding:6px 11px;border-radius:30px;border:1px solid var(--border);background:var(--panel2);}
  .chip[data-tip]{cursor:default;}
  .chip.live{color:var(--red);border-color:rgba(255,78,69,0.45);background:rgba(255,78,69,0.12);}
  .chip.rank{color:var(--gold);border-color:rgba(240,196,25,0.4);background:rgba(240,196,25,0.1);}
  .chip.see{color:var(--mint);border-color:rgba(107,255,184,0.4);background:var(--mint-bg);}
  .chip .dot{width:7px;height:7px;border-radius:50%;background:var(--red);animation:pulse 1.6s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,78,69,0.5);}70%{box-shadow:0 0 0 7px rgba(255,78,69,0);}100%{box-shadow:0 0 0 0 rgba(255,78,69,0);}}
  .tip{position:fixed;transform:translate(-50%,-100%);background:#05050a;color:#fff;font-size:0.72rem;font-weight:600;padding:6px 10px;border-radius:8px;border:1px solid var(--border);pointer-events:none;opacity:0;transition:opacity .12s;white-space:nowrap;z-index:90;box-shadow:0 6px 18px rgba(0,0,0,0.5);}
  .tip.show{opacity:1;}
  .facts{width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:14px;background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
  .facts td{padding:10px 14px;border-bottom:1px solid var(--border);}
  .facts tr:last-child td{border-bottom:none;}
  .facts .k{color:var(--muted);width:42%;} .facts .v{text-align:right;font-weight:600;}
  .ch-logo{width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:6px;}
  .mapbtn{display:block;width:100%;text-align:center;margin-top:12px;padding:12px;border-radius:12px;
    background:#173e33;color:#9af5cd;font-weight:800;font-size:0.85rem;border:1px solid rgba(107,255,184,0.25);}
  .mapbtn:hover{background:#1c4a3c;}
  .right section{margin-bottom:32px;} .right section:first-child{margin-top:4px;}
  .right h2{font-size:1.1rem;margin:0 0 10px;}
  .right p{color:#d8d8e2;font-size:0.94rem;}
  .see-list{list-style:none;padding:0;margin:0;display:grid;gap:9px;}
  .see-list li{padding-left:21px;position:relative;font-size:0.92rem;color:#d8d8e2;}
  .see-list li::before{content:"📍";position:absolute;left:0;}
  /* 댓글 */
  .cmt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .cmt-rating{font-size:0.82rem;color:var(--gold);font-weight:700;}
  .cmt-write{border:1px solid rgba(107,255,184,0.4);background:var(--mint-bg);color:var(--mint);
    font-weight:700;font-size:0.78rem;padding:7px 13px;border-radius:9px;cursor:pointer;}
  .cmt-list{max-height:330px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;
    scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent;padding-right:4px;}
  .cmt-list::-webkit-scrollbar{width:7px;} .cmt-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:7px;}
  .cmt{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:11px 13px;}
  .cmt .ct{display:flex;justify-content:space-between;font-size:0.76rem;color:var(--muted);margin-bottom:4px;gap:8px;}
  .cmt .cs{color:var(--gold);} .cmt .cc{font-size:0.88rem;color:#e4e4ee;}
  .cmt-empty,.cmt-loading{font-size:0.85rem;color:var(--muted);padding:8px 2px;}
  /* 댓글 작성 모달 */
  .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;display:none;align-items:center;justify-content:center;padding:18px;}
  .modal-bg.show{display:flex;}
  .modal{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px;width:100%;max-width:420px;}
  .modal h3{margin:0 0 14px;font-size:1.05rem;}
  .modal input,.modal textarea{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);
    border-radius:9px;padding:10px;font-size:0.88rem;font-family:inherit;margin-bottom:10px;}
  .modal textarea{min-height:80px;resize:vertical;}
  .mstars{font-size:1.4rem;color:var(--muted);cursor:pointer;margin-bottom:10px;}
  .mstars b{cursor:pointer;} .mstars b.on{color:var(--gold);}
  .mrow{display:flex;gap:8px;} .mrow button{flex:1;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;font-family:inherit;}
  .m-ok{background:var(--mint);color:#06231a;} .m-no{background:var(--panel2);color:var(--text);border:1px solid var(--border);}
  .m-msg{font-size:0.78rem;color:var(--festival);min-height:16px;margin-bottom:6px;}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:11px;overflow:hidden;transition:border-color .15s;}
  .card:hover{border-color:rgba(107,255,184,0.4);}
  .card .th{height:96px;background:#0e1622;overflow:hidden;}
  .card .th img{width:100%;height:100%;object-fit:cover;display:block;}
  .card .cap{padding:8px 11px;} .card .nm{font-size:0.82rem;font-weight:600;}
  .card .cs{font-size:0.7rem;color:var(--muted);margin-top:2px;}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:0.8rem;text-align:center;}
  @media(max-width:760px){.grid{grid-template-columns:1fr;} .left{position:static;} .cards{grid-template-columns:1fr 1fr;}}
__BARCSS__
</style>
</head>
<body>
  __BAR__
  <div class="wrap">
    <div class="crumb"><a href="/">Home</a> › <a href="__CRUMB_HREF__">__CRUMB_COUNTRY__</a> › __H1__</div>
    <h1>__H1__</h1>
    <div class="grid" id="grid">
      <div class="left">
        <div class="videowrap" id="videowrap">
          <div class="vidinner" id="vidinner">
            <div class="sizectl" id="sizectl"><button data-t="0" class="on">Default</button><button data-t="1">Theater</button></div>
            <div class="pip-bar" id="pipbar"><span>📷 __PIPNAME__ · LIVE</span><button id="pipClose" title="Close">✕</button></div>
            <div class="drag-layer" id="draglayer"></div>
            <iframe src="__EMBED__" allow="autoplay; encrypted-media" allowfullscreen></iframe>
          </div>
        </div>
        <div class="chips">
          __CHIPS__
        </div>
        <table class="facts">
            __FACTS__
        </table>
        <a class="mapbtn" href="__MAPHREF__">🗺 Open in map</a>
      </div>
      <div class="right">
        __ABOUT__
        __SEE__
        __BEST__
        <section>
          <div class="cmt-head"><h2 style="margin:0;">Comments</h2><button class="cmt-write" onclick="cmtOpen()">✏️ Write a review</button></div>
          <div class="cmt-rating" id="cmt-rating">⭐ –</div>
          <div class="cmt-list" id="cmt-list"><div class="cmt-loading">Loading…</div></div>
        </section>
        __NEARBY__
        <footer>Flare[V] · Live web cams around the world, on a map</footer>
      </div>
    </div>
  </div>

  <div class="modal-bg" id="cmt-modal">
    <div class="modal">
      <h3>Write a review</h3>
      <div class="m-msg" id="cmt-msg"></div>
      <input id="cmt-author" type="text" placeholder="Your name" maxlength="40" />
      <input id="cmt-pw" type="text" inputmode="numeric" placeholder="Password (to edit/delete later)" maxlength="20" />
      <div class="mstars" id="cmt-stars"><b data-n="1">★</b><b data-n="2">★</b><b data-n="3">★</b><b data-n="4">★</b><b data-n="5">★</b></div>
      <textarea id="cmt-content" placeholder="Share what you think about this cam" maxlength="600"></textarea>
      <div class="mrow"><button class="m-no" onclick="cmtClose()">Cancel</button><button class="m-ok" onclick="cmtSubmit()">Post</button></div>
    </div>
  </div>

<script>
  var TZ="__TZ__", LAT=parseFloat("__LAT__"), LNG=parseFloat("__LNG__"), LIVESTART="__LIVESTART__", VID="__VID__";

  // ---- 일출/일몰 계산 (SunCalc 핵심 축약, MIT) ----
  var rad=Math.PI/180,dayMs=864e5,J1970=2440588,J2000=2451545;
  function toJ(d){return d.valueOf()/dayMs-0.5+J1970;} function fromJ(j){return new Date((j+0.5-J1970)*dayMs);}
  function toDays(d){return toJ(d)-J2000;} var e0=rad*23.4397;
  function dec(l,b){return Math.asin(Math.sin(b)*Math.cos(e0)+Math.cos(b)*Math.sin(e0)*Math.sin(l));}
  function sma(d){return rad*(357.5291+0.98560028*d);}
  function ecl(M){var C=rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));return M+C+rad*102.9372+Math.PI;}
  var J0=0.0009;
  function aT(Ht,lw,n){return J0+(Ht+lw)/(2*Math.PI)+n;}
  function stJ(ds,M,L){return J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);}
  function ha(h,phi,d){return Math.acos((Math.sin(h)-Math.sin(phi)*Math.sin(d))/(Math.cos(phi)*Math.cos(d)));}
  function sunTimes(date,lat,lng){
    var lw=rad*-lng,phi=rad*lat,d=toDays(date),n=Math.round(d-J0-lw/(2*Math.PI)),
        ds=aT(0,lw,n),M=sma(ds),L=ecl(M),de=dec(L,0),Jn=stJ(ds,M,L),h=-0.833*rad,
        Js=stJ(aT(ha(h,phi,de),lw,n),M,L),Jr=Jn-(Js-Jn);
    return {sunrise:fromJ(Jr),sunset:fromJ(Js)};
  }
  function fmtT(d){try{return new Intl.DateTimeFormat('en-US',{timeZone:TZ||'UTC',hour:'2-digit',minute:'2-digit'}).format(d);}catch(e){return '';}}

  function refresh(){
    var now=new Date(), icon="🕐", label="—", tip="";
    if(TZ){
      var t=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(now);
      document.querySelectorAll('.lt').forEach(function(el){el.textContent=t+" (local)";});
    }
    if(!isNaN(LAT)&&!isNaN(LNG)){
      var s=sunTimes(now,LAT,LNG),H=3600000;
      var sr=s.sunrise,ss=s.sunset;
      if(now>=new Date(+sr-H)&&now<sr){icon="🌅";label="Sunrise soon";tip="Sunrise at "+fmtT(sr);}
      else if(now>=sr&&now<=new Date(+sr+H)){icon="🌅";label="Sunrise time";tip="Sunrise at "+fmtT(sr);}
      else if(now>=new Date(+ss-H)&&now<ss){icon="🌇";label="Sunset soon";tip="Sunset at "+fmtT(ss);}
      else if(now>=ss&&now<=new Date(+ss+H)){icon="🌇";label="Sunset time";tip="Sunset at "+fmtT(ss);}
      else if(now>sr&&now<ss){icon="☀️";label="Daytime";tip="Sunset at "+fmtT(ss);}
      else {icon="🌙";label="Night";tip="Sunrise at "+fmtT(sr);}
    } else if(TZ){
      var h=parseInt(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}).format(now),10);
      if(h>=8&&h<18){icon="☀️";label="Daytime";} else {icon="🌙";label="Night";}
    }
    var dn=document.getElementById('chip-dn');
    if(label==="—"){dn.style.display="none";} else {
      dn.style.display="";dn.textContent=icon+" "+label;
      if(tip)dn.setAttribute('data-tip',tip);else dn.removeAttribute('data-tip');
    }
    document.querySelectorAll('.bn').forEach(function(el){el.textContent=label.toLowerCase();});
    document.querySelectorAll('.bt').forEach(function(el){el.textContent=(label==="Daytime"||label.indexOf("Sun")===0)?"good visibility right now.":"quieter hours — check back in daylight.";});
  }
  refresh();setInterval(refresh,60000);

  // LIVE 칩 툴팁: 며칠째 방송 중 (데이터 있을 때만)
  (function(){
    if(!LIVESTART)return;
    var d=new Date(LIVESTART); if(isNaN(d))return;
    var days=Math.floor((Date.now()-d)/86400000);
    var txt = days>=1 ? ("Live for "+days+" day"+(days>1?"s":"")) : "Live since "+fmtT(d);
    document.getElementById('chip-live').setAttribute('data-tip',txt);
  })();

  // 공통 툴팁 (마우스 올리면 표시, 벗어나면 사라짐)
  var tipEl=document.createElement('div');tipEl.className='tip';document.body.appendChild(tipEl);
  document.addEventListener('mouseover',function(ev){var el=ev.target.closest('[data-tip]');
    if(!el||!el.getAttribute('data-tip'))return;tipEl.textContent=el.getAttribute('data-tip');
    var r=el.getBoundingClientRect();tipEl.style.left=(r.left+r.width/2)+'px';tipEl.style.top=(r.top-8)+'px';tipEl.classList.add('show');});
  document.addEventListener('mouseout',function(ev){if(ev.target.closest('[data-tip]'))tipEl.classList.remove('show');});

  // 크게/보통
  var grid=document.getElementById('grid');
  document.querySelectorAll('#sizectl button').forEach(function(b){b.onclick=function(){
    grid.classList.toggle('theater',b.dataset.t==='1');
    document.querySelectorAll('#sizectl button').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on');window.scrollTo({top:0,behavior:'smooth'});};});

  // PiP + 드래그
  var vidinner=document.getElementById('vidinner'),videowrap=document.getElementById('videowrap'),pipClosed=false;
  function enablePip(){if(vidinner.classList.contains('pip'))return;vidinner.classList.add('pip');var w=vidinner.offsetWidth||340;vidinner.style.left=(window.innerWidth-w-20)+'px';vidinner.style.top='86px';}
  function disablePip(){vidinner.classList.remove('pip','dragging');vidinner.style.left='';vidinner.style.top='';}
  document.getElementById('pipClose').onclick=function(e){e.stopPropagation();pipClosed=true;disablePip();};
  new IntersectionObserver(function(en){var e=en[0];if(e.isIntersecting){disablePip();pipClosed=false;}else if(e.boundingClientRect.bottom<80&&!pipClosed){enablePip();}},{threshold:0,rootMargin:'-76px 0px 0px 0px'}).observe(videowrap);
  var dr=false,mv=false,sx,sy,ox,oy;
  function pt(ev){return ev.touches?ev.touches[0]:ev;}
  function ds(ev){if(!vidinner.classList.contains('pip'))return;if(ev.target&&ev.target.id==='pipClose')return;dr=true;mv=false;var p=pt(ev);sx=p.clientX;sy=p.clientY;var r=vidinner.getBoundingClientRect();ox=r.left;oy=r.top;vidinner.classList.add('dragging');ev.preventDefault();}
  function dm(ev){if(!dr)return;var p=pt(ev),dx=p.clientX-sx,dy=p.clientY-sy;if(Math.abs(dx)+Math.abs(dy)>4)mv=true;var w=vidinner.offsetWidth,h=vidinner.offsetHeight;vidinner.style.left=Math.max(8,Math.min(window.innerWidth-w-8,ox+dx))+'px';vidinner.style.top=Math.max(8,Math.min(window.innerHeight-h-8,oy+dy))+'px';ev.preventDefault();}
  function de(){if(!dr)return;dr=false;vidinner.classList.remove('dragging');if(!mv){window.scrollTo({top:0,behavior:'smooth'});}}
  ['#draglayer','#pipbar'].forEach(function(s){var el=document.querySelector(s);el.addEventListener('mousedown',ds);el.addEventListener('touchstart',ds,{passive:false});});
  window.addEventListener('mousemove',dm);window.addEventListener('touchmove',dm,{passive:false});
  window.addEventListener('mouseup',de);window.addEventListener('touchend',de);

  // ---- 댓글 (라이브 리뷰 공유: reviews 테이블) ----
  var sb=supabase.createClient("__SBURL__","__SBKEY__");
  var cmtRating=0;
  function escH(s){return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function fmtDate(s){try{return new Date(s).toLocaleDateString();}catch(e){return '';}}
  async function loadComments(){
    var list=document.getElementById('cmt-list');
    try{
      var res=await sb.from('reviews').select('*').eq('content_id',VID).order('created_at',{ascending:false});
      var rows=res.data||[];
      var rb=document.getElementById('cmt-rating');
      if(rows.length){var avg=rows.reduce(function(a,r){return a+(r.rating||0);},0)/rows.length;
        rb.textContent='⭐ '+avg.toFixed(1)+' · '+rows.length+' review'+(rows.length>1?'s':'');}
      else rb.textContent='⭐ No reviews yet';
      if(!rows.length){list.innerHTML='<div class="cmt-empty">No reviews yet — be the first!</div>';return;}
      list.innerHTML=rows.map(function(r){
        var stars='★'.repeat(r.rating||0)+'☆'.repeat(5-(r.rating||0));
        return '<div class="cmt"><div class="ct"><span>'+escH(r.author)+'</span><span class="cs">'+stars+'</span><span>'+fmtDate(r.created_at)+'</span></div><div class="cc">'+escH(r.content)+'</div></div>';
      }).join('');
    }catch(err){list.innerHTML='<div class="cmt-empty">Could not load comments.</div>';}
  }
  function cmtOpen(){document.getElementById('cmt-modal').classList.add('show');document.getElementById('cmt-msg').textContent='';}
  function cmtClose(){document.getElementById('cmt-modal').classList.remove('show');}
  document.getElementById('cmt-modal').addEventListener('click',function(e){if(e.target===this)cmtClose();});
  document.querySelectorAll('#cmt-stars b').forEach(function(b){b.onclick=function(){cmtRating=+b.dataset.n;
    document.querySelectorAll('#cmt-stars b').forEach(function(x){x.classList.toggle('on',+x.dataset.n<=cmtRating);});};});
  var lastPost=0;
  async function cmtSubmit(){
    var msg=document.getElementById('cmt-msg');
    var author=document.getElementById('cmt-author').value.trim();
    var pw=document.getElementById('cmt-pw').value.trim();
    var content=document.getElementById('cmt-content').value.trim();
    if(!author){msg.textContent='Please enter a name';return;}
    if(!pw){msg.textContent='Please enter a password';return;}
    if(!cmtRating){msg.textContent='Please pick a rating';return;}
    if(!content){msg.textContent='Please write a review';return;}
    if(Date.now()-lastPost<10000){msg.textContent='Please wait a few seconds';return;}
    try{
      var res=await sb.from('reviews').insert([{content_id:VID,author:author,password:pw,content:content,rating:cmtRating}]).select();
      if(res.error){msg.textContent='Failed — try again in a moment';return;}
      lastPost=Date.now();cmtClose();
      document.getElementById('cmt-author').value='';document.getElementById('cmt-pw').value='';document.getElementById('cmt-content').value='';
      cmtRating=0;document.querySelectorAll('#cmt-stars b').forEach(function(x){x.classList.remove('on');});
      loadComments();
    }catch(err){msg.textContent='Failed — try again in a moment';}
  }
  window.cmtOpen=cmtOpen;window.cmtClose=cmtClose;window.cmtSubmit=cmtSubmit;
  loadComments();
</script>
</body>
</html>"""


SHARED_CSS = """
  :root{--bg:#0a0a0f;--panel:#14141f;--panel2:#1a1a26;--border:rgba(255,255,255,0.07);
    --text:#f0f0f5;--muted:#6b6b80;--sidebar:#10101a;--mint:#6bffb8;--mint-bg:rgba(107,255,184,0.12);
    --red:#ff4e45;--gold:#f0c419;--festival:#ff6b6b;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Noto Sans KR',system-ui,-apple-system,sans-serif;line-height:1.6;}
  a{color:inherit;text-decoration:none;}
  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:24px;padding:11px 22px;background:rgba(10,10,15,0.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
  .logo{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:2px;line-height:1;}
  .logo span{color:var(--festival);animation:breath 3.5s ease-in-out infinite;}
  @keyframes breath{0%,100%{text-shadow:0 0 10px rgba(255,107,107,0.55);}50%{text-shadow:0 0 22px rgba(255,107,107,1),0 0 38px rgba(255,107,107,0.6);}}
  .nav{display:flex;gap:18px;font-size:0.85rem;color:var(--muted);align-items:center;}
  .nav>a:hover{color:var(--text);}
  .nav-drop{position:relative;} .nav-trigger{cursor:pointer;} .nav-drop:hover .nav-trigger{color:var(--text);}
  .mega{position:absolute;top:calc(100% + 12px);left:0;transform:translateY(8px);background:rgba(16,16,26,0.98);backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:16px;padding:14px;width:min(620px,92vw);box-shadow:0 24px 60px rgba(0,0,0,0.6);opacity:0;visibility:hidden;transition:opacity .2s ease,transform .2s ease;z-index:50;}
  .nav-drop:hover .mega{opacity:1;visibility:visible;transform:translateY(0);}
  .nav-drop.open .mega{opacity:1;visibility:visible;transform:none;}
  .mega::before{content:"";position:absolute;top:-12px;left:0;right:0;height:12px;}
  .mega-top{display:flex;align-items:center;gap:8px;font-weight:800;font-size:0.9rem;color:var(--gold);background:rgba(240,196,25,0.1);border:1px solid rgba(240,196,25,0.3);border-radius:11px;padding:11px 14px;margin-bottom:12px;}
  .mega-top:hover{filter:brightness(1.12);}
  .mega-body{display:grid;grid-template-columns:150px 1fr;gap:10px;}
  .mega-conts{display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--border);padding-right:8px;}
  .cont{display:flex;justify-content:space-between;align-items:center;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:0.82rem;font-weight:600;text-align:left;padding:8px 10px;border-radius:9px;cursor:pointer;}
  .cont i{color:var(--muted);font-style:normal;font-size:0.72rem;} .cont:hover,.cont.on{background:var(--mint-bg);color:var(--mint);} .cont.on i{color:var(--mint);}
  .mega-countries{min-height:150px;} .cgrp{display:none;grid-template-columns:1fr 1fr;gap:4px;animation:fadein .25s ease;} .cgrp.on{display:grid;}
  @keyframes fadein{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  .cgrp a{font-size:0.8rem;padding:7px 9px;border-radius:8px;display:flex;justify-content:space-between;gap:8px;} .cgrp a:hover{background:rgba(255,255,255,0.06);color:var(--mint);}
  .cgrp a i{color:var(--muted);font-style:normal;font-size:0.72rem;}
  .wrap{max-width:1160px;margin:0 auto;padding:26px 22px 70px;}
  .ph{margin:0 0 6px;font-size:1.7rem;} .psub{color:var(--muted);font-size:0.9rem;margin-bottom:24px;}
  .grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;}
  .gc{background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:transform .15s,border-color .15s;}
  .gc:hover{transform:translateY(-3px);border-color:rgba(107,255,184,0.45);}
  .gc .th{position:relative;aspect-ratio:16/9;background:#0e1622;overflow:hidden;}
  .gc .th img{width:100%;height:100%;object-fit:cover;display:block;}
  .gc .lvb{position:absolute;top:8px;left:8px;font-size:0.6rem;font-weight:800;letter-spacing:0.5px;color:#fff;background:var(--red);padding:3px 7px;border-radius:5px;}
  .gc .cap{padding:11px 13px;} .gc .nm{font-size:0.88rem;font-weight:600;line-height:1.35;}
  .gc .cs{font-size:0.74rem;color:var(--muted);margin-top:4px;}
  footer{margin-top:46px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:0.8rem;text-align:center;}
  @media(max-width:760px){.nav{gap:12px;font-size:0.8rem;} .mega{position:fixed;left:8px;right:8px;top:58px;transform:none;width:auto;max-height:70vh;overflow:auto;} .nav-drop:hover .mega{transform:none;} .mega-body{grid-template-columns:1fr;} .mega-conts{flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid var(--border);padding:0 0 8px;}}
"""

LIST_TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>__PAGETITLE__</title>
<meta name="description" content="__METADESC__" />
<link rel="canonical" href="__CANONICAL__" />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>__CSS__</style></head><body>
  __BAR__
  <div class="wrap">
    <div class="psub" style="margin-bottom:10px;"><a href="/" style="color:var(--muted)">Home</a> › Live cams</div>
    <h1 class="ph">__H1__</h1>
    <div class="psub">__SUB__</div>
    <div class="grid-cards">__CARDS__</div>
    <footer>Flare[V] · Live web cams around the world, on a map</footer>
  </div>
</body></html>"""

TOP_TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Live Cam Rankings | Flare[V]</title>
<meta name="description" content="The most popular live cams right now — ranked by likes, views and live viewers." />
<link rel="canonical" href="__CANONICAL__" />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>__CSS__
  .tabs{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;}
  .tab{padding:9px 16px;border-radius:30px;border:1px solid var(--border);background:var(--panel2);color:var(--muted);font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;}
  .tab.on{background:var(--mint);color:#06231a;border-color:var(--mint);}
  .rlist{display:none;flex-direction:column;gap:10px;} .rlist.on{display:flex;animation:fadein .3s ease;}
  .row{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:10px 14px;transition:transform .12s,border-color .12s;}
  .row:hover{transform:translateX(3px);border-color:rgba(107,255,184,0.4);}
  .rk{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;width:42px;text-align:center;color:var(--muted);flex:0 0 42px;}
  .row:nth-child(1) .rk{color:var(--gold);} .row:nth-child(2) .rk{color:#cfd3da;} .row:nth-child(3) .rk{color:#e0a06a;}
  .rth{width:104px;height:60px;border-radius:9px;overflow:hidden;flex:0 0 104px;background:#0e1622;}
  .rth img{width:100%;height:100%;object-fit:cover;display:block;}
  .rmid{flex:1;min-width:0;} .rnm{font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .rpl{font-size:0.74rem;color:var(--muted);margin-top:2px;}
  .rval{font-weight:800;font-size:0.95rem;color:var(--mint);white-space:nowrap;} .rval span{font-size:0.7rem;color:var(--muted);font-weight:600;display:block;text-align:right;}
</style></head><body>
  __BAR__
  <div class="wrap">
    <div class="psub" style="margin-bottom:10px;"><a href="/" style="color:var(--muted)">Home</a> › Rankings</div>
    <h1 class="ph">🏆 Live Cam Rankings</h1>
    <div class="psub">The most popular live cams right now, updated daily.</div>
    <div class="tabs">
      <button class="tab on" data-t="liked">❤️ Most liked</button>
      <button class="tab" data-t="viewed">📺 Most viewed</button>
      <button class="tab" data-t="watching">👀 Watching now</button>
    </div>
    __LISTS__
    <footer>Flare[V] · Live web cams around the world, on a map</footer>
  </div>
<script>
  document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){
    document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on');});b.classList.add('on');
    document.querySelectorAll('.rlist').forEach(function(l){l.classList.toggle('on',l.dataset.t===b.dataset.t);});
  };});
</script>
</body></html>"""


def _card(cam):
    vid = cam.get("video_id") or ""
    slug = cam.get("slug") or vid
    place = cam.get("place_name") or cam.get("country") or ""
    return (
        f'<a class="gc" href="/cam/{esc(slug)}/"><div class="th">'
        f'<img loading="lazy" src="{thumb(vid)}" alt="" /><span class="lvb">LIVE</span></div>'
        f'<div class="cap"><div class="nm">{esc((cam.get("title") or "")[:60])}</div>'
        f'<div class="cs">📍 {esc(place)}</div></div></a>'
    )


def render_country_page(country, cams, menu_html):
    cards = "".join(_card(c) for c in cams)
    h1 = f"Live cams in {country}"
    sub = f"{len(cams)} live cam" + ("s" if len(cams) != 1 else "")
    out = LIST_TEMPLATE
    repl = {
        "__CSS__": SHARED_CSS + BAR_CSS, "__BAR__": menu_html,
        "__PAGETITLE__": esc(f"Live Cams in {country} | Flare[V]"),
        "__METADESC__": esc(f"Watch {len(cams)} live cams in {country}, streaming right now on Flare[V]."),
        "__CANONICAL__": f"{SITE}/live/{cslug(country)}/",
        "__H1__": esc(h1), "__SUB__": esc(sub), "__CARDS__": cards,
    }
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def _rank_list(tab, cams, valfn, unit):
    rows = []
    for i, c in enumerate(cams):
        vid = c.get("video_id") or ""
        slug = c.get("slug") or vid
        place = c.get("place_name") or c.get("country") or ""
        rows.append(
            f'<a class="row" href="/cam/{esc(slug)}/"><div class="rk">{i+1}</div>'
            f'<div class="rth"><img loading="lazy" src="{thumb(vid)}" alt="" /></div>'
            f'<div class="rmid"><div class="rnm">{esc((c.get("title") or "")[:70])}</div>'
            f'<div class="rpl">📍 {esc(place)}</div></div>'
            f'<div class="rval">{human(valfn(c))}<span>{unit}</span></div></a>'
        )
    on = " on" if tab == "liked" else ""
    return f'<div class="rlist{on}" data-t="{tab}">' + "".join(rows) + "</div>"


def render_top_page(rows, menu_html, limit=50):
    liked = sorted(rows, key=lambda c: -(c.get("like_count") or 0))[:limit]
    viewed = sorted(rows, key=lambda c: -(c.get("view_count") or 0))[:limit]
    watching = [c for c in rows if (c.get("concurrent_viewers") or 0) > 0]
    watching = sorted(watching, key=lambda c: -(c.get("concurrent_viewers") or 0))[:limit]
    lists = (
        _rank_list("liked", liked, lambda c: c.get("like_count") or 0, "likes")
        + _rank_list("viewed", viewed, lambda c: c.get("view_count") or 0, "views")
        + _rank_list("watching", watching, lambda c: c.get("concurrent_viewers") or 0, "watching")
    )
    out = TOP_TEMPLATE
    for k, v in {"__CSS__": SHARED_CSS + BAR_CSS, "__BAR__": menu_html,
                 "__CANONICAL__": f"{SITE}/top/", "__LISTS__": lists}.items():
        out = out.replace(k, v)
    return out



BAR_CSS = """
  #sidebar{position:sticky;top:0;z-index:300;display:flex;align-items:center;gap:16px;height:58px;line-height:normal;
    padding:0 18px;background:var(--sidebar);border-bottom:1px solid var(--border);overflow:visible;}
  #sidebar a,.nav-trigger,.bar-link,.mega a{text-decoration:none;}
  .logo-wrap{position:relative;flex-shrink:0;}
  .logo{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:3px;line-height:1;position:relative;z-index:2;display:inline-block;}
  .logo span{color:var(--festival);animation:logo-breath 3.5s ease-in-out infinite;}
  @keyframes logo-breath{0%,100%{text-shadow:0 0 10px rgba(255,107,107,0.55);}50%{text-shadow:0 0 22px rgba(255,107,107,1),0 0 38px rgba(255,107,107,0.6);}}
  .logo-flare{position:absolute;left:82px;top:14px;width:5px;height:5px;border-radius:50%;background:#ffb3a0;
    box-shadow:0 0 10px #ff6b6b,0 0 18px #ff6b6b;opacity:0;z-index:1;animation:logo-launch 15s ease-out infinite;}
  @keyframes logo-launch{0%{transform:translateY(0) scale(1);opacity:0;}2%{opacity:1;}7%{transform:translateY(-32px) scale(0.7);opacity:1;}
    9%{transform:translateY(-38px) scale(1.6);opacity:0.5;}10%{transform:translateY(-40px) scale(0.2);opacity:0;}100%{transform:translateY(-40px) scale(0.2);opacity:0;}}
  .logo-light{position:absolute;left:84px;top:-8px;width:7px;height:7px;border-radius:50%;background:#ffe88a;
    box-shadow:0 0 14px #ffd93d,0 0 26px rgba(255,217,61,0.7);opacity:0;z-index:1;animation:logo-fall 15s ease-in infinite;}
  @keyframes logo-fall{0%,9%{opacity:0;transform:translateY(0) scale(0.4);}11%{opacity:1;transform:translateY(0) scale(1.3);}
    14%{opacity:1;transform:translateY(4px) scale(1);}30%{opacity:0.85;transform:translateY(40px) scale(0.85);}34%{opacity:0;transform:translateY(48px) scale(0.5);}100%{opacity:0;transform:translateY(48px) scale(0.5);}}
  .bar-link,.nav-trigger{font-family:'Noto Sans KR',sans-serif;font-size:0.86rem;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap;}
  .bar-link,.nav-trigger{display:inline-flex;align-items:center;line-height:1;} .bar-link{margin-top:2px;} .bar-link:hover,.nav-drop:hover .nav-trigger{color:var(--text);}
  .bar-spacer{flex:1;}
  .nav-drop{position:relative;flex-shrink:0;}
  .mega{position:absolute;top:calc(100% + 14px);left:0;width:min(620px,92vw);background:rgba(16,16,26,0.98);
    backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:16px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,0.6);
    opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;z-index:320;}
  .nav-drop:hover .mega,.nav-drop.open .mega{opacity:1;visibility:visible;transform:translateY(0);}
  .mega::before{content:"";position:absolute;top:-14px;left:0;right:0;height:14px;}
  .mega-body{display:grid;grid-template-columns:150px 1fr;gap:10px;}
  .mega-conts{display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--border);padding-right:8px;}
  .cont{display:flex;justify-content:space-between;align-items:center;background:transparent;border:none;color:var(--text);
    font-family:inherit;font-size:0.82rem;font-weight:600;text-align:left;padding:8px 10px;border-radius:9px;cursor:pointer;}
  .cont i{color:var(--muted);font-style:normal;font-size:0.72rem;}
  .cont:hover,.cont.on{background:var(--mint-bg);color:var(--mint);} .cont.on i{color:var(--mint);}
  .mega-countries{min-height:150px;}
  .cgrp{display:none;grid-template-columns:1fr 1fr;gap:4px;animation:fadein .25s ease;} .cgrp.on{display:grid;}
  @keyframes fadein{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  .cgrp a{font-size:0.8rem;padding:7px 9px;border-radius:8px;display:flex;justify-content:space-between;gap:8px;color:var(--text);}
  .cgrp a:hover{background:rgba(255,255,255,0.06);color:var(--mint);} .cgrp a i{color:var(--muted);font-style:normal;font-size:0.72rem;}
  .mega-cats{width:240px;}
  .mega-cats .filter-list{display:flex;flex-direction:column;gap:2px;}
  .filter-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;font-size:0.84rem;}
  .filter-item .filter-text{flex:1;}
  .filter-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
  .dot-spot{background:#ff8fa3;} .dot-yt{background:#ff4e45;} .dot-news{background:#4ea3ff;}
  .dot-resort{background:#6bffb8;} .dot-hotel{background:#f0c419;}
  .nav-disabled .filter-item{opacity:0.45;pointer-events:none;}
  .contact-btn{width:auto;margin:0;white-space:nowrap;padding:9px 14px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:0.8rem;font-family:'Noto Sans KR',sans-serif;font-weight:600;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:all 0.2s;}
  .contact-btn:hover{background:rgba(255,107,107,0.1);border-color:var(--festival);color:var(--text);}
  @media(max-width:768px){
    #sidebar{height:54px;gap:10px;padding:0 12px;}
    .logo{font-size:1.3rem;letter-spacing:2px;} .logo span{font-size:1.3rem;} .logo-flare,.logo-light{display:none;}
    .bar-link,.nav-trigger{font-size:0.78rem;}
    .contact-btn{padding:7px 9px;font-size:0.72rem;}
    .mega{position:fixed;left:8px;right:8px;top:56px;width:auto;max-height:72vh;overflow:auto;}
    .mega-cats{width:auto;}
  }
"""

if __name__ == "__main__":
    main()
