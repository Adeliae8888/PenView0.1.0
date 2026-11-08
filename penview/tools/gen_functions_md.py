# FUNCTIONS.md 生成：python3 tools/gen_functions_md.py > FUNCTIONS.md
# js/*.js のトップレベル関数（export 含む）の 名前／ファイル／行／行数／参照数（縮退検出用）
import re, glob
files = sorted(glob.glob('js/*.js'))
allsrc = '\n'.join(open(f, encoding='utf-8').read() for f in files)
rows = []
for f in files:
    src = open(f, encoding='utf-8').read().splitlines()
    for i, line in enumerate(src):
        m = re.match(r'(?:export )?(?:async )?function (\w+)\s*\(', line)
        if not m: continue
        end = next((j for j in range(i + 1, len(src)) if src[j].startswith('}')), i)
        refs = len(re.findall(rf'\b{m.group(1)}\b', allsrc)) - 1
        rows.append(f'| {m.group(1)} | {f} | {i + 1} | {end - i + 1} | {refs} |')
print(f'# FUNCTIONS（{len(rows)} 関数）\n\n| 関数 | ファイル | 行 | 行数 | 参照 |\n|---|---|---|---|---|')
print('\n'.join(rows))
