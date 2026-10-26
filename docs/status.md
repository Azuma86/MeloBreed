# 現在の状況と次にやること

- 最終更新: 2026-10-26
- ブランチ: `feat/ux-improvements`（`feat/validation-prototype` から分岐）。プロトタイプは PR #3（`feat/validation-prototype` → `main`）、UI 改善は PR #3 の上に積んだ別 PR。`chore/scaffold` は PR #1 で `main` に統合済み
- セッションの終わりにこのファイルを更新する

## 決まっていること

詳細と根拠は各文書を参照。

- **方針**: 2〜3 週間で作る検証用プロトタイプで「売れるか」を測り、事前に決めた基準で継続・方向転換・撤退を決める（`docs/specs/2026-10-26-validation-prototype.md`、Status: approved）
- **想定ユーザー（暫定）**: 趣味〜セミプロのビートメイカー / DTMer（ボカロP を含む）
- **市場**: UI は日英両対応。初期の反応は日本の DTM・ボカロ界隈で取り、英語圏（Reddit 等）にも出す
- **課金モデル（検証中）**: フリーミアム。価格付きの「Pro（準備中）」画面とウェイトリストで支払意欲を測る（$6.99/月・$49/年、¥980/月・¥7,800/年）。アカウントと決済はまだ作らない
- **判定基準**: 公開から 2 週間・有効セッション 100 以上で、①第 3 世代到達 30% ②MIDI 書き出し 10% ③書き出した人の 7〜14 日後の再訪 15% ④書き出した人の Pro 反応 3%。集計手順は `docs/analytics.md`
- **エンジン設計**: 学習データを使わない対話型進化。設計と先行研究の根拠は `docs/plans/2026-10-26-validation-prototype.md`

## できているもの

- **エンジン**（`src/engine/`）: 第 1 世代の生成（`generate.ts`）、変異・交叉（`operators.ts`）、8 候補の選択（`breed.ts`）、評価ルール（`critic.ts`）、セッション（`session.ts`）、MIDI 書き出し（`midi.ts`）。調整値は `presets.ts` に集約
- **UI**（`src/app/`）: `/ja`・`/en`（`src/proxy.ts` が振り分け）、設定 → 8 候補の試聴（単体・連続・コード伴奏）→ 選択 → 次の世代 / 戻る / 再開、MIDI ダウンロード、Pro 画面、同意バナー、プライバシーポリシー
- **UI 改善（2026-10-26）**: セッション中はヒーローを畳み、スマホでも世代画面を開いた時点で 8 候補のうち 6 つが見える（以前は 0）。カードはピアノロールをタップで再生（再生位置の線つき）、「選ぶ」を大きく、MIDI は小さなボタンに。やり直しはグリッドの下へ移し「元に戻す」（10 秒、フォーカス中は消えない）つき。下のバーで「次へ」を押せない理由と 3 つの上限を表示。繁殖・戻る・やり直しの後は先頭へスクロールして見出しにフォーカス。書き出し後の Pro 案内は下のバーの 1 行に縮め、次の繁殖で消える。配色は据え置き
- **UI 確認の道具**: `scripts/screenshot.mjs`（依存なし。インストール済みの Chrome を CDP で操作してスクリーンショット）と、それを使う `ux-reviewer` サブエージェント（`.claude/agents/ux-reviewer.md`。次のセッションから `subagent_type: ux-reviewer` で使える）
- **計測**: PostHog は同意後にだけ読み込む（`src/app/_analytics/analytics.ts`）。`/ingest` 経由で送る（`next.config.ts`）
- **ウェイトリスト**: `POST /api/waitlist` → Supabase（`src/lib/supabase-server.ts`、`supabase/waitlist.sql`）
- **依存**: `tone@15.1.22`、`posthog-js@1.438.7`、`@supabase/supabase-js@2.117.3`（バージョン固定）

## 確認済み（2026-10-26）

- `python3 .claude/hooks/quality_gate.py verify`: PASS（format、lint、型、テスト 100 件。全 240 設定での AC5〜AC7、決定性、MIDI 往復を含む）
- `mise exec -- npm run build`: 成功
- ヘッドレス Chrome で本番ビルドを操作して 32 項目すべて合格（同意前に PostHog 通信なし、選択 3 個まで、繁殖・戻る・再読み込みでの再開、再生、書き出し、Pro 画面、375px での表示）。スクリプトはセッションの一時フォルダに置いたため**リポジトリには残っていない**
- `reviewer` サブエージェントの指摘 11 件はすべて修正済み
- UI 改善: verify PASS、build 成功、`scripts/screenshot.mjs` で 375px・1280px・ライト/ダーク・日英を撮影して確認。繁殖後と、やり直し後に `h1` へフォーカスし先頭へ戻ること、すべて再生中にカードの停止で止まることを確認。`ux-reviewer` と `reviewer` の指摘のうち導線・アクセシビリティに関わるものは修正済み

## 未確認

- Supabase への保存と、公開キーで読めないこと（AC12・AC13）: プロジェクトとキーが未設定
- PostHog にイベントが届くこと（AC11）: キーが未設定
- iPhone・Android 実機（再生、マナーモード、iOS でのダウンロード）
- DAW への .mid の読み込み（AC8 の手動確認）
- **メロディの質を耳で確かめること**: 未実施。ここが検証の核心

## 次にやること（上から順に）

1. **PR のマージ（ユーザー）**: PR #3（プロトタイプ）→ UI 改善の PR の順。第 1 世代はユーザーが試聴して「使えそう」と判断済み（2026-10-26）。第 2 世代以降の育ち方は未評価
2. **UI の残り（任意）**: 見送ったもの。PC 用キーボード操作（1〜8 で再生、Space で停止、Enter で次へ）。Pro モーダルを `<dialog>` にしてフォーカスを閉じ込め、閉じたら元のボタンに戻す。iPhone SE（高さ 667px）で初回の「はじめる」がまだ画面外。設定の変更中に `h1` がない。キーと BPM だけの変更なら系統を捨てずに今の世代へ反映する（セッションの変更が必要）。系統（どの親から生まれたか）の表示はセッションに由来を保存する必要があり、`SCHEMA_VERSION` を上げることになる
3. **外部サービスの準備（ユーザー作業）**: Supabase で `supabase/waitlist.sql` を実行、PostHog のプロジェクト作成、`.env.example` に沿って `.env.local` と Vercel に環境変数を設定。その後 AC11〜AC13 を確認し、`docs/analytics.md` の集計を PostHog に作る
4. **実機と DAW での確認**: iOS Safari・Android Chrome、GarageBand ともう 1 つの DAW
5. **公開前に決めること（ユーザー）**: プライバシーポリシーの運営者名と連絡先（今は `[運営者名]` などの仮の文字列）、Vercel を Pro にするか（Hobby は非商用のみで、価格の表示は「販売の広告」に当たる可能性が高い）
6. **公開前の試聴テスト**: 5 人程度に聴いてもらい調整する → 公開 → 2 週間計測 → 判定

## 未決事項

- 「学習データを使う ML は入れない」を長期の製品原則にするか（LP の文言はこれを前提にしている）
- テスト参加者 20〜30 人の集め方と、公開する場所・日程
- PostHog のリージョン（US / EU。`NEXT_PUBLIC_POSTHOG_REGION` で切り替え）と公開ドメイン
- ウェイトリスト API のレート制限（今はボット除けの隠し項目だけ。公開前に Vercel Firewall などで検討）
- E2E テスト（Playwright）の導入。今回の 32 項目のブラウザ確認を移植する

## 注意点

- ルートを移動・削除したあとに `npm run typecheck` が `.next/dev/types` のエラーで失敗したら、古い生成物なので `.next/dev` を消す
- `npm install` で `fsevents`（既存の vitest 経由）のインストールスクリプト警告が出るが、今回の変更とは無関係で未対応。`core-js`（posthog-js 経由）は `allowScripts` で拒否済み
- PostHog は `posthog.init` を呼ぶだけで通信が起きる。同意前に import も init もしない作りを崩さない
- メロディの保存形式（`session.ts`）を変えるときは `SCHEMA_VERSION` を上げる。生成・繁殖の挙動を変えたら `ENGINE_VERSION` を上げる
