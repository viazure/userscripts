// ==UserScript==
// @name         NeoDB 豆瓣与 Bangumi 评分
// @namespace    https://github.com/viazure/userscripts
// @version      0.2.1
// @description  在 NeoDB 条目页左侧原生评分下方显示已关联的豆瓣与 Bangumi 评分；短评默认折叠
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neodb.social
// @author       viazure
// @license      MIT
// @homepageURL  https://github.com/viazure/userscripts
// @supportURL   https://github.com/viazure/userscripts/issues
// @updateURL    https://github.com/viazure/userscripts/raw/main/scripts/neodb-external-ratings.user.js
// @downloadURL  https://github.com/viazure/userscripts/raw/main/scripts/neodb-external-ratings.user.js
// @match        *://neodb.social/*
// @match        *://*.neodb.social/*
// @match        *://eggplant.place/*
// @match        *://neodb.de/*
// @match        *://minreol.dk/*
// @include      /^https?:\/\/(?:[^\/?#]+\.)?(?:neodb\.social|neodb\.de|eggplant\.place|minreol\.dk)\/(movie|tv|book|game|music|album|podcast|performance)(?:\/[^\s]*)?(?:[?#][^\s]*)?$/
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.bgm.tv
// @connect      next.bgm.tv
// @connect      bgm.tv
// @connect      bangumi.tv
// @connect      chii.in
// @connect      m.douban.com
// @connect      movie.douban.com
// @connect      book.douban.com
// @connect      music.douban.com
// @connect      www.douban.com
// @connect      douban.com
// @connect      neodb.social
// @connect      *
// ==/UserScript==

/*
 * 数据来源（均不要求登录，也不含密钥）：
 * - NeoDB：页面上游站链接；缺失时读同源 /api/{路径}、Activity JSON，或 /api/catalog/item/{uuid}
 * - Bangumi 评分：https://api.bgm.tv/v0/subjects/{id}
 * - Bangumi 短评：https://next.bgm.tv/p1/subjects/{id}/comments （新站公开只读接口）
 * - 豆瓣评分与热门短评：https://m.douban.com/rexxar/api/v2/{type}/{id}
 *   豆瓣没有官方公开 API。直连失败时只保留原站链接和说明。
 */
(function () {
  'use strict';

  var UA = 'viazure-userscripts/0.2.1 (+https://github.com/viazure/userscripts)';
  var BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  var ITEM_PATH = /^\/(movie|tv|book|game|music|album|podcast|performance)(\/|$)/;
  var COMMENT_LIMIT = 3;

  function isItemPath(pathname) {
    return ITEM_PATH.test(pathname || '');
  }

  function parseBangumiUrl(href) {
    var url;
    try {
      url = new URL(href);
    } catch (err) {
      return null;
    }
    var host = url.hostname.toLowerCase();
    if (!(host === 'bgm.tv' || host.endsWith('.bgm.tv') || host === 'bangumi.tv' || host.endsWith('.bangumi.tv') || host === 'chii.in' || host.endsWith('.chii.in'))) {
      return null;
    }
    var match = url.pathname.match(/\/subject\/(\d+)/);
    if (!match) return null;
    var id = match[1];
    return {
      site: 'bangumi',
      id: id,
      url: 'https://bgm.tv/subject/' + id,
      commentsUrl: 'https://bgm.tv/subject/' + id + '/comments',
    };
  }

  function canonicalDouban(kind, id, fallback) {
    if (kind === 'book') return 'https://book.douban.com/subject/' + id + '/';
    if (kind === 'music') return 'https://music.douban.com/subject/' + id + '/';
    if (kind === 'game') return 'https://www.douban.com/game/' + id + '/';
    if (kind === 'drama') return fallback;
    if (kind === 'movie') return 'https://movie.douban.com/subject/' + id + '/';
    return 'https://www.douban.com/subject/' + id + '/';
  }

  function doubanCommentsUrl(kind, id, pageUrl) {
    if (kind === 'book') return 'https://book.douban.com/subject/' + id + '/comments/';
    if (kind === 'music') return 'https://music.douban.com/subject/' + id + '/comments/';
    if (kind === 'movie') return 'https://movie.douban.com/subject/' + id + '/comments/';
    return pageUrl;
  }

  function parseDoubanUrl(href) {
    var url;
    try {
      url = new URL(href);
    } catch (err) {
      return null;
    }
    var host = url.hostname.toLowerCase();
    if (!(host === 'douban.com' || host.endsWith('.douban.com'))) return null;
    var path = url.pathname;
    var game = path.match(/\/game\/(\d+)/);
    var drama = path.match(/\/drama\/(\d+)/);
    var subject = path.match(/\/subject\/(\d+)/);
    var kind = null;
    var id = null;
    if (game) {
      kind = 'game';
      id = game[1];
    } else if (drama) {
      kind = 'drama';
      id = drama[1];
    } else if (subject) {
      id = subject[1];
      if (host.indexOf('book.') === 0 || path.indexOf('/book/') !== -1) kind = 'book';
      else if (host.indexOf('music.') === 0 || path.indexOf('/music/') !== -1) kind = 'music';
      else if (host.indexOf('movie.') === 0 || path.indexOf('/movie/') !== -1) kind = 'movie';
      else kind = 'subject';
    } else {
      return null;
    }
    var pageUrl = canonicalDouban(kind, id, url.href);
    return {
      site: 'douban',
      id: id,
      kind: kind,
      url: pageUrl,
      commentsUrl: doubanCommentsUrl(kind, id, pageUrl),
    };
  }

  function pickResources(hrefs) {
    var douban = null;
    var bangumi = null;
    (hrefs || []).forEach(function (href) {
      if (!douban) douban = parseDoubanUrl(href);
      if (!bangumi) bangumi = parseBangumiUrl(href);
    });
    return { douban: douban, bangumi: bangumi };
  }

  function urlsFromCatalog(data) {
    var list = data && data.external_resources;
    if (!Array.isArray(list)) return [];
    return list.map(function (item) {
      return item && typeof item.url === 'string' ? item.url : '';
    }).filter(Boolean);
  }

  function catalogApiUrls(origin, pathname) {
    var path = String(pathname || '').split('?')[0].split('#')[0].replace(/\/$/, '');
    var parts = path.split('/').filter(Boolean);
    var uuid = parts.length ? parts[parts.length - 1] : '';
    var urls = [];
    if (path) urls.push(origin.replace(/\/$/, '') + '/api' + path);
    if (uuid) urls.push(origin.replace(/\/$/, '') + '/api/catalog/item/' + encodeURIComponent(uuid));
    return urls;
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function shorten(value, max) {
    var text = cleanText(value);
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '…';
  }

  function finiteNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseDoubanSubject(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.code && !data.title && !data.rating) return null;
    var rating = data.rating && typeof data.rating === 'object' ? data.rating : null;
    var score = rating ? finiteNumber(rating.value) : null;
    var count = rating ? finiteNumber(rating.count) : null;
    return {
      title: cleanText(data.title || ''),
      score: score > 0 ? score : null,
      max: rating && finiteNumber(rating.max) ? finiteNumber(rating.max) : 10,
      count: count > 0 ? count : null,
      emptyReason: cleanText(data.null_rating_reason || ''),
    };
  }

  function scoreLabel(rating) {
    if (!rating || !finiteNumber(rating.value)) return '';
    var max = finiteNumber(rating.max) || 5;
    return finiteNumber(rating.value) + '/' + max;
  }

  function parseDoubanInterests(data) {
    var list = data && Array.isArray(data.interests) ? data.interests : [];
    return list.map(function (item) {
      var user = item && item.user ? item.user.name : '';
      return {
        user: cleanText(user),
        text: shorten(item && item.comment, 160),
        score: scoreLabel(item && item.rating),
      };
    }).filter(function (item) {
      return item.text;
    }).slice(0, COMMENT_LIMIT);
  }

  function parseBangumiSubject(data) {
    if (!data || typeof data !== 'object') return null;
    var rating = data.rating && typeof data.rating === 'object' ? data.rating : {};
    var score = finiteNumber(rating.score);
    return {
      title: cleanText(data.name_cn || data.name || ''),
      score: score && score > 0 ? score : null,
      max: 10,
      count: finiteNumber(rating.total),
      rank: finiteNumber(rating.rank),
      emptyReason: score && score > 0 ? '' : '暂无评分',
    };
  }

  function parseBangumiComments(data) {
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
    return list.map(function (item) {
      var rate = finiteNumber(item && item.rate);
      var user = item && item.user ? (item.user.nickname || item.user.username) : '';
      return {
        user: cleanText(user),
        text: shorten(item && item.comment, 160),
        score: rate && rate > 0 ? rate + '/10' : '',
      };
    }).filter(function (item) {
      return item.text;
    }).slice(0, COMMENT_LIMIT);
  }

  function formatScore(value) {
    var n = finiteNumber(value);
    if (n == null) return '';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function formatCount(value) {
    var n = finiteNumber(value);
    if (n == null) return '';
    try {
      return Math.round(n).toLocaleString('zh-CN');
    } catch (err) {
      return String(Math.round(n));
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (err) {}
    return '';
  }

  function renderComments(comments) {
    if (!comments || !comments.length) return '';
    return '<ul class="neodb-ext-comments">' + comments.map(function (item) {
      var who = item.user ? '<span class="neodb-ext-user">' + escapeHtml(item.user) + '</span>' : '';
      var score = item.score ? '<span class="neodb-ext-cmt-score">' + escapeHtml(item.score) + '</span>' : '';
      return '<li>' + who + score + '<span class="neodb-ext-text">' + escapeHtml(item.text) + '</span></li>';
    }).join('') + '</ul>';
  }

  function sourceLabel(source) {
    var names = { douban: '豆瓣', bangumi: 'Bangumi' };
    return names[source.key] || source.key;
  }

  function renderName(source) {
    var name = sourceLabel(source);
    var mark = '<i class="neodb-ext-mark ' + source.key + '" aria-hidden="true"></i>';
    var link = safeUrl(source.url);
    if (link && source.status !== 'missing') {
      return '<a class="neodb-ext-name" href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' +
        mark + escapeHtml(name) + '</a>';
    }
    return '<span class="neodb-ext-name">' + mark + escapeHtml(name) + '</span>';
  }

  function renderFold(source) {
    var comments = source.comments;
    if (!comments || !comments.length) return '';
    var commentsLink = safeUrl(source.commentsUrl || source.url);
    var title = source.title ? '<div class="neodb-ext-title">' + escapeHtml(source.title) + '</div>' : '';
    var more = commentsLink
      ? '<div class="neodb-ext-more"><a href="' + escapeHtml(commentsLink) + '" target="_blank" rel="noopener noreferrer">更多短评</a></div>'
      : '';
    var note = source.commentsNote ? '<p class="neodb-ext-note">' + escapeHtml(source.commentsNote) + '</p>' : '';
    return '<details class="neodb-ext-fold">' +
      '<summary>短评 ' + comments.length + '</summary>' +
      title + renderComments(comments) + note + more +
      '</details>';
  }

  function renderCard(source) {
    var name = sourceLabel(source);
    var link = safeUrl(source.url);
    var head = '<div class="neodb-ext-row">' + renderName(source);

    if (source.status === 'missing') {
      return '<section class="neodb-ext-card">' + head + '<span class="neodb-ext-meta">未关联</span></div></section>';
    }
    if (source.status === 'loading') {
      return '<section class="neodb-ext-card" aria-busy="true">' + head +
        '<span class="neodb-ext-meta">正在读取…</span></div></section>';
    }
    if (source.status === 'error') {
      var open = link
        ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">打开' + escapeHtml(name) + '</a>'
        : '';
      return '<section class="neodb-ext-card">' + head + open + '</div>' +
        '<p class="neodb-ext-note">' + escapeHtml(source.message || '暂时没有读到数据。') + '</p></section>';
    }

    var score = source.score == null
      ? '<span class="neodb-ext-meta">' + escapeHtml(source.emptyReason || '暂无评分') + '</span>'
      : '<span class="neodb-ext-score">' + escapeHtml(formatScore(source.score)) + '</span>' +
        '<span class="neodb-ext-meta">/ ' + escapeHtml(source.max || 10) + '</span>';
    var count = source.count == null ? '' : '<span class="neodb-ext-meta">' + escapeHtml(formatCount(source.count)) + ' 人</span>';
    var rank = source.rank && source.rank > 0 ? '<span class="neodb-ext-meta">#' + escapeHtml(formatCount(source.rank)) + '</span>' : '';
    return '<section class="neodb-ext-card">' + head + score + count + rank + '</div>' +
      renderFold(source) +
      '</section>';
  }

  function renderPanel(state) {
    var douban = Object.assign({ key: 'douban', status: 'missing' }, state && state.douban);
    var bangumi = Object.assign({ key: 'bangumi', status: 'missing' }, state && state.bangumi);
    var bothMissing = douban.status === 'missing' && bangumi.status === 'missing';
    var body = bothMissing
      ? '<p class="neodb-ext-note">这条目没有关联豆瓣或 Bangumi。</p>'
      : renderCard(douban) + renderCard(bangumi);
    return '<div class="neodb-ext-head"><span class="neodb-ext-label">站外评分</span></div>' + body;
  }

  function panelCss() {
    return [
      '#neodb-ext-ratings{box-sizing:border-box;max-width:100%;margin:.15rem 0 .7rem;padding:.4rem .55rem .3rem;',
      'border:1px solid var(--pico-muted-border-color,color-mix(in srgb,CanvasText 22%,transparent));',
      'border-radius:var(--pico-border-radius,.5rem);',
      'background:var(--pico-card-background-color,color-mix(in srgb,CanvasText 6%,Canvas));',
      'color:var(--pico-color,CanvasText);text-align:start;font-size:.8125rem;line-height:1.35;}',
      '#neodb-ext-ratings *{box-sizing:border-box;}',
      '#neodb-ext-ratings section{margin:0;padding:0;border:0;background:transparent;}',
      '#neodb-ext-ratings .neodb-ext-head{display:flex;justify-content:space-between;margin-bottom:.1rem;}',
      '#neodb-ext-ratings .neodb-ext-label{font-size:.7rem;letter-spacing:.04em;color:var(--pico-muted-color,color-mix(in srgb,CanvasText 62%,transparent));}',
      '#neodb-ext-ratings .neodb-ext-card{padding:.28rem 0;border-top:1px solid var(--pico-muted-border-color,color-mix(in srgb,CanvasText 16%,transparent));}',
      '#neodb-ext-ratings .neodb-ext-card:first-of-type{border-top:0;padding-top:.05rem;}',
      '#neodb-ext-ratings .neodb-ext-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .4rem;}',
      '#neodb-ext-ratings .neodb-ext-name{font-weight:600;text-decoration:none;}',
      '#neodb-ext-ratings a.neodb-ext-name{color:inherit;}',
      '#neodb-ext-ratings a.neodb-ext-name:hover{text-decoration:underline;text-underline-offset:.12em;}',
      '#neodb-ext-ratings .neodb-ext-mark{display:inline-block;width:.5rem;height:.5rem;border-radius:2px;margin-right:.25rem;vertical-align:.05rem;}',
      '#neodb-ext-ratings .neodb-ext-mark.douban{background:#319840;}',
      '#neodb-ext-ratings .neodb-ext-mark.bangumi{background:#F09199;}',
      '#neodb-ext-ratings .neodb-ext-score{font-size:1.05rem;font-weight:700;font-variant-numeric:tabular-nums;}',
      '#neodb-ext-ratings .neodb-ext-meta,#neodb-ext-ratings .neodb-ext-title,#neodb-ext-ratings .neodb-ext-user{color:var(--pico-muted-color,color-mix(in srgb,CanvasText 62%,transparent));}',
      '#neodb-ext-ratings .neodb-ext-title{margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem;}',
      '#neodb-ext-ratings a{color:var(--pico-primary,#2a6fdb);text-decoration:underline;text-underline-offset:.12em;}',
      '#neodb-ext-ratings details.neodb-ext-fold{margin:.08rem 0 0;padding:0;border:0;background:transparent;}',
      '#neodb-ext-ratings details.neodb-ext-fold summary{cursor:pointer;list-style:none;padding:0;margin:0;border:0;background:none;',
      'color:var(--pico-muted-color,color-mix(in srgb,CanvasText 62%,transparent));font-size:.75rem;line-height:1.3;',
      'display:block;min-height:0;height:auto;}',
      '#neodb-ext-ratings details.neodb-ext-fold summary::-webkit-details-marker{display:none;}',
      '#neodb-ext-ratings ul{list-style:none;margin:.3rem 0 0;padding:0;}',
      '#neodb-ext-ratings li{margin:.28rem 0 0;}',
      '#neodb-ext-ratings .neodb-ext-user{margin-right:.3rem;}',
      '#neodb-ext-ratings .neodb-ext-cmt-score{margin-right:.3rem;font-variant-numeric:tabular-nums;}',
      '#neodb-ext-ratings .neodb-ext-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}',
      '#neodb-ext-ratings .neodb-ext-note,#neodb-ext-ratings .neodb-ext-more{margin:.25rem 0 0;font-size:.75rem;color:var(--pico-muted-color,color-mix(in srgb,CanvasText 62%,transparent));}',
    ].join('');
  }

  function findMountTarget(doc) {
    doc = doc || document;
    var rating = doc.querySelector('#item-metadata .rating');
    if (rating) return { node: rating, where: 'afterend', leftColumn: false };
    var metadata = doc.getElementById('item-metadata');
    if (metadata) return { node: metadata, where: 'beforeend', leftColumn: false };
    var cover = doc.getElementById('item-cover');
    if (cover) return { node: cover, where: 'afterend', leftColumn: true };
    return null;
  }

  function panelIsWellPlaced(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('#item-title') || el.closest('.site-list')) return false;
    if (el.closest('#item-metadata')) return true;
    if (el.classList && el.classList.contains('left')) return true;
    var cover = el.ownerDocument ? el.ownerDocument.getElementById('item-cover') : null;
    return !!(cover && el.previousElementSibling === cover);
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function gmRequest(url, headers) {
    var fn = typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && GM.xmlHttpRequest);
    if (typeof fn !== 'function') return Promise.reject(new Error('no-gm'));
    return new Promise(function (resolve, reject) {
      fn({
        method: 'GET',
        url: url,
        headers: headers,
        timeout: 12000,
        anonymous: true,
        onload: function (res) {
          resolve({ status: res.status || 0, responseText: res.responseText || '' });
        },
        onerror: function () { reject(new Error('network')); },
        ontimeout: function () { reject(new Error('timeout')); },
      });
    });
  }

  function httpGet(url, headers) {
    var sameOrigin = false;
    try {
      if (typeof location !== 'undefined' && location.origin) {
        sameOrigin = new URL(url, location.href).origin === location.origin;
      }
    } catch (err) {}
    if (sameOrigin && typeof fetch === 'function') {
      return fetch(url, { headers: headers, credentials: 'omit' }).then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, responseText: text };
        });
      });
    }
    return gmRequest(url, headers).catch(function (err) {
      if (String(err && err.message) === 'no-gm' && typeof fetch === 'function') {
        return fetch(url, { headers: headers }).then(function (res) {
          return res.text().then(function (text) {
            return { status: res.status, responseText: text };
          });
        });
      }
      throw err;
    });
  }

  function doubanHeaders() {
    return {
      Accept: 'application/json',
      Referer: 'https://m.douban.com/',
      'User-Agent': BROWSER_UA,
    };
  }

  function bangumiHeaders() {
    return {
      Accept: 'application/json',
      'User-Agent': UA,
    };
  }

  function failureState(ref, message) {
    return {
      status: 'error',
      url: ref.url,
      commentsUrl: ref.commentsUrl,
      message: message,
    };
  }

  function loadDouban(ref) {
    var kinds = ref.kind === 'subject' ? ['movie', 'book', 'music', 'game'] : [ref.kind];
    var headers = doubanHeaders();
    var index = 0;

    function nextKind() {
      if (index >= kinds.length) {
        return Promise.resolve(failureState(ref, '暂时读不到豆瓣数据。豆瓣没有开放官方接口，直连可能被限制。可以先打开原站查看。'));
      }
      var kind = kinds[index++];
      var subjectUrl = 'https://m.douban.com/rexxar/api/v2/' + kind + '/' + ref.id;
      return httpGet(subjectUrl, headers).then(function (res) {
        var data = res.status >= 200 && res.status < 300 ? parseJson(res.responseText) : null;
        var subject = parseDoubanSubject(data);
        if (!subject) return nextKind();
        var pageUrl = canonicalDouban(kind, ref.id, ref.url);
        var commentsUrl = doubanCommentsUrl(kind, ref.id, pageUrl);
        return httpGet(subjectUrl + '/interests?count=8&order_by=hot', headers).then(function (cRes) {
          var comments = cRes.status >= 200 && cRes.status < 300
            ? parseDoubanInterests(parseJson(cRes.responseText))
            : [];
          return {
            status: 'ok',
            url: pageUrl,
            commentsUrl: commentsUrl,
            title: subject.title,
            score: subject.score,
            max: subject.max,
            count: subject.count,
            emptyReason: subject.emptyReason,
            comments: comments,
            commentsNote: comments.length ? '' : '短评暂时没有读到。评分来自豆瓣公开页面数据。',
          };
        }).catch(function () {
          return {
            status: 'ok',
            url: pageUrl,
            commentsUrl: commentsUrl,
            title: subject.title,
            score: subject.score,
            max: subject.max,
            count: subject.count,
            emptyReason: subject.emptyReason,
            comments: [],
            commentsNote: '短评暂时没有读到。评分来自豆瓣公开页面数据。',
          };
        });
      }).catch(function (err) {
        if (index < kinds.length) return nextKind();
        var message = err && err.message === 'timeout'
          ? '读取豆瓣超时。可以先打开原站查看。'
          : '暂时读不到豆瓣数据。豆瓣没有开放官方接口，直连可能被限制。可以先打开原站查看。';
        return failureState(ref, message);
      });
    }

    return nextKind();
  }

  function loadBangumi(ref) {
    var headers = bangumiHeaders();
    return httpGet('https://api.bgm.tv/v0/subjects/' + ref.id, headers).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        return failureState(ref, '暂时读不到 Bangumi 数据。可以先打开原站查看。');
      }
      var subject = parseBangumiSubject(parseJson(res.responseText));
      if (!subject) return failureState(ref, 'Bangumi 返回的评分数据无法识别。可以先打开原站查看。');
      return httpGet('https://next.bgm.tv/p1/subjects/' + ref.id + '/comments?limit=8', headers).then(function (cRes) {
        var comments = cRes.status >= 200 && cRes.status < 300
          ? parseBangumiComments(parseJson(cRes.responseText))
          : [];
        var note = comments.length
          ? ''
          : '短评暂时没有读到。评分来自 Bangumi 公开接口。';
        return {
          status: 'ok',
          url: ref.url,
          commentsUrl: ref.commentsUrl,
          title: subject.title,
          score: subject.score,
          max: subject.max,
          count: subject.count,
          rank: subject.rank,
          emptyReason: subject.emptyReason,
          comments: comments,
          commentsNote: note,
        };
      }).catch(function () {
        return {
          status: 'ok',
          url: ref.url,
          commentsUrl: ref.commentsUrl,
          title: subject.title,
          score: subject.score,
          max: subject.max,
          count: subject.count,
          rank: subject.rank,
          emptyReason: subject.emptyReason,
          comments: [],
          commentsNote: '短评暂时没有读到。评分来自 Bangumi 公开接口。',
        };
      });
    }).catch(function (err) {
      var message = err && err.message === 'timeout'
        ? '读取 Bangumi 超时。可以先打开原站查看。'
        : '暂时读不到 Bangumi 数据。可以先打开原站查看。';
      return failureState(ref, message);
    });
  }

  function urlsFromDocument(doc) {
    var nodes = doc.querySelectorAll('#item-title .site-list a[href], a.douban[href], a.bangumi[href]');
    var hrefs = [];
    nodes.forEach(function (node) {
      var href = node.href || node.getAttribute('href');
      if (href) hrefs.push(href);
    });
    return hrefs;
  }

  function fetchCatalogUrls() {
    var origin = location.origin;
    var pageUrl = location.href.split('#')[0];
    var candidates = catalogApiUrls(origin, location.pathname);
    candidates.push(pageUrl);

    function readAt(index) {
      if (index >= candidates.length) return Promise.resolve([]);
      var target = candidates[index];
      var headers = target === pageUrl
        ? { Accept: 'application/activity+json' }
        : { Accept: 'application/json' };
      return httpGet(target, headers).then(function (res) {
        if (res.status < 200 || res.status >= 300) return readAt(index + 1);
        var urls = urlsFromCatalog(parseJson(res.responseText));
        return urls.length ? urls : readAt(index + 1);
      }).catch(function () {
        return readAt(index + 1);
      });
    }

    return readAt(0);
  }

  function isNeoDBItemPage() {
    if (!isItemPath(location.pathname)) return false;
    var root = document.documentElement;
    if (root && root.classList.contains('item-page')) return true;
    if (document.querySelector('link[rel="stylesheet"][href*="neodb"]')) return true;
    if (document.getElementById('item-title') && document.querySelector('.site-list')) return true;
    return false;
  }

  function ensureStyle() {
    if (document.getElementById('neodb-ext-ratings-style')) return;
    var style = document.createElement('style');
    style.id = 'neodb-ext-ratings-style';
    style.textContent = panelCss();
    document.head.appendChild(style);
  }

  var runToken = 0;
  var mountedPath = '';

  function paint(host, token, state) {
    if (token !== runToken || !host.isConnected) return;
    host.innerHTML = renderPanel(state);
  }

  function start() {
    if (!isNeoDBItemPage()) return;
    var existing = document.getElementById('neodb-ext-ratings');
    if (mountedPath === location.pathname && panelIsWellPlaced(existing)) return;
    var target = findMountTarget(document);
    if (!target) return;
    mountedPath = location.pathname;
    if (existing) existing.remove();
    ensureStyle();
    var host = document.createElement('div');
    host.id = 'neodb-ext-ratings';
    if (target.leftColumn) host.classList.add('left');
    target.node.insertAdjacentElement(target.where, host);
    var token = ++runToken;
    var hrefs = urlsFromDocument(document);
    var siteList = document.querySelector('#item-title .site-list, .site-list');
    var picked = pickResources(hrefs);

    function reveal(resources) {
      if (token !== runToken) return;
      if (!resources.douban && !resources.bangumi) {
        paint(host, token, {
          douban: { status: 'missing' },
          bangumi: { status: 'missing' },
        });
        return;
      }
      paint(host, token, {
        douban: resources.douban ? { status: 'loading', url: resources.douban.url } : { status: 'missing' },
        bangumi: resources.bangumi ? { status: 'loading', url: resources.bangumi.url } : { status: 'missing' },
      });
      Promise.all([
        resources.douban ? loadDouban(resources.douban) : Promise.resolve({ status: 'missing' }),
        resources.bangumi ? loadBangumi(resources.bangumi) : Promise.resolve({ status: 'missing' }),
      ]).then(function (pair) {
        paint(host, token, { douban: pair[0], bangumi: pair[1] });
      });
    }

    if (!picked.douban && !picked.bangumi && !siteList) {
      paint(host, token, {
        douban: { status: 'loading' },
        bangumi: { status: 'loading' },
      });
      fetchCatalogUrls().then(function (extra) {
        reveal(pickResources(hrefs.concat(extra)));
      });
      return;
    }
    reveal(picked);
  }

  var api = {
    isItemPath: isItemPath,
    parseBangumiUrl: parseBangumiUrl,
    parseDoubanUrl: parseDoubanUrl,
    pickResources: pickResources,
    urlsFromCatalog: urlsFromCatalog,
    catalogApiUrls: catalogApiUrls,
    parseDoubanSubject: parseDoubanSubject,
    parseDoubanInterests: parseDoubanInterests,
    parseBangumiSubject: parseBangumiSubject,
    parseBangumiComments: parseBangumiComments,
    formatScore: formatScore,
    formatCount: formatCount,
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    renderPanel: renderPanel,
    loadDouban: loadDouban,
    loadBangumi: loadBangumi,
    panelCss: panelCss,
    findMountTarget: findMountTarget,
    panelIsWellPlaced: panelIsWellPlaced,
  };

  try {
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  } catch (err) {}

  if (typeof document !== 'undefined' && document.documentElement) {
    start();
    document.addEventListener('htmx:afterSettle', start);
  }
})();
