import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const api = require('./neodb-external-ratings.user.js');

test('recognizes NeoDB item paths, including album and tv season', () => {
  assert.equal(api.isItemPath('/movie/6SAqdyMEu3kGepBN0mHZAr'), true);
  assert.equal(api.isItemPath('/tv/season/6w9C7lVHbDMULFhw8sywTo'), true);
  assert.equal(api.isItemPath('/album/0OAma72CoBzNwr99j4CIUx'), true);
  assert.equal(api.isItemPath('/performance/1jDANyAiacbCZ5vL1gUy00'), true);
  assert.equal(api.isItemPath('/movies/foo'), false);
  assert.equal(api.isItemPath('/search'), false);
  assert.equal(api.isItemPath('/'), false);
});

test('parses Douban and Bangumi links from NeoDB external resources', () => {
  const picked = api.pickResources([
    'https://www.imdb.com/title/tt0111161/',
    'https://movie.douban.com/subject/1292052/',
    'https://bgm.tv/subject/245665',
    'https://www.douban.com/game/26817171/',
    'https://bangumi.tv/subject/62229',
  ]);
  assert.equal(picked.douban.id, '1292052');
  assert.equal(picked.douban.kind, 'movie');
  assert.equal(picked.douban.url, 'https://movie.douban.com/subject/1292052/');
  assert.equal(picked.bangumi.id, '245665');
  assert.equal(picked.bangumi.commentsUrl, 'https://bgm.tv/subject/245665/comments');
});

test('covers book, music, game, drama and bare subject urls', () => {
  assert.equal(api.parseDoubanUrl('https://book.douban.com/subject/27105437/').kind, 'book');
  assert.equal(api.parseDoubanUrl('https://music.douban.com/subject/1406522/').kind, 'music');
  assert.equal(api.parseDoubanUrl('https://www.douban.com/game/26817171/').url, 'https://www.douban.com/game/26817171/');
  assert.equal(api.parseDoubanUrl('https://www.douban.com/location/drama/38462585/').kind, 'drama');
  assert.equal(api.parseDoubanUrl('https://www.douban.com/subject/1292052/').kind, 'subject');
  assert.equal(api.parseBangumiUrl('https://chii.in/subject/12/ep').id, '12');
  assert.equal(api.parseDoubanUrl('https://example.com/subject/1'), null);
  assert.equal(api.parseBangumiUrl('javascript:alert(1)'), null);
});

test('builds catalog API candidates for the current item and the generic uuid route', () => {
  assert.deepEqual(
    api.catalogApiUrls('https://neodb.social', '/tv/season/6w9C7lVHbDMULFhw8sywTo'),
    [
      'https://neodb.social/api/tv/season/6w9C7lVHbDMULFhw8sywTo',
      'https://neodb.social/api/catalog/item/6w9C7lVHbDMULFhw8sywTo',
    ],
  );
  assert.deepEqual(api.urlsFromCatalog({
    external_resources: [{ url: 'https://bgm.tv/subject/1' }, { url: '' }, null],
  }), ['https://bgm.tv/subject/1']);
});

test('parses Douban rating and hot comments', () => {
  const subject = api.parseDoubanSubject({
    title: '肖申克的救赎',
    rating: { count: 3351916, max: 10, value: 9.7 },
    null_rating_reason: '',
  });
  assert.equal(subject.score, 9.7);
  assert.equal(subject.count, 3351916);
  const comments = api.parseDoubanInterests({
    interests: [
      { comment: '  恐惧让你沦为囚犯。  ', rating: { value: 5, max: 5 }, user: { name: '如小果' } },
      { comment: '   ', rating: { value: 4, max: 5 }, user: { name: '空' } },
    ],
  });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].user, '如小果');
  assert.equal(comments[0].score, '5/5');
  assert.equal(api.parseDoubanSubject({ code: 404, msg: 'missing' }), null);
});

test('parses Bangumi score and short comments', () => {
  const subject = api.parseBangumiSubject({
    name: '鬼滅の刃',
    name_cn: '鬼灭之刃',
    rating: { score: 7.3, total: 22214, rank: 1566 },
  });
  assert.equal(subject.title, '鬼灭之刃');
  assert.equal(subject.score, 7.3);
  assert.equal(subject.rank, 1566);
  const comments = api.parseBangumiComments({
    data: [
      { rate: 0, comment: '只有吐槽没有打分', user: { nickname: '甲' } },
      { rate: 8, comment: '画面很强\r\n剧情一般', user: { username: '乙' } },
    ],
  });
  assert.equal(comments[0].score, '');
  assert.equal(comments[1].text, '画面很强 剧情一般');
  assert.equal(comments[1].score, '8/10');
  assert.equal(api.parseBangumiSubject({ rating: { score: 0, total: 2 } }).emptyReason, '暂无评分');
});

test('renders compact scores with comments collapsed by default', () => {
  const html = api.renderPanel({
    douban: {
      status: 'ok',
      url: 'https://movie.douban.com/subject/1292052/',
      commentsUrl: 'https://movie.douban.com/subject/1292052/comments/',
      title: '<肖申克>',
      score: 9.7,
      max: 10,
      count: 3351916,
      comments: [{ user: '<如小果>', text: '<script>alert(1)</script>', score: '5/5' }],
    },
    bangumi: { status: 'missing' },
  });
  assert.match(html, /9\.7/);
  assert.match(html, /3,351,916|3351916/);
  assert.match(html, /movie\.douban\.com\/subject\/1292052/);
  assert.match(html, /未关联/);
  assert.match(html, /<details class="neodb-ext-fold">/);
  assert.equal(/<details[^>]*\sopen[\s>]/.test(html), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;肖申克&gt;/);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('打开豆瓣'), false);
  assert.equal(api.safeUrl('javascript:alert(1)'), '');
});

test('error state still keeps an open-site link and message', () => {
  const html = api.renderPanel({
    douban: {
      status: 'error',
      url: 'https://movie.douban.com/subject/1292052/',
      message: '暂时读不到豆瓣数据。',
    },
    bangumi: { status: 'missing' },
  });
  assert.match(html, /打开豆瓣/);
  assert.match(html, /暂时读不到豆瓣数据/);
  assert.equal(html.includes('neodb-ext-fold'), false);
});

function fakeNode(id, extras) {
  return Object.assign({
    id: id || '',
    isConnected: true,
    classList: { contains() { return false; } },
    closest() { return null; },
    previousElementSibling: null,
    ownerDocument: null,
  }, extras);
}

test('mounts after the native #item-metadata .rating, never into the title', () => {
  const rating = fakeNode('rating');
  const metadata = fakeNode('item-metadata');
  const cover = fakeNode('item-cover');
  const title = fakeNode('item-title');
  const doc = {
    getElementById(id) {
      if (id === 'item-metadata') return metadata;
      if (id === 'item-cover') return cover;
      if (id === 'item-title') return title;
      return null;
    },
    querySelector(sel) {
      if (sel === '#item-metadata .rating') return rating;
      return null;
    },
  };
  const target = api.findMountTarget(doc);
  assert.equal(target.node, rating);
  assert.equal(target.where, 'afterend');
  assert.equal(target.leftColumn, false);
  assert.notEqual(target.node, title);
});

test('falls back to metadata, then cover; never uses #item-title', () => {
  const metadata = fakeNode('item-metadata');
  const cover = fakeNode('item-cover');
  const title = fakeNode('item-title');
  const metaOnly = {
    getElementById(id) {
      if (id === 'item-metadata') return metadata;
      if (id === 'item-cover') return cover;
      if (id === 'item-title') return title;
      return null;
    },
    querySelector() { return null; },
  };
  const metaTarget = api.findMountTarget(metaOnly);
  assert.equal(metaTarget.node, metadata);
  assert.equal(metaTarget.where, 'beforeend');

  const coverOnly = {
    getElementById(id) {
      if (id === 'item-cover') return cover;
      if (id === 'item-title') return title;
      return null;
    },
    querySelector() { return null; },
  };
  const coverTarget = api.findMountTarget(coverOnly);
  assert.equal(coverTarget.node, cover);
  assert.equal(coverTarget.where, 'afterend');
  assert.equal(coverTarget.leftColumn, true);

  const titleOnly = {
    getElementById(id) {
      if (id === 'item-title') return title;
      return null;
    },
    querySelector() { return null; },
  };
  assert.equal(api.findMountTarget(titleOnly), null);
});

test('rejects a panel still sitting in the title area', () => {
  const title = fakeNode('item-title');
  const misplaced = fakeNode('neodb-ext-ratings', {
    closest(sel) { return sel === '#item-title' ? title : null; },
  });
  assert.equal(api.panelIsWellPlaced(misplaced), false);

  const well = fakeNode('neodb-ext-ratings', {
    closest(sel) { return sel === '#item-metadata' ? fakeNode('item-metadata') : null; },
  });
  assert.equal(api.panelIsWellPlaced(well), true);
});

test('live Douban movie and Bangumi subject', { timeout: 30000 }, async () => {
  const douban = await api.loadDouban(api.parseDoubanUrl('https://movie.douban.com/subject/1292052/'));
  assert.equal(douban.status, 'ok', douban.message);
  assert.ok(douban.score >= 9, `unexpected douban score ${douban.score}`);
  assert.ok(douban.count > 100000);
  assert.ok(douban.comments.length >= 1);
  assert.ok(douban.comments[0].text.length > 0);

  const bangumi = await api.loadBangumi(api.parseBangumiUrl('https://bgm.tv/subject/245665'));
  assert.equal(bangumi.status, 'ok', bangumi.message);
  assert.ok(bangumi.score > 0);
  assert.ok(bangumi.count > 1000);
  assert.equal(bangumi.title.includes('鬼灭') || bangumi.title.includes('鬼滅'), true);
  assert.ok(bangumi.comments.length >= 1, 'expected at least one Bangumi comment');
});

test('live Douban book, game and drama degrade without throwing', { timeout: 30000 }, async () => {
  const book = await api.loadDouban(api.parseDoubanUrl('https://book.douban.com/subject/27105437/'));
  assert.equal(book.status, 'ok', book.message);
  assert.ok(book.score > 0);

  const game = await api.loadDouban(api.parseDoubanUrl('https://www.douban.com/game/26817171/'));
  assert.equal(game.status, 'ok', game.message);
  assert.ok(game.score > 0);

  const drama = await api.loadDouban(api.parseDoubanUrl('https://www.douban.com/location/drama/38462585/'));
  assert.equal(drama.status, 'ok', drama.message);
  assert.equal(drama.score, null);
  assert.match(drama.emptyReason, /评分/);
});
