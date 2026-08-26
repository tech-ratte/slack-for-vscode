# Slack for VSCode

VS Code / Cursor のサイドバーから、参加中の Slack チャンネルとダイレクトメッセージを閲覧・送受信するための非公式拡張機能です。Slack, Inc. の公式製品ではありません。

トークンは VS Code の Secret Storage に保存します。リポジトリや設定ファイルには書き込みません。

## できること

- 参加しているパブリック / プライベートチャンネルの一覧
- 未読数の表示（チャンネルと、追加した DM）
- 会話の閲覧（直近 50 件）とメッセージ送信
- ユーザー検索からの DM 追加
- 約 60 秒ごとのポーリングによる新着通知

## 前提条件

- VS Code 1.109 以降、または Cursor
- 対象ワークスペースで Slack アプリを作成・インストールできる権限
- **User OAuth Token**（`xoxp-` で始まる）。Bot Token（`xoxb-`）も入力できますが、投稿者や見える会話がボット側になるため、この拡張では User Token を推奨します

---

## Slack アクセストークンの取得方法

この拡張は、あなたが作った Slack アプリの **User Token** を使って Web API を呼び出します。レガシーの「テストトークン」は使えません。次の手順で、自分用のアプリを 1 つ作り、そのトークンを拡張に渡します。

### 1. Slack アプリを作成する

1. ブラウザで [Your Apps](https://api.slack.com/apps) を開きます。Slack にログインしていない場合はログインします。
2. **Create New App** を選びます。
3. **From scratch** を選びます（マニフェストからの作成でも構いませんが、手順は From scratch を前提にします）。
4. **App Name** に分かりやすい名前を付けます。例: `Slack for VS Code (個人用)`。
5. **Pick a workspace to develop your app in** で、使いたいワークスペースを選びます。
6. **Create App** を押します。

ワークスペースの管理者ポリシーによっては、アプリ作成やインストールが禁止されていたり、インストール後に管理者の承認待ちになったりします。承認されるまで User OAuth Token は発行されません。その場合はワークスペース管理者に相談してください。

### 2. User Token に必要なスコープを追加する

左メニューの **OAuth & Permissions** を開き、**User Token Scopes**（Bot Token Scopes ではありません）に次を追加します。

| スコープ | 用途 |
| --- | --- |
| `channels:read` | パブリックチャンネルの一覧・情報 |
| `groups:read` | プライベートチャンネルの一覧・情報 |
| `im:read` | 既存 DM の検索 |
| `users:read` | メンバー一覧・表示名の解決 |
| `channels:history` | パブリックチャンネルの履歴 |
| `groups:history` | プライベートチャンネルの履歴 |
| `im:history` | DM の履歴 |
| `chat:write` | メッセージ送信 |
| `im:write` | 新規 DM の開始、および DM の既読更新 |
| `channels:write` | パブリックチャンネルの既読更新 |
| `groups:write` | プライベートチャンネルの既読更新 |

`channels:write` / `groups:write` / `im:write` が無いと、会話は読めても未読が消えません。`im:write` が無いと、まだ存在しない DM を新規に開けません（既存 DM の再利用は `im:read` だけで足りる場合があります）。

グループ DM（MPIM）はこの拡張では扱いません。`mpim:*` は不要です。

### 3. ワークスペースへインストールする

1. 同じ **OAuth & Permissions** ページの上部にある **Install to Workspace**（または **Reinstall to Workspace**）を押します。
2. 権限一覧を確認し、**Allow** で許可します。
3. インストール後、**OAuth Tokens** に **User OAuth Token** が表示されます。`xoxp-` で始まる文字列です。

**ここがこの拡張に貼るトークンです。** 同じページにある Bot User OAuth Token（`xoxb-`）ではありません。User OAuth Token は `xoxp-` のあとに数字とハイフンが続く長い文字列です。

スコープを後から追加した場合は、必ず **Reinstall to Workspace** で再インストールしてください。スコープを足しただけでは、すでに発行済みのトークンに権限は付きません。再インストール後は新しい User OAuth Token をコピーし、拡張の **Slack: Set Token** でもう一度保存してください。

### 4. トークンを安全に扱う

- トークンはパスワードと同じです。チャット、Issue、スクリーンショット、git コミットに載せないでください。
- 漏洩したら [Your Apps](https://api.slack.com/apps) で該当アプリを開き、トークンの再発行またはアプリの削除を行ってください。拡張側ではコマンド **Slack: Clear Token** で保存済みトークンを消せます。
- User Token は **あなた本人** として投稿・既読します。ボットとして動きたい場合だけ `xoxb-` を使います。その場合、ボットをチャンネルに招待する必要があり、投稿もボット名になります。

公式のトークン解説: [Slack token types](https://docs.slack.dev/authentication/tokens)

---

## 拡張へのトークン設定

1. 拡張をインストールした VS Code / Cursor を開きます。
2. 左のアクティビティバーにある **Slack** アイコンを開きます。
3. 次のいずれかでトークン入力欄を出します。
   - サイドバーの鍵アイコン
   - コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）から **Slack: Set Token**
4. `xoxp-` で始まる User OAuth Token を貼り付けて確定します。
5. 認証に成功すると、参加中チャンネルが一覧されます。

トークンが未設定、無効、またはスコープ不足のときは、サイドバーにエラーと「Slack: Set Token」への案内が出ます。

## 使い方

1. **Channels** からチャンネルをクリックすると、エディタ領域に会話ビューが開きます。
2. **Direct Messages** の **Add DM** でメンバーを検索し、DM を追加します。追加した DM は次回以降も残ります。
3. 会話ビューでは直近 50 件を表示します。**Refresh** で再取得、**Send** または `Ctrl+Enter` / `Cmd+Enter` で送信します。`Enter` 単体は改行です。
4. 会話を開くと既読にします（対応スコープがある場合）。
5. 未読が増えると、情報メッセージで通知します。**Open** でその会話を開けます。

### コマンド

| コマンド | 説明 |
| --- | --- |
| `Slack: Set Token` | トークンを保存する |
| `Slack: Clear Token` | 保存済みトークンを削除する |
| `Slack: Refresh Channels` | チャンネルと未読を再取得する |
| `Slack: Add DM` | メンバーを検索して DM を追加する |
| `Slack: Remove DM` | サイドバーから DM を外す（Slack 上の会話は消えません） |

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| `invalid_auth` / Token is invalid | `xoxp-` の User Token か。コピー漏れ、アプリ削除、再インストール前の古いトークン、管理者によるアプリ削除ではないか |
| `missing_scope` | 上表のスコープを User Token Scopes に足し、**再インストール** したか。Bot Token Scopes にだけ足していないか |
| チャンネルが空 | 自分が参加しているチャンネルだけ出ます。アーカイブ済みは対象外です |
| DM を追加できない | `im:write` を付けて再インストールしたか |
| 未読が消えない | `channels:write` / `groups:write` / `im:write`。不足時は既読 API を黙ってスキップします |
| ボットトークンで履歴が取れない | ボットがそのチャンネルに参加している必要があります。User Token を使ってください |
| `ratelimited` | Slack のレート制限です。少し待ってから Refresh してください |

## 既知の制限

- スレッド、ファイル添付、メンション補完、絵文字ピッカー、リッチな mrkdwn 描画はありません
- 履歴は直近 50 件です
- グループ DM と、サイドバーに追加していない DM は扱いません
- 新着は WebSocket ではなく約 60 秒間隔のポーリングです
- 公式 Slack クライアントの全機能は再現しません

## 開発

```powershell
npm install
npm run compile
```

F5（Run Extension）で Extension Development Host が開きます。監視コンパイルは `npm run watch` です。

```powershell
npm run lint
npm test
```

## ライセンス

[MIT](LICENSE)

不具合や要望は [GitHub Issues](https://github.com/tech-ratte/slack-for-vscode/issues) へお願いします。
