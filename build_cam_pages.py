# ============================================
# Flare[V] 캠 상세페이지 생성기  (build_cam_pages.py)
# 버전: 1.0 / 2026-06-17
# 역할: live_videos 에서 좋아요 상위 N개를 골라 /cam/<slug>/index.html 정적 페이지로 생성.
#       + sitemap.xml 갱신, 페이지끼리 "근처 캠" 내부 링크, 내용 빈약하면 noindex 자동.
# 실행: GitHub Actions (수동 또는 스케줄). 생성된 파일을 워크플로가 커밋→Vercel 배포.
# 비용: AI 안 씀(0). 유튜브 안 부름(0). DB 읽기만.
#
# 설계 메모:
#   - 페이지는 미리 만든 정적 HTML (구글이 가장 잘 크롤링). JS 모달 아님.
#   - 빈 칸(소개/볼거리)이면 그 섹션을 아예 안 그림 (휑하지 않게).
#   - 고유 콘텐츠가 너무 빈약하면 <meta robots noindex> 자동 → 사이트 SEO 평판 보호.
#     (사람은 링크로 정상 접속 가능. 내용 채워지면 다음 생성 때 noindex 자동 해제)
#   - sitemap 에는 색인 대상(noindex 아닌 것)만 넣음.
#   - 로고/레이아웃은 확정한 demo3(영상 좌측 고정 + 보통/크게 + PiP)와 동일.
# ============================================

import os
import re
import html
import json
from datetime import datetime, timezone

from supabase import create_client

SUPABASE_URL = "https://pbrbzjxdjqqmhvhzhwlp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicmJ6anhkanFxbWh2aHpod2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjc3NTcsImV4cCI6MjA5NTMwMzc1N30.E6-GthxwIFN2-jy4ojf5ZxR7YcdPJULG6Mxj9LvkI1c"

# ============================================
# 설정값
# ============================================
SITE = "https://flarev.co"
TOP_N = 10              # 시범: 좋아요 상위 N개만 페이지 생성
NEARBY_COUNT = 6        # 페이지당 "근처 캠" 링크 수
OUT_ROOT = "."         # 저장소 루트 (cam/<slug>/index.html, sitemap.xml 가 여기 생김)
INTRO_MIN = 40         # 소개글이 이 글자 수 미만이고 볼거리도 없으면 "빈약" → noindex


# ============================================
# 작은 도우미들
# ============================================
def esc(s):
    return html.escape(str(s if s is not None else ""))


def human(n):
    """329133627 → '329M', 567470 → '567K'"""
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
    """seo_highlights 가 list 또는 JSON 문자열로 올 수 있어 안전하게 list 로."""
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
    """고유 콘텐츠가 빈약한가? (소개 짧음 + 볼거리 없음)"""
    intro = (cam.get("seo_intro") or "").strip()
    hl = as_highlights(cam.get("seo_highlights"))
    return len(intro) < INTRO_MIN and len(hl) == 0


# ============================================
# 페이지 HTML 만들기
# ============================================
def render_page(cam, rank, nearby):
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
    likes = cam.get("like_count") or 0
    views = cam.get("view_count") or 0
    watching = cam.get("concurrent_viewers") or 0

    canonical = f"{SITE}/cam/{slug}/"
    page_title = f"{title} — Watch {place} Live | Flare[V]" if place else f"{title} | Flare[V]"
    meta_desc = intro[:155] if intro else f"Watch {place} live, 24/7, on Flare[V] — live web cams around the world on one map."
    thin = is_thin(cam)
    robots = '<meta name="robots" content="noindex,follow" />' if thin else ""

    # 칩
    chips = ['<span class="chip live"><span class="dot"></span> LIVE</span>']
    if rank:
        chips.append(f'<span class="chip rank">🔥 #{rank} most liked</span>')
    if int(watching or 0) > 0:
        chips.append(f'<span class="chip">👀 {int(watching):,} watching</span>')
    chips.append('<span class="chip see dn">🕐 —</span>')
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
    if int(watching or 0) > 0:
        facts.append(f'<tr><td class="k">Watching now</td><td class="v">{int(watching):,}</td></tr>')
    facts.append(f'<tr><td class="k">Total views</td><td class="v">{human(views)}</td></tr>')
    facts.append(f'<tr><td class="k">Likes</td><td class="v">{human(likes)}</td></tr>')
    if channel:
        facts.append(f'<tr><td class="k">Channel</td><td class="v">{esc(channel)}</td></tr>')
    facts_html = "\n            ".join(facts)

    # About (소개) — 없으면 통째로 생략
    about_html = ""
    if intro:
        about_html = f'<section><h2>About this cam</h2><p>{esc(intro)}</p></section>'

    # What you'll see (볼거리) — 없으면 생략
    see_html = ""
    if hl:
        items = "".join(f"<li>{esc(x)}</li>" for x in hl)
        see_html = f'<section><h2>What you’ll see</h2><ul class="see-list">{items}</ul></section>'

    # Best time — 시간대 있으면 JS로 실시간, 없으면 일반 문구
    if tz:
        best_html = ('<section><h2>Best time to watch</h2>'
                     '<p>It’s currently <b class="bn">—</b> at this location — '
                     '<span class="bt">checking local conditions…</span></p></section>')
    else:
        best_html = ('<section><h2>Best time to watch</h2>'
                     '<p>This camera streams live around the clock.</p></section>')

    # Comments — 아직 데이터 연동 전: 빈 상태 안내 (구조만)
    comments_html = ('<section><h2>Comments</h2>'
                     '<div class="addc">💬 Open this cam in the map to leave a comment</div></section>')

    # Nearby cams
    cards = []
    for nb in nearby:
        emoji = {"news": "📰", "resort": "🏝️", "hotel": "🏨"}.get(nb.get("kind"), "📷")
        nb_place = nb.get("place_name") or nb.get("country") or ""
        cards.append(
            f'<a class="card" href="/cam/{esc(nb.get("slug") or nb.get("video_id"))}/">'
            f'<div class="th">{emoji}</div><div class="cap">'
            f'<div class="nm">{esc((nb.get("title") or "")[:48])}</div>'
            f'<div class="cs">{esc(nb_place)}</div></div></a>'
        )
    nearby_html = ""
    if cards:
        nearby_html = ('<section><h2>Nearby &amp; similar cams</h2>'
                       f'<div class="cards">{"".join(cards)}</div></section>')

    # JSON-LD (VideoObject + Breadcrumb)
    jsonld = {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": title,
        "description": meta_desc,
        "thumbnailUrl": [f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"],
        "uploadDate": (cam.get("created_at") or "")[:10] or None,
        "embedUrl": f"https://www.youtube.com/embed/{vid}",
        "isLiveBroadcast": True,
        "contentUrl": f"https://www.youtube.com/watch?v={vid}",
    }
    jsonld = {k: v for k, v in jsonld.items() if v is not None}
    crumb_country = esc(country) if country else "Live cams"
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": crumb_country, "item": SITE + "/"},
            {"@type": "ListItem", "position": 3, "name": title, "item": canonical},
        ],
    }
    jsonld_html = (
        '<script type="application/ld+json">' + json.dumps(jsonld, ensure_ascii=False) + "</script>\n"
        '<script type="application/ld+json">' + json.dumps(breadcrumb, ensure_ascii=False) + "</script>"
    )

    embed_url = f"https://www.youtube.com/embed/{vid}?autoplay=1&mute=1&playsinline=1"

    html_out = TEMPLATE
    repl = {
        "__ROBOTS__": robots,
        "__PAGETITLE__": esc(page_title),
        "__METADESC__": esc(meta_desc),
        "__CANONICAL__": canonical,
        "__JSONLD__": jsonld_html,
        "__CRUMB_COUNTRY__": crumb_country,
        "__H1__": esc(page_title.split(" | ")[0]),
        "__EMBED__": embed_url,
        "__PIPNAME__": esc((title[:28])),
        "__CHIPS__": chips_html,
        "__FACTS__": facts_html,
        "__ABOUT__": about_html,
        "__SEE__": see_html,
        "__BEST__": best_html,
        "__COMMENTS__": comments_html,
        "__NEARBY__": nearby_html,
        "__MAPHREF__": f"{SITE}/?cam={esc(vid)}",
        "__TZ__": esc(tz),
    }
    for k, v in repl.items():
        html_out = html_out.replace(k, v)
    return html_out, thin


# ============================================
# 근처 캠 고르기: 같은 나라 먼저, 모자라면 인기순으로 채움
# ============================================
def pick_nearby(cam, pool):
    me = cam.get("video_id")
    same = [c for c in pool if c.get("video_id") != me and c.get("country") and c.get("country") == cam.get("country")]
    others = [c for c in pool if c.get("video_id") != me and c not in same]
    return (same + others)[:NEARBY_COUNT]


# ============================================
# 메인
# ============================================
def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    res = (
        sb.table("live_videos")
        .select("*")
        .eq("is_active", True)
        .not_.is_("slug", "null")
        .order("like_count", desc=True)
        .execute()
    )
    rows = res.data or []
    print(f"📂 활성+slug 있는 캠 {len(rows)}개")
    if not rows:
        print("만들 페이지 없음 — 종료")
        return

    top = rows[:TOP_N]
    print(f"🏗️  좋아요 상위 {len(top)}개 페이지 생성")

    sitemap_urls = [(SITE + "/", None)]
    made = 0
    for i, cam in enumerate(top):
        rank = i + 1
        nearby = pick_nearby(cam, rows)
        page, thin = render_page(cam, rank, nearby)
        slug = cam.get("slug") or cam.get("video_id")
        d = os.path.join(OUT_ROOT, "cam", slug)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        made += 1
        tag = " (noindex: 내용 빈약)" if thin else ""
        print(f"  ✅ /cam/{slug}/{tag}")
        if not thin:
            sitemap_urls.append((f"{SITE}/cam/{slug}/", None))

    # sitemap.xml 생성
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, _ in sitemap_urls:
        lines.append(f"  <url><loc>{url}</loc><lastmod>{now}</lastmod></url>")
    lines.append("</urlset>")
    with open(os.path.join(OUT_ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"🗺️  sitemap.xml 갱신 ({len(sitemap_urls)}개 URL)")
    print(f"🎉 완료 — 페이지 {made}개")


# ============================================
# 페이지 템플릿 (확정 demo3: 영상 좌측 고정 + 보통/크게 + PiP + 실제 로고)
# __TOKEN__ 자리는 render_page 에서 채움
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
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@400;600;700;800&display=swap" rel="stylesheet" />
__JSONLD__
<style>
  :root{--bg:#0a0a0f;--panel:#14141f;--panel2:#1a1a26;--border:rgba(255,255,255,0.08);
    --text:#f0f0f5;--muted:#7c7c92;--mint:#6bffb8;--mint-bg:rgba(107,255,184,0.12);
    --red:#ff4e45;--gold:#f0c419;--festival:#ff6b6b;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:'Noto Sans KR',system-ui,-apple-system,sans-serif;line-height:1.6;}
  a{color:inherit;text-decoration:none;}
  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:24px;
    padding:11px 22px;background:rgba(10,10,15,0.9);backdrop-filter:blur(12px);
    border-bottom:1px solid var(--border);}
  .logo{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:2px;line-height:1;
    position:relative;display:inline-block;}
  .logo span{color:var(--festival);animation:breath 3.5s ease-in-out infinite;}
  @keyframes breath{0%,100%{text-shadow:0 0 10px rgba(255,107,107,0.55);}
    50%{text-shadow:0 0 22px rgba(255,107,107,1),0 0 38px rgba(255,107,107,0.6);}}
  .nav{display:flex;gap:20px;font-size:0.85rem;color:var(--muted);}
  .nav a:hover{color:var(--text);} .nav .drop::after{content:" ▾";font-size:0.7rem;}
  .wrap{max-width:1160px;margin:0 auto;padding:22px 22px 70px;}
  .crumb{font-size:0.75rem;color:var(--muted);margin-bottom:12px;}
  .crumb a:hover{color:var(--mint);}
  h1{font-size:1.55rem;line-height:1.3;margin:0 0 18px;}
  .grid{display:grid;grid-template-columns:600px 1fr;gap:28px;align-items:start;
    transition:grid-template-columns .25s ease;}
  .grid.theater{grid-template-columns:1fr;} .grid.theater .left{position:static;}
  .left{position:sticky;top:80px;align-self:start;}
  .videowrap{position:relative;aspect-ratio:16/9;background:#000;border-radius:16px;}
  .vidinner{position:absolute;inset:0;border-radius:16px;overflow:hidden;border:1px solid var(--border);background:#000;}
  .vidinner iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
  .vidinner.pip{position:fixed;width:340px;aspect-ratio:16/9;z-index:60;
    border-color:rgba(107,255,184,0.5);box-shadow:0 14px 38px rgba(0,0,0,0.6);}
  .pip-bar{display:none;}
  .vidinner.pip .pip-bar{display:flex;align-items:center;justify-content:space-between;
    position:absolute;top:0;left:0;right:0;height:28px;padding:0 6px 0 10px;z-index:4;
    font-size:0.7rem;font-weight:700;color:#fff;cursor:grab;
    background:linear-gradient(rgba(0,0,0,0.75),rgba(0,0,0,0));touch-action:none;}
  #pipClose{background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:6px;
    cursor:pointer;font-size:0.72rem;padding:3px 7px;line-height:1;}
  .drag-layer{display:none;}
  .vidinner.pip .drag-layer{display:block;position:absolute;inset:0;z-index:3;cursor:grab;touch-action:none;}
  .vidinner.pip.dragging,.vidinner.pip.dragging .pip-bar,.vidinner.pip.dragging .drag-layer{cursor:grabbing;}
  .vidinner.pip .sizectl{display:none;}
  .sizectl{position:absolute;top:10px;right:10px;z-index:6;display:flex;gap:4px;
    background:rgba(10,10,15,0.72);backdrop-filter:blur(8px);border:1px solid var(--border);
    border-radius:10px;padding:4px;}
  .sizectl button{border:none;background:transparent;color:var(--muted);font-size:0.74rem;
    font-weight:700;padding:5px 12px;border-radius:7px;cursor:pointer;font-family:inherit;}
  .sizectl button.on{background:var(--mint);color:#06231a;}
  @media(max-width:760px){.sizectl{display:none;}}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px;}
  .chip{display:inline-flex;align-items:center;gap:5px;font-size:0.76rem;font-weight:700;
    padding:6px 11px;border-radius:30px;border:1px solid var(--border);background:var(--panel2);}
  .chip.live{color:var(--red);border-color:rgba(255,78,69,0.45);background:rgba(255,78,69,0.12);}
  .chip.rank{color:var(--gold);border-color:rgba(240,196,25,0.4);background:rgba(240,196,25,0.1);}
  .chip.see{color:var(--mint);border-color:rgba(107,255,184,0.4);background:var(--mint-bg);}
  .chip .dot{width:7px;height:7px;border-radius:50%;background:var(--red);animation:pulse 1.6s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,78,69,0.5);}70%{box-shadow:0 0 0 7px rgba(255,78,69,0);}100%{box-shadow:0 0 0 0 rgba(255,78,69,0);}}
  .facts{width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:14px;
    background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
  .facts td{padding:10px 14px;border-bottom:1px solid var(--border);}
  .facts tr:last-child td{border-bottom:none;}
  .facts .k{color:var(--muted);width:42%;} .facts .v{text-align:right;font-weight:600;}
  .mapbtn{display:block;width:100%;text-align:center;margin-top:12px;padding:12px;
    border-radius:12px;background:var(--mint);color:#06231a;font-weight:800;font-size:0.85rem;}
  .right section{margin-bottom:32px;} .right section:first-child{margin-top:4px;}
  .right h2{font-size:1.1rem;margin:0 0 10px;}
  .right p{color:#d8d8e2;font-size:0.94rem;}
  .see-list{list-style:none;padding:0;margin:0;display:grid;gap:9px;}
  .see-list li{padding-left:21px;position:relative;font-size:0.92rem;color:#d8d8e2;}
  .see-list li::before{content:"📍";position:absolute;left:0;}
  .addc{font-size:0.85rem;color:var(--mint);border:1px dashed rgba(107,255,184,0.4);
    border-radius:11px;padding:13px;text-align:center;}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:11px;overflow:hidden;transition:border-color .15s;}
  .card:hover{border-color:rgba(107,255,184,0.4);}
  .card .th{height:84px;background:linear-gradient(135deg,#1a2740,#0e1622);display:flex;align-items:center;justify-content:center;font-size:1.5rem;}
  .card .cap{padding:8px 11px;} .card .nm{font-size:0.82rem;font-weight:600;}
  .card .cs{font-size:0.7rem;color:var(--muted);margin-top:2px;}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--border);color:var(--muted);font-size:0.8rem;text-align:center;}
  @media(max-width:760px){.grid{grid-template-columns:1fr;} .left{position:static;}}
</style>
</head>
<body>
  <div class="topbar">
    <a href="/" class="logo">FLARE<span>[V]</span></a>
    <nav class="nav"><a href="/">Home</a><a href="/" class="drop">Spots</a><a href="/" class="drop">Live cams</a></nav>
  </div>
  <div class="wrap">
    <div class="crumb"><a href="/">Home</a> › <a href="/">__CRUMB_COUNTRY__</a> › __H1__</div>
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
        __COMMENTS__
        __NEARBY__
        <footer>Flare[V] · Live web cams around the world, on a map</footer>
      </div>
    </div>
  </div>
<script>
  var TZ="__TZ__";
  function refresh(){
    if(!TZ)return;
    var now=new Date();
    var t=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(now);
    var h=parseInt(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}).format(now),10);
    var icon,label;
    if(h>=5&&h<8){icon="🌅";label="Sunrise";}
    else if(h>=8&&h<17){icon="☀️";label="Daytime";}
    else if(h>=17&&h<20){icon="🌇";label="Sunset soon";}
    else{icon="🌙";label="Night";}
    document.querySelectorAll('.lt').forEach(function(e){e.textContent=t+" (local)";});
    document.querySelectorAll('.dn').forEach(function(e){e.textContent=icon+" "+label;});
    document.querySelectorAll('.bn').forEach(function(e){e.textContent=label.toLowerCase();});
    document.querySelectorAll('.bt').forEach(function(e){
      e.textContent = (h>=8&&h<20)?"good visibility right now.":"quieter hours — check back in daylight.";});
  }
  refresh();setInterval(refresh,60000);

  var grid=document.getElementById('grid');
  document.querySelectorAll('#sizectl button').forEach(function(b){b.onclick=function(){
    grid.classList.toggle('theater',b.dataset.t==='1');
    document.querySelectorAll('#sizectl button').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on');window.scrollTo({top:0,behavior:'smooth'});
  };});

  var vidinner=document.getElementById('vidinner'),videowrap=document.getElementById('videowrap'),pipClosed=false;
  function enablePip(){if(vidinner.classList.contains('pip'))return;vidinner.classList.add('pip');
    var w=vidinner.offsetWidth||340;vidinner.style.left=(window.innerWidth-w-20)+'px';vidinner.style.top='86px';}
  function disablePip(){vidinner.classList.remove('pip','dragging');vidinner.style.left='';vidinner.style.top='';}
  document.getElementById('pipClose').onclick=function(e){e.stopPropagation();pipClosed=true;disablePip();};
  new IntersectionObserver(function(en){var e=en[0];
    if(e.isIntersecting){disablePip();pipClosed=false;}
    else if(e.boundingClientRect.bottom<80&&!pipClosed){enablePip();}
  },{threshold:0,rootMargin:'-76px 0px 0px 0px'}).observe(videowrap);
  var dragging=false,moved=false,sx,sy,ox,oy;
  function pt(ev){return ev.touches?ev.touches[0]:ev;}
  function dStart(ev){if(!vidinner.classList.contains('pip'))return;if(ev.target&&ev.target.id==='pipClose')return;
    dragging=true;moved=false;var p=pt(ev);sx=p.clientX;sy=p.clientY;var r=vidinner.getBoundingClientRect();ox=r.left;oy=r.top;
    vidinner.classList.add('dragging');ev.preventDefault();}
  function dMove(ev){if(!dragging)return;var p=pt(ev);var dx=p.clientX-sx,dy=p.clientY-sy;
    if(Math.abs(dx)+Math.abs(dy)>4)moved=true;var w=vidinner.offsetWidth,h=vidinner.offsetHeight;
    var nx=Math.max(8,Math.min(window.innerWidth-w-8,ox+dx)),ny=Math.max(8,Math.min(window.innerHeight-h-8,oy+dy));
    vidinner.style.left=nx+'px';vidinner.style.top=ny+'px';ev.preventDefault();}
  function dEnd(){if(!dragging)return;dragging=false;vidinner.classList.remove('dragging');
    if(!moved){window.scrollTo({top:0,behavior:'smooth'});}}
  ['#draglayer','#pipbar'].forEach(function(sel){var el=document.querySelector(sel);
    el.addEventListener('mousedown',dStart);el.addEventListener('touchstart',dStart,{passive:false});});
  window.addEventListener('mousemove',dMove);window.addEventListener('touchmove',dMove,{passive:false});
  window.addEventListener('mouseup',dEnd);window.addEventListener('touchend',dEnd);
</script>
</body>
</html>"""


if __name__ == "__main__":
    main()
