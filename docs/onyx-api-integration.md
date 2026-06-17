# Onyx API Integration

## 目的

Knowledge Desk APIから実Onyxへ問い合わせ、Box / SharePoint / Jira の検索結果を使った回答を返すための接続方針を整理する。

Knowledge Deskの業務ロジックは `apps/knowledge-desk-api/` に閉じる。Onyx本体には問い合わせ業務固有の処理を追加しない。

## 利用するOnyx API

今回のMVPでは、検索専用APIではなくチャットAPIを使う。

```http
POST /api/chat/send-chat-message
```

理由:

- 回答文と引用元documentを同時に取得できる
- `stream=false` を指定するとJSONで扱える
- `internal_search_filters.source_type` で Box / SharePoint / Jira に検索対象を絞れる
- 既存Onyx UIが使っているRAG処理に乗れる

## Request方針

Knowledge Deskからは次のように呼び出す。

```json
{
  "message": "社員からの問い合わせ文",
  "stream": false,
  "include_citations": true,
  "origin": "api",
  "internal_search_filters": {
    "source_type": ["box", "sharepoint", "jira"]
  },
  "chat_session_info": {
    "persona_id": 0,
    "description": "Knowledge Desk"
  }
}
```

`persona_id=0` はOnyxの既定エージェントを使う指定。デモでは、Box / SharePoint / Jira のConnectorが既にindex済みであることを前提にする。

## Responseで使う項目

`stream=false` の場合、主に以下を読む。

```json
{
  "answer": "...",
  "answer_citationless": "...",
  "top_documents": [
    {
      "semantic_identifier": "...",
      "link": "...",
      "blurb": "...",
      "source_type": "box",
      "score": 0.91,
      "match_highlights": ["..."]
    }
  ],
  "tool_calls": [
    {
      "tool_name": "...",
      "search_docs": []
    }
  ],
  "citation_info": []
}
```

Knowledge Deskでは `top_documents` と `tool_calls[].search_docs` を集約し、`SourceReference` に正規化する。

## 認証方式

外部アプリからはCookieではなくBearer tokenを使う。

候補:

- Personal Access Token
  - 推奨
  - User settingsから発行
  - 必要scope: `Chat Write`
  - 必要に応じて `Search Read`
- API Key
  - 管理者向け
  - `Authorization: Bearer <key>` または生token形式が使える
- Session cookie
  - ブラウザUI向け
  - Knowledge Deskのサーバー間連携では使わない

Knowledge Deskでは以下の環境変数を使う。

```bash
KNOWLEDGE_DESK_ONYX_MODE=real
ONYX_BASE_URL=http://localhost:3100
ONYX_API_KEY=...
```

`ONYX_API_KEY` はPATまたはOnyx API Keyを想定し、HTTP Headerには以下で送る。

```http
Authorization: Bearer <ONYX_API_KEY>
```

## Source識別

Onyxの `source_type` をKnowledge Deskのsource名に変換する。

| Onyx source_type | Knowledge Desk source |
|---|---|
| `box` | `Box` |
| `sharepoint` | `SharePoint` |
| `jira` | `Jira` |

対象外sourceはMVPでは破棄する。

## URLとsnippet

`SourceReference` には以下を入れる。

- `title`: `semantic_identifier` を優先
- `url`: `link` を優先。なければ `document_id`
- `snippet`: `match_highlights[0]` または `blurb`
- `score`: `score`

`snippet` は `<hi>...</hi>` などのハイライトタグを除去して返す。

## 注意事項

- 実Onyx API呼び出しはKnowledge Desk API内に閉じる
- Onyx Connector、権限同期、indexing処理は変更しない
- 本番認証設計は今回対象外
- Jira APIでの本物チケット作成は今回対象外
