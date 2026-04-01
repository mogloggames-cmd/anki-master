# CLAUDE.md

## プロジェクト概要

**アプリ名:** もぐら先生の暗記サポートアプリ
**目的:** 暗記学習を支援するフラッシュカードアプリ
**対象ユーザー:** 勉強するすべての人（資格試験・語学・学校の試験など）

---

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フロントエンド | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| バックエンド | なし（ブラウザのみで動作） |
| データ永続化 | `localStorage` + JSON エクスポート/インポート |
| 外部依存 | **なし**（ゼロ依存） |
| ビルドツール | **なし**（ビルド不要） |
| サーバー | Python 3 `http.server`（任意・ローカル開発用） |

---

## ファイル構成

```
tax_tutor_app/
├── index.html               # メインアプリ
├── script.js                # アプリロジック全体
├── style.css                # スタイル
├── README.txt               # アプリ概要ドキュメント
└── tax_tutor_icon.png       # アプリアイコン
```

---

## 起動方法

```bash
open index.html   # index.html をブラウザで直接開くだけでOK
```

---

## アーキテクチャ

### データ構造
```javascript
let theoryData = {
    subjects: [
        {
            id, name,
            books: [
                {
                    id, name,
                    chapters: [
                        {
                            id, name,
                            theories: [
                                {
                                    id, question, answer,
                                    evaluation,   // 'S'|'A'|'B'|'C'|'D'|'E'
                                    lastReviewed, // ISO date string
                                    reviewCount
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};
```

### 復習間隔（スペーシング効果）
```javascript
const REVIEW_INTERVALS = {
    'A': 30,  // 30日後
    'B': 14,  // 14日後
    'C': 7,   // 7日後
    'D': 3,   // 3日後
    'E': 1    // 翌日
};
```
評価 `S` は特別扱い（完全習得済み・通常の復習対象外）。

### 主要タブ
| タブ | 機能 |
|---|---|
| 今日の復習 | 当日対象のカードを復習（負荷予測カレンダー付き） |
| テスト | 範囲を指定してテストモードで実力確認 |
| 不正解 | 今日間違えた問題を再確認 |
| 統計 | 日別学習量・正答率・評価分布・科目別定着率 |
| 設定 | 復習設定・教材登録・教材構造管理・バックアップ・同期 |

### 主要関数（script.js）
| 関数 | 役割 |
|---|---|
| `loadData()` / `saveData()` | localStorage との読み書き |
| `exportData()` / `importData()` | JSON バックアップ |
| `updateTodayReview()` | 当日の復習リストを算出 |
| `calculatePriority()` | 優先度計算アルゴリズム |
| `recordEvaluation()` | S/A/B/C/D/E 評価を記録 |
| `addTheory()` / `bulkRegisterTheories()` | 理論の追加（単体・一括） |
| `updateCalendar()` | 負荷予測カレンダーを描画 |
| `switchTab()` | タブ切り替え |

---

## コーディング規約

- **言語:** UIは日本語、コード（変数名・コメント）は英語
- **スタイル:** CSS カスタムプロパティ（`--eval-s`, `--eval-a` など）で評価色を一元管理
- **DOM操作:** ネイティブ DOM API のみ使用（jQuery等なし）
- **モジュール:** 単一ファイル構成（`script.js`）、モジュール分割なし
- **状態管理:** グローバル変数 `theoryData` で一元管理

---

## 注意事項

- **外部ライブラリを追加しない:** 依存ゼロが設計上の要件。CDN 読み込みも避ける
- **ビルドプロセスなし:** webpack/Vite等の導入は要検討（現状は不要）
- **オフライン動作が必須:** ネットワーク依存の機能は追加しない
- **データはすべて localStorage:** サーバーサイドDBへの移行は現状スコープ外
- **文字コード:** UTF-8（日本語テキストを多数含む）
- **Python関連機能は削除済み:** .bat/.sh 起動スクリプト、Pythonサーバー関連は不要
