"""Collect short publisher RSS excerpts on every build; keep the last valid catalog."""
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = pathlib.Path(__file__).resolve().parents[1]
BST = dt.timezone(dt.timedelta(hours=6))
MAX_BYTES = 4 * 1024 * 1024
# Public publisher feeds verified to carry current items; no search-service API key.
FEEDS = (
    ('The Business Standard', 'en', 'https://www.tbsnews.net/top-news/rss.xml'),
    ('The Business Standard', 'en', 'https://www.tbsnews.net/economy/rss.xml'),
    ('The Daily Star', 'en', 'https://www.thedailystar.net/news/rss.xml'),
    ('Prothom Alo', 'en', 'https://en.prothomalo.com/feed/'),
    ('প্রথম আলো', 'bn', 'https://www.prothomalo.com/feed/'),
    ('বাংলা ট্রিবিউন', 'bn', 'https://www.banglatribune.com/feed/'),
    ('জাগো নিউজ২৪', 'bn', 'https://www.jagonews24.com/rss/rss.xml'),
)
POWER = re.compile(r'\b(?:electricity|power plant|power sector|power supply|power grid|national grid|power outage|power generation|power tariff|load[ -]?shedding|blackout|bpdb|pgcb|rooppur)\b|বিদ্যু[ৎত]|লোডশেডিং|লোডশেড|ব্ল্যাকআউট|পিডিবি|পিজিসিবি|রূপপুর', re.I)
FUEL = re.compile(r'\b(?:lng|petrobangla|gas supply|gas shortage|gas tariff|coal import|coal supply)\b|এলএনজি|পেট্রোবাংলা|গ্যাস সরবরাহ|গ্যাসসংকট|গ্যাস সংকট|গ্যাসের দাম|কয়লা আমদানি|কয়লা আমদানি', re.I)
BD = re.compile(r'\bbangladesh\b|বাংলাদেশ|ঢাকা|চট্টগ্রাম', re.I)
FOREIGN = re.compile(r'/(?:world|international|foreign|offbeat|sports|entertainment|showbiz|opinion)/', re.I)
STOP = set('the a an and or of to for in on at by from with as is are over after amid bangladesh power electricity says said new bd বাংলাদেশের বিদ্যুৎ বিদ্যুতের ও এর যে এই নিয়ে নিয়ে'.split())

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
        if tag in ('p', 'br', 'div', 'li'): self.parts.append(' ')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'li'): self.parts.append(' ')
    def handle_data(self, value):
        if not self.hidden: self.parts.append(value)

def plain(value):
    parser = PlainText()
    parser.feed(value or '')
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()

def canonical(url):
    try:
        parts = urlsplit(url.strip())
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password or parts.port not in (None, 80, 443): return None
        host = parts.hostname.lower().removeprefix('www.')
        query = [(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')]
        return urlunsplit(('https', host, parts.path.rstrip('/') or '/', urlencode(sorted(query)), ''))
    except (ValueError, AttributeError): return None

def fetch(url):
    result = subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '20', '--max-filesize', str(MAX_BYTES), '--proto', '=https', '--proto-redir', '=https', '--user-agent', 'BEGD-News/1.0 (+https://satyakibanik.github.io/Projects/begd/)', url], capture_output=True, check=True, timeout=25)
    if len(result.stdout) > MAX_BYTES: raise ValueError('Oversized feed')
    return result.stdout

def timestamp(value):
    try:
        result = parsedate_to_datetime(value.strip())
    except (ValueError, TypeError, AttributeError):
        try: result = dt.datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        except (ValueError, TypeError, AttributeError): return None
    return result.astimezone(BST) if result.tzinfo else None

def relevant(title, excerpt, url):
    text = title + ' ' + excerpt
    if FOREIGN.search(url) and not BD.search(text): return False
    return bool(POWER.search(text) or FUEL.search(text))

def tokens(title):
    return set(re.findall(r'[\w\u0980-\u09ff]+', unicodedata.normalize('NFKC', title).lower(), re.UNICODE)) - STOP

def parse_feed(content, feed, now):
    source, language, feed_url = feed
    root = ET.fromstring(content.decode('utf-8-sig'))
    if root.tag.split('}')[-1] != 'rss' or root.find('channel') is None: raise ValueError('Not a publisher RSS feed')
    items, articles, dates = root.findall('./channel/item'), [], []
    if not items: raise ValueError('Empty publisher feed')
    host = urlsplit(feed_url).hostname.removeprefix('www.')
    cutoff = (now.astimezone(BST).date() - dt.timedelta(days=89)).isoformat()
    for item in items[:500]:
        text = lambda key: ''.join(item.find(key).itertext()).strip() if item.find(key) is not None else ''
        posted = timestamp(text('pubDate'))
        if posted and posted <= now + dt.timedelta(minutes=5): dates.append(posted)
        if not posted or posted > now or posted.date().isoformat() < cutoff: continue
        title, excerpt = plain(text('title')), plain(text('description'))
        url = canonical(text('link'))
        # Prothom Alo sometimes syndicates sister-site items: keep only the configured publisher.
        if not title or not url or urlsplit(url).hostname != host or not relevant(title, excerpt[:1500], url): continue
        identifier = 'rss-' + hashlib.sha256(url.encode()).hexdigest()[:20]
        summary = excerpt[:280].rsplit(' ', 1)[0] + '…' if len(excerpt) > 280 else excerpt
        if not summary or summary == title:
            summary = 'প্রকাশকের ফিডে সংক্ষিপ্তসার দেওয়া হয়নি।' if language == 'bn' else 'The publisher did not provide a summary in its feed.'
        articles.append(dict(id=identifier, source=source, title=title, url=url, summary=summary, date=posted.date().isoformat(), published_at=posted.isoformat(), publication_time_verified=True, language=language, event='auto-' + identifier, collection_method='publisher-rss', verification='Publisher RSS metadata; automated relevance filtering', discovered_at=now.isoformat()))
    if not dates or max(dates) < now - dt.timedelta(days=7): raise ValueError('Feed has no recent dated items')
    return articles

def valid_catalog(value):
    if not isinstance(value, dict) or not isinstance(value.get('articles'), list) or not isinstance(value.get('event_labels'), dict): return False
    try:
        dt.date.fromisoformat(value['curated_on'])
        for a in value['articles']:
            if not isinstance(a, dict) or not all(isinstance(a.get(k), str) and a[k] for k in ('id', 'title', 'source', 'url', 'date', 'summary', 'event')): return False
            dt.date.fromisoformat(a['date'])
            if not canonical(a['url']) or a.get('language') not in ('en', 'bn') or not isinstance(value['event_labels'].get(a['event']), str): return False
        return True
    except (KeyError, ValueError, TypeError): return False

def merge_articles(previous, incoming, now):
    cutoff = (now.astimezone(BST).date() - dt.timedelta(days=89)).isoformat()
    end = now.astimezone(BST).date().isoformat()
    # Earlier, curated versions win over rediscovered RSS entries, including their summaries/groups.
    by_url = {}
    for article in [*previous.get('articles', []), *incoming]:
        if cutoff <= article['date'] <= end: by_url.setdefault(canonical(article['url']), dict(article))
    articles = sorted(by_url.values(), key=lambda a: (a['date'], a.get('published_at', ''), a['id']), reverse=True)
    labels = dict(previous.get('event_labels', {}))
    for article in articles:
        if not article['event'].startswith('auto-'): continue
        own = tokens(article['title'])
        matches = []
        for other in articles:
            if other is article or other['event'].startswith('auto-') and other['id'] >= article['id']: continue
            if abs((dt.date.fromisoformat(other['date']) - dt.date.fromisoformat(article['date'])).days) > 3: continue
            theirs = tokens(other['title'])
            common = len(own & theirs)
            similarity = common / max(1, len(own | theirs))
            if common >= 3 and similarity >= .65: matches.append((similarity, other['event']))
        if matches: article['event'] = max(matches)[1]
        labels.setdefault(article['event'], article['title'])
    used = {a['event'] for a in articles}
    return articles, {key: value for key, value in labels.items() if key in used}

def collect(cache_dir, now=None, fetcher=fetch, published_url=None):
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(BST)
    cache_dir = pathlib.Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / 'catalog.json'
    seed = json.loads((ROOT / 'begd/news-data.json').read_text())
    previous = seed
    try:
        candidate = json.loads(cache_file.read_text())
        if valid_catalog(candidate): previous = candidate
        else: raise ValueError('Invalid cached catalog')
    except (OSError, ValueError, TypeError):
        if published_url:
            try:
                candidate = json.loads(fetcher(published_url))
                if valid_catalog(candidate): previous = candidate
            except Exception: pass
    retained = dict(previous)
    # Preserve manual additions in the repository, even when a cached catalog exists.
    previous = dict(previous)
    known = {canonical(a['url']) for a in seed['articles']}
    previous['articles'] = seed['articles'] + [a for a in previous['articles'] if canonical(a['url']) not in known]
    previous['event_labels'] = {**seed['event_labels'], **previous['event_labels']}
    def read(feed):
        try: return parse_feed(fetcher(feed[2]), feed, now), dict(source=feed[0], url=feed[2], status='ok')
        except Exception as error: return [], dict(source=feed[0], url=feed[2], status='failed', error=type(error).__name__ + ': ' + str(error)[:160])
    with ThreadPoolExecutor(max_workers=4) as pool: results = list(pool.map(read, FEEDS))
    successful = sum(status['status'] == 'ok' for _, status in results)
    output = {**previous, 'refresh_mode': 'automatic', 'mode': 'Publisher RSS collection with curated archive', 'last_attempt_at': now.isoformat(), 'collection_status': 'success' if successful == len(FEEDS) else 'partial' if successful else 'failed', 'feed_status': [status for _, status in results], 'coverage_complete': False}
    if successful:
        output['articles'], output['event_labels'] = merge_articles(previous, [a for rows, _ in results for a in rows], now)
        output.update(last_successful_refresh_at=now.isoformat(), last_successful_refresh_date=now.date().isoformat(), coverage_start=(now.date() - dt.timedelta(days=89)).isoformat(), coverage_end=now.date().isoformat(), coverage_note='Rolling 90-day publisher-feed catalog. Feed coverage and automated relevance matching are not exhaustive.')
    else:
        output['articles'], output['event_labels'] = retained['articles'], retained['event_labels']
    temporary = cache_file.with_suffix('.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, allow_nan=False))
    temporary.replace(cache_file)
    return output
