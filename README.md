# PenView

戦闘機パイロット向けの航法・戦術状況認識マップ（PWA・オフライン対応）。

- 起動：静的ホスティング（GitHub Pages 等）に置いて開く。ホーム画面に追加するとオフラインで動きます
- 開発：RULES.md / HANDOFF.md / FUNCTIONS.md を参照
- テスト：`node --test tests/unit.test.mjs`、`node tests/e2e.mjs <URL> <出力dir>`
- データ：陸地 Natural Earth（パブリックドメイン）／空域・飛行場・NAVAID・障害物 OpenAIP（CC BY-NC 4.0, openaip.net）／磁気偏差 国土地理院 磁気図2020.0年値
