#!/usr/bin/env bash
# seed_fixture.sh — write a fictional demo dataset into a blog SQLite database.
#
#   ./scripts/seed_fixture.sh <db> [full|empty|long-read]
#
#   full       every module filled (default) — used for screenshots and dist/
#   empty      profile only (Name + Location); all other modules empty
#   long-read  full, plus one long article (slug long-read) for reading tests
#
# All content is invented. Never seed real personal data here: blog_self is the
# open-source template and dist/ is exported from this fixture.
# The schema is applied first, so the db may not exist yet. Existing content in
# the target db is replaced.
set -euo pipefail

cd "$(dirname "$0")/.."

db="${1:?usage: seed_fixture.sh <db> [full|empty|long-read]}"
mode="${2:-full}"
case "$mode" in full|empty|long-read) ;; *) echo "unknown mode: $mode" >&2; exit 2 ;; esac
command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }

sqlite3 "$db" < internal/store/schema.sql >/dev/null

sqlite3 "$db" <<'SQL'
BEGIN;
DELETE FROM experiences; DELETE FROM thoughts; DELETE FROM projects;
DELETE FROM posts; DELETE FROM footprints; DELETE FROM moments;
DELETE FROM sqlite_sequence;
INSERT OR IGNORE INTO profile (id) VALUES (1);
UPDATE profile SET name = '星野', title = '', tagline = '', about_md = '', stack = '',
  github_url = '', email = '', location = '广东', updated_at = datetime('now') WHERE id = 1;
COMMIT;
SQL

[ "$mode" = empty ] && { echo ">> seeded $db (empty)"; exit 0; }

sqlite3 "$db" <<'SQL'
BEGIN;
UPDATE profile SET
  title = '独立开发者 · 夜行写作者',
  tagline = '白天写代码，夜里写字。把走过的路，慢慢点成星图。',
  about_md = '在南方的海边城市生活，做一些小而完整的软件。

喜欢清晨的码头、深夜的终端，和一切**慢慢变好**的东西。这里记录写过的代码、去过的地方，以及偶尔冒出来的念头。',
  stack = 'Go,TypeScript,SQLite,Figma',
  github_url = 'https://github.com/example',
  email = 'hello@example.com'
WHERE id = 1;

INSERT INTO experiences (period, company, role, description, sort_order) VALUES
  ('2024 — 至今', '星港工作室', '独立开发者', '一个人完成从设计到上线的全部环节，维护三款效率工具。', 1),
  ('2021 — 2024', '远帆科技', '高级前端工程师', '负责设计系统与可视化平台，主导首屏性能优化，加载时间减半。', 2),
  ('2018 — 2021', '灯塔网络', '后端工程师', '搭建订单与结算服务，第一次体会到「稳定」两个字的分量。', 3);

INSERT INTO footprints (country_code, country_name, province, city, note, moment_ids, sort_order) VALUES
  ('CN', '中国', '广东省', '深圳市', '住了五年的城市，海风和加班都很咸。', '1', 1),
  ('CN', '中国', '广东省', '广州市', '早茶、骑楼和永远逛不完的老街。', '', 2),
  ('CN', '中国', '北京市', '', '第一次看雪，在胡同里迷了路。', '', 3),
  ('JP', '日本', 'Tokyo', '', '凌晨的便利店和末班电车。', '2', 4);

INSERT INTO posts (slug, title, date, tags, body_md, published) VALUES
  ('night-terminal', '在深夜的终端里写诗', '2026-09-18', '随笔,工具',
   '深夜的终端有一种奇特的安静。光标在黑底上一闪一闪，像远处的灯塔。

我习惯在这个时候写点东西，不一定是代码。

## 为什么是深夜

白天的注意力被切成碎片，到了夜里才能重新拼起来。

> 好的工具会消失在手里，只留下你想做的事。

写完最后一行，`git commit`，然后去阳台看一会儿星星。', 1),
  ('harbor-morning', '码头的清晨', '2026-08-02', '摄影,旅行',
   '五点半的码头，渔船刚刚靠岸。

![清晨的码头](https://picsum.photos/seed/harbor-morning/1200/800)

光线很软，海面像一块没打磨好的银。我按了几十次快门，最后只留下这一张。', 1),
  ('small-software', '小而完整的软件', '2026-06-21', '产品,工程',
   '一个人能做的软件，往往比想象中更多，也比想象中更少。

关键是让它**完整**：能安装、能升级、能在出错时告诉你发生了什么。

- 先做最小的闭环
- 再把每个边角磨圆
- 最后才考虑增长', 1);

INSERT INTO projects (name, description, language, stars, license, url, sort_order) VALUES
  ('lantern', '一个把 Markdown 笔记变成静态星图的小工具，支持离线搜索。', 'Go', 1280, 'MIT', 'https://github.com/example/lantern', 1),
  ('tidewatch', '潮汐与日出时间的命令行查询器，给早起拍照的人用。', 'TypeScript', 342, 'Apache-2.0', 'https://github.com/example/tidewatch', 2);

INSERT INTO thoughts (body, topic, date) VALUES
  ('慢一点没关系，方向对就好。很多事情不是做得不够快，而是太早放弃了。', '日常', '2026-09-30'),
  ('关于「完成」：我越来越觉得，一件事真正完成，不是功能都写完的那一刻，而是你可以放心地把它交给别人，自己转身去做下一件事的那一刻。为了到达那一刻，需要写文档、写测试、留好退路，需要把那些没人会夸奖的边角一点点磨圆。这个过程很慢，也很少被看见，但它决定了一件作品能走多远。年轻时总想着做大，现在更想做完整：一个小工具，能安装、能升级、能在出错时说人话；一篇文章，能让读者读到最后一句；一段旅程，回来以后还记得那条街的味道。完整不等于完美，它只是意味着你认真对待了每一个会被别人碰到的地方。我想把这种认真，当作一种长期的习惯来练习。', '工程', '2026-09-12');

INSERT INTO moments (caption, media, place, date) VALUES
  ('海边的晚霞，五分钟就褪了色。', 'https://picsum.photos/seed/sunset-pier/1200/900
https://picsum.photos/seed/sunset-sand/900/1200
https://picsum.photos/seed/sunset-gull/1200/800', '深圳 · 南山', '2026-09-20'),
  ('末班电车上，整节车厢只剩我和一只纸袋。', 'https://picsum.photos/seed/last-train/1200/800', '东京', '2026-07-08');
COMMIT;
SQL

if [ "$mode" = long-read ]; then
sqlite3 "$db" <<'SQL'
INSERT INTO posts (slug, title, date, tags, body_md, published) VALUES
  ('long-read', '一次长途旅行的完整笔记', '2026-10-01', '长文,旅行,工程',
   '这是一篇用来检验阅读体验的长文。它包含多级标题、超宽代码块、表格、引用、图片和分隔线，覆盖正文排版里所有常见的元素。

出发前一周，我把行程、预算和要带的东西都写进了一个纯文本文件，后来这个文件成了整趟旅行最可靠的同伴。

## 一、出发之前

准备工作永远比想象中多。签证、保险、换汇、充电器转换头，每一样都不难，但每一样都可能在最后一刻出问题。

### 清单

- 护照与复印件
- 两张不同银行的卡
- 一本纸质笔记本

### 预算

| 项目 | 预算（元） | 实际（元） | 备注 |
| --- | ---: | ---: | --- |
| 交通 | 3200 | 2980 | 提前三周订票 |
| 住宿 | 4500 | 4810 | 有一晚临时换了酒店 |
| 餐饮 | 2000 | 2260 | 早茶比预想中贵 |
| 其他 | 800 | 640 | 门票与纪念品 |

## 二、路上

> 旅行的意义不在于到达，而在于你在路上变成了另一个人。

火车穿过稻田的时候，我写下了这一段。窗外的光一格一格地掠过，像老式放映机里的胶片。

![车窗外的稻田](https://picsum.photos/seed/long-read-field/1400/800)

### 一段脚本

为了整理照片，我在车上写了一个小脚本：

```go
package main

import ("fmt"; "os"; "path/filepath"; "sort"; "strings"; "time")

func main() { files, _ := filepath.Glob(filepath.Join(os.Args[1], "*.jpg")); sort.Strings(files); for i, f := range files { info, _ := os.Stat(f); fmt.Printf("%03d  %-48s  %s  %8d bytes\n", i+1, strings.TrimSuffix(filepath.Base(f), ".jpg"), info.ModTime().Format(time.RFC3339), info.Size()) } }
```

运行一次，三百多张照片按时间排好了队。

## 三、意外

第四天下了一整天的雨，原定的徒步取消了。我在旅馆的大堂里坐了一下午，读完了一本带来的书，也第一次认真地和前台的老人聊了天。

---

那天晚上雨停了，街上的积水映着路灯，像一条条倒过来的银河。

## 四、回来以后

回来一周后，我才真正开始想念那些地方。照片整理好了，账也算清了，剩下的是一些很难写进清单的东西：某条街的味道，某个陌生人的笑，和那场把计划全部打乱的雨。

下一次出发，大概还是会写一个纯文本文件吧。', 1);
SQL
fi

echo ">> seeded $db ($mode)"
