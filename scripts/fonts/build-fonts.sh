#!/usr/bin/env bash
# build-fonts.sh -- 构建公开页自托管字体（开发期脚本，产物提交进仓库）。
#
#   Noto Serif SC SemiBold(600)  -> web/static/fonts/noto-serif-sc/600-NNN.woff2（unicode-range 分片）
#   Bodoni Moda 500 / 700        -> web/static/fonts/bodoni-moda/{500,700}.woff2（数字 / 罗马数字子集）
#   @font-face 汇总              -> web/static/fonts/fonts.css
#
# 用法：
#   scripts/fonts/build-fonts.sh                  下载（带缓存）+ sha256 校验 -> 子集化 -> 生成 fonts.css
#   scripts/fonts/build-fonts.sh --update-slices  从 Google Fonts 重新抓取分片表（一次性操作，结果提交）
#
# 环境变量：
#   PYTHON          Python 解释器（默认 python3），需要 fontTools + brotli
#   FONT_CACHE_DIR  源字体缓存目录（默认 ${XDG_CACHE_HOME:-$HOME/.cache}/blog_self-fonts，不在仓库内）
#   JOBS            并行子集化进程数（默认 CPU 核数）
#
# 详细说明见 scripts/fonts/README.md。
set -euo pipefail

PYTHON="${PYTHON:-python3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT/web/static/fonts"
SLICES_FILE="$SCRIPT_DIR/noto-serif-sc-slices.txt"
CACHE_DIR="${FONT_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/blog_self-fonts}"
JOBS="${JOBS:-0}"

# ---- 固定版本的源字体（URL + sha256）-------------------------------------------
# notofonts/noto-cjk tag Serif2.003，SubsetOTF/SC（仅简中字形，比 Pan-CJK OTC 小得多）
NOTO_URL="https://github.com/notofonts/noto-cjk/raw/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-SemiBold.otf"
NOTO_SHA256="517d9736136b3b4e9aea742a7e1acda1922aea91a4425bd8db79281934055bf5"
NOTO_FILE="NotoSerifSC-SemiBold-Serif2.003.otf"
# google/fonts commit 6ce172f7，ofl/bodonimoda/BodoniModa[opsz,wght].ttf（正体可变字体）
BODONI_URL="https://github.com/google/fonts/raw/6ce172f74aa355ea43eb964fa4a91570a4d3064d/ofl/bodonimoda/BodoniModa%5Bopsz%2Cwght%5D.ttf"
BODONI_SHA256="550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf"
BODONI_FILE="BodoniModa-opsz-wght-6ce172f.ttf"

# Bodoni Moda 光学尺寸轴固定值：24 是 STAT 中的具名档位（"24pt"），
# 对比度已是展示风格，但发丝线在 13-16px 的日期上仍然清晰。
BODONI_OPSZ=24

# 分片表来源（只在 --update-slices 时联网）
SLICES_CSS_URL="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&display=swap"
CHROME_UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

die() { echo "build-fonts: $*" >&2; exit 1; }

sha256_of() {
  "$PYTHON" -c 'import hashlib,sys
h = hashlib.sha256()
with open(sys.argv[1], "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
print(h.hexdigest())' "$1"
}

# fetch <url> <sha256> <cache-file-name>：命中缓存且校验通过则跳过下载
fetch() {
  local url="$1" want="$2" dest="$CACHE_DIR/$3" got tmp
  if [[ -f "$dest" ]] && [[ "$(sha256_of "$dest")" == "$want" ]]; then
    echo "cached:      $dest" >&2
    return 0
  fi
  mkdir -p "$CACHE_DIR"
  tmp="$dest.part.$$"
  echo "downloading: $url" >&2
  curl -fL --retry 3 --retry-delay 2 -sS -o "$tmp" "$url" || { rm -f "$tmp"; die "download failed: $url"; }
  got="$(sha256_of "$tmp")"
  if [[ "$got" != "$want" ]]; then
    rm -f "$tmp"
    die "sha256 mismatch for $url (expected $want, got $got)"
  fi
  mv -f "$tmp" "$dest"
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/build-fonts.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- --update-slices：抓取 Google Fonts 的分片表 -------------------------------
if [[ "${1:-}" == "--update-slices" ]]; then
  curl -fsS -A "$CHROME_UA" -o "$WORK/gf.css" "$SLICES_CSS_URL" || die "failed to fetch $SLICES_CSS_URL"
  "$PYTHON" - "$WORK/gf.css" "$SLICES_FILE" "$SLICES_CSS_URL" <<'PY'
import re, sys
css_path, out_path, url = sys.argv[1:4]
css = open(css_path, encoding="utf-8").read()
blocks = re.findall(r"(?:/\*\s*([^*]*?)\s*\*/\s*)?@font-face\s*\{([^}]*)\}", css)
if not blocks:
    sys.exit("no @font-face blocks found (wrong User-Agent?)")
versions = sorted(set(re.findall(r"fonts\.gstatic\.com/s/notoserifsc/(v\d+)/", css)))
lines = [
    "# Google Fonts 的 Noto Serif SC 600 unicode-range 分片表，保持 Google CSS 中的原始顺序，一行一个分片。",
    "# 来源: " + url + "（Chrome User-Agent 请求）",
    "# gstatic 版本: notoserifsc/" + ",".join(versions),
    "# 由 scripts/fonts/build-fonts.sh --update-slices 生成；构建时按倒序（= 浏览器 unicode-range 优先级，",
    "# 也是使用频率从高到低）依次认领码位，详见 scripts/fonts/README.md。",
    "# 格式: <标签><TAB><unicode-range>",
]
for comment, body in blocks:
    m = re.search(r"unicode-range:\s*([^;]*);", body)
    if not m:
        sys.exit("@font-face without unicode-range")
    if comment:
        label = comment.strip()
    else:
        u = re.search(r"\.(\d+)\.woff2", body)
        if not u:
            sys.exit("cannot determine shard label")
        label = u.group(1)
    lines.append(label + "\t" + " ".join(m.group(1).split()))
with open(out_path, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines) + "\n")
print("wrote %s (%d shards)" % (out_path, len(blocks)))
PY
  exit 0
fi
[[ $# -eq 0 ]] || die "unknown argument: $1 (only --update-slices is supported)"

# ---- 依赖检查 ------------------------------------------------------------------
command -v "$PYTHON" >/dev/null 2>&1 || die "python not found: $PYTHON"
command -v curl >/dev/null 2>&1 || die "curl not found"
"$PYTHON" - <<'PY' || die "missing Python deps: pip install 'fonttools>=4.59' brotli"
import fontTools
try:
    import brotlicffi as brotli  # noqa: F401
except ImportError:
    import brotli  # noqa: F401
from fontTools.varLib import instancer  # noqa: F401
print("fontTools %s" % fontTools.version)
PY
[[ -f "$SLICES_FILE" ]] || die "missing $SLICES_FILE (run with --update-slices once)"

# ---- 下载源字体 ----------------------------------------------------------------
fetch "$NOTO_URL" "$NOTO_SHA256" "$NOTO_FILE"
fetch "$BODONI_URL" "$BODONI_SHA256" "$BODONI_FILE"

# ---- 子集化 + 生成 fonts.css ---------------------------------------------------
"$PYTHON" - "$CACHE_DIR/$NOTO_FILE" "$CACHE_DIR/$BODONI_FILE" "$SLICES_FILE" "$OUT_DIR" "$WORK" "$BODONI_OPSZ" "$JOBS" <<'PY'
import concurrent.futures as cf
import hashlib
import math
import os
import shutil
import subprocess
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

noto_src, bodoni_src, slices_path, out_dir, work, opsz, jobs = sys.argv[1:8]
opsz = float(opsz)
jobs = int(jobs) or (os.cpu_count() or 4)

# pyftsubset 参数：保留全部 OpenType 特性；去掉 hinting 并展开子程序（woff2/brotli 压缩后更小）。
# --no-bidi-closure：默认的 bidi 闭包会把镜像字符（如 ( 与 )、「 与 」）悄悄加进 cmap，
# 导致分片实际码位与声明的 unicode-range 不一致、并与其他分片重叠；中文站点不需要 RTL 镜像。
SUBSET_FLAGS = ["--flavor=woff2", "--layout-features=*", "--no-hinting", "--desubroutinize", "--no-bidi-closure"]
EXTRA_MAX = 300  # 未被 Google 分片覆盖的码位，每个额外分片最多这么多


def compact(cps):
    """升序码位 -> [(start, end), ...]"""
    out = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def css_range(cps):
    return ", ".join(("U+%04X" % a) if a == b else ("U+%04X-%04X" % (a, b)) for a, b in compact(cps))


def pyft_range(cps):
    return ",".join(("U+%04X" % a) if a == b else ("U+%04X-%04X" % (a, b)) for a, b in compact(cps))


def parse_range(text):
    cps = set()
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.upper().startswith("U+") or "?" in part:
            raise SystemExit("unsupported unicode-range token: %r" % part)
        body = part[2:]
        if "-" in body:
            a, b = body.split("-", 1)
            cps.update(range(int(a, 16), int(b, 16) + 1))
        else:
            cps.add(int(body, 16))
    return cps


def gb2312_rows(rows):
    out = set()
    for r in rows:
        for c in range(0xA1, 0xFF):
            try:
                ch = bytes([r, c]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            out.add(ord(ch))
    return out


def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run_subset(src, cps, dest):
    cmd = [sys.executable, "-m", "fontTools.subset", src, "--unicodes=" + pyft_range(cps)]
    cmd += SUBSET_FLAGS + ["--output-file=" + dest]
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode != 0:
        raise SystemExit("pyftsubset failed for %s:\n%s" % (dest, p.stdout.decode("utf-8", "replace")))
    return dest


# ---- Noto Serif SC 字符集 -------------------------------------------------------
HANZI = gb2312_rows(range(0xB0, 0xF8))           # GB2312 一级 + 二级汉字
assert len(HANZI) == 6763, len(HANZI)
charset = set(HANZI)
charset |= gb2312_rows(range(0xA1, 0xAA))        # GB2312 01-09 区：符号、标点、全角 ASCII、假名、希腊、俄文、拼音、制表符
charset |= set(range(0x3000, 0x3040))            # CJK 符号和标点
charset |= set(range(0xFF00, 0xFFF0))            # 半角及全角形式
charset |= set(range(0x2010, 0x2028)) | set(range(0x2030, 0x203B))  # 通用标点
charset |= set(range(0x20, 0x7F))                # 基本拉丁
# · — … 「 」 『 』 《 》 “ ” ‘ ’
charset |= set(map(ord, "\u00b7\u2014\u2026\u300c\u300d\u300e\u300f\u300a\u300b\u201c\u201d\u2018\u2019"))

noto_cmap = TTFont(noto_src, lazy=True).getBestCmap()
missing_hanzi = HANZI - noto_cmap.keys()
if missing_hanzi:
    raise SystemExit("source font lacks %d GB2312 hanzi" % len(missing_hanzi))
available = charset & noto_cmap.keys()
print("noto charset: %d requested, %d in font (%d not in font, skipped)"
      % (len(charset), len(available), len(charset - available)))

# ---- 按 Google 分片表分组 -------------------------------------------------------
slices = []
with open(slices_path, encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line.strip() or line.startswith("#"):
            continue
        label, ranges = line.split("\t", 1)
        slices.append((label, parse_range(ranges)))
if not slices:
    raise SystemExit("empty slices file")

# Google CSS 里越靠后的 @font-face 优先级越高（CSS Fonts 4：unicode-range 重叠时最后声明的先匹配），
# 也就是 latin 系列最先、其次 CJK 分片按使用频率从高到低。倒序遍历，每个码位只归入第一个认领它的分片。
shards = []  # [(label, set)]
claimed = set()
for label, cps in reversed(slices):
    mine = (cps & available) - claimed
    if mine:
        shards.append((label, mine))
        claimed |= mine
rest = sorted(available - claimed)
if rest:
    n = math.ceil(len(rest) / EXTRA_MAX)
    size = math.ceil(len(rest) / n)
    for i in range(n):
        shards.append(("extra-%d" % i, set(rest[i * size:(i + 1) * size])))

# ---- Bodoni Moda 字符集 ---------------------------------------------------------
bodoni_cps = set(map(ord, "0123456789IVXLCDMivxlcdm\u00b7.\u2014/,:-+ "))
bodoni_cmap = TTFont(bodoni_src, lazy=True).getBestCmap()
if bodoni_cps - bodoni_cmap.keys():
    raise SystemExit("Bodoni Moda lacks: %r" % sorted(bodoni_cps - bodoni_cmap.keys()))

# ---- 生成到临时目录 -------------------------------------------------------------
stage = os.path.join(work, "out")
os.makedirs(os.path.join(stage, "noto-serif-sc"))
os.makedirs(os.path.join(stage, "bodoni-moda"))

tasks = []
for i, (label, cps) in enumerate(shards):
    tasks.append((noto_src, cps, os.path.join(stage, "noto-serif-sc", "600-%03d.woff2" % i)))

for wght in (500, 700):
    vf = TTFont(bodoni_src, recalcTimestamp=False)  # 保留源 head.modified，保证可复现
    inst = instancer.instantiateVariableFont(vf, {"wght": wght, "opsz": opsz}, updateFontNames=True)
    ttf = os.path.join(work, "bodoni-%d.ttf" % wght)
    inst.save(ttf)
    tasks.append((ttf, bodoni_cps, os.path.join(stage, "bodoni-moda", "%d.woff2" % wght)))

with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
    for fut in [ex.submit(run_subset, *t) for t in tasks]:
        fut.result()

# ---- 校验：每个产物的 cmap 恰好等于计划的码位集合 ------------------------------
hanzi_hits = {}
for src, cps, dest in tasks:
    got = set(TTFont(dest).getBestCmap().keys())
    if got != cps:
        raise SystemExit("%s: cmap mismatch (+%d -%d)" % (dest, len(got - cps), len(cps - got)))
for _, cps in shards:
    for cp in cps & HANZI:
        hanzi_hits[cp] = hanzi_hits.get(cp, 0) + 1
if set(hanzi_hits) != HANZI or any(v != 1 for v in hanzi_hits.values()):
    raise SystemExit("GB2312 hanzi are not covered exactly once")

# ---- fonts.css ------------------------------------------------------------------
def face(family, weight, rel, cps):
    v = sha256_file(os.path.join(stage, rel))[:8]
    return (
        "@font-face {\n"
        '  font-family: "%s";\n'
        "  font-style: normal;\n"
        "  font-weight: %d;\n"
        "  font-display: swap;\n"
        '  src: url("%s?v=%s") format("woff2");\n'
        "  unicode-range: %s;\n"
        "}\n" % (family, weight, rel, v, css_range(cps))
    )

css = [
    "/*\n"
    " * Self-hosted web fonts for the public pages.\n"
    " * GENERATED by scripts/fonts/build-fonts.sh -- do not edit by hand.\n"
    " *   Noto Serif SC 600: %d unicode-range shards (GB2312 6763 hanzi + punctuation + Basic Latin).\n"
    " *   Bodoni Moda 500/700: digits, Roman numeral letters and separators (opsz=%g).\n"
    " * License: SIL Open Font License 1.1, see OFL.txt.\n"
    " */\n" % (len(shards), opsz)
]
for i, (label, cps) in enumerate(shards):
    css.append(face("Noto Serif SC", 600, "noto-serif-sc/600-%03d.woff2" % i, cps))
for wght in (500, 700):
    css.append(face("Bodoni Moda", wght, "bodoni-moda/%d.woff2" % wght, bodoni_cps))
with open(os.path.join(stage, "fonts.css"), "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(css))

# ---- 许可：OFL.txt 必须包含两个字体 name ID 0 的版权行 --------------------------
ofl = os.path.join(out_dir, "OFL.txt")
ofl_text = open(ofl, encoding="utf-8").read() if os.path.exists(ofl) else ""
for src in (noto_src, bodoni_src):
    notice = str(TTFont(src, lazy=True)["name"].getName(0, 3, 1, 0x409))
    if notice not in ofl_text:
        raise SystemExit("%s is missing the copyright notice: %s" % (ofl, notice))

# ---- 替换仓库内产物（OFL.txt 不动）---------------------------------------------
os.makedirs(out_dir, exist_ok=True)
for name in ("noto-serif-sc", "bodoni-moda"):
    shutil.rmtree(os.path.join(out_dir, name), ignore_errors=True)
    shutil.move(os.path.join(stage, name), os.path.join(out_dir, name))
shutil.copyfile(os.path.join(stage, "fonts.css"), os.path.join(out_dir, "fonts.css"))

noto_bytes = sum(os.path.getsize(t[2].replace(stage, out_dir)) for t in tasks[:len(shards)])
bodoni_bytes = sum(os.path.getsize(t[2].replace(stage, out_dir)) for t in tasks[len(shards):])
print("noto-serif-sc: %d shards, %d codepoints, %.1f KiB" % (len(shards), len(available), noto_bytes / 1024))
print("bodoni-moda:   500 + 700, %d codepoints each, %.1f KiB" % (len(bodoni_cps), bodoni_bytes / 1024))
print("wrote %s" % os.path.join(out_dir, "fonts.css"))
PY
