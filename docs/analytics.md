# 計測と継続・撤退の判定（PostHog）

検証用プロトタイプ（`docs/specs/2026-10-26-validation-prototype.md`）の判定 ①〜④ を、PostHog でどう集計するかの手順。イベントは計測に同意した人からだけ届く（`src/app/_analytics/analytics.ts`）。

## 送っているイベント

| イベント             | 送るタイミング                   | プロパティ                                                 |
| -------------------- | -------------------------------- | ---------------------------------------------------------- |
| `session_started`    | 「はじめる」/「8つを新しく出す」 | `preset`, `key`, `scale`, `bpm`, `locale`                  |
| `candidate_played`   | 候補の再生 / すべて再生          | `generation`, `index`（単体のみ）, `mode`（`one` / `all`） |
| `generation_bred`    | 「次の世代へ」                   | `generation`（新しい世代の番号。2 以上）, `parentCount`    |
| `midi_exported`      | MIDI 書き出し                    | `generation`, `preset`                                     |
| `pro_viewed`         | Pro 画面を開いた                 | `source`（`header` / `after_export`）                      |
| `waitlist_submitted` | ウェイトリスト登録の成功         | `source`                                                   |
| `$pageview`          | ページ表示（PostHog が自動送信） | —                                                          |

「有効セッション」は `session_started` を 1 回以上送った人と数える。

## PostHog に作る集計

すべて「公開日から 2 週間」の期間で見る。人数は person（匿名 ID）単位。

1. **① 第 3 世代への到達**: Funnel。`session_started` → `generation_bred`（フィルタ: `generation` ≥ 3）。conversion window は 1 日。
2. **② MIDI 書き出し**: Funnel。`session_started` → `midi_exported`。conversion window は 1 日。
3. **③ 書き出した人の再訪**: Retention。cohortizing event は `midi_exported`（first time）、returning event は `$pageview`、period は Week。「Week 1」の値を使う（7〜13 日後の再訪。仕様の「7〜14 日後」に相当）。
4. **④ 書き出した人の Pro 反応**: Funnel。`midi_exported` → `pro_viewed`。conversion window は 14 日。

## 判定（仕様から転記）

- 判定時点: 公開から 2 週間、かつ有効セッション 100 以上。届かなければ最大 4 週間まで延長する。それでも届かない場合は「集客が成立しない」という結果として扱い、テスト参加者への聞き取りで判断する。
- ① 30% 以上、② 10% 以上、③ 15% 以上、④ 3% 以上。
- 全達成なら継続（アカウント・課金の spec へ）。①か②が未達なら、方向転換か撤退。③か④だけ未達なら、改善して 1 回だけ 2 週間再測定し、そこで決める。

## 注意

- 同意しなかった人は数に入らない。拒否率は計測できないので、聞き取りで補う。
- 広告ブロッカー対策として `/ingest` 経由で送っている（`next.config.ts`）。それでも一部は取りこぼす。
- 自分のテスト操作が混ざらないよう、PostHog の設定で自分の IP か匿名 ID を除外する。
