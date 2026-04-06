<?php
/**
 * もぐら先生の暗記サポートアプリ - クラウド同期API
 *
 * エックスサーバーに設置して使用します。
 *
 * 設置手順:
 * 1. このファイル（sync_api.php）をエックスサーバーにアップロード
 *    例: public_html/anki-sync/sync_api.php
 * 2. 下の SYNC_PASSWORD を自分だけが知るパスワードに変更
 * 3. アプリの設定からサーバーURLとパスワードを入力
 *
 * データは同じフォルダ内の data/ ディレクトリに保存されます。
 */

// ====== 設定 ======
define('SYNC_PASSWORD', 'ここにパスワードを設定してください');
define('DATA_DIR', __DIR__ . '/data');
// ==================

// CORS — 許可するオリジンを制限
$allowedOrigins = [
    'https://mogura-app.com',
    'http://localhost',
    'http://127.0.0.1',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true) || preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://mogura-app.com');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Sync-Key');
header('Content-Type: application/json; charset=utf-8');

// プリフライトリクエスト
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// データディレクトリ作成
if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0700, true);
    // .htaccessで直接アクセスを禁止
    file_put_contents(DATA_DIR . '/.htaccess', "Deny from all\n");
}

// パスワード認証
$syncKey = $_SERVER['HTTP_X_SYNC_KEY'] ?? ($_GET['key'] ?? '');
if ($syncKey !== SYNC_PASSWORD) {
    http_response_code(401);
    echo json_encode(['error' => '認証エラー: パスワードが正しくありません']);
    exit;
}

$action = $_GET['action'] ?? '';
$dataFile = DATA_DIR . '/sync_data.json';
$metaFile = DATA_DIR . '/sync_meta.json';

switch ($action) {
    case 'pull':
        // データ取得
        if (!file_exists($dataFile)) {
            echo json_encode(['data' => null, 'lastModified' => null]);
        } else {
            $data = file_get_contents($dataFile);
            $meta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : [];
            echo json_encode([
                'data' => json_decode($data),
                'lastModified' => $meta['lastModified'] ?? null,
                'deviceName' => $meta['deviceName'] ?? null
            ]);
        }
        break;

    case 'push':
        // データ保存
        $input = file_get_contents('php://input');
        $body = json_decode($input, true);

        if (!$body || !isset($body['data'])) {
            http_response_code(400);
            echo json_encode(['error' => 'データが不正です']);
            exit;
        }

        // データ保存
        file_put_contents($dataFile, json_encode($body['data'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        // メタ情報保存
        $meta = [
            'lastModified' => date('c'),
            'deviceName' => $body['deviceName'] ?? 'unknown',
            'theoryCount' => countTheories($body['data'])
        ];
        file_put_contents($metaFile, json_encode($meta, JSON_UNESCAPED_UNICODE));

        echo json_encode([
            'success' => true,
            'lastModified' => $meta['lastModified'],
            'theoryCount' => $meta['theoryCount']
        ]);
        break;

    case 'info':
        // 同期情報のみ取得（軽量）
        if (!file_exists($metaFile)) {
            echo json_encode(['lastModified' => null, 'theoryCount' => 0]);
        } else {
            $meta = json_decode(file_get_contents($metaFile), true);
            echo json_encode($meta);
        }
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => '不明なアクション: ' . $action]);
        break;
}

function countTheories($data) {
    $count = 0;
    if (isset($data['subjects']) && is_array($data['subjects'])) {
        foreach ($data['subjects'] as $subject) {
            if (isset($subject['books']) && is_array($subject['books'])) {
                foreach ($subject['books'] as $book) {
                    if (isset($book['chapters']) && is_array($book['chapters'])) {
                        foreach ($book['chapters'] as $chapter) {
                            if (isset($chapter['theories']) && is_array($chapter['theories'])) {
                                $count += count($chapter['theories']);
                            }
                        }
                    }
                }
            }
        }
    }
    return $count;
}
