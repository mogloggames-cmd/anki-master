<?php
/**
 * もぐら先生の暗記サポートアプリ - アカウント認証 & データ同期 API
 *
 * エックスサーバーに設置して使用します。
 *
 * 設置手順:
 * 1. このファイルをエックスサーバーにアップロード
 *    例: public_html/anki-sync/api.php
 * 2. 同じフォルダに data/ ディレクトリが自動作成されます
 *
 * エンドポイント:
 *   POST ?action=register   - アカウント作成 {email, password}
 *   POST ?action=login      - ログイン {email, password} → {token, email}
 *   POST ?action=logout     - ログアウト (Authorization: Bearer <token>)
 *   GET  ?action=pull       - データ取得 (Authorization: Bearer <token>)
 *   POST ?action=push       - データ保存 (Authorization: Bearer <token>)
 *   GET  ?action=info       - 同期情報取得 (Authorization: Bearer <token>)
 *   POST ?action=change_password - パスワード変更 (Authorization: Bearer <token>)
 *   POST ?action=delete_account  - アカウント削除 (Authorization: Bearer <token>)
 */

// ====== 設定 ======
define('DATA_DIR', __DIR__ . '/data');
define('USERS_DIR', DATA_DIR . '/users');
define('TOKENS_FILE', DATA_DIR . '/tokens.json');
define('TOKEN_EXPIRY', 90 * 24 * 60 * 60); // 90日
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
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ディレクトリ初期化
foreach ([DATA_DIR, USERS_DIR] as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
        file_put_contents($dir . '/.htaccess', "Deny from all\n");
    }
}

// ====== ルーティング ======
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'register':
        handleRegister();
        break;
    case 'login':
        handleLogin();
        break;
    case 'logout':
        handleLogout();
        break;
    case 'pull':
        handlePull();
        break;
    case 'push':
        handlePush();
        break;
    case 'info':
        handleInfo();
        break;
    case 'change_password':
        handleChangePassword();
        break;
    case 'delete_account':
        handleDeleteAccount();
        break;
    default:
        jsonError('不明なアクション', 400);
}

// ====== ハンドラー ======

function handleRegister() {
    requireMethod('POST');
    $body = getJsonBody();

    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError('有効なメールアドレスを入力してください', 400);
    }
    if (strlen($password) < 6) {
        jsonError('パスワードは6文字以上にしてください', 400);
    }

    $userId = emailToId($email);
    $userDir = USERS_DIR . '/' . $userId;

    if (is_dir($userDir)) {
        jsonError('このメールアドレスは既に登録されています', 409);
    }

    // ユーザー作成
    mkdir($userDir, 0700, true);
    $userInfo = [
        'email' => $email,
        'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
        'createdAt' => date('c')
    ];
    file_put_contents($userDir . '/user.json', json_encode($userInfo, JSON_UNESCAPED_UNICODE));

    // トークン発行
    $token = generateToken();
    saveToken($token, $userId);

    jsonResponse([
        'success' => true,
        'token' => $token,
        'email' => $email
    ]);
}

function handleLogin() {
    requireMethod('POST');
    $body = getJsonBody();

    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    if (!$email || !$password) {
        jsonError('メールアドレスとパスワードを入力してください', 400);
    }

    $userId = emailToId($email);
    $userFile = USERS_DIR . '/' . $userId . '/user.json';

    if (!file_exists($userFile)) {
        jsonError('メールアドレスまたはパスワードが正しくありません', 401);
    }

    $userInfo = json_decode(file_get_contents($userFile), true);

    if (!password_verify($password, $userInfo['passwordHash'])) {
        jsonError('メールアドレスまたはパスワードが正しくありません', 401);
    }

    // トークン発行
    $token = generateToken();
    saveToken($token, $userId);

    jsonResponse([
        'success' => true,
        'token' => $token,
        'email' => $userInfo['email']
    ]);
}

function handleLogout() {
    requireMethod('POST');
    $token = getBearerToken();
    if ($token) {
        removeToken($token);
    }
    jsonResponse(['success' => true]);
}

function handlePull() {
    requireMethod('GET');
    $userId = requireAuth();
    $userDir = USERS_DIR . '/' . $userId;
    $dataFile = $userDir . '/sync_data.json';
    $metaFile = $userDir . '/sync_meta.json';

    if (!file_exists($dataFile)) {
        jsonResponse(['data' => null, 'lastModified' => null]);
        return;
    }

    $data = file_get_contents($dataFile);
    $meta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : [];

    jsonResponse([
        'data' => json_decode($data),
        'lastModified' => $meta['lastModified'] ?? null,
        'deviceName' => $meta['deviceName'] ?? null
    ]);
}

function handlePush() {
    requireMethod('POST');
    $userId = requireAuth();
    $body = getJsonBody();

    if (!isset($body['data'])) {
        jsonError('データが不正です', 400);
    }

    $userDir = USERS_DIR . '/' . $userId;
    if (!is_dir($userDir)) {
        mkdir($userDir, 0700, true);
    }

    $dataFile = $userDir . '/sync_data.json';
    $metaFile = $userDir . '/sync_meta.json';

    file_put_contents($dataFile, json_encode($body['data'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    $meta = [
        'lastModified' => date('c'),
        'deviceName' => $body['deviceName'] ?? 'unknown',
        'theoryCount' => countTheories($body['data'])
    ];
    file_put_contents($metaFile, json_encode($meta, JSON_UNESCAPED_UNICODE));

    jsonResponse([
        'success' => true,
        'lastModified' => $meta['lastModified'],
        'theoryCount' => $meta['theoryCount']
    ]);
}

function handleInfo() {
    requireMethod('GET');
    $userId = requireAuth();
    $metaFile = USERS_DIR . '/' . $userId . '/sync_meta.json';

    if (!file_exists($metaFile)) {
        jsonResponse(['lastModified' => null, 'theoryCount' => 0]);
        return;
    }

    jsonResponse(json_decode(file_get_contents($metaFile), true));
}

function handleChangePassword() {
    requireMethod('POST');
    $userId = requireAuth();
    $body = getJsonBody();

    $currentPassword = $body['currentPassword'] ?? '';
    $newPassword = $body['newPassword'] ?? '';

    if (strlen($newPassword) < 6) {
        jsonError('新しいパスワードは6文字以上にしてください', 400);
    }

    $userFile = USERS_DIR . '/' . $userId . '/user.json';
    $userInfo = json_decode(file_get_contents($userFile), true);

    if (!password_verify($currentPassword, $userInfo['passwordHash'])) {
        jsonError('現在のパスワードが正しくありません', 401);
    }

    $userInfo['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
    file_put_contents($userFile, json_encode($userInfo, JSON_UNESCAPED_UNICODE));

    jsonResponse(['success' => true]);
}

function handleDeleteAccount() {
    requireMethod('POST');
    $userId = requireAuth();
    $body = getJsonBody();

    $password = $body['password'] ?? '';
    $userFile = USERS_DIR . '/' . $userId . '/user.json';
    $userInfo = json_decode(file_get_contents($userFile), true);

    if (!password_verify($password, $userInfo['passwordHash'])) {
        jsonError('パスワードが正しくありません', 401);
    }

    // ユーザーデータ削除
    $userDir = USERS_DIR . '/' . $userId;
    $files = glob($userDir . '/*');
    foreach ($files as $file) {
        unlink($file);
    }
    rmdir($userDir);

    // トークン削除
    removeTokensByUser($userId);

    jsonResponse(['success' => true]);
}

// ====== ユーティリティ ======

function emailToId($email) {
    return hash('sha256', strtolower(trim($email)));
}

function generateToken() {
    return bin2hex(random_bytes(32));
}

function getTokens() {
    if (!file_exists(TOKENS_FILE)) return [];
    $data = json_decode(file_get_contents(TOKENS_FILE), true);
    return is_array($data) ? $data : [];
}

function saveTokens($tokens) {
    file_put_contents(TOKENS_FILE, json_encode($tokens, JSON_UNESCAPED_UNICODE));
}

function saveToken($token, $userId) {
    $tokens = getTokens();
    // 期限切れトークンを削除
    $now = time();
    $tokens = array_filter($tokens, function($t) use ($now) {
        return ($t['expires'] ?? 0) > $now;
    });
    $tokens[$token] = [
        'userId' => $userId,
        'created' => $now,
        'expires' => $now + TOKEN_EXPIRY
    ];
    saveTokens($tokens);
}

function removeToken($token) {
    $tokens = getTokens();
    unset($tokens[$token]);
    saveTokens($tokens);
}

function removeTokensByUser($userId) {
    $tokens = getTokens();
    $tokens = array_filter($tokens, function($t) use ($userId) {
        return ($t['userId'] ?? '') !== $userId;
    });
    saveTokens($tokens);
}

function validateToken($token) {
    $tokens = getTokens();
    if (!isset($tokens[$token])) return null;
    $t = $tokens[$token];
    if (($t['expires'] ?? 0) < time()) {
        removeToken($token);
        return null;
    }
    return $t['userId'];
}

function getBearerToken() {
    // エックスサーバー等でAuthorizationヘッダーが届かない場合の複数フォールバック
    $header = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $header = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $header = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
        return $m[1];
    }
    return null;
}

function requireAuth() {
    $token = getBearerToken();
    if (!$token) {
        jsonError('認証が必要です', 401);
    }
    $userId = validateToken($token);
    if (!$userId) {
        jsonError('セッションが期限切れです。再ログインしてください', 401);
    }
    return $userId;
}

function requireMethod($method) {
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        jsonError('Method Not Allowed', 405);
    }
}

function getJsonBody() {
    $input = file_get_contents('php://input');
    $body = json_decode($input, true);
    if (!is_array($body)) {
        jsonError('リクエストデータが不正です', 400);
    }
    return $body;
}

function jsonResponse($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
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
