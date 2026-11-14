# HANDOFF 0.2.6（2026-11-14 パブリッシュ）

## できたこと（ユーザー決定は SPEC.md §8c）
1. **従来型の SID/STAR/TRANSITION の説明文の取り込み**（js/aip-text.js 新規）：説明文の切り出し（narrativeBlocks）→ 滑走路ごと・「...」の共通部分（runwayClauses）→ 言い回しを1つずつ読む（Scanner）→ 高度の制限を当てる（applyCross：名前のフィックス、STN Rnnn/D.D DME はラジアルを分けて差し込む。外向きは近い順、局へ向かうときは遠い順）。図の中のフィックスの定義（labelDefs・fixDefsFor → proc.fixDefs）。RNAV の表と同じ PDF でも両方読む
2. 座標の補い：同じ取り込みの全 PDF（進入チャートも）の座標表を飛行場ごとにまとめて埋める（fillWaypoints）。どこにも無い局・フィックスは確認画面で警告（markUnknownFixes）
3. **作図**：ラジアルの向き「自動」（autoRadial）、「Climb RWY HDG」（rwyHdg）、アークの終点を別の NAVAID のラジアル（arcCrossing）・フィックス、旋回して針路で前の進路が無いときはまっすぐ、TRANSITION は親 SID の最後の進路から（inboundCourse）、前の段の手順の名前付きフィックス（relatedFixes）、エラーの文言を具体的に（局・フィックスの名前）
4. **エディター**：アーク CW/CCW・終点の種類、ラジアルの点線（proc-guide）と向き「自動」、一覧の絞り込みと全部を表示／非表示
5. 設定：AIP の PDF の既定値（上昇勾配・旋回 KIAS・バンク）。確認画面に原文・補った値・警告

## 検証
- 単体 37/37（新規：アークの別 NAVAID の交点、TRANSITION の開始に SID の名前付きフィックス、文章の滑走路分けと共通部分、文章 → 手順（GOPVU1・DAIGO・CHOSHI・DAIGO1・読めない文）、ラジアルの向き自動）
- 画面：e2e・e2e-nav・e2e-proc・e2e-route-proc・e2e-gesture・e2e-aip すべてエラー 0
- e2e-aip：8空港の zip で 428 本（33 秒）。国土交通省の NAV データ無しで 379 本は警告なしで作図。残り 49 本は局・フィックスが同梱データに無い（千歳 VOR の CHE など。NAV データで引ける見込み）か開始フィックス無し。手順の一覧：RJAH に絞って全部表示 25 本・他の飛行場 0 本、もう一度押すと 0 本。点線は保存されて描かれる
- 百里の従来型（GOPVU1・DAIGO・OKUJI・CHOSHI・DAIGO1）を NAV データ無しで作図し、チャートと形が合うことを目視
- tests/aip-corpus.mjs：表 235・レグ 1465、手順 SID 267・TRANSITION 51・STAR 110、読めない文のある手順 23、TRANSITION の親なし 0（0.2.5 は 11）
- FUNCTIONS：427 → 444（+17、削除なし）。60 行超は createView のみ。Scanner のメソッドも最長 41 行

## 残り
- Android タブレット実機での確認
- 0.2.7：進入チャート（IAC）

---

# HANDOFF 0.2.5（2026-11-13 パブリッシュ）

## できたこと（ユーザー決定は SPEC.md §8b）
- **AIP の PDF の取り込み**（設定「AIP の PDF」）：空港ごとの zip のまま → 確認画面 → 取り込む。pdf.js 4.10.38 を vendor/pdfjs に同梱（Apache-2.0、SW で先読み、オフライン可）
  - AD2：滑走路 L/R・THR・DER・標高（aipRunways に保存、proc-wire の findAirport で OpenAIP の滑走路を置き換え）。SID の滑走路端は AIP の DER。古い手順の「RWY03」は AIP の「03L」等の最初に当てて警告
  - RNAV の SID/STAR/TRANSITION：表（IF/TF/DF/VA）→ 手順。座標は proc.wpts（手順ごと。無ければ登録済みの地点を探す）。id は aip-ICAO-種別-名前-滑走路（読み直すと上書き）
  - ずれた文字コード（+29）・1字ずつの文字・壊れたフォントの空白（CJK 拡張 A）を直してから読む
- **TRANSITION**：種別と parents。ルートの DEP／DST の行で選ぶ（route.procs：SID・SID_TR・STAR_TR・STAR・APP）。無関係な TRANSITION は選べず、親が変われば外れる（dropOrphans）
- **手順の色分け**と**名前のあるウェイポイントの WPT 形式の表示**
- 離陸前は手順を入れ直すとアクティブ STPT を 1 に

## ファイル
| ファイル | 変更 |
|---|---|
| js/pdf-text.js（新） | pdf.js → 位置つきの文字・行・区切り。ずれた文字コードの復元 |
| js/aip-parse.js（新） | AD 2.12/2.13、RNAV の表・座標表・図の中の座標・上昇勾配の注記、手順への変換、TRANSITION のつなぎ |
| js/aip-import.js（新） | zip/pdf の読み取り（scanAip）・保存（applyAip）・aipRunways |
| js/ui-aip.js（新） | 設定の取り込み欄と確認画面 |
| js/route-proc.js | 役割（SID・SID_TR・STAR_TR・STAR・APP）、fitsRole、dropOrphans、並び |
| js/procgeo.js / procedures.js / ui-proc.js | TRANSITION、findRunway、localCtx（proc.wpts）、runwayStart（AIP の DER）、親の選択 |
| js/ui-route.js / proc-render.js / proc-wire.js / map-render.js / css | DEP・DST の行の選択欄、色、WPT 形式、STPT の色 |
| vendor/pdfjs/ | pdf.min.mjs・pdf.worker.min.mjs・LICENSE |

## 検証
- 単体 32/32（新規：ずれた文字コード・名前・高度・反対側の滑走路、AD2（ずれた末端・真方位なし）、RNAV の表（上下のコース・2段の高度・座標表・上昇勾配）、TRANSITION の選択と並び）
- 画面：e2e・e2e-nav・e2e-proc・e2e-route-proc・e2e-gesture・e2e-aip（新規）すべてエラー 0
- e2e-aip：8空港の zip（279 PDF）を 17 秒で読み取り、滑走路 8 飛行場・手順 260 本（SID 135・TRANSITION 34・STAR 91）を取り込み。千歳 JUGGLAR2 RWY01L を選ぶと TRANSITION は PANSY・BUTOS だけ、SOSHU2 に変えると外れる。滑走路端の推定なし
- tests/aip-corpus.mjs（新規・PDF は同梱しない）：AD2 は全飛行場で「THR → DER の距離 ＝ LDA」が 15m 以内（独立の確かめ。羽田の Displaced THR も）。RNAV の表 235・レグ 1465 で名前・座標の抜けなし。TRANSITION の親なし 11（伊丹・千歳 SHUYU・羽田 OPPAR：親が従来型の文章の SID のため。0.2.6 で取り込めばつながる）
- FUNCTIONS：374 → 427（新しい4ファイルなど +54／procFields を削除）。60 行超は createView のみ

## 残り
- Android タブレット実機での確認（ピンチ・回転・スワイプの感触、取り込みの速さ）

## 0.2.6 に追加（ユーザー依頼 2026-11-14・未着手）
1. DME アーク：向きの表示を CW／CCW に（今の「右回り／左回り」＝CW／CCW）。終点を、アークの中心の局のラジアルだけでなく、**別の NAVAID のラジアルとの交点**でも指定できる
2. ラジアルのパーツにチェックボックス「局から終点の DME まで点線」：経路とは別に、局 → 終点の DME の点を点線で描く（見た目の補助、距離・燃料には入れない）。ラジアルのパーツだけ（決定）
3. 手順の一覧に、表示チェックの全選択／全解除のボタン（1つのトグル）＋飛行場での絞り込み。絞り込み中のボタンはその飛行場の手順だけを切り替える（決定）
4. TRANSITION の開始フィックスに、SID（自作）で名前を付けたフィックス（例：GOPVU1 の「GOPVU」＝HUC R047 D32.5）も使えるように。今は NAVAID・ウェイポイント・ユーザーポイントなど登録済みの地点しか引けない → つながる SID（なければ同じ飛行場の手順）の作図で決まった名前つきのフィックスも引く（決定）
- 0.2.6：従来型の文章の SID/STAR、0.2.7：進入チャート（PDF 取り込みの検討は下の 0.2.4 の記録）

---

# HANDOFF 0.2.4（2026-11-13 パブリッシュ）— 以下は前の版の記録

## できたこと（ユーザー決定は SPEC.md §2・§8）
A. **DIVERT**：目的飛行場から 30NM 以内か MISSED APP の後にボタン（▲▼ LOG FUEL の段の右端、小さく。MISSED APP も同じ段へ移動）。進入前でもその位置から代替経路へ直行。DIV は DIVERT を押した後だけ表示（DIV＝EST − 代替飛行場の接地見込み＋予備）。復行・DIVERT 後は HOME BINGO を判定しない（点滅なし）。復行中（DIVERT 前）の燃料欄は EST と ALT（LAND は出さない）
B. **地図の操作**：settings.orient（track／north／free）を追加。◎＝follow＋track（トグルではない）、方位アイコン＝north、スワイプ（30px 以上）＝follow を外し free、2本指の回転（10° 以上）＝free（follow は保つ）、ピンチ＝そのまま。2本指が触れた操作は指を全部離すまで1本指の移動をしない（タブレットでピンチで ◎ が外れていた原因：指を離す順のずれで1本指の移動と判定）
C. **手順のパーツ「旋回して針路」（turnhdg）**：dir（L/R）・hdg（°M）・turn（半径、既定 250KIAS・25°・その時の高度）・end（DME／フィックス・ラジアル／高度）。弧の後に直進。高度で終わるときは旋回中の上昇も数える。180° 超の旋回も可
- **DIRECT の燃料の修正**：直行線の出発高度に、実行したときの自機高度を使う（directOrigin.alt）。これまでは飛ばした点の手前の点の高度（復行後の DIVERT では MAPT の 600ft）から上昇する計算になり、燃料を多めに見積もっていた
- RJAH GOPVU1（RWY03／21、DAIGO TRANSITION つき4本）の読込用 JSON を別に渡した（AIP AD2.24-SID-5 の文字から作成。RWY HDG 030/210・RWY03 の会合針路 092° は補った値）

## ファイル
| ファイル | 変更 |
|---|---|
| js/map-view.js | attachGestures を分割（panStep・pinchStep）、rotateAt、pinchInfo に角度 |
| js/main.js / ui.js / state.js | applyOrientation（orient）、onUserMove・onUserRotate、方位アイコン、◎、settings.orient |
| js/ui-nav.js / nav.js / route.js / flightplan.js | phaseButtons（30NM）、fuelHtml、fuelGates、liveNav の DIV、executeDivert（元の目的地を DST に）、directOrigin.alt、divertNeed は削除 |
| js/procgeo.js / procedures.js / ui-proc.js | turnHeadingGeometry、courseLabel、PART_TYPES・newPart、エディターの欄 |
| tests/ | 単体 28（新規：進入前の DIVERT、旋回して針路）、e2e-gesture.mjs（新規・タッチ）、e2e-route-proc（30NM・DIV の位置と値） |

## 検証
- 単体 28/28。画面 e2e・e2e-nav・e2e-proc・e2e-route-proc・e2e-gesture すべてエラー 0。e2e-data は国土交通省 zip が手元に無く未実行
- e2e-gesture（CDP のタッチ）：1本目が 12px ずれてから2本目が触れるピンチ・指を1本残して動かす → ◎ のまま、自機は中央。2本指で 40° 回す → 向きが 40° 変わり、航跡が変わっても回らない、自機は中央。◎ → 航跡 180° が上。スワイプ → ◎ OFF・向きそのまま・航跡が変わっても回らない。◎ → 270° が上。方位アイコン → North-up、その後のスワイプでも North-up
- e2e-route-proc：MAPT（RJAH から 30NM 以内）で MISSED APP と DIVERT が ▲▼ LOG FUEL の段に並ぶ。復行後は DIV なし。DIVERT 後の DIV 3,774 ＝ 独立計算（現在位置 → RJSK の区間燃料＋進入着陸 600＋予備 1500）と一致
- 注意：CDP の touchEnd に渡すのは「離した指」。残す指を渡すと別の指として扱われる
- FUNCTIONS：372 → 374（増：panStep, pinchStep, turnHeadingGeometry／減：divertNeed）。60 行超は createView のみ

## 残り
- Android タブレット実機での確認（特にピンチ・回転・スワイプの感触。PAN_RELEASE_PX＝30、ROTATE_START_DEG＝10 は実機で調整するかも）

## PDF 取り込みの検討（2026-11-13、8空港 279 PDF：RJAH RJCC RJFF RJOO RJSM RJTT ROAH RODN）
- 文字の層なし（画像）24：RODN 全部、RJSM の IAC と SID の文章、AOC。→ アプリでは読めない（OCR なし）。Claude が画像を読んでデータにする
- 文字のずれた符号：フォントによって文字コードが 29 ずれている（制御文字 0x03＝空白、0x13〜0x1C＝数字）。pdf.js の生の文字列に +29 で全部戻る（「Climb to 600FT on HDG028°,」）。pdftotext では数字が消えるので注意
- AD2 の 2.12：8空港とも滑走路ごと（L/R 別）の THR 座標・真方位（RJSM は未公表 → 両端から計算）・THR 標高。2.13 の TORA と LDA の差で末端のずれを補正すれば DER が出る（RJTT 16L/34R/16R など）。ADC には滑走路端の座標の文字は無い
- RNAV の SID/STAR（58）と RJTT の RNP AR（1）：ARINC 424 の表（IF/TF/DF/VA のみ）＋ウェイポイント座標表 → 全自動。滑走路方位も分かる（RJAH 03L＝028°M）
- 従来型 SID/STAR の文章（29＋8、ずれた符号 7 を含む）：決まった言い回し（Climb RWY HDG to/until、turn right/left (HDG)、to intercept and proceed via、via R to、DME ARC、direct to、Cross … at or above/below、From over）→ 規則で読む。補う値は既定値＋確認画面
- IAC：RNP（18）はウェイポイント座標と役割（IAF/IF/FAF/MAPt/MAHF）の一覧 → 順に並べて TF でほぼ自動。従来型（35＋ずれた符号 46）は進入経路の文章が無い（図だけ）。読めるのはフィックスの定義（TAIYO R081/D26.0 HUC 等）・FAF 座標・最終進入コース・復行の文章 → 候補を出して組み立ては半自動。待機（hold）は未対応
- GOPVU1 の滑走路方位を RNAV の表の値（028°/208°）に直した JSON を渡した

## 0.2.5 以降の分け方（提案・未決定）
- 0.2.5 に追加（ユーザー依頼 2026-11-13）：
  1. ルートに入れた手順（SID 等）のフィックスと線の色を変え、登録済みの WPT・経路と見分けられるように
  2. 手順の中の名前のあるウェイポイント（GOPVU 等）は、既存の WPT と同じ形で名前を表示。D8.0 HUC のような距離・高度で決まる点は対象外（決定）
  3. ROUTE の DEP・DST の行に手順の選択を付ける（ルート欄の下の選択欄は廃止）。種別 TRANSITION を追加し、つながる SID/STAR を持たせる。TRANSITION は選んだ SID（STAR）に属するものだけ選べる（無関係の組み合わせは選べない）。DEP＝SID→TRANSITION、DST＝STAR（＋TRANSITION）・APP（決定）
- 0.2.5：AD2 の読込（滑走路 L/R・THR・DER・標高、2.19 の NAVAID）＋ RNAV の SID/STAR の自動取り込み＋取り込み確認画面＋ずれた符号の復元
- 0.2.6：従来型 SID/STAR の文章の読み取り（補う値の既定値は設定で変更）
- 0.2.7：IAC（RNP は自動、従来型は候補から組み立て。待機の描画）

---


# HANDOFF 0.2.3（2026-11-11 パブリッシュ）— 以下は前の版の記録

## できたこと（ユーザー決定は SPEC.md §8「0.2.3 の決定」）
- **手順のルート連携**：ROUTE の編集で、DEP の飛行場に SID、DST の飛行場に STAR・APP があれば選択欄が出る。選ぶとフィックスが STPT として入る（DEP → SID → 経路 → STAR → APP → DST）。印「2 SID」等。手順の点は ↑↓× なし（「手順」表示。外すには手順を「なし」に）
  - 点の id は手順＋パーツから決まる（`pp-<手順id>-<パーツid>`）。作図を直すと自動で入れ直し、TOS・風・速度などの入力とアクティブ STPT は保つ。飛行中（離陸記録後）は自動では入れ直さない（ルートで選び直したときだけ）
  - 名前の無いフィックスは「2105FT」（高度で終わるレグ）または「手順名-番号」
  - 高度：高度で終わるレグ・高度制限を使う。制限なしは SID＝既定高度、STAR/APP＝前の点。SID の「以上」は既定高度まで、範囲は SID＝上・STAR/APP＝下
  - 経路の追加（選択行なし）は STAR/APP の手前に入る
- **燃料**：手順の点は `pathNm`（作図の旋回・アーク込みの実距離）で区間計算。DIRECT の直行線では使わない
- **地図**：NAV ではルートで選んだ手順を、手順レイヤーや手順の表示設定に関わらず描く。手順の区間はルートの直線を引かず、航法中の区間は手順の線を紫で強調。TAC では手順を描かず、ルートは全区間直線
- **MISSED APP**：APP（復行あり）を選び、アクティブが APP の点か目的地のとき NAV パネルにボタン。押すと復行の点（MA）を目的地の後ろに足してアクティブに。目的地と未通過の点は飛ばし扱い。代替経路へは自動で向けない
- **DIV**：復行中は燃料欄が「EST / DIV（@代替飛行場）」に変わる。DIV＝現在位置から代替経路で代替飛行場までの燃料＋進入着陸＋予備。EST が下回ると赤（点滅はしない）。HOME BINGO は復行中は判定しない
- **DIVERT**：復行中・代替経路ありでボタン。押すと現在位置から A1 … ALT へ直行開始（行き先が代替飛行場に）。以後の判定は「MIN」＝代替飛行場接地時に予備燃料
- 「飛行実績をリセット」で復行・DIVERT 前の計画に戻る（flight.planned）
- **既存の不具合の修正**：同じ基地へ戻るルートで、目的地の飛行場名（例 RJAH）が DEP の STPT として引かれ、標高を失って既定高度になっていた → 飛行場と同名の STPT は地点検索から除く（points.js allPoints）

## ファイル
| ファイル | 変更 |
|---|---|
| js/route-proc.js（新規） | 選べる手順、手順 → STPT の展開、再同期、復行の点、進入中の判定（DOM に依存しない） |
| js/procgeo.js | fixes に partId・missed・altC・altEnd・pathNm（annotatePath） |
| js/route.js | procs 欄、executeMissed、executeDivert、pointTag、resetFlight で計画に戻す、addPoint の既定位置 |
| js/flightplan.js | computeLeg の pathNm、divertNeed |
| js/nav.js | fuelGates（復行中・DIVERT 後）、liveNav の divert |
| js/proc-wire.js | syncProcRoutes、routeMissedPoints、ルートで選んだ手順の描画と強調 |
| js/map-render.js | drawRoute（手順の区間は直線なし・pointTag）、legsD |
| js/ui-route.js / ui-nav.js | 手順の選択欄・印 ／ MISSED APP・DIVERT・DIV |
| js/main.js / sw.js / css | 起動・route・proc・navdata で同期 ／ APP_SHELL に route-proc.js ／ ボタンと強調の色 |

## 検証
- 単体 26/26（新規 5：アークの実距離＝半径×中心角、手順の高度、展開・同期・利用者入力の保持、MISSED→DIV→DIVERT→リセット、同じ基地へ戻るルート）
- 画面 tests/e2e-route-proc.mjs（新規）：RJAH SID（針路→ラジアル→20DME アーク）＋APP（復行つき）、ルート RJAH → HUC 360/40 → RJAH（代替 RJSK）。並びと印、GOT は APP の手前に入る、アーク区間 27.56nm（弦 25.44nm）、手順の表示 OFF でも描く、航法中の区間の強調、MISSED APP → 10 MA MAHF、復行の終点でも代替へ向けない、DIV 表示＝独立計算 3,774 と一致、DIVERT → ALT RJSK、リセット、再読込で残る、TAC で手順なし。エラー 0
- 既存 e2e・e2e-nav・e2e-proc も再実行しエラー 0。e2e-data は国土交通省 zip が手元に無く未実行
- FUNCTIONS：349 → 372（増：annotatePath, polyLenNm, approachPhase, destPoint, expandProc, expandRole, fixAlt, missedPoints, nextPoints, procChoices, procPoint, syncRouteProcs, divertNeed, executeDivert, executeMissed, pointTag, fuelHtml, phaseButtons, legsD, procFields, routeMissedPoints, routeProcIds, syncProcRoutes／減：なし）。60 行超は createView のみ

## 残り（0.2.4 へ持ち越し）
- Android タブレット実機での確認結果の反映（未受領）

---

# HANDOFF 0.2.2（2026-11-11）

## 0. 次の冒頭プロンプト（コピー用）
PenView の継続開発。HANDOFF.md → SPEC.md（ユーザー決定の台帳）→ RULES.md → FUNCTIONS.md の順に読む。全ファイルは読まず、触るものだけ読む。
現在地：0.2.2（NAVAID ラベル、臨時空域の表示修正、SID/STAR/APP エディター、Android 対応）を公開済み。計画の全体はプロジェクトの PenView_PLAN.md。
次：0.2.3（ルート作成で DEP/DST の手順を選んで経路に含める、飛行中に重畳、APP の「MISSED APP」ボタンで復行を手動アクティブ）。仕様は SPEC.md §8。
注意：「パブリッシュして」と言われるまで版を上げない・zip を出さない。パブリッシュするか不明なら確認する。
着手前に、触るファイル・関数と方針3行を出して承認を待つ。

## 0.2.2 でできること
- **NAVAID ラベル**：「ID＋TACAN チャンネル（あれば）＋VOR 周波数（あれば）」。例：HUC 80X 113.3／NRE 117.9／GOT 100X。DME 単体はチャンネルのみ。公式 NAVAID のチャンネルを OpenAIP の同じ局に補う
- **臨時空域（SUP・NOTAM）**：表示・非表示を設定できる（既定 ON）。線は JSDF 訓練空域と同系色の濃淡（JSDF 橙・SUP 明るい橙・NOTAM 濃い橙）、斜線なし、TAC では他と同様に薄くなる
- **SID/STAR/APP エディター**（ROUTE → 「手順」タブ）
  - 手順＝飛行場＋種別＋名前。一覧で表示 ON/OFF・編集・複製・削除
  - パーツをつなぐパズル型：＋直線（→フィックス）／＋ラジアル（局から外向き・局へ向かう、終わり＝DME・フィックス/ラジアル交点・高度）／＋針路で上昇（終わり＝高度なら上昇勾配〔既定 3.3%〕から距離）／＋DME アーク。↑↓で並べ替え
  - フィックスの書き方：`MENOU`／`HUC R-270 D15`／`HUC 270/25`／`HUC R-300 / GOT R-210`（交点）／`HUC R-270 / GOT D15`／座標。地図を長押し →「手順エディターへ」で、最後に触ったフィックス欄に地点名（無ければ座標）が入る
  - 旋回：前のパーツとの角をフライバイの弧でつなぐ。半径を直接、または KIAS・高度・バンク（既定 25°）から計算（画面に半径を表示）
  - 注記：磁方位コース＋距離、フィックス名、高度制限（AIP の書き方：以上＝下線、以下＝上線、指定＝上下線、範囲＝2段）、速度制限。編集中の手順の注記は地図上でドラッグして動かせる（「注記↺」で戻す）
  - SID の開始点：滑走路を選ぶと飛行場標点・滑走路方位・長さから滑走路端を推定（点線の丸と「推定」の警告）。AIP AD 2.12 の座標を入れると置き換わる
  - APP は進入復行を別欄で作図し破線で表示（アクティブ化は 0.2.3）
  - 表示は NAV モードのみ（レイヤー「手順」、TAC では既定で隠す）。色：SID 水色・STAR 黄緑・APP 黄
  - 書き出し・読込：設定 → 書き出し・読込に「手順」を追加（全データにも含む）
- **Android 向け**：画面を消さない（Wake Lock、設定の GPS 欄で切替、既定 ON、アプリに戻ると取り直す）。戻るボタンで一番上のテンキー・シートを閉じる（開いていなければ通常の戻る）

## 0.2.2 のファイル
| ファイル | 役割 |
|---|---|
| js/procgeo.js | 手順の幾何（旋回半径、上昇勾配、ラジアル交点、ラジアル×DME、フィックス解決、滑走路端の推定、buildProcedure） |
| js/procedures.js | 手順の保存（IndexedDB `procedures`）・新規・複製・削除・取り込み |
| js/proc-render.js | 手順の描画（画面座標）と注記、計算結果のキャッシュ |
| js/proc-wire.js | 地図とのつなぎ（描く手順の選択、地点検索 ctx、注記ドラッグ） |
| js/ui-proc.js | 手順タブ（一覧・パーツカード・地図からの入力） |
| js/android.js | Wake Lock と戻るボタン |

## 0.2.2 の検証
- 単体 21/21（NAVAID ラベル、旋回半径・勾配・交点・フィックス解決・滑走路端・手順の組み立て）
- 画面（tests/e2e-proc.mjs）：RJAH RWY03 の SID を UI で作成（針路で上昇 1500ft → HUC R-060 D12〔KIAS250・3000ft・旋回半径 2.13nm〕→ 12DME アーク右回り R-120 → HUC R-120 / GOT R-150 交点）。線5・旋回1・高度の線3、滑走路端「推定」、注記ドラッグ、地図から「手順エディターへ」、戻るボタンでシートが閉じる、書き出し → 削除 → 読込、再読込で残る、TAC で隠れる。エラー 0
- 既存の e2e（e2e・e2e-nav・e2e-data〔AIP zip ＋ NOTAM〕）も再実行、エラー 0
- 関数 60 行超は createView（66 行、既知の例外）のみ

## 0.2.3 でやること（合意済み）
- ルート作成で DEP/DST に手順があれば選べる → 選んだ手順のフィックスを経路に含める（燃料計算・飛行中の重畳も）
- APP の進入復行：飛行中に「MISSED APP」ボタンで手動アクティブ
- 実機（Android タブレット）での確認結果を反映

## 前の版：0.2.1.1 の修正（百里臨時訓練空域 SUP 200/26 が見えない）
- 期間の誤読（「Until …」を開始日と読んでいた）→ parsePeriod を作り直し。保存済みデータの SUP 期間は起動時に読み直す
- 臨時空域の表示は 0.2.2 で上記の形に修正（常時表示・斜線はユーザーの意図と違ったため撤回）

## 1. 0.2.1 でできること
- **NAV データの読込**（設定 → NAV データ）：国土交通省の配布 zip をそのまま（中の zip も展開、Shift_JIS のファイル名も可）、KML、デジタル NOTAM（AIXM 5.1 の XML）
  - 自動で 26 グループに分類（JSDF 訓練空域・制限区域・ACA・CTR・ACC・ADIZ・各ルート・WPT・VFR REP・ホールディング・公式 NAVAID/飛行場・SUP 空域/NAVAID/無人機・障害物 AREA1/AREA2/SUP・NOTAM 空域/障害物/飛行場）。同じグループは読み込み直しで置き換え
  - AREA2（空港周辺の詳細障害物 約12.5万点）は既定で読まない（チェックで読む）
  - AIRAC（EFF＋28日）を過ぎたグループは一覧と地図左下に「AIRAC 期限切れ」
  - 公式の空域・障害物があれば OpenAIP の空域・障害物を隠す（設定で切替）。公式 NAVAID/飛行場は OpenAIP に無いものだけ描く
  - SUP・NOTAM の有効期間：計画離陸時刻があれば離陸〜終了予定（不明なら最大1日）、飛行中は「今〜終了予定」（過ぎたものは隠す）、無ければ「今」
  - 表示はグループごとに NAV/TAC 別に記憶。既定：量が多いもの（ACC・民間訓練・その他区域・ホールディング・無人機）は隠す。広域では RNAV/ATS 等の線を隠し TACAN ルートは残す。WPT は拡大時、障害物は中縮尺で標高1000ft以上・拡大で全部
  - 区域名と上下限、ルート名と MEA をラベル表示（重なりは間引く）。ホールディングは待機経路の形で描く
- **XTK/DTK**：アクティブ区間（DIRECT 後は直行線）に対する横ずれ。2nm 黄・3.5nm 赤、R＝コースの右
- **方位アイコン**：Google マップ風の赤白の針を常時右上に。タップで North-up（◎ OFF）
- **選択リスト**：長押し（PC はクリック）の近くに地点が2つ以上あればリスト（＋「この座標」）
- **燃料基準の再定義**
  - BINGO＝地点で保有すべき燃料（燃料＋地点。地点は入力・地図の「BINGO 地点に設定」）。見込み＝EST −（ルート上の先の STPT ならルート沿い、それ以外は巡航で直行した燃料）。通過済みなら判定しない
  - HOME BINGO＝目的地接地時（既定）の最低燃料。ルート上の STPT に変更可
  - どちらも見込みが下回ると画面全体が点滅（ACK で縮小）。JOKER は TAC 用として従来の動作のまま（ユーザー指示）
- **ルート編集**：名前をタップで行を選択（水色）、追加は選択行の「前に/後に挿入」（地図の STPT 追加も同じ）。▶ でアクティブ STPT を変更（紫）。凡例を表示
- **書き出し・読込**（設定に集約）：ルート／機体（形態含む）／NAV データ／ユーザーポイント／設定／全データを別々に。ROUTE の「共有」タブは廃止

## 2. ファイル（0.2.1 で追加）
| ファイル | 役割 |
|---|---|
| js/zip.js | 最小の ZIP 読み取り（DecompressionStream、入れ子、Shift_JIS 名） |
| js/kml.js | KML・AIXM の解析、SUP の期間、高度の解析 |
| js/navdata.js | 分類・正規化・保存（IndexedDB の `nd:<group>` と `navIndex`）・有効期間・AIRAC |
| js/nav-render.js | 読み込みデータの描画（区域・線＝世界座標、点・ラベル・ホールディング＝画面座標）、タップ判定、地点カタログ |
| js/ui-settings-data.js | 設定の NAV データ欄と、項目別の書き出し・読込 |

## 3. 残タスク
- P1：0.2.3 手順のルート連携・MISSED APP、チャート重ね（PDF）
- P1：TAC（ブルズアイ・Hook・BRAA・DOL）、JOKER の TAC 化
- P2：NOTAM 飛行場（AirportHeliport）は点のみで、本文はタップ時の一覧に出ない。区域・障害物は表示
- P2：SUP の期間が文章のもの（「by NOTAM」等）は期間不明＝常に表示
- P3：偏差を国土地理院の3′グリッドに

## 4. 実機確認の観点
1. 国土交通省の zip を iPad で選び、数秒で読み込めるか（PC の Chrome で約2秒）
2. 既定の表示で地図が読めるか（混み具合）。広域・中縮尺・拡大でそれぞれ確認
3. 飛行中に XTK の左右が実際の機位と合うか
4. BINGO 地点・HOME BINGO の見込みが、手計算と合うか

## 5. 検証（0.2.1）
- 単体 18/18（期間解析の実例 6 件を追加。0.2.0 の 14 ＋ 横ずれ、KML/AIXM/期間/高度の解析、分類・有効期間、選択行の挿入とアクティブ指定）
- 実ファイル：AIP 一式 zip（299 KML）＋ NOTAM 828件 → 24 グループ・約2秒。WPT 1,292、RNAV 1,368 区間、障害物 AREA1 16,097、NOTAM 空域 264・障害物 508
- 画面：公式優先で OpenAIP 空域を隠す、TAC で線が消え NAV で戻る、選択リスト（二重表示を修正）、XTK 2.5R＝黄、BINGO 6,209/6,000・HOME 5,322/5,000、前に挿入、機体だけの書き出し、NAV データ書き出し 6.2MB、再読込でデータが残る。0.1.x・0.2.0 の画面テストも再実行。エラー 0
- 実データで見つけて直したもの：全レイヤー既定表示で地図が読めない（無人機 534 区域・障害物 1.6万点）→ 既定を絞り縮尺で間引き／ラベルの重なり／選択リストの二重表示／編集画面の ▶ と ▸ が紛らわしい
- FUNCTIONS：220 → 284（消えた：共有タブの3関数＝設定へ移設）

## 6. 以前の版
- 0.2.1：NAV データ読込（国土交通省 zip・KML・NOTAM）、XTK/DTK、方位アイコン、選択リスト、BINGO/HOME BINGO、項目別の書き出し・読込
- 0.2.0：NAV の中核（ルート・STPT・DIRECT・フライトログ・燃料計算・TIME HACK・長押し・モード別レイヤー）
- 0.1.1：◎＝自機中央＋Heading(Track)-up、カーソル座標、縮尺可変グリッド
- 0.1.0：骨格（PWA・オフライン・地図・GPS・座標系・NAV/TAC）
