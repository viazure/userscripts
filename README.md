# userscripts

viazure 的油猴脚本仓库，脚本可直接用 Violentmonkey 或 Tampermonkey 安装。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| [NeoDB 豆瓣与 Bangumi 评分](scripts/neodb-external-ratings.user.js) | 在 NeoDB 条目页读取已关联的豆瓣、Bangumi 链接，显示评分和若干条短评 |

## 安装

安装地址（合并到 `main` 之后）：

```
https://github.com/viazure/userscripts/raw/main/scripts/neodb-external-ratings.user.js
```

1. 安装 [Violentmonkey](https://violentmonkey.github.io/) 或 [Tampermonkey](https://www.tampermonkey.net/)。
2. 用浏览器打开上面的 raw 链接。扩展会提示安装这个 `.user.js`。
3. 确认脚本已启用，然后打开任意 NeoDB 条目页，例如一部电影、一季剧集、一本书或一个游戏。标题下方会出现「站外评分」。

脚本的更新地址同样指向这份 raw 文件，扩展可以按自己的更新周期检查新版本。

自建实例不用改代码也能匹配常见条目路径：`/movie/`、`/tv/`（含分季、分集）、`/book/`、`/game/`、`/album/`、`/music/`、`/podcast/`、`/performance/`。页面还要像 NeoDB 条目页（`item-page`、NeoDB 样式，或标题旁的上游站列表）。`neodb.social` 以及示例里出现过的 `eggplant.place`、`neodb.de`、`minreol.dk` 已写在 `@match` 里。如果某个管理器忽略了 `@include` 正则，把你的实例域名加进脚本的 `@match` 即可。

## 面板里有什么

脚本只使用条目上已经关联的外部链接，不会拿标题去搜索猜测。

- 豆瓣、Bangumi 各显示评分、评分人数；Bangumi 还有排名（接口有提供时）。
- 能读到短评时，每站最多显示 3 条，正文会截断。
- 读取中、未关联、失败都会在对应位置说明。失败时仍保留「打开豆瓣」或「打开 Bangumi」。
- 样式沿用 NeoDB 的 Pico 颜色变量，浅色和暗色下都可读，面板放在标题块内部，不改三栏结构。

## 数据来源和限制

不需要登录豆瓣或 Bangumi，脚本里也没有密钥。

- **Bangumi 评分**：官方公开接口 `https://api.bgm.tv/v0/subjects/{id}`。
- **Bangumi 短评**：`https://next.bgm.tv/p1/subjects/{id}/comments`，这是 Bangumi 新站使用的公开只读接口。它不在 v0 文档的稳定列表里；如果以后变了，面板仍会显示评分、评分人数，并链到原站短评页。
- **豆瓣**：没有可用的官方公开 API。脚本读取豆瓣移动站公开 JSON（`https://m.douban.com/rexxar/api/v2/{movie|book|music|game|drama}/{id}` 及对应的热门短评）。请求不携带登录态。豆瓣会限制部分网络环境的直连；遇到这种情况，面板会写明暂时读不到，并保留原站链接。演出等条目如果豆瓣自己显示「暂无评分」，这里也会照实显示。
- 条目若把链接藏在页面里但上游站列表还没渲染出来，脚本会再请求当前实例的 `GET /api/{条目路径}`、带 `Accept: application/activity+json` 的条目地址，以及 `GET /api/catalog/item/{uuid}`。现在的 neodb.social 使用第一种。

## 本地检查

```bash
node --test scripts/neodb-external-ratings.test.mjs
```

测试包含链接解析和渲染，也会请求一次真实的豆瓣、Bangumi 接口。
