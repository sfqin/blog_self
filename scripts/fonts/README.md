# 自托管字体构建（WP0）

公开页的字体不再从 `fonts.googleapis.com` / `fonts.gstatic.com` 加载，统一由本目录的脚本生成后提交到
`web/static/fonts/`。对应设计文档 `docs/superpowers/specs/2026-10-13-aesthetic-redesign-design.md` 第 4.2 节。

| 字体 | 用途 | 产物 |
|---|---|---|
| Noto Serif SC SemiBold（600） | 标题、大名字、导航品牌、首字下沉 | `web/static/fonts/noto-serif-sc/600-NNN.woff2`（94 个 `unicode-range` 分片） |
| Bodoni Moda 500 / 700 | 罗马数字、日期、统计数字 | `web/static/fonts/bodoni-moda/500.woff2`、`700.woff2` |
| — | 全部 `@font-face` | `web/static/fonts/fonts.css`（生成文件，勿手改） |
| — | 许可 | `web/static/fonts/OFL.txt`（手工维护：两个字体的版权行 + SIL OFL 1.1 全文；脚本会校验版权行） |

## 依赖

- bash、curl
- Python 3（本次构建使用 3.10.8），通过 `PYTHON` 环境变量指定解释器，默认 `python3`
- [fontTools](https://github.com/fonttools/fonttools) **4.59.0**（`pyftsubset` + `fontTools.varLib.instancer`）
- brotli（WOFF2 压缩）。本次构建用的是 conda 包 `brotlipy 0.7.0` 提供的 `brotli` 模块；`pip install brotli` 亦可

```bash
pip install 'fonttools==4.59.0' brotli
```

> WOFF2 的字节内容取决于 fontTools 与 brotli 的版本。要得到与仓库完全一致的产物，请使用相同版本；
> 换版本后重建会产生新的文件哈希（`?v=` 随之变化），这是预期行为。

## 源字体（固定版本 + sha256）

脚本只把源字体下载到缓存目录（默认 `~/.cache/blog_self-fonts/`，可用 `FONT_CACHE_DIR` 覆盖），**不进仓库**。
下载后校验 sha256，不一致直接失败。

| 字体 | URL | sha256 |
|---|---|---|
| Noto Serif SC SemiBold，noto-cjk tag `Serif2.003`（`SubsetOTF/SC`，Version 2.003） | https://github.com/notofonts/noto-cjk/raw/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-SemiBold.otf | `517d9736136b3b4e9aea742a7e1acda1922aea91a4425bd8db79281934055bf5` |
| Bodoni Moda 正体可变字体 `BodoniModa[opsz,wght].ttf`，google/fonts commit `6ce172f74aa355ea43eb964fa4a91570a4d3064d`（Version 2.005） | https://github.com/google/fonts/raw/6ce172f74aa355ea43eb964fa4a91570a4d3064d/ofl/bodonimoda/BodoniModa%5Bopsz%2Cwght%5D.ttf | `550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf` |

## 重建

```bash
# 在仓库根目录
PYTHON=python3 scripts/fonts/build-fonts.sh
git status   # 版本一致时应当干净（产物可复现）
```

- 第一次运行会下载约 12MB 源字体，之后命中缓存可离线运行；全程约 5–15 秒（默认按 CPU 核数并行，`JOBS=N` 可调）。
- 脚本先在临时目录生成全部产物并做校验，全部通过后才替换 `web/static/fonts/` 下的
  `noto-serif-sc/`、`bodoni-moda/`、`fonts.css`。`OFL.txt` 不会被改写。
- 产物可复现：pyftsubset 与 instancer 都保留源字体的 `head.modified`，不写入当前时间；分片顺序、
  `unicode-range` 与 `?v=` 都由输入唯一确定。

内置校验（任何一项失败即退出，不改动仓库）：

1. 每个 woff2 的 cmap 与它在 `fonts.css` 中声明的 `unicode-range` 完全相等；
2. GB2312 的 6763 个汉字每个恰好落在一个分片里；
3. `OFL.txt` 包含两个源字体 name 表 ID 0 的版权行。

### 更新分片表（一般不需要）

```bash
scripts/fonts/build-fonts.sh --update-slices
```

会用 Chrome User-Agent 请求
`https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&display=swap`，
按原顺序把每个 `@font-face` 的 `unicode-range` 写入 `noto-serif-sc-slices.txt`（每行 `标签<TAB>范围`）。
当前提交的表抓取自 gstatic `notoserifsc/v36`，共 101 个分片。更新分片表后需要重新运行构建并提交全部产物。

## Noto Serif SC：字符集与切片方法

**字符集**（共请求 7752 个码位，源字体中存在 7726 个；缺字形的 26 个码位如 U+2017、U+FF00、部分半角韩文
会被跳过）：

- GB2312 一级 + 二级汉字 6763 个：用 Python `gb2312` 解码 0xB0–0xF7 区、0xA1–0xFE 位的每个双字节码；
- GB2312 01–09 区（0xA1–0xA9）全部非汉字符号：标点、全角 ASCII、序号、日文假名、希腊/俄文字母、拼音、制表符等；
- U+3000–303F（CJK 符号和标点）、U+FF00–FFEF（半角及全角形式）、U+2010–2027、U+2030–203A（通用标点）；
- 基本拉丁 U+0020–007E，以及 `·—…「」『』《》“”‘’`。

**切片**：直接复用 Google Fonts 对 Noto Serif SC 600 的切法（`noto-serif-sc-slices.txt`），它本身就是按
汉字使用频率分组的（编号越大越常用，`119` 号含「的、一」等最高频字）。

1. 把 Google 的分片**倒序**遍历：latin → latin-ext → vietnamese → cyrillic → 119 → 118 → … → 21 → 6 → 5 → 4。
   这与浏览器处理重叠 `unicode-range` 的优先级一致（同一字体族中最后声明的 `@font-face` 先匹配），
   也就是常用在前、生僻在后。
2. 每个 Google 分片与我们的字符集求交集，并去掉已被前面分片认领的码位（Google 的分片之间有重叠，
   去重后每个码位只属于一个分片）；交集为空的分片跳过（本次跳过了 vietnamese、99、98、97、91、87、6、4）。
3. 不在任何 Google 分片里的码位（206 个：希腊字母、罗马数字 Ⅰ–Ⅻ、部分 CJK 符号、33 个 GB2312 汉字、
   半角韩文等）放进末尾的额外分片（每片最多 300 个，本次 1 片）。
4. 按上述顺序从 `000` 连续编号输出 `600-NNN.woff2`；`fonts.css` 中每个分片的 `unicode-range` 是该分片实际码位
   压缩后的区间列表。

pyftsubset 参数：

```
--unicodes=<本分片码位> --flavor=woff2 --layout-features='*' --no-hinting --desubroutinize --no-bidi-closure
```

- `--no-hinting --desubroutinize`：去掉 hinting、展开 CFF 子程序，WOFF2/brotli 压缩后更小；
- `--no-bidi-closure`：pyftsubset 默认会把镜像字符（如 `(`↔`)`、`「`↔`」`）自动加进 cmap，
  使分片实际码位与声明的 `unicode-range` 不一致并互相重叠；中文页面不需要 RTL 镜像，所以关闭。

## Bodoni Moda：静态实例

- 用 `fontTools.varLib.instancer` 从可变字体实例化 `wght=500` 与 `wght=700` 两个静态字体，
  **`opsz` 固定为 24**（STAT 表中的具名档位 “24pt”）。
  - 用途包括章节罗马数字（约 28–44px）、F3 统计数字，也包括 13–16px 的日期。opsz 越大对比越强、发丝线越细：
    em dash 线粗在 opsz 24 为 17.6/2000 em，28 为 14.7，36 只有 8.9，在小字号日期上会断线。
    24 是展示风格与小字号可读性之间的折中。
- 子集：`0–9`、`IVXLCDM`、`ivxlcdm`、`· . — / , : - +` 与空格（含 U+00B7、U+2014），共 33 个码位，保留全部 OpenType 特性
  （如 `tnum`、`onum`、`lnum`）。

## 体积

| 项目 | 大小 |
|---|---|
| `noto-serif-sc/`（94 个分片） | 1,909,148 B（≈1.82 MiB）；单片 1.0–66.1 KiB，中位数 14.5 KiB |
| `bodoni-moda/500.woff2` / `700.woff2` | 5,524 B / 5,340 B |
| `fonts.css` | 72,190 B（gzip 后约 20 KB） |
| `du -sh web/static/fonts` | 2.1M（上限 6MB） |

首屏估算：一份典型首页文案（3 字站点名、七个章节名、「即将点亮」和一句约 30 字的签名）
全部用 Noto Serif SC 渲染时命中 10 个分片（000、003–010、013），共 421,680 B（≈412 KiB）；
其中 000 号只因空格命中（40,836 B），去掉空格为 9 个分片、380,844 B。
