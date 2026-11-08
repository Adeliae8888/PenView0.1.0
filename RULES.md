# RULES（不変規約）— 進行中の作業はここに書かない（HANDOFF へ）

## 構成
- PWA。オフライン起動は必須。依存ライブラリなし（ES modules）。1ファイル＝1機能
- 版番号は `version.js` の1か所。**リリースごとに必ず上げる**（sw.js のキャッシュ名に使うため。上げないと端末が旧版のまま）
- 新しい js / data ファイルを足したら `sw.js` の APP_SHELL にも足す
- 大容量データは localStorage に入れない。保存は store.js（IndexedDB）経由のみ。保存失敗は必ず画面に出す

## 単位と規約
- 距離 nm、速度 kt、高度 ft、方位は**内部は真方位**、表示は磁方位（`toMagnetic`）
- 偏差は E=正 / W=負。磁方位 = 真方位 − 偏差
- 座標は内部 `{lat, lon}`（10進度）。GeoJSON 由来の配列は `[lon, lat]`

## 編集
- 全面書き直し禁止。関数単位で直す。関数は60行まで
- 新しい関数を作る前に FUNCTIONS.md を検索し、同じ役割があれば再利用する
- 数値のしきい値は定数にする。innerHTML に入れる文字列は esc() を通す
- テストを都合よく書き換えない。期待値を変えるときは、独立した根拠（別の実装・公的な値）を示す

## 納品
1. 方針3行＋触る関数 → 2. 変更 → 3. `node --test tests/unit.test.mjs` と `node tests/e2e.mjs` の結果をそのまま貼る
4. FUNCTIONS.md を再生成し、増えた/消えた関数を HANDOFF に書く → 5. version.js を上げる
