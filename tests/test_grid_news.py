"""Offline regression tests for build-time news collection and recovery."""
import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import grid_news as news

NOW = dt.datetime(2026, 10, 28, 18, tzinfo=news.BST)
FEED = ('The Business Standard', 'en', 'https://www.tbsnews.net/top-news/rss.xml')
BN = ('প্রথম আলো', 'bn', 'https://www.prothomalo.com/feed/')

def rss(title='Bangladesh electricity tariff increases', url='https://www.tbsnews.net/economy/power-tariff-1', date='Wed, 28 Oct 2026 11:05:00 +0600', description='New electricity tariffs affect power generation costs.'):
    return ('<rss><channel><item><title>' + escape(title) + '</title><link>' + escape(url) + '</link><pubDate>' + date + '</pubDate><description>' + escape(description) + '</description></item></channel></rss>').encode()

def article(id='old', date='2026-10-27', url='https://www.tbsnews.net/economy/old', title='Power grid fault disrupts supply in Dhaka'):
    return dict(id=id, date=date, url=url, title=title, source='The Business Standard', summary='Curated context.', event='curated-grid', language='en')

class NewsTests(unittest.TestCase):
    def test_publisher_excerpts_and_bangladesh_times(self):
        a = news.parse_feed(rss(description='<p>Costs <b>rise</b>.</p><script>bad()</script>'), FEED, NOW)[0]
        self.assertEqual(a['summary'], 'Costs rise.')
        self.assertEqual(a['published_at'], '2026-10-28T11:05:00+06:00')
        self.assertTrue(a['publication_time_verified'])
        self.assertEqual(a['source'], FEED[0])
        bn = news.parse_feed(rss('বিদ্যুৎ সরবরাহে বিপর্যয়', 'https://www.prothomalo.com/bangladesh/test', description='ঢাকায় বিদ্যুৎ সরবরাহ বন্ধ।'), BN, NOW)[0]
        self.assertEqual(bn['language'], 'bn')
        self.assertIn('সরবরাহে', news.tokens(bn['title']))

    def test_relevance_domain_and_date_guards(self):
        cases = [rss('Cricket player wins award', description='Sports reporting.'), rss(url='javascript:alert(1)'), rss(url='https://evil.test/power'), rss(date='Thu, 29 Oct 2026 11:05:00 +0600'), rss(date='Wed, 28 Oct 2026 11:05:00'), rss(date='not a date')]
        for content in cases:
            try: result = news.parse_feed(content, FEED, NOW)
            except ValueError: result = []
            self.assertEqual(result, [])
        self.assertFalse(news.relevant('Indian electricity tariffs rise', '', 'https://www.tbsnews.net/world/india'))
        self.assertTrue(news.relevant('India resumes electricity exports to Bangladesh', '', 'https://www.tbsnews.net/world/india'))
        self.assertFalse(news.relevant('LPG cylinder prices rise', '', 'https://www.tbsnews.net/economy/lpg'))
        with self.assertRaises(ValueError): news.parse_feed(b'<html>Not RSS</html>', FEED, NOW)
        with self.assertRaises(ValueError): news.parse_feed(rss(date='Fri, 22 Jul 2022 11:05:00 +0600'), FEED, NOW)

    def test_rolling_90_days_deduplication_and_curated_precedence(self):
        old = article()
        duplicate = dict(old, id='rss-new', url=old['url'] + '/?utm_source=rss#part', summary='Raw excerpt.')
        previous = dict(articles=[old, article('expired', '2026-07-30', 'https://www.tbsnews.net/expired')], event_labels={'curated-grid':'Curated grid incident'})
        articles, labels = news.merge_articles(previous, [duplicate, article('future', '2026-10-29', 'https://www.tbsnews.net/future')], NOW)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]['summary'], 'Curated context.')
        self.assertEqual(articles[0]['event'], 'curated-grid')
        self.assertEqual(labels['curated-grid'], 'Curated grid incident')

    def test_groups_require_close_headlines_and_nearby_dates(self):
        a = dict(article('a'), event='auto-a')
        same = dict(article('b', url='https://www.tbsnews.net/b', title='Power grid fault disrupts supply in Dhaka city'), event='auto-b')
        unrelated = dict(article('c', url='https://www.tbsnews.net/c', title='LNG fuel imports increase gas supplies'), event='auto-c')
        far = dict(article('d', date='2026-09-01', url='https://www.tbsnews.net/d'), event='auto-d')
        rows, _ = news.merge_articles({'articles':[], 'event_labels':{}}, [a, same, unrelated, far], NOW)
        by_id = {a['id']:a for a in rows}
        self.assertEqual(by_id['a']['event'], by_id['b']['event'])
        self.assertNotEqual(by_id['a']['event'], by_id['c']['event'])
        self.assertNotEqual(by_id['a']['event'], by_id['d']['event'])

    def test_every_build_collects_and_total_failure_preserves_history(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(news, 'FEEDS', (FEED,)):
            calls = []
            def fetch(url): calls.append(url); return rss()
            first = news.collect(directory, NOW, fetch)
            second = news.collect(directory, NOW + dt.timedelta(minutes=15), fetch)
            self.assertEqual(calls, [FEED[2], FEED[2]])
            self.assertEqual(second['refresh_mode'], 'automatic')
            self.assertEqual(second['collection_status'], 'success')
            self.assertEqual(len(first['articles']), len(second['articles']))
            def failed(url): raise OSError('offline')
            third = news.collect(directory, NOW + dt.timedelta(minutes=30), failed)
            self.assertEqual(third['collection_status'], 'failed')
            self.assertEqual(third['last_successful_refresh_at'], second['last_successful_refresh_at'])
            self.assertEqual(third['articles'], second['articles'])
            self.assertEqual(json.loads((pathlib.Path(directory)/'catalog.json').read_text())['last_attempt_at'], third['last_attempt_at'])

    def test_build_writes_the_collected_catalog(self):
        import build_pages_data as build
        with tempfile.TemporaryDirectory() as directory, patch.object(news, 'collect', return_value={'articles':[], 'refresh_mode':'automatic'}) as collect:
            build.write_news_bundle(pathlib.Path(directory))
            self.assertEqual(json.loads((pathlib.Path(directory)/'news-data.json').read_text())['refresh_mode'], 'automatic')
            collect.assert_called_once()

    def test_partial_failure_and_published_catalog_recovery(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(news, 'FEEDS', (FEED, BN)):
            saved = {'articles':[article('recovered', url='https://www.tbsnews.net/recovered')], 'event_labels':{'curated-grid':'Recovered story'}, 'curated_on':'2026-10-27'}
            def fetch(url):
                if url == 'https://example.test/catalog': return json.dumps(saved).encode()
                if url == BN[2]: raise OSError('publisher unavailable')
                return rss()
            result = news.collect(directory, NOW, fetch, 'https://example.test/catalog')
            self.assertEqual(result['collection_status'], 'partial')
            self.assertIn('recovered', [a['id'] for a in result['articles']])
            self.assertEqual(sum(s['status']=='ok' for s in result['feed_status']), 1)
            self.assertTrue(news.valid_catalog(result))

if __name__ == '__main__': unittest.main()
