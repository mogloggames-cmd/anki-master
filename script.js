// ========================================
// グローバル変数とデータ構造
// ========================================

let theoryData = {
    subjects: []
};

const REVIEW_INTERVALS = {
    'A': 30,
    'B': 14,
    'C': 7,
    'D': 3,
    'E': 1
};

let currentCardIndex = 0;
let currentReviewList = [];
let currentDisplayMode = 'today-review';
let calendarCurrentDate = new Date();

let isRandomOrder = false;
let isAnswerVisible = false;
let preserveTheoryId = null;
let evalMode = localStorage.getItem('evalMode') || 'simple';
let evalBtnSize = localStorage.getItem('evalBtnSize') || 'small';
let incorrectMode = localStorage.getItem('incorrectMode') || 'normal';

// テストモード用
let testQuestions = [];
let testCurrentIndex = 0;
let testResults = []; // { theory, correct: bool }
let testIsAnswerVisible = false;

// 評価の「元に戻す」用
let lastEvalAction = null;

// 今日の不正解復習用
let todayIncorrectList = [];
let incorrectCardIndex = 0;

// 教材構造管理の階層ナビゲーション用
let currentStructurePath = [];

// 今日の完了カウント
let completedTodayKey = 'completedToday_' + getTodayStringStatic();
let completedTodayCount = parseInt(localStorage.getItem(completedTodayKey) || '0');
let initialTodayTotal = 0;

// カードアニメーション方向
let cardAnimDirection = 'right';

// スワイプ用
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 50;

// ========================================
// 初期化
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    registerServiceWorker();

    // login/register Enter key support
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('register-password-confirm').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleRegister();
    });

    await checkAuthAndInit();
});

// ========================================
// ダークモード
// ========================================

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    }
    updateThemeIcon();
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.addEventListener('click', toggleTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    let next;
    if (current === 'dark') next = 'light';
    else if (current === 'light') next = 'dark';
    else {
        // Auto mode: toggle to opposite of system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        next = prefersDark ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon();
}

// ========================================
// 日別学習目標
// ========================================

function initDailyGoal() {
    const goal = parseInt(localStorage.getItem('dailyGoal') || '0');
    const input = document.getElementById('daily-goal-input');
    if (input) {
        input.value = goal;
        input.addEventListener('change', () => {
            const val = Math.max(0, parseInt(input.value) || 0);
            localStorage.setItem('dailyGoal', val.toString());
            input.value = val;
            updateDailyGoalDisplay();
        });
    }
    updateDailyGoalDisplay();
}

function updateDailyGoalDisplay() {
    const goal = parseInt(localStorage.getItem('dailyGoal') || '0');
    const bar = document.getElementById('daily-goal-bar');
    if (!bar) return;
    if (goal <= 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    const done = completedTodayCount;
    const pct = Math.min(100, Math.round((done / goal) * 100));
    document.getElementById('daily-goal-text').textContent = `目標: ${done}/${goal}問 (${pct}%)`;
    document.getElementById('daily-goal-fill').style.width = pct + '%';
    if (pct >= 100) {
        document.getElementById('daily-goal-fill').classList.add('goal-achieved');
    } else {
        document.getElementById('daily-goal-fill').classList.remove('goal-achieved');
    }
}

function updateThemeIcon() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    const theme = document.documentElement.getAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (!theme && prefersDark);
    toggle.textContent = isDark ? '☀️' : '🌙';
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

// ========================================
// アカウント認証 & クラウド同期
// ========================================

const API_BASE_URL = 'https://meta-labo.com/anki-sync/api.php';

let authToken = localStorage.getItem('authToken');
let authEmail = localStorage.getItem('authEmail');
let isOfflineMode = false;
let autoSyncTimer = null;
let autoSyncInProgress = false;

function getDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    return 'PC';
}

async function checkAuthAndInit() {
    if (authToken) {
        // token validation
        try {
            const resp = await fetch(API_BASE_URL + '?action=info', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            if (resp.ok) {
                showApp();
                initApp();
                await autoSyncPullOnLoad();
                return;
            }
        } catch (e) {
            // network error - start in offline mode with existing data
            showApp();
            initApp();
            showToast('オフラインモードで起動しました', 'info');
            return;
        }
        // token expired
        localStorage.removeItem('authToken');
        localStorage.removeItem('authEmail');
        authToken = null;
        authEmail = null;
    }
    // show login screen
    document.getElementById('auth-screen').style.display = 'flex';
}

function initApp() {
    loadData();
    initializeEventListeners();
    updateAllDisplays();
    updateSubjectSelectors();
    initButtonSettings();
    initIncorrectModeButtons();
    initDailyGoal();
    updateAccountInfo();
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-container').style.display = '';
}

function showAuthForm(type) {
    document.getElementById('auth-form-login').style.display = type === 'login' ? '' : 'none';
    document.getElementById('auth-form-register').style.display = type === 'register' ? '' : 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('register-error').style.display = 'none';
}

function showAuthError(formType, message) {
    const el = document.getElementById(formType + '-error');
    el.textContent = message;
    el.style.display = '';
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    document.getElementById('login-error').style.display = 'none';

    if (!email || !password) {
        showAuthError('login', 'メールアドレスとパスワードを入力してください');
        return;
    }

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'ログイン中...';

    try {
        const resp = await fetch(API_BASE_URL + '?action=login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await resp.json();
        if (!resp.ok) {
            showAuthError('login', result.error || 'ログインに失敗しました');
            return;
        }

        authToken = result.token;
        authEmail = result.email;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('authEmail', authEmail);
        isOfflineMode = false;

        showApp();
        initApp();
        await autoSyncPullOnLoad();
        showToast('ログインしました', 'success');
    } catch (err) {
        showAuthError('login', 'ネットワークエラー: サーバーに接続できません');
    } finally {
        btn.disabled = false;
        btn.textContent = 'ログイン';
    }
}

async function handleRegister() {
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-password-confirm').value;
    document.getElementById('register-error').style.display = 'none';

    if (!email || !password) {
        showAuthError('register', 'メールアドレスとパスワードを入力してください');
        return;
    }
    if (password.length < 6) {
        showAuthError('register', 'パスワードは6文字以上にしてください');
        return;
    }
    if (password !== confirm) {
        showAuthError('register', 'パスワードが一致しません');
        return;
    }

    const btn = document.getElementById('register-btn');
    btn.disabled = true;
    btn.textContent = '作成中...';

    try {
        const resp = await fetch(API_BASE_URL + '?action=register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await resp.json();
        if (!resp.ok) {
            showAuthError('register', result.error || '登録に失敗しました');
            return;
        }

        authToken = result.token;
        authEmail = result.email;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('authEmail', authEmail);
        isOfflineMode = false;

        showApp();
        initApp();

        // upload existing local data if any
        if (getAllTheories().length > 0) {
            await syncPush();
        }
        showToast('アカウントを作成しました', 'success');
    } catch (err) {
        showAuthError('register', 'ネットワークエラー: サーバーに接続できません');
    } finally {
        btn.disabled = false;
        btn.textContent = 'アカウント作成';
    }
}

function startOfflineMode() {
    isOfflineMode = true;
    showApp();
    initApp();
    showToast('オフラインモードで起動しました', 'info');
}

async function handleLogout() {
    if (!confirm('ログアウトしますか？')) return;

    try {
        await fetch(API_BASE_URL + '?action=logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
    } catch (e) { /* ignore */ }

    authToken = null;
    authEmail = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('authEmail');
    localStorage.removeItem('lastCloudSync');
    isOfflineMode = false;

    document.getElementById('app-container').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    showAuthForm('login');
}

function updateAccountInfo() {
    const el = document.getElementById('account-info');
    if (!el) return;
    const syncEl = document.getElementById('account-sync-status');

    if (isOfflineMode) {
        el.innerHTML = '<span style="color: #f39c12;">● オフラインモード</span><br><small style="color: var(--text-light);">ログインするとデータが同期されます</small>';
        if (syncEl) syncEl.style.display = 'none';
        return;
    }
    if (!authToken || !authEmail) {
        el.innerHTML = '<span style="color: #95a5a6;">● 未ログイン</span>';
        if (syncEl) syncEl.style.display = 'none';
        return;
    }

    let html = '<span style="color: #27ae60;">● ログイン中</span>';
    html += '<br><small style="color: var(--text-light);">' + authEmail + '</small>';
    const lastSync = localStorage.getItem('lastCloudSync');
    if (lastSync) {
        html += '<br><small style="color: var(--text-light);">最終同期: ' + new Date(lastSync).toLocaleString('ja-JP') + '</small>';
    }
    el.innerHTML = html;

    if (syncEl) {
        syncEl.style.display = '';
        syncEl.innerHTML = '<span style="color: var(--text-light);">データは自動的に同期されます</span>';
    }
}

// ---- sync helpers ----

async function apiRequest(action, method, body) {
    const opts = {
        method,
        headers: { 'Authorization': 'Bearer ' + authToken }
    };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const resp = await fetch(API_BASE_URL + '?action=' + action, opts);
    if (resp.status === 401) {
        // session expired
        showToast('セッション切れ。再ログインしてください', 'warning');
        handleLogout();
        throw new Error('session_expired');
    }
    return resp;
}

async function syncPush() {
    if (!authToken || isOfflineMode) return;
    try {
        const resp = await apiRequest('push', 'POST', {
            data: theoryData,
            deviceName: getDeviceName()
        });
        if (resp.ok) {
            const result = await resp.json();
            localStorage.setItem('lastCloudSync', new Date().toISOString());
            updateAccountInfo();
        }
    } catch (e) {
        if (e.message !== 'session_expired') {
            // silent fail for auto-sync
        }
    }
}

async function syncPull() {
    if (!authToken || isOfflineMode) return null;
    try {
        const resp = await apiRequest('pull', 'GET');
        if (!resp.ok) return null;
        const result = await resp.json();
        return result;
    } catch (e) {
        return null;
    }
}

function scheduleAutoSync() {
    if (!authToken || isOfflineMode) return;
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(async () => {
        if (autoSyncInProgress) return;
        autoSyncInProgress = true;
        await syncPush();
        autoSyncInProgress = false;
    }, 3000);
}

async function autoSyncPullOnLoad() {
    if (!authToken || isOfflineMode) return;
    try {
        const resp = await apiRequest('info', 'GET');
        if (!resp.ok) return;
        const info = await resp.json();
        if (!info.lastModified) return;

        const serverTime = new Date(info.lastModified).getTime();
        const lastSync = localStorage.getItem('lastCloudSync');
        const localTime = lastSync ? new Date(lastSync).getTime() : 0;

        if (serverTime > localTime + 5000) {
            const result = await syncPull();
            if (!result || !result.data) return;

            const serverCount = countAllTheories(result.data);
            const localCount = getAllTheories().length;

            if (serverCount >= localCount) {
                theoryData = result.data;
                saveDataLocal();
                updateAllDisplays();
                localStorage.setItem('lastCloudSync', new Date().toISOString());
                updateAccountInfo();
                showToast(`サーバーから同期しました（${serverCount}問）`, 'success');
            }
        }
    } catch (e) { /* silent fail */ }
}

// manual sync buttons
async function manualSyncPush() {
    if (!authToken) { showToast('ログインしてください', 'warning'); return; }
    showToast('送信中...', 'info');
    await syncPush();
    showToast(`データを送信しました（${getAllTheories().length}問）`, 'success');
}

async function manualSyncPull() {
    if (!authToken) { showToast('ログインしてください', 'warning'); return; }
    showToast('受信中...', 'info');
    const result = await syncPull();
    if (!result || !result.data) {
        showToast('サーバーにデータがありません', 'warning');
        return;
    }
    const serverCount = countAllTheories(result.data);
    const localCount = getAllTheories().length;
    if (!window.confirm(`サーバーのデータ（${serverCount}問）で上書きします。\n現在のデータ（${localCount}問）は置き換えられます。\n\nよろしいですか？`)) return;
    theoryData = result.data;
    saveData();
    updateAllDisplays();
    localStorage.setItem('lastCloudSync', new Date().toISOString());
    updateAccountInfo();
    showToast(`データを受信しました（${serverCount}問）`, 'success');
}

// password change
function showChangePassword() {
    const current = prompt('現在のパスワードを入力:');
    if (!current) return;
    const newPass = prompt('新しいパスワードを入力（6文字以上）:');
    if (!newPass) return;
    if (newPass.length < 6) { showToast('パスワードは6文字以上にしてください', 'warning'); return; }

    apiRequest('change_password', 'POST', { currentPassword: current, newPassword: newPass })
        .then(resp => resp.json())
        .then(result => {
            if (result.error) { showToast(result.error, 'error'); return; }
            showToast('パスワードを変更しました', 'success');
        })
        .catch(() => showToast('パスワード変更に失敗しました', 'error'));
}

function countAllTheories(data) {
    let count = 0;
    if (data && data.subjects) {
        data.subjects.forEach(s => s.books && s.books.forEach(b => b.chapters && b.chapters.forEach(c => {
            if (c.theories) count += c.theories.length;
        })));
    }
    return count;
}

function saveDataLocal() {
    localStorage.setItem('theoryData', JSON.stringify(theoryData));
    updateSubjectSelectors();
}

// ========================================
// JSONバックアップ（iOS対応）
// ========================================

function exportJSON() {
    const json = JSON.stringify(theoryData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `anki_master_backup_${getTodayString()}.json`;

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
        navigator.share({
            files: [new File([blob], filename, { type: 'application/json' })],
            title: '暗記マスター バックアップ'
        }).then(() => showToast('バックアップを共有しました', 'success')).catch(() => {});
    } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast('バックアップをダウンロードしました', 'success');
    }
}

function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.subjects || !Array.isArray(data.subjects)) {
                showToast('無効なバックアップファイルです', 'error');
                return;
            }
            if (!confirm(`${data.subjects.length}科目のデータをインポートします。現在のデータは上書きされます。よろしいですか？`)) return;
            theoryData = data;
            saveData();
            updateAllDisplays();
            showToast('バックアップを復元しました', 'success');
        } catch (err) {
            showToast('ファイルの読み込みに失敗しました', 'error');
        }
    };
    reader.readAsText(file, 'UTF-8');
    document.getElementById('import-json-input').value = '';
}

// ========================================
// Toast通知
// ========================================

function showToast(message, type = 'info', duration = 2500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('toast-visible'));
    });
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

// ========================================
// データ管理
// ========================================

function loadData() {
    const saved = localStorage.getItem('theoryData');
    if (saved) {
        theoryData = JSON.parse(saved);
        let needsSave = false;
        getAllTheories().forEach(theory => {
            if ('history' in theory || 'firstDate' in theory || 'lastDate' in theory) {
                delete theory.history;
                delete theory.firstDate;
                delete theory.lastDate;
                needsSave = true;
            }
        });
        // マイグレーション: 科目activeフラグ
        theoryData.subjects.forEach(subject => {
            if (subject.active === undefined) {
                subject.active = true;
                needsSave = true;
            }
        });
        if (needsSave) saveData();
    } else {
        theoryData = {
            subjects: [
                {
                    name: "サンプル科目",
                    active: true,
                    books: [
                        {
                            name: "サンプル教材",
                            chapters: [
                                {
                                    name: "第1章 サンプル",
                                    theories: [
                                        {
                                            id: generateId(),
                                            questionText: "暗記マスターへようこそ！\nこれはサンプルの問題です。（　①　）に入る言葉は？",
                                            answerText: "①サンプル回答\n\n設定タブから問題を登録してみましょう。",
                                            evaluation: "E",
                                            nextReview: getTodayStringStatic(),
                                            learned: true
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };
        saveData();
    }
}

function saveData() {
    localStorage.setItem('theoryData', JSON.stringify(theoryData));
    updateSubjectSelectors();
    scheduleAutoSync();
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}


// ========================================
// 日付ユーティリティ
// ========================================

function getTodayStringStatic() {
    const today = new Date();
    return formatDateISO(today);
}

function getTodayString() {
    return getTodayStringStatic();
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateJP(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return formatDateISO(date);
}

function daysBetween(dateStr1, dateStr2) {
    const date1 = new Date(dateStr1);
    const date2 = new Date(dateStr2);
    return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
}

// ========================================
// イベントリスナー初期化
// ========================================

function initializeEventListeners() {
    // タブ切り替え
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => switchTab(button.dataset.tab));
    });

    // 全理論一覧フィルター（タブが存在する場合のみ）
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateAllTheoriesList();
        });
    });

    const filterSubject = document.getElementById('filter-subject');
    if (filterSubject) filterSubject.addEventListener('change', () => updateAllTheoriesList());
    const theorySearch = document.getElementById('theory-search');
    if (theorySearch) theorySearch.addEventListener('input', () => updateAllTheoriesList());

    // カレンダー（タブが存在する場合のみ）
    const prevMonth = document.getElementById('prev-month');
    if (prevMonth) prevMonth.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
        updateCalendar();
    });
    const nextMonth = document.getElementById('next-month');
    if (nextMonth) nextMonth.addEventListener('click', () => {
        calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
        updateCalendar();
    });

    // 教材管理モード
    document.querySelectorAll('.mode-btn-row[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => switchManagementMode(btn.dataset.mode));
    });

    // 教材登録サブタブ
    document.querySelectorAll('.register-sub-tab').forEach(btn => {
        btn.addEventListener('click', () => switchRegisterSubTab(btn.dataset.registerMode));
    });

    document.getElementById('add-and-continue').addEventListener('click', () => addTheory(true));
    document.getElementById('add-and-finish').addEventListener('click', () => addTheory(false));
    document.getElementById('bulk-register').addEventListener('click', () => bulkRegisterTheories());

    // 個別登録セレクター
    document.getElementById('subject-select').addEventListener('change', (e) => onSubjectSelectChange(e.target.value, 'individual'));
    document.getElementById('book-select').addEventListener('change', (e) => onBookSelectChange(e.target.value, 'individual'));
    document.getElementById('chapter-select').addEventListener('change', (e) => onChapterSelectChange(e.target.value, 'individual'));

    // 一括登録セレクター
    document.getElementById('bulk-subject-select').addEventListener('change', (e) => onSubjectSelectChange(e.target.value, 'bulk'));
    document.getElementById('bulk-book-select').addEventListener('change', (e) => onBookSelectChange(e.target.value, 'bulk'));
    document.getElementById('bulk-chapter-select').addEventListener('change', (e) => onChapterSelectChange(e.target.value, 'bulk'));

    // CSV
    document.getElementById('export-csv-btn').addEventListener('click', () => exportCSV());
    document.getElementById('import-csv-btn').addEventListener('click', () => document.getElementById('import-csv-input').click());
    document.getElementById('import-csv-input').addEventListener('change', (e) => importCSV(e.target.files[0]));

    // リセット
    document.getElementById('reset-all-evaluations-btn').addEventListener('click', () => resetAllEvaluations());
    document.getElementById('bulk-unlearn-e-btn').addEventListener('click', () => bulkUnlearnByEvaluation('E'));

    // 復習コントロール
    document.getElementById('undo-eval-btn').addEventListener('click', () => undoLastEvaluation());
    document.getElementById('toggle-random-btn').addEventListener('click', () => toggleRandomOrder());

    // 設定パネル（設定タブ内に統合済み）

    // エクスポートフィルター
    document.querySelectorAll('.export-eval-filter').forEach(cb => {
        cb.addEventListener('change', () => updateExportFilterCount());
    });

    // モーダル
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.getElementById('card-modal').addEventListener('click', (e) => {
        if (e.target.id === 'card-modal') closeModal();
    });

    // スワイプジェスチャー
    initSwipeGestures();

    // キーボードショートカット
    document.addEventListener('keydown', handleKeyboardShortcut);
}

function handleKeyboardShortcut(e) {
    // テキスト入力中は無効
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    // モーダルが開いている場合は無効
    const modal = document.getElementById('card-modal');
    if (modal && modal.style.display !== 'none' && modal.style.display !== '') return;

    const isReviewTab = (currentDisplayMode === 'today-review' || currentDisplayMode === 'incorrect-review');

    switch (e.key) {
        case '?':
            e.preventDefault();
            toggleShortcutHelp();
            return;
        case 'Escape':
            closeShortcutHelp();
            return;
        case ' ':
            if (isReviewTab) {
                e.preventDefault();
                toggleAnswerVisibility();
            }
            break;
        case 'ArrowLeft':
            if (isReviewTab && currentCardIndex > 0) {
                e.preventDefault();
                navigateCard(-1);
            }
            break;
        case 'ArrowRight':
            if (isReviewTab && currentCardIndex < currentReviewList.length - 1) {
                e.preventDefault();
                navigateCard(1);
            }
            break;
        case 'o': case 'O':
            if (isReviewTab && currentReviewList.length > 0) {
                e.preventDefault();
                const newEval = upgradeEvaluation(currentReviewList[currentCardIndex].evaluation);
                recordEvaluation(currentReviewList[currentCardIndex], newEval);
            }
            break;
        case 'x': case 'X':
            if (isReviewTab && currentReviewList.length > 0) {
                e.preventDefault();
                const theory = currentReviewList[currentCardIndex];
                let newEval;
                if (incorrectMode === 'strict') newEval = 'E';
                else if (incorrectMode === 'gentle') newEval = theory.evaluation;
                else newEval = downgradeEvaluation(theory.evaluation);
                recordEvaluation(theory, newEval, incorrectMode === 'gentle');
            }
            break;
        case 'z': case 'Z':
            if (isReviewTab) {
                e.preventDefault();
                undoLastEvaluation();
            }
            break;
        case '1': case '2': case '3': case '4': case '5':
            if (isReviewTab && evalMode === 'detail' && currentReviewList.length > 0) {
                e.preventDefault();
                const evals = ['E', 'D', 'C', 'B', 'A'];
                recordEvaluation(currentReviewList[currentCardIndex], evals[parseInt(e.key) - 1]);
            }
            break;
    }
}

function navigateCard(direction) {
    if (currentDisplayMode === 'incorrect-review') {
        incorrectCardIndex = Math.max(0, Math.min(incorrectCardIndex + direction, todayIncorrectList.length - 1));
        displayIncorrectReview();
    } else {
        currentCardIndex = Math.max(0, Math.min(currentCardIndex + direction, currentReviewList.length - 1));
        isAnswerVisible = false;
        cardAnimDirection = direction > 0 ? 'right' : 'left';
        displayCurrentCard();
    }
}

// ========================================
// ショートカットヘルプ
// ========================================

function toggleShortcutHelp() {
    let overlay = document.getElementById('shortcut-help');
    if (overlay) {
        overlay.remove();
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'shortcut-help';
    overlay.className = 'shortcut-overlay';
    overlay.innerHTML = `
        <div class="shortcut-modal">
            <h3>キーボードショートカット</h3>
            <div class="shortcut-list">
                <div class="shortcut-item"><kbd>Space</kbd><span>回答を表示/非表示</span></div>
                <div class="shortcut-item"><kbd>←</kbd><span>前のカード</span></div>
                <div class="shortcut-item"><kbd>→</kbd><span>次のカード</span></div>
                <div class="shortcut-item"><kbd>O</kbd><span>正解</span></div>
                <div class="shortcut-item"><kbd>X</kbd><span>不正解</span></div>
                <div class="shortcut-item"><kbd>Z</kbd><span>元に戻す</span></div>
                <div class="shortcut-item"><kbd>1-5</kbd><span>評価 E〜A（詳細モード時）</span></div>
                <div class="shortcut-item"><kbd>?</kbd><span>このヘルプを表示</span></div>
                <div class="shortcut-item"><kbd>Esc</kbd><span>閉じる</span></div>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function closeShortcutHelp() {
    const overlay = document.getElementById('shortcut-help');
    if (overlay) overlay.remove();
}

// ========================================
// スワイプジェスチャー
// ========================================

function initSwipeGestures() {
    const containers = ['today-review-content', 'incorrect-review-content'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        el.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
                if (currentReviewList.length === 0) return;
                if (dx < 0) {
                    // swipe left = next
                    cardAnimDirection = 'right';
                    currentCardIndex = (currentCardIndex + 1) % currentReviewList.length;
                } else {
                    // swipe right = prev
                    cardAnimDirection = 'left';
                    currentCardIndex = (currentCardIndex - 1 + currentReviewList.length) % currentReviewList.length;
                }
                const containerId = id;
                displayCurrentCard(containerId);
            }
        }, { passive: true });
    });
}

// ========================================
// タブ切り替え
// ========================================

function switchTab(tabName) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    currentDisplayMode = tabName;

    switch(tabName) {
        case 'today-review': updateTodayReview(); break;
        case 'test-mode': setupTestSelectors(); break;
        case 'incorrect-review': displayIncorrectReview(); break;
        case 'all-theories': updateFilterSubjectSelect(); updateAllTheoriesList(); break;
        case 'calendar': updateCalendar(); break;
        case 'statistics': updateStatistics(); break;
    }
}

// ========================================
// 全理論の取得
// ========================================

function getAllTheories(includeInactive = true) {
    const theories = [];
    theoryData.subjects.forEach(subject => {
        if (!includeInactive && subject.active === false) return;
        subject.books.forEach(book => {
            book.chapters.forEach(chapter => {
                chapter.theories.forEach(theory => {
                    theories.push({
                        ...theory,
                        learned: theory.learned !== false,
                        subjectName: subject.name,
                        bookName: book.name,
                        chapterName: chapter.name
                    });
                });
            });
        });
    });
    return theories;
}

// ========================================
// ダッシュボード
// ========================================

function updateDashboard(learnedCount, unlearnedCount, learnedReviewList) {
    // 完了数
    document.getElementById('review-completed').textContent = completedTodayCount;
    document.getElementById('review-total').textContent = learnedCount;

    // 進捗リング
    const total = completedTodayCount + learnedCount;
    const pct = total > 0 ? Math.round((completedTodayCount / total) * 100) : 0;
    const circumference = 2 * Math.PI * 26; // r=26
    const offset = circumference - (pct / 100) * circumference;
    const ring = document.getElementById('progress-ring');
    const ringPct = document.getElementById('progress-ring-pct');
    if (ring) ring.setAttribute('stroke-dashoffset', offset);
    if (ringPct) ringPct.textContent = pct + '%';

    // 目標進捗
    updateDailyGoalDisplay();

    // 評価内訳バッジ
    const breakdown = document.getElementById('dashboard-eval-breakdown');
    if (breakdown) {
        const eCount = learnedReviewList.filter(t => t.evaluation === 'E').length;
        const dCount = learnedReviewList.filter(t => t.evaluation === 'D').length;
        const cCount = learnedReviewList.filter(t => t.evaluation === 'C').length;
        const bCount = learnedReviewList.filter(t => t.evaluation === 'B').length;
        const aCount = learnedReviewList.filter(t => t.evaluation === 'A').length;
        let pills = '';
        if (eCount) pills += `<span class="eval-pill pill-e">E: ${eCount}</span>`;
        if (dCount) pills += `<span class="eval-pill pill-d">D: ${dCount}</span>`;
        if (cCount) pills += `<span class="eval-pill pill-c">C: ${cCount}</span>`;
        if (bCount) pills += `<span class="eval-pill pill-b">B: ${bCount}</span>`;
        if (aCount) pills += `<span class="eval-pill pill-a">A: ${aCount}</span>`;
        if (unlearnedCount) pills += `<span class="eval-pill pill-unlearned">未習: ${unlearnedCount}</span>`;
        breakdown.innerHTML = pills;
    }

    // 科目チップ
    updateSubjectChips();

    // 7日間カレンダーストリップ
    updateCalendarStrip();
}

function updateSubjectChips() {
    const container = document.getElementById('subject-chips');
    if (!container) return;
    if (theoryData.subjects.length <= 1) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    theoryData.subjects.forEach(subject => {
        const cls = subject.active === false ? 'subject-chip inactive' : 'subject-chip';
        html += `<span class="${cls}" onclick="toggleSubjectActive('${subject.name}')">${subject.name}</span>`;
    });
    container.innerHTML = html;
}

function toggleSubjectActive(subjectName) {
    const subject = theoryData.subjects.find(s => s.name === subjectName);
    if (!subject) return;
    subject.active = subject.active === false ? true : false;
    saveData();
    updateAllDisplays();
    showToast(subject.active ? `${subjectName}をアクティブに` : `${subjectName}を休止に`, 'info');
}

function updateCalendarStrip() {
    const container = document.getElementById('calendar-strip');
    if (!container) return;
    const today = getTodayString();
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    let html = '';
    for (let i = 0; i < 7; i++) {
        const dateStr = addDays(today, i);
        const date = new Date(dateStr);
        const dayLabel = i === 0 ? '今日' : weekDays[date.getDay()];
        const count = getTodayReviewList(dateStr).length;
        const todayClass = i === 0 ? ' today' : '';
        let loadClass = 'load-none';
        if (count > 20) loadClass = 'load-heavy';
        else if (count > 0) loadClass = 'load-light';
        html += `
            <div class="strip-day${todayClass}" onclick="switchTab('calendar')">
                <div class="strip-day-label">${dayLabel}</div>
                <div class="strip-day-num">${date.getDate()}</div>
                <div class="strip-day-count ${loadClass}">${count > 0 ? count + '問' : '-'}</div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// ========================================
// タブ1：今日の復習プール
// ========================================

function updateTodayReview() {
    const today = getTodayString();
    const learnedReviewList = getTodayReviewList(today);
    const unlearnedList = getUnlearnedList();

    if (isRandomOrder) {
        shuffleArray(learnedReviewList);
        shuffleArray(unlearnedList);
    } else {
        applySortMode(learnedReviewList, 'priority');
        applySortMode(unlearnedList, 'priority');
    }

    currentReviewList = [...learnedReviewList, ...unlearnedList];

    // 初回トータル記録
    if (initialTodayTotal === 0 && learnedReviewList.length > 0) {
        initialTodayTotal = learnedReviewList.length + completedTodayCount;
    }

    if (preserveTheoryId) {
        const preservedIndex = currentReviewList.findIndex(t => t.id === preserveTheoryId);
        if (preservedIndex !== -1) {
            currentCardIndex = preservedIndex;
        } else if (currentCardIndex >= currentReviewList.length) {
            currentCardIndex = Math.max(0, currentReviewList.length - 1);
        }
        preserveTheoryId = null;
    } else {
        currentCardIndex = 0;
    }

    // ダッシュボード更新
    updateDashboard(learnedReviewList.length, unlearnedList.length, learnedReviewList);

    // プログレスバー
    updateProgressBar();

    // カード表示
    displayCurrentCard('today-review-content');
}

function updateProgressBar() {
    const total = initialTodayTotal || (currentReviewList.length + completedTodayCount);
    const pct = total > 0 ? Math.round((completedTodayCount / total) * 100) : 0;
    const bar = document.getElementById('review-progress-bar');
    const text = document.getElementById('review-progress-text');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = completedTodayCount + ' / ' + total + ' 完了';
}

function getTodayReviewList(targetDate) {
    const theories = getAllTheories(false); // アクティブ科目のみ
    const reviewList = [];
    theories.forEach(theory => {
        if (theory.learned && theory.nextReview && theory.nextReview <= targetDate) {
            const daysOverdue = daysBetween(theory.nextReview, targetDate);
            const priority = calculatePriority(theory.evaluation, daysOverdue);
            reviewList.push({ ...theory, daysOverdue, priority });
        }
    });
    return reviewList.sort((a, b) => b.priority - a.priority);
}

function getUnlearnedList() {
    const theories = getAllTheories(false);
    return theories.filter(theory => !theory.learned);
}

function calculatePriority(evaluation, daysOverdue) {
    const evalWeights = { 'E': 120, 'D': 100, 'C': 80, 'B': 60, 'A': 40 };
    return (evalWeights[evaluation] || 0) + (daysOverdue * 10);
}

function applySortMode(list, mode) {
    switch (mode) {
        case 'evaluation':
            const evalOrder = { 'E': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4 };
            return list.sort((a, b) => {
                const diff = (evalOrder[a.evaluation] || 0) - (evalOrder[b.evaluation] || 0);
                return diff !== 0 ? diff : (b.priority || 0) - (a.priority || 0);
            });
        case 'subject':
            return list.sort((a, b) => {
                const s = a.subjectName.localeCompare(b.subjectName, 'ja');
                if (s !== 0) return s;
                const bk = a.bookName.localeCompare(b.bookName, 'ja');
                return bk !== 0 ? bk : a.chapterName.localeCompare(b.chapterName, 'ja');
            });
        case 'overdue':
            return list.sort((a, b) => {
                const diff = (b.daysOverdue || 0) - (a.daysOverdue || 0);
                return diff !== 0 ? diff : (b.priority || 0) - (a.priority || 0);
            });
        case 'priority':
        default:
            return list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }
}

// ========================================
// カード表示と評価
// ========================================

function displayCurrentCard(containerId = 'today-review-content') {
    const container = document.getElementById(containerId);

    isAnswerVisible = false;

    if (currentReviewList.length === 0) {
        // 完了チェック
        if (completedTodayCount > 0) {
            showCompletionCelebration(container);
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🎉</div>
                    <div class="empty-state-title">今日の復習はありません</div>
                    <div class="empty-state-message">新しい理論を追加するか、明日の復習をお待ちください。</div>
                </div>
            `;
        }
        return;
    }

    if (currentCardIndex >= currentReviewList.length) {
        currentCardIndex = 0;
    }

    const theory = currentReviewList[currentCardIndex];
    const cardHTML = createTheoryCard(theory, true);

    // アニメーション付きで表示
    const animClass = cardAnimDirection === 'right' ? 'card-slide-in-right' : 'card-slide-in-left';
    container.innerHTML = cardHTML;
    const card = container.querySelector('.theory-card');
    if (card) {
        card.classList.add(animClass);
        card.addEventListener('animationend', () => card.classList.remove(animClass), { once: true });
    }

    cardAnimDirection = 'right'; // reset
    attachEvaluationButtons(containerId);
    attachCardTapToggle(containerId);
}

function showCompletionCelebration(container) {
    container.innerHTML = `
        <div class="celebration">
            <div class="celebration-emoji">🎉</div>
            <div class="celebration-title">今日の復習完了！</div>
            <div class="celebration-subtitle">お疲れさまでした</div>
            <div class="celebration-stats">
                <span class="eval-pill pill-a">完了: ${completedTodayCount}問</span>
            </div>
        </div>
    `;
}

function createTheoryCard(theory, showEvalButtons = false) {
    const questionHTML = formatQuestionText(theory);
    const daysOverdueText = theory.daysOverdue > 0 ? `⚠️ ${theory.daysOverdue}日滞留中` : '';
    const unlearnedBadge = !theory.learned ? '<span class="badge-unlearned">🆕 未習</span>' : '';

    let html = `
        <div class="theory-card">
            <div class="card-header">
                <div class="card-path">${theory.subjectName} &gt; ${theory.bookName} &gt; ${theory.chapterName}</div>
                <div class="card-number">No.${currentCardIndex + 1} / ${currentReviewList.length}${unlearnedBadge}</div>
            </div>
            <div class="question-section">
                <h4>【問題】</h4>
                <p>${questionHTML}</p>
            </div>
            <div class="answer-section" id="answer-section-display" style="${isAnswerVisible ? '' : 'display: none;'}">
                <h4>【解答】</h4>
                <p>${formatAnswerText(theory.answerText)}</p>
            </div>
            <div class="card-info">
                <div class="current-eval">
                    現在：<span class="eval-badge eval-${theory.evaluation.toLowerCase()}">${theory.evaluation}</span>
                    <span style="color: var(--text-light); font-size: 0.8rem;">
                        ${theory.nextReview ? '次回: ' + formatDateShort(theory.nextReview) : '未スケジュール'}
                    </span>
                    <button class="btn btn-warning btn-small" onclick="openEditModal('${theory.id}')">✏️</button>
                </div>
                ${daysOverdueText ? `<div class="overdue-warning">${daysOverdueText}</div>` : ''}
            </div>
    `;

    if (showEvalButtons) {
        const isLarge = evalBtnSize === 'large';
        const sz = isLarge ? ' eval-btn-large' : '';
        const compact = isLarge ? '' : ' eval-buttons-compact';
        if (evalMode === 'simple') {
            html += `
            <div class="eval-buttons${compact}" style="display: flex; gap: 8px;">
                <button class="eval-btn${sz}" style="background: #4CAF50; flex: 1;" data-action="correct">✅ 正解</button>
                <button class="eval-btn${sz}" style="background: #f44336; flex: 1;" data-action="incorrect">❌ 不正解</button>
            </div>`;
        } else {
            html += `
            <div class="eval-buttons${compact}" style="display: flex; gap: ${isLarge ? '8px' : '6px'};">
                <button class="eval-btn eval-btn-a${sz}" style="flex: 1;" data-eval="A">A</button>
                <button class="eval-btn eval-btn-b${sz}" style="flex: 1;" data-eval="B">B</button>
                <button class="eval-btn eval-btn-c${sz}" style="flex: 1;" data-eval="C">C</button>
                <button class="eval-btn eval-btn-d${sz}" style="flex: 1;" data-eval="D">D</button>
                <button class="eval-btn eval-btn-e${sz}" style="flex: 1;" data-eval="E">E</button>
            </div>`;
        }
    }

    html += `</div>`;
    return html;
}

function formatQuestionText(theory) {
    return theory.questionText.replace(/\n/g, '<br>');
}

function formatAnswerText(text) {
    text = text.replace(/__([^_]+)__/g, '<u style="text-decoration: underline; font-weight: bold;">$1</u>');
    return text.replace(/\n/g, '<br>');
}

function attachEvaluationButtons(containerId) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('.eval-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const evaluation = btn.dataset.eval;
            if (action === 'correct') {
                const newEval = upgradeEvaluation(currentReviewList[currentCardIndex].evaluation);
                recordEvaluation(currentReviewList[currentCardIndex], newEval);
            } else if (action === 'incorrect') {
                const currentEval = currentReviewList[currentCardIndex].evaluation;
                let newEval;
                if (incorrectMode === 'strict') {
                    newEval = 'E';
                } else if (incorrectMode === 'gentle') {
                    newEval = currentEval; // 維持
                } else {
                    newEval = downgradeEvaluation(currentEval);
                }
                recordEvaluation(currentReviewList[currentCardIndex], newEval, incorrectMode === 'gentle');
            } else {
                recordEvaluation(currentReviewList[currentCardIndex], evaluation);
            }
        });
    });
}

function attachCardTapToggle(containerId) {
    const container = document.getElementById(containerId);
    const questionSection = container.querySelector('.question-section');
    const answerSection = container.querySelector('.answer-section');
    if (questionSection) {
        questionSection.style.cursor = 'pointer';
        questionSection.addEventListener('click', () => toggleAnswerVisibility());
    }
    if (answerSection) {
        answerSection.style.cursor = 'pointer';
        answerSection.addEventListener('click', () => toggleAnswerVisibility());
    }
}

function upgradeEvaluation(current) {
    const levels = ['E', 'D', 'C', 'B', 'A'];
    const index = levels.indexOf(current);
    if (index === -1 || index === levels.length - 1) return current;
    return levels[index + 1];
}

function downgradeEvaluation(current) {
    const levels = ['E', 'D', 'C', 'B', 'A'];
    const index = levels.indexOf(current);
    if (index === -1 || index === 0) return current;
    return levels[index - 1];
}

function recordEvaluation(theory, evaluation, gentleMode = false) {
    const today = getTodayString();
    const originalTheory = findTheoryById(theory.id);
    if (!originalTheory) return;

    const prevEval = originalTheory.evaluation;
    lastEvalAction = {
        theoryId: theory.id,
        prevEval: prevEval,
        prevNextReview: originalTheory.nextReview,
        prevLearned: originalTheory.learned,
        cardIndex: currentCardIndex
    };

    // 不正解トラッキング
    const evalOrder = ['E', 'D', 'C', 'B', 'A'];
    if (currentDisplayMode === 'today-review' && evalOrder.indexOf(evaluation) <= evalOrder.indexOf(prevEval)) {
        if (!todayIncorrectList.find(t => t.theoryId === theory.id)) {
            todayIncorrectList.push({
                theoryId: theory.id,
                subjectName: theory.subjectName,
                bookName: theory.bookName,
                chapterName: theory.chapterName,
                questionText: theory.questionText,
                answerText: theory.answerText,
                evaluation: evaluation
            });
        }
    }

    originalTheory.evaluation = evaluation;
    if (gentleMode) {
        originalTheory.nextReview = addDays(today, 1);
    } else {
        originalTheory.nextReview = addDays(today, REVIEW_INTERVALS[evaluation]);
    }
    originalTheory.learned = true;

    // 完了カウント更新
    if (currentDisplayMode === 'today-review') {
        completedTodayCount++;
        localStorage.setItem(completedTodayKey, completedTodayCount.toString());
    }

    // カード位置保持
    if (currentDisplayMode === 'today-review') {
        const nextIndex = currentCardIndex + 1;
        if (nextIndex < currentReviewList.length) {
            preserveTheoryId = currentReviewList[nextIndex].id;
        } else if (currentCardIndex > 0 && currentCardIndex - 1 < currentReviewList.length) {
            preserveTheoryId = currentReviewList[currentCardIndex - 1].id;
        }
    }

    // 学習履歴を記録
    recordStudyLog(today, evaluation, prevEval);

    cardAnimDirection = 'right';
    saveData();
    updateAllDisplays();
}

// ========================================
// 学習履歴の記録
// ========================================

function getStudyLog() {
    const saved = localStorage.getItem('studyLog');
    return saved ? JSON.parse(saved) : {};
}

function saveStudyLog(log) {
    localStorage.setItem('studyLog', JSON.stringify(log));
}

function recordStudyLog(dateStr, newEval, prevEval) {
    const log = getStudyLog();
    if (!log[dateStr]) {
        log[dateStr] = { total: 0, correct: 0, incorrect: 0 };
    }
    log[dateStr].total++;

    // 評価が上がった or 維持 = 正解、下がった = 不正解
    const evalOrder = ['E', 'D', 'C', 'B', 'A', 'S'];
    const newIdx = evalOrder.indexOf(newEval);
    const prevIdx = evalOrder.indexOf(prevEval);
    if (newIdx >= prevIdx) {
        log[dateStr].correct++;
    } else {
        log[dateStr].incorrect++;
    }

    saveStudyLog(log);
}

function undoLastEvaluation() {
    if (!lastEvalAction) return;
    const theory = findTheoryById(lastEvalAction.theoryId);
    if (!theory) { lastEvalAction = null; return; }

    theory.evaluation = lastEvalAction.prevEval;
    theory.nextReview = lastEvalAction.prevNextReview;
    theory.learned = lastEvalAction.prevLearned;

    // 完了カウント戻す
    if (completedTodayCount > 0) {
        completedTodayCount--;
        localStorage.setItem(completedTodayKey, completedTodayCount.toString());
    }

    preserveTheoryId = lastEvalAction.theoryId;
    lastEvalAction = null;
    cardAnimDirection = 'left';
    saveData();
    updateAllDisplays();
}

function findTheoryById(id) {
    for (let subject of theoryData.subjects) {
        for (let book of subject.books) {
            for (let chapter of book.chapters) {
                const theory = chapter.theories.find(t => t.id === id);
                if (theory) return theory;
            }
        }
    }
    return null;
}

// ========================================
// 全理論一覧
// ========================================

function updateFilterSubjectSelect() {
    const select = document.getElementById('filter-subject');
    if (!select) return;
    select.innerHTML = '<option value="">すべて</option>';
    theoryData.subjects.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject.name;
        option.textContent = subject.name;
        select.appendChild(option);
    });
}

function updateAllTheoriesList() {
    const activeFilter = document.querySelector('.filter-btn[data-filter].active');
    if (!activeFilter) return;
    const evalFilter = activeFilter.dataset.filter;
    const subjectEl = document.getElementById('filter-subject');
    const subjectFilter = subjectEl ? subjectEl.value : '';
    const searchQuery = (document.getElementById('theory-search')?.value || '').trim().toLowerCase();
    let theories = getAllTheories();

    if (evalFilter === 'unlearned') theories = theories.filter(t => !t.learned);
    else if (evalFilter !== 'all') theories = theories.filter(t => t.evaluation === evalFilter);
    if (subjectFilter) theories = theories.filter(t => t.subjectName === subjectFilter);
    if (searchQuery) {
        theories = theories.filter(t =>
            t.questionText.toLowerCase().includes(searchQuery) ||
            t.answerText.toLowerCase().includes(searchQuery)
        );
    }

    const container = document.getElementById('all-theories-list');
    if (!container) return;
    const countEl = document.getElementById('theory-count');
    if (countEl) {
        const allCount = getAllTheories().length;
        countEl.textContent = theories.length === allCount ? `(${allCount}問)` : `(${theories.length}/${allCount}問)`;
    }

    if (theories.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-title">該当する理論がありません</div>
                <div class="empty-state-message">フィルター条件を変更してください</div>
            </div>
        `;
        return;
    }

    const unlearnedTheories = theories.filter(t => !t.learned);
    const learnedTheories = theories.filter(t => t.learned);
    const grouped = { 'E': [], 'D': [], 'C': [], 'B': [], 'A': [] };
    learnedTheories.forEach(t => { if (grouped[t.evaluation]) grouped[t.evaluation].push(t); });

    let html = '';

    if (unlearnedTheories.length > 0) {
        html += `<h3 style="margin: 24px 0 12px; color: #95a5a6;">🆕 未習（${unlearnedTheories.length}問）</h3><div class="theory-list">`;
        unlearnedTheories.forEach(t => html += renderTheoryItem(t));
        html += '</div>';
    }

    const emojis = { 'E': '🔴', 'D': '🟠', 'C': '🟡', 'B': '🟢', 'A': '🔵' };
    ['E', 'D', 'C', 'B', 'A'].forEach(grade => {
        if (grouped[grade].length > 0) {
            html += `<h3 style="margin: 24px 0 12px; color: var(--eval-${grade.toLowerCase()});">${emojis[grade]} ${grade}評価（${grouped[grade].length}問）</h3><div class="theory-list">`;
            grouped[grade].forEach(t => html += renderTheoryItem(t));
            html += '</div>';
        }
    });

    container.innerHTML = html;
}

function renderTheoryItem(theory) {
    const learnedLabel = theory.learned ? '既習' : '未習';
    const learnedColor = theory.learned ? '#27ae60' : '#95a5a6';
    const toggleLabel = theory.learned ? '→未習' : '→既習';
    const nextReviewText = theory.nextReview ? formatDateShort(theory.nextReview) : '未設定';

    return `
        <div class="theory-item">
            <div class="theory-item-header">
                <div style="flex: 1;">
                    <div class="theory-item-path">
                        ${theory.subjectName} &gt; ${theory.bookName} &gt; ${theory.chapterName}
                        <span style="background: ${learnedColor}; color: white; padding: 1px 6px; border-radius: 3px; font-size: 0.7rem; margin-left: 4px;">${learnedLabel}</span>
                    </div>
                    <div class="theory-item-question">${theory.questionText.substring(0, 60)}${theory.questionText.length > 60 ? '...' : ''}</div>
                    <div class="theory-item-info"><span>次回: ${nextReviewText}</span></div>
                </div>
            </div>
            <div class="theory-item-actions">
                <button class="btn btn-primary btn-small" onclick="showTheoryInModal('${theory.id}')">見る</button>
                <button class="btn btn-secondary btn-small" onclick="toggleLearned('${theory.id}')">${toggleLabel}</button>
                <button class="btn btn-warning btn-small" onclick="openEditModal('${theory.id}')">✏️</button>
                <button class="btn btn-danger btn-small" onclick="deleteTheory('${theory.id}')">🗑️</button>
            </div>
        </div>
    `;
}

function toggleLearned(theoryId) {
    const theory = findTheoryById(theoryId);
    if (!theory) return;
    theory.learned = !theory.learned;
    if (theory.learned && !theory.nextReview) theory.nextReview = getTodayString();
    if (!theory.learned) theory.nextReview = null;
    saveData();
    updateAllDisplays();
}

function showTheoryInModal(theoryId) {
    const allTheories = getAllTheories();
    const theory = allTheories.find(t => t.id === theoryId);
    if (!theory) return;
    currentReviewList = [theory];
    currentCardIndex = 0;
    const modal = document.getElementById('card-modal');
    document.getElementById('modal-card-content').innerHTML = createTheoryCard(theory, true);
    modal.style.display = 'flex';
    attachEvaluationButtons('modal-card-content');
}

function closeModal() {
    document.getElementById('card-modal').style.display = 'none';
    updateAllDisplays();
}

// ========================================
// カレンダー
// ========================================

function updateCalendar() {
    const calMonth = document.getElementById('calendar-month');
    if (!calMonth) return;
    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();
    calMonth.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const adjustedFirstDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    let html = '';
    ['月', '火', '水', '木', '金', '土', '日'].forEach(day => {
        html += `<div class="calendar-header">${day}</div>`;
    });
    for (let i = 0; i < adjustedFirstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    // Calculate max review count for heat map scaling
    const dailyCounts = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDateISO(new Date(year, month, day));
        dailyCounts.push({ dateStr, count: getTodayReviewList(dateStr).length });
    }
    const maxCount = Math.max(1, ...dailyCounts.map(d => d.count));

    for (let day = 1; day <= daysInMonth; day++) {
        const { dateStr, count: reviewCount } = dailyCounts[day - 1];
        const isToday = dateStr === getTodayString();
        // Heat map: 0=none, 1-25%=light, 26-50%=medium, 51-75%=heavy, 76-100%=extreme
        let heatLevel = '';
        if (reviewCount > 0) {
            const ratio = reviewCount / maxCount;
            if (ratio <= 0.25) heatLevel = 'heat-light';
            else if (ratio <= 0.5) heatLevel = 'heat-medium';
            else if (ratio <= 0.75) heatLevel = 'heat-heavy';
            else heatLevel = 'heat-extreme';
        }
        // Check if date is in past and had study log
        const log = getStudyLog();
        const wasStudied = log[dateStr] && log[dateStr].total > 0;
        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${heatLevel} ${wasStudied ? 'was-studied' : ''}" onclick="showCalendarDetail('${dateStr}')">
                <div class="calendar-day-number">${day}</div>
                ${reviewCount > 0 ? `<div class="calendar-day-count">${reviewCount}</div>` : ''}
            </div>
        `;
    }
    document.getElementById('calendar-grid').innerHTML = html;
    document.getElementById('calendar-detail').style.display = 'none';
}

function showCalendarDetail(dateStr) {
    const reviewList = getTodayReviewList(dateStr);
    const detailContainer = document.getElementById('calendar-detail');

    if (reviewList.length === 0) {
        detailContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                <div class="empty-state-title">${formatDateJP(dateStr)}</div>
                <div class="empty-state-message">この日の復習予定はありません</div>
            </div>
        `;
        detailContainer.style.display = 'block';
        return;
    }

    currentReviewList = reviewList;
    currentCardIndex = 0;
    detailContainer.innerHTML = `
        <h3 style="margin-bottom: 16px; color: var(--primary);">
            ${formatDateJP(dateStr)} の復習予定（${reviewList.length}問）
        </h3>
        <div id="calendar-card-display"></div>
    `;
    displayCurrentCard('calendar-card-display');
    detailContainer.style.display = 'block';
    detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ========================================
// 教材管理
// ========================================

function switchManagementMode(mode) {
    document.querySelectorAll('.mode-btn-row[data-mode]').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
    document.getElementById('review-settings-mode').style.display = 'none';
    document.getElementById('register-mode').style.display = 'none';
    document.getElementById('structure-mode').style.display = 'none';
    document.getElementById('backup-mode').style.display = 'none';

    if (mode === 'review-settings') { document.getElementById('review-settings-mode').style.display = 'block'; initButtonSettings(); }
    else if (mode === 'register') { document.getElementById('register-mode').style.display = 'block'; }
    else if (mode === 'structure') { document.getElementById('structure-mode').style.display = 'block'; updateStructureList(); }
    else if (mode === 'backup') { document.getElementById('backup-mode').style.display = 'block'; updateExportFilterCount(); }
}

function switchRegisterSubTab(subMode) {
    document.querySelectorAll('.register-sub-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-register-mode="${subMode}"]`).classList.add('active');
    document.getElementById('individual-mode').style.display = subMode === 'individual' ? 'block' : 'none';
    document.getElementById('bulk-mode').style.display = subMode === 'bulk' ? 'block' : 'none';
}

function addTheory(continueAdding) {
    const subjectName = document.getElementById('subject-name').value.trim();
    const bookName = document.getElementById('book-name').value.trim();
    const chapterName = document.getElementById('chapter-name').value.trim();
    const questionText = document.getElementById('question-text').value.trim();
    const answerText = document.getElementById('answer-text').value.trim();

    if (!subjectName || !bookName || !chapterName || !questionText || !answerText) {
        showToast('すべての項目を入力してください', 'warning');
        return;
    }

    let subject = theoryData.subjects.find(s => s.name === subjectName);
    if (!subject) { subject = { name: subjectName, active: true, books: [] }; theoryData.subjects.push(subject); }
    let book = subject.books.find(b => b.name === bookName);
    if (!book) { book = { name: bookName, chapters: [] }; subject.books.push(book); }
    let chapter = book.chapters.find(c => c.name === chapterName);
    if (!chapter) { chapter = { name: chapterName, theories: [] }; book.chapters.push(chapter); }

    const registerAsLearned = document.getElementById('register-as-learned').checked;
    chapter.theories.push({
        id: generateId(),
        questionText, answerText,
        evaluation: "E",
        nextReview: registerAsLearned ? getTodayString() : null,
        learned: registerAsLearned
    });
    saveData();

    const currentSubject = document.getElementById('subject-select').value;
    const currentBook = document.getElementById('book-select').value;
    if (currentSubject && currentSubject !== '__NEW__') {
        updateBookSelector(currentSubject, 'individual');
        if (currentBook && currentBook !== '__NEW__') updateChapterSelector(currentSubject, currentBook, 'individual');
    }

    if (continueAdding) {
        document.getElementById('question-text').value = '';
        document.getElementById('answer-text').value = '';
        showToast('理論を追加しました', 'success');
        document.getElementById('question-text').focus();
    } else {
        document.getElementById('subject-select').value = '';
        document.getElementById('subject-name').value = '';
        document.getElementById('book-select').value = '';
        document.getElementById('book-select').disabled = true;
        document.getElementById('book-name').value = '';
        document.getElementById('chapter-select').value = '';
        document.getElementById('chapter-select').disabled = true;
        document.getElementById('chapter-name').value = '';
        document.getElementById('question-text').value = '';
        document.getElementById('answer-text').value = '';
        showToast('理論を追加しました', 'success');
        updateAllDisplays();
    }
}

function bulkRegisterTheories() {
    const subjectName = document.getElementById('bulk-subject-name').value.trim();
    const bookName = document.getElementById('bulk-book-name').value.trim();
    const chapterName = document.getElementById('bulk-chapter-name').value.trim();
    const bulkText = document.getElementById('bulk-input').value.trim();

    if (!subjectName || !bookName || !chapterName || !bulkText) {
        showToast('すべての項目を入力してください', 'warning');
        return;
    }

    const theories = parseBulkInput(bulkText);
    if (theories.length === 0) { showToast('正しい形式で入力してください', 'warning'); return; }

    let subject = theoryData.subjects.find(s => s.name === subjectName);
    if (!subject) { subject = { name: subjectName, active: true, books: [] }; theoryData.subjects.push(subject); }
    let book = subject.books.find(b => b.name === bookName);
    if (!book) { book = { name: bookName, chapters: [] }; subject.books.push(book); }
    let chapter = book.chapters.find(c => c.name === chapterName);
    if (!chapter) { chapter = { name: chapterName, theories: [] }; book.chapters.push(chapter); }

    const bulkRegisterAsLearned = document.getElementById('bulk-register-as-learned').checked;
    theories.forEach(t => {
        chapter.theories.push({
            id: generateId(),
            questionText: t.questionText,
            answerText: t.answerText,
            evaluation: "E",
            nextReview: bulkRegisterAsLearned ? getTodayString() : null,
            learned: bulkRegisterAsLearned
        });
    });
    saveData();

    const currentSubject = document.getElementById('bulk-subject-select').value;
    const currentBook = document.getElementById('bulk-book-select').value;
    if (currentSubject && currentSubject !== '__NEW__') {
        updateBookSelector(currentSubject, 'bulk');
        if (currentBook && currentBook !== '__NEW__') updateChapterSelector(currentSubject, currentBook, 'bulk');
    }

    document.getElementById('bulk-input').value = '';
    showToast(`${theories.length}問の理論を登録しました`, 'success');
    updateAllDisplays();
}

function parseBulkInput(text) {
    const theories = [];
    const problemBlocks = text.split(/\n---\n|^---\n|\n---$/).filter(block => block.trim());
    for (const block of problemBlocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;
        let questionText = '', answerText = '';
        if (trimmedBlock.includes('\n===\n')) {
            const parts = trimmedBlock.split('\n===\n');
            questionText = parts[0].trim();
            answerText = parts.slice(1).join('\n===\n').trim();
        } else {
            const parts = trimmedBlock.split(/\n\s*\n/);
            if (parts.length >= 2) {
                questionText = parts[0].trim();
                answerText = parts.slice(1).join('\n\n').trim();
            } else {
                questionText = trimmedBlock.trim();
            }
        }
        if (questionText) theories.push({ questionText, answerText });
    }
    return theories;
}

// ========================================
// 表示更新
// ========================================

function updateAllDisplays() {
    switch(currentDisplayMode) {
        case 'today-review': updateTodayReview(); break;
        case 'all-theories': updateAllTheoriesList(); break;
        case 'calendar': updateCalendar(); break;
    }
    updateUndoBar();
}

// ========================================
// 編集・削除
// ========================================

function openEditModal(theoryId) {
    const allTheories = getAllTheories();
    const theory = allTheories.find(t => t.id === theoryId);
    if (!theory) { showToast('理論が見つかりません', 'error'); return; }

    document.getElementById('edit-theory-id').value = theory.id;
    document.getElementById('edit-subject-name').value = theory.subjectName;
    document.getElementById('edit-book-name').value = theory.bookName;
    document.getElementById('edit-chapter-name').value = theory.chapterName;
    document.getElementById('edit-question-text').value = theory.questionText;
    document.getElementById('edit-answer-text').value = theory.answerText;
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

function saveEditedTheory() {
    const theoryId = document.getElementById('edit-theory-id').value;
    const questionText = document.getElementById('edit-question-text').value.trim();
    const answerText = document.getElementById('edit-answer-text').value.trim();

    if (!questionText || !answerText) { showToast('問題文と解答を入力してください', 'warning'); return; }

    const originalTheory = findTheoryById(theoryId);
    if (!originalTheory) { showToast('理論が見つかりません', 'error'); return; }

    originalTheory.questionText = questionText;
    originalTheory.answerText = answerText;
    saveData();
    closeEditModal();
    if (currentDisplayMode === 'today-review') preserveTheoryId = theoryId;
    updateAllDisplays();
    updateStructureList();
    showToast('理論を更新しました', 'success');
}

function deleteTheory(theoryId) {
    if (!confirm('この理論を削除しますか？')) return;
    let deleted = false;
    for (let subject of theoryData.subjects) {
        for (let book of subject.books) {
            for (let chapter of book.chapters) {
                const index = chapter.theories.findIndex(t => t.id === theoryId);
                if (index !== -1) { chapter.theories.splice(index, 1); deleted = true; break; }
            }
            if (deleted) break;
        }
        if (deleted) break;
    }
    if (deleted) { saveData(); updateAllDisplays(); showToast('削除しました', 'info'); }
}

// ========================================
// 教材構造管理
// ========================================

function openStructureEditModal(type, index, parentIndex = null, grandparentIndex = null) {
    let currentName = '', labelText = '';
    if (type === 'subject') { currentName = theoryData.subjects[index].name; labelText = '科目名:'; }
    else if (type === 'book') { currentName = theoryData.subjects[parentIndex].books[index].name; labelText = '問題集名:'; }
    else if (type === 'chapter') { currentName = theoryData.subjects[grandparentIndex].books[parentIndex].chapters[index].name; labelText = '単元名:'; }

    document.getElementById('structure-edit-type').value = type;
    document.getElementById('structure-edit-index').value = index;
    document.getElementById('structure-edit-parent-index').value = parentIndex !== null ? parentIndex : '';
    document.getElementById('structure-edit-grandparent-index').value = grandparentIndex !== null ? grandparentIndex : '';
    document.getElementById('structure-edit-label').textContent = labelText;
    document.getElementById('structure-edit-name').value = currentName;
    document.getElementById('structure-edit-modal').style.display = 'flex';
}

function closeStructureEditModal() {
    document.getElementById('structure-edit-modal').style.display = 'none';
}

function saveStructureEdit() {
    const type = document.getElementById('structure-edit-type').value;
    const index = parseInt(document.getElementById('structure-edit-index').value);
    const parentIndex = document.getElementById('structure-edit-parent-index').value;
    const grandparentIndex = document.getElementById('structure-edit-grandparent-index').value;
    const newName = document.getElementById('structure-edit-name').value.trim();
    if (!newName) { showToast('名称を入力してください', 'warning'); return; }

    if (type === 'subject') theoryData.subjects[index].name = newName;
    else if (type === 'book') theoryData.subjects[parseInt(parentIndex)].books[index].name = newName;
    else if (type === 'chapter') theoryData.subjects[parseInt(grandparentIndex)].books[parseInt(parentIndex)].chapters[index].name = newName;

    saveData();
    closeStructureEditModal();
    updateStructureList();
    updateAllDisplays();
    showToast('名称を更新しました', 'success');
}

function deleteStructure(type, index, parentIndex = null, grandparentIndex = null) {
    let itemName = '', theoryCount = 0;
    if (type === 'subject') {
        itemName = theoryData.subjects[index].name;
        theoryCount = countTheories(theoryData.subjects[index]);
    } else if (type === 'book') {
        itemName = theoryData.subjects[parentIndex].books[index].name;
        theoryCount = theoryData.subjects[parentIndex].books[index].chapters.reduce((s, c) => s + c.theories.length, 0);
    } else if (type === 'chapter') {
        itemName = theoryData.subjects[grandparentIndex].books[parentIndex].chapters[index].name;
        theoryCount = theoryData.subjects[grandparentIndex].books[parentIndex].chapters[index].theories.length;
    }
    if (!confirm(`「${itemName}」を削除しますか？\n(${theoryCount}問の理論も削除されます)`)) return;

    if (type === 'subject') theoryData.subjects.splice(index, 1);
    else if (type === 'book') theoryData.subjects[parentIndex].books.splice(index, 1);
    else if (type === 'chapter') theoryData.subjects[grandparentIndex].books[parentIndex].chapters.splice(index, 1);

    saveData();
    updateStructureList();
    updateAllDisplays();
    showToast('削除しました', 'info');
}

function updateStructureList() {
    const container = document.getElementById('structure-list');
    if (!container) return;
    const breadcrumb = document.getElementById('breadcrumb-path');

    if (currentStructurePath.length === 0) {
        breadcrumb.textContent = 'トップ';
        let html = '';
        theoryData.subjects.forEach((subject, i) => {
            const count = countTheories(subject);
            const activeLabel = subject.active === false ? ' <small style="color:#95a5a6;">(休止中)</small>' : '';
            html += `
                <div class="structure-item" style="padding: 15px; margin-bottom: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
                    <div onclick="navigateToSubject('${subject.name}')" style="flex: 1; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.3rem;">📚</span>
                        <span style="font-weight: 600;">${subject.name}${activeLabel}</span>
                        <span style="color: var(--text-light); font-size: 0.85rem;">${count}問</span>
                    </div>
                    <button class="btn btn-warning btn-small" onclick="openStructureEditModal('subject', ${i})">✏️</button>
                </div>`;
        });
        container.innerHTML = html;
    } else if (currentStructurePath.length === 1) {
        const subjectName = currentStructurePath[0];
        const subject = theoryData.subjects.find(s => s.name === subjectName);
        if (!subject) return;
        breadcrumb.innerHTML = `<a href="#" onclick="navigateToTop(); return false;" style="color: var(--accent);">トップ</a> / ${subjectName}`;
        let html = '<div style="margin-bottom: 16px;"><button class="btn btn-secondary btn-small" onclick="navigateToTop()">⬅️ 戻る</button></div>';
        const si = theoryData.subjects.findIndex(s => s.name === subjectName);
        subject.books.forEach((book, bi) => {
            const count = book.chapters.reduce((s, c) => s + c.theories.length, 0);
            html += `
                <div class="structure-item" style="padding: 15px; margin-bottom: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
                    <div onclick="navigateToBook('${book.name}')" style="flex: 1; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.3rem;">📖</span>
                        <span style="font-weight: 600;">${book.name}</span>
                        <span style="color: var(--text-light); font-size: 0.85rem;">${count}問</span>
                    </div>
                    <button class="btn btn-warning btn-small" onclick="openStructureEditModal('book', ${bi}, ${si})">✏️</button>
                </div>`;
        });
        container.innerHTML = html;
    } else if (currentStructurePath.length === 2) {
        const [subjectName, bookName] = currentStructurePath;
        const subject = theoryData.subjects.find(s => s.name === subjectName);
        if (!subject) return;
        const book = subject.books.find(b => b.name === bookName);
        if (!book) return;
        breadcrumb.innerHTML = `<a href="#" onclick="navigateToTop(); return false;" style="color: var(--accent);">トップ</a> / <a href="#" onclick="navigateToSubject('${subjectName}'); return false;" style="color: var(--accent);">${subjectName}</a> / ${bookName}`;
        let html = '<div style="margin-bottom: 16px;"><button class="btn btn-secondary btn-small" onclick="navigateBack()">⬅️ 戻る</button></div>';
        const si = theoryData.subjects.findIndex(s => s.name === subjectName);
        const bi = subject.books.findIndex(b => b.name === bookName);
        book.chapters.forEach((chapter, ci) => {
            html += `
                <div class="structure-item" style="padding: 15px; margin-bottom: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center;">
                    <div onclick="navigateToChapter('${chapter.name}')" style="flex: 1; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.3rem;">📑</span>
                        <span style="font-weight: 600;">${chapter.name}</span>
                        <span style="color: var(--text-light); font-size: 0.85rem;">${chapter.theories.length}問</span>
                    </div>
                    <button class="btn btn-warning btn-small" onclick="openStructureEditModal('chapter', ${ci}, ${bi}, ${si})">✏️</button>
                </div>`;
        });
        container.innerHTML = html;
    } else if (currentStructurePath.length === 3) {
        const [subjectName, bookName, chapterName] = currentStructurePath;
        const subject = theoryData.subjects.find(s => s.name === subjectName);
        if (!subject) return;
        const book = subject.books.find(b => b.name === bookName);
        if (!book) return;
        const chapter = book.chapters.find(c => c.name === chapterName);
        if (!chapter) return;
        breadcrumb.innerHTML = `<a href="#" onclick="navigateToTop(); return false;" style="color: var(--accent);">トップ</a> / <a href="#" onclick="navigateToSubject('${subjectName}'); return false;" style="color: var(--accent);">${subjectName}</a> / <a href="#" onclick="navigateToBook('${bookName}'); return false;" style="color: var(--accent);">${bookName}</a> / ${chapterName}`;
        let html = '<div style="margin-bottom: 16px;"><button class="btn btn-secondary btn-small" onclick="navigateBack()">⬅️ 戻る</button></div>';
        chapter.theories.forEach((theory, index) => {
            const preview = theory.questionText.substring(0, 50) + (theory.questionText.length > 50 ? '...' : '');
            html += `
                <div class="structure-item" style="padding: 15px; margin-bottom: 10px; background: white; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: var(--primary); font-size: 0.85rem;">問題 ${index + 1}</div>
                            <div style="color: var(--text-light); font-size: 0.85rem; line-height: 1.4;">${preview}</div>
                        </div>
                        <span class="eval-badge eval-${theory.evaluation.toLowerCase()}">${theory.evaluation}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-primary btn-small" style="flex: 1;" onclick="editTheoryFromStructure('${theory.id}')">✏️ 編集</button>
                        <button class="btn btn-warning btn-small" style="flex: 1;" onclick="openMoveModal('${theory.id}')">📦 移動</button>
                        <button class="btn btn-danger btn-small" style="flex: 1;" onclick="deleteTheoryFromStructure('${theory.id}')">🗑️</button>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    }
}

function navigateToTop() { currentStructurePath = []; updateStructureList(); }
function navigateBack() { currentStructurePath.pop(); updateStructureList(); }
function navigateToSubject(name) { currentStructurePath = [name]; updateStructureList(); }
function navigateToBook(name) { currentStructurePath.push(name); updateStructureList(); }
function navigateToChapter(name) { currentStructurePath.push(name); updateStructureList(); }
function countTheories(subject) { let c = 0; subject.books.forEach(b => b.chapters.forEach(ch => c += ch.theories.length)); return c; }
function editTheoryFromStructure(id) { openEditModal(id); }
function deleteTheoryFromStructure(id) { if (!confirm('この理論を削除しますか？')) return; deleteTheory(id); updateStructureList(); }

// ========================================
// 問題移動
// ========================================

function openMoveModal(theoryId) {
    const theory = findTheoryById(theoryId);
    if (!theory) return;
    document.getElementById('move-theory-id').value = theoryId;
    const preview = theory.questionText.substring(0, 80) + (theory.questionText.length > 80 ? '...' : '');
    document.getElementById('move-theory-preview').innerHTML = `<strong>移動する問題：</strong><br>${preview.replace(/\n/g, '<br>')}`;
    const subjectSelect = document.getElementById('move-subject-select');
    subjectSelect.innerHTML = '<option value="">-- 科目を選択 --</option>';
    theoryData.subjects.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; subjectSelect.appendChild(o); });
    document.getElementById('move-book-select').innerHTML = '<option value="">-- 問題集を選択 --</option>';
    document.getElementById('move-book-select').disabled = true;
    document.getElementById('move-chapter-select').innerHTML = '<option value="">-- 単元を選択 --</option>';
    document.getElementById('move-chapter-select').disabled = true;
    document.getElementById('move-modal').style.display = 'flex';
}

function closeMoveModal() { document.getElementById('move-modal').style.display = 'none'; }

function onMoveSubjectChange(value) {
    const bookSelect = document.getElementById('move-book-select');
    const chapterSelect = document.getElementById('move-chapter-select');
    bookSelect.innerHTML = '<option value="">-- 問題集を選択 --</option>';
    chapterSelect.innerHTML = '<option value="">-- 単元を選択 --</option>';
    chapterSelect.disabled = true;
    if (!value) { bookSelect.disabled = true; return; }
    const subject = theoryData.subjects.find(s => s.name === value);
    if (!subject) return;
    subject.books.forEach(b => { const o = document.createElement('option'); o.value = b.name; o.textContent = b.name; bookSelect.appendChild(o); });
    bookSelect.disabled = false;
}

function onMoveBookChange(value) {
    const subjectName = document.getElementById('move-subject-select').value;
    const chapterSelect = document.getElementById('move-chapter-select');
    chapterSelect.innerHTML = '<option value="">-- 単元を選択 --</option>';
    if (!value || !subjectName) { chapterSelect.disabled = true; return; }
    const subject = theoryData.subjects.find(s => s.name === subjectName);
    const book = subject && subject.books.find(b => b.name === value);
    if (!book) return;
    book.chapters.forEach(ch => { const o = document.createElement('option'); o.value = ch.name; o.textContent = ch.name; chapterSelect.appendChild(o); });
    chapterSelect.disabled = false;
}

function saveTheoryMove() {
    const theoryId = document.getElementById('move-theory-id').value;
    const targetSubjectName = document.getElementById('move-subject-select').value;
    const targetBookName = document.getElementById('move-book-select').value;
    const targetChapterName = document.getElementById('move-chapter-select').value;
    if (!targetSubjectName || !targetBookName || !targetChapterName) { showToast('移動先を選択してください', 'warning'); return; }

    let theory = null, sourceChapter = null;
    for (const subject of theoryData.subjects) {
        for (const book of subject.books) {
            for (const chapter of book.chapters) {
                const idx = chapter.theories.findIndex(t => t.id === theoryId);
                if (idx !== -1) { theory = chapter.theories.splice(idx, 1)[0]; sourceChapter = chapter; break; }
            }
            if (theory) break;
        }
        if (theory) break;
    }
    if (!theory) { showToast('問題が見つかりません', 'error'); return; }

    const targetSubject = theoryData.subjects.find(s => s.name === targetSubjectName);
    const targetBook = targetSubject && targetSubject.books.find(b => b.name === targetBookName);
    const targetChapter = targetBook && targetBook.chapters.find(c => c.name === targetChapterName);
    if (!targetChapter) { sourceChapter.theories.push(theory); showToast('移動先が見つかりません', 'error'); return; }
    if (targetChapter === sourceChapter) { sourceChapter.theories.push(theory); showToast('移動元と同じです', 'warning'); return; }

    targetChapter.theories.push(theory);
    saveData();
    closeMoveModal();
    updateStructureList();
    updateAllDisplays();
    showToast(`「${targetChapterName}」に移動しました`, 'success');
}

// ========================================
// セレクター
// ========================================

function updateSubjectSelectors() {
    const subjects = theoryData.subjects.map(s => s.name);
    updateSelector('subject-select', subjects);
    updateSelector('bulk-subject-select', subjects);
}

function updateBookSelector(subjectName, mode) {
    const prefix = mode === 'bulk' ? 'bulk-' : '';
    const subject = theoryData.subjects.find(s => s.name === subjectName);
    if (!subject) {
        document.getElementById(prefix + 'book-select').disabled = true;
        document.getElementById(prefix + 'book-select').innerHTML = '<option value="">-- 問題集を選択 --</option>';
        document.getElementById(prefix + 'chapter-select').disabled = true;
        document.getElementById(prefix + 'chapter-select').innerHTML = '<option value="">-- 単元を選択 --</option>';
        return;
    }
    updateSelector(prefix + 'book-select', subject.books.map(b => b.name));
    document.getElementById(prefix + 'book-select').disabled = false;
    document.getElementById(prefix + 'chapter-select').disabled = true;
    document.getElementById(prefix + 'chapter-select').innerHTML = '<option value="">-- 単元を選択 --</option>';
}

function updateChapterSelector(subjectName, bookName, mode) {
    const prefix = mode === 'bulk' ? 'bulk-' : '';
    const subject = theoryData.subjects.find(s => s.name === subjectName);
    if (!subject) return;
    const book = subject.books.find(b => b.name === bookName);
    if (!book) { document.getElementById(prefix + 'chapter-select').disabled = true; return; }
    updateSelector(prefix + 'chapter-select', book.chapters.map(c => c.name));
    document.getElementById(prefix + 'chapter-select').disabled = false;
}

function updateSelector(selectId, items) {
    const select = document.getElementById(selectId);
    const currentValue = select.value;
    select.innerHTML = '<option value="">-- 選択 --</option>';
    items.forEach(item => { const o = document.createElement('option'); o.value = item; o.textContent = item; select.appendChild(o); });
    const newOption = document.createElement('option');
    newOption.value = '__NEW__';
    newOption.textContent = '➕ 新規作成...';
    select.appendChild(newOption);
    if (items.includes(currentValue)) select.value = currentValue;
}

function onSubjectSelectChange(value, mode) {
    const prefix = mode === 'bulk' ? 'bulk-' : '';
    const subjectInput = document.getElementById(prefix + 'subject-name');
    const bookSelect = document.getElementById(prefix + 'book-select');
    const bookInput = document.getElementById(prefix + 'book-name');
    const chapterSelect = document.getElementById(prefix + 'chapter-select');
    const chapterInput = document.getElementById(prefix + 'chapter-name');

    if (value === '__NEW__') {
        subjectInput.style.display = 'block'; subjectInput.value = ''; subjectInput.focus();
        bookSelect.disabled = true; bookSelect.innerHTML = '<option value="">-- 問題集を選択 --</option>';
        bookInput.style.display = 'block'; bookInput.value = '';
        chapterSelect.disabled = true; chapterSelect.innerHTML = '<option value="">-- 単元を選択 --</option>';
        chapterInput.style.display = 'block'; chapterInput.value = '';
    } else if (value) {
        subjectInput.style.display = 'none'; subjectInput.value = value;
        updateBookSelector(value, mode);
        bookInput.style.display = 'none'; bookInput.value = '';
        chapterInput.style.display = 'none'; chapterInput.value = '';
    } else {
        subjectInput.style.display = 'none'; subjectInput.value = '';
        bookSelect.disabled = true; bookInput.style.display = 'none'; bookInput.value = '';
        chapterSelect.disabled = true; chapterInput.style.display = 'none'; chapterInput.value = '';
    }
}

function onBookSelectChange(value, mode) {
    const prefix = mode === 'bulk' ? 'bulk-' : '';
    const subjectSelect = document.getElementById(prefix + 'subject-select');
    const subjectInput = document.getElementById(prefix + 'subject-name');
    const bookInput = document.getElementById(prefix + 'book-name');
    const chapterSelect = document.getElementById(prefix + 'chapter-select');
    const chapterInput = document.getElementById(prefix + 'chapter-name');
    const subjectName = subjectSelect.value === '__NEW__' ? subjectInput.value.trim() : subjectSelect.value;

    if (value === '__NEW__') {
        bookInput.style.display = 'block'; bookInput.value = ''; bookInput.focus();
        chapterSelect.disabled = true; chapterSelect.innerHTML = '<option value="">-- 単元を選択 --</option>';
        chapterInput.style.display = 'block'; chapterInput.value = '';
    } else if (value) {
        bookInput.style.display = 'none'; bookInput.value = value;
        updateChapterSelector(subjectName, value, mode);
        chapterInput.style.display = 'none'; chapterInput.value = '';
    } else {
        bookInput.style.display = 'none'; bookInput.value = '';
        chapterSelect.disabled = true; chapterInput.style.display = 'none'; chapterInput.value = '';
    }
}

function onChapterSelectChange(value, mode) {
    const prefix = mode === 'bulk' ? 'bulk-' : '';
    const chapterInput = document.getElementById(prefix + 'chapter-name');
    if (value === '__NEW__') { chapterInput.style.display = 'block'; chapterInput.value = ''; chapterInput.focus(); }
    else if (value) { chapterInput.style.display = 'none'; chapterInput.value = value; }
    else { chapterInput.style.display = 'none'; chapterInput.value = ''; }
}

// ========================================
// 設定・トグル
// ========================================

function resetAllEvaluations() {
    if (!confirm('すべての理論の評価を「E」にリセットしますか？\nこの操作は取り消せません。')) return;
    const today = getTodayString();
    let count = 0;
    theoryData.subjects.forEach(s => s.books.forEach(b => b.chapters.forEach(c => c.theories.forEach(t => {
        t.evaluation = 'E'; t.nextReview = today; count++;
    }))));
    saveData();
    updateAllDisplays();
    showToast(`${count}問をEにリセットしました`, 'info');
}

function bulkUnlearnByEvaluation(evalGrade) {
    let count = 0;
    theoryData.subjects.forEach(s => s.books.forEach(b => b.chapters.forEach(c => c.theories.forEach(t => {
        if (t.evaluation === evalGrade && t.learned !== false) count++;
    }))));
    if (count === 0) { showToast(`${evalGrade}評価の既習理論はありません`, 'info'); return; }
    if (!confirm(`${evalGrade}評価の既習理論 ${count}問 を未習にしますか？`)) return;
    theoryData.subjects.forEach(s => s.books.forEach(b => b.chapters.forEach(c => c.theories.forEach(t => {
        if (t.evaluation === evalGrade && t.learned !== false) { t.learned = false; t.nextReview = null; }
    }))));
    saveData();
    updateAllDisplays();
    showToast(`${count}問を未習にしました`, 'success');
}

function toggleRandomOrder() {
    isRandomOrder = !isRandomOrder;
    const btn = document.getElementById('toggle-random-btn');
    if (isRandomOrder) { btn.textContent = '🔀 ランダム: ON'; btn.classList.remove('btn-secondary'); btn.classList.add('btn-success'); }
    else { btn.textContent = '🔀 ランダム'; btn.classList.remove('btn-success'); btn.classList.add('btn-secondary'); }
    updateTodayReview();
}

function toggleAnswerVisibility() {
    isAnswerVisible = !isAnswerVisible;
    const answerSection = document.getElementById('answer-section-display');
    if (isAnswerVisible) {
        if (answerSection) {
            answerSection.style.display = 'block';
            answerSection.classList.add('answer-reveal');
            answerSection.addEventListener('animationend', () => answerSection.classList.remove('answer-reveal'), { once: true });
        }
    } else {
        if (answerSection) answerSection.style.display = 'none';
    }
}


function setEvalMode(mode) {
    evalMode = mode;
    localStorage.setItem('evalMode', mode);
    document.getElementById('eval-mode-simple-btn').className = 'btn btn-small ' + (mode === 'simple' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('eval-mode-detail-btn').className = 'btn btn-small ' + (mode === 'detail' ? 'btn-primary' : 'btn-secondary');
    if (currentDisplayMode === 'today-review') { preserveTheoryId = currentReviewList[currentCardIndex]?.id || null; updateTodayReview(); }
}

function setBtnSize(size) {
    evalBtnSize = size;
    localStorage.setItem('evalBtnSize', size);
    document.getElementById('btn-size-small-btn').className = 'btn btn-small ' + (size === 'small' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('btn-size-large-btn').className = 'btn btn-small ' + (size === 'large' ? 'btn-primary' : 'btn-secondary');
    if (currentDisplayMode === 'today-review') { preserveTheoryId = currentReviewList[currentCardIndex]?.id || null; updateTodayReview(); }
}

function setIncorrectMode(mode) {
    incorrectMode = mode;
    localStorage.setItem('incorrectMode', mode);
    initIncorrectModeButtons();
}

function initIncorrectModeButtons() {
    const modes = ['strict', 'normal', 'gentle'];
    modes.forEach(m => {
        const btn = document.getElementById('incorrect-mode-' + m);
        if (btn) btn.className = 'btn btn-small ' + (incorrectMode === m ? 'btn-primary' : 'btn-secondary');
    });
}

function initButtonSettings() {
    document.getElementById('eval-mode-simple-btn').className = 'btn btn-small ' + (evalMode === 'simple' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('eval-mode-detail-btn').className = 'btn btn-small ' + (evalMode === 'detail' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('btn-size-small-btn').className = 'btn btn-small ' + (evalBtnSize === 'small' ? 'btn-primary' : 'btn-secondary');
    document.getElementById('btn-size-large-btn').className = 'btn btn-small ' + (evalBtnSize === 'large' ? 'btn-primary' : 'btn-secondary');
    initIncorrectModeButtons();
}

function updateUndoBar() {
    const btn = document.getElementById('undo-eval-btn');
    if (!btn) return;
    if (lastEvalAction && currentDisplayMode === 'today-review') {
        const theory = findTheoryById(lastEvalAction.theoryId);
        if (theory) { btn.disabled = false; btn.textContent = '↩️ 戻る'; return; }
    }
    btn.disabled = true;
    btn.textContent = '↩️ 戻る';
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ========================================
// 今日の不正解復習
// ========================================

function displayIncorrectReview() {
    const container = document.getElementById('incorrect-review-content');
    const totalEl = document.getElementById('incorrect-total');
    todayIncorrectList.forEach(item => {
        const theory = findTheoryById(item.theoryId);
        if (theory) item.evaluation = theory.evaluation;
    });
    totalEl.textContent = todayIncorrectList.length;

    if (todayIncorrectList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✨</div>
                <div class="empty-state-title">不正解の問題はありません</div>
                <div class="empty-state-message">今日の復習で評価が上がらなかった問題がここに表示されます。</div>
            </div>
        `;
        return;
    }

    if (incorrectCardIndex >= todayIncorrectList.length) incorrectCardIndex = 0;
    const item = todayIncorrectList[incorrectCardIndex];
    const theory = findTheoryById(item.theoryId);
    const currentEval = theory ? theory.evaluation : item.evaluation;

    container.innerHTML = `
        <div class="theory-card">
            <div class="card-header">
                <div class="card-path">${item.subjectName} &gt; ${item.bookName} &gt; ${item.chapterName}</div>
                <div class="card-number">No.${incorrectCardIndex + 1} / ${todayIncorrectList.length}</div>
            </div>
            <div class="question-section">
                <h4>【問題】</h4>
                <p>${formatQuestionText(item)}</p>
            </div>
            <div class="answer-section">
                <h4>【解答】</h4>
                <p>${formatAnswerText(item.answerText)}</p>
            </div>
            <div class="card-info">
                <div class="current-eval">
                    現在：<span class="eval-badge eval-${currentEval.toLowerCase()}">${currentEval}</span>
                </div>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button class="btn btn-secondary" style="flex: 1;" onclick="incorrectCardIndex = Math.max(0, incorrectCardIndex - 1); displayIncorrectReview();">◀ 前</button>
                <button class="btn btn-primary" style="flex: 1;" onclick="incorrectCardIndex++; displayIncorrectReview();">次 ▶</button>
            </div>
        </div>
    `;
}

// ========================================
// CSV エクスポート / インポート
// ========================================

function escapeCSVField(value) {
    const str = String(value == null ? '' : value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) return '"' + str.replace(/"/g, '""') + '"';
    return str;
}

function setExportFilter(evaluations) {
    document.querySelectorAll('.export-eval-filter').forEach(cb => cb.checked = evaluations.includes(cb.value));
    updateExportFilterCount();
}

function updateExportFilterCount() {
    const selected = getSelectedExportEvaluations();
    let count = 0;
    theoryData.subjects.forEach(s => s.books.forEach(b => b.chapters.forEach(c => c.theories.forEach(t => {
        if (selected.includes(t.evaluation || 'E')) count++;
    }))));
    const el = document.getElementById('export-filter-count');
    if (el) el.textContent = `対象: ${count}問`;
}

function getSelectedExportEvaluations() {
    return Array.from(document.querySelectorAll('.export-eval-filter:checked')).map(cb => cb.value);
}

function exportCSV() {
    if (theoryData.subjects.length === 0) { showToast('データがありません', 'warning'); return; }
    const selectedEvals = getSelectedExportEvaluations();
    if (selectedEvals.length === 0) { showToast('評価を選択してください', 'warning'); return; }

    const headers = ['科目', '問題集', '単元', '問題文', '解答', '評価', '次回復習日', '習得状態'];
    const rows = [headers];
    theoryData.subjects.forEach(subject => subject.books.forEach(book => book.chapters.forEach(chapter => chapter.theories.forEach(theory => {
        const ev = theory.evaluation || 'E';
        if (selectedEvals.includes(ev)) {
            rows.push([subject.name, book.name, chapter.name, theory.questionText, theory.answerText, ev, theory.nextReview || '', theory.learned === false ? '未習' : '既習']);
        }
    }))));

    if (rows.length <= 1) { showToast('該当する問題がありません', 'warning'); return; }

    const csvContent = rows.map(row => row.map(escapeCSVField).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const filterLabel = selectedEvals.length === 5 ? 'all' : selectedEvals.join('');
    const filename = `anki_master_${filterLabel}_${getTodayString()}.csv`;

    // iOS Safari: try share API first, then fallback to download link
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
        navigator.share({ files: [new File([blob], filename, { type: 'text/csv' })], title: filename })
            .then(() => showToast(`${rows.length - 1}問をエクスポートしました`, 'success'))
            .catch(() => {});
    } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast(`${rows.length - 1}問をエクスポートしました`, 'success');
    }
}

function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') { field += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else field += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\r' && next === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
            else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
            else field += ch;
        }
    }
    if (row.length > 0 || field !== '') { row.push(field); rows.push(row); }
    if (rows.length > 0 && rows[rows.length - 1].every(f => f === '')) rows.pop();
    return rows;
}

function importCSV(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let text = e.target.result;
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const rows = parseCSV(text);
            if (rows.length < 2) { showToast('データが見つかりません', 'error'); return; }
            const header = rows[0];
            if (header[0] !== '科目' || header[3] !== '問題文') { showToast('CSVフォーマットが不正です', 'error'); return; }
            const dataRows = rows.slice(1).filter(row => row.some(f => f.trim() !== ''));
            const importMode = document.querySelector('input[name="csv-import-mode"]:checked').value;
            if (!confirm(`【${importMode === 'replace' ? '完全置き換え' : '追加'}】${dataRows.length}行をインポートしますか？`)) return;
            if (importMode === 'replace') theoryData = { subjects: [] };

            const today = getTodayString();
            let addedCount = 0, skippedCount = 0;
            dataRows.forEach(row => {
                const subjectName = (row[0] || '').trim(), bookName = (row[1] || '').trim(), chapterName = (row[2] || '').trim();
                const questionText = (row[3] || '').trim(), answerText = (row[4] || '').trim();
                const evaluation = (row[5] || '').trim().toUpperCase(), nextReview = (row[6] || '').trim();
                if (!subjectName || !bookName || !chapterName || !questionText) { skippedCount++; return; }

                let subject = theoryData.subjects.find(s => s.name === subjectName);
                if (!subject) { subject = { name: subjectName, active: true, books: [] }; theoryData.subjects.push(subject); }
                let book = subject.books.find(b => b.name === bookName);
                if (!book) { book = { name: bookName, chapters: [] }; subject.books.push(book); }
                let chapter = book.chapters.find(c => c.name === chapterName);
                if (!chapter) { chapter = { name: chapterName, theories: [] }; book.chapters.push(chapter); }

                if (importMode === 'merge' && chapter.theories.some(t => t.questionText === questionText)) { skippedCount++; return; }

                const validEval = ['S', 'A', 'B', 'C', 'D', 'E'].includes(evaluation) ? evaluation : 'E';
                const learnedStatus = (row[7] || '').trim();
                const isLearned = learnedStatus !== '未習';
                chapter.theories.push({
                    id: generateId(), questionText, answerText, evaluation: validEval,
                    nextReview: isLearned ? (/^\d{4}-\d{2}-\d{2}$/.test(nextReview) ? nextReview : today) : null,
                    learned: isLearned
                });
                addedCount++;
            });

            saveData();
            updateAllDisplays();
            let msg = `${addedCount}問をインポートしました`;
            if (skippedCount > 0) msg += `（${skippedCount}件スキップ）`;
            showToast(msg, 'success');
            document.getElementById('import-csv-input').value = '';
        } catch (error) {
            showToast('CSVの読み込みに失敗しました', 'error');
            console.error('CSV import error:', error);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

// ========================================
// 統計ダッシュボード
// ========================================

function updateStatistics() {
    const log = getStudyLog();
    const today = getTodayString();
    const theories = getAllTheories();

    // 過去30日の日付リスト
    const last30 = [];
    for (let i = 29; i >= 0; i--) {
        last30.push(addDays(today, -i));
    }

    // --- サマリー ---
    updateStatsStreak(log, today);
    updateStatsTotals(log, last30);

    // --- 日別学習量バーチャート ---
    renderDailyChart(log, last30);

    // --- 正答率推移ラインチャート ---
    renderAccuracyChart(log, last30);

    // --- 評価分布 ---
    renderEvalDistribution(theories);

    // --- 科目別定着率 ---
    renderSubjectProgress();
}

function updateStatsStreak(log, today) {
    let streak = 0;
    let checkDate = today;
    // 今日まだ学習していない場合は昨日から数える
    if (!log[checkDate] || log[checkDate].total === 0) {
        checkDate = addDays(today, -1);
    }
    while (log[checkDate] && log[checkDate].total > 0) {
        streak++;
        checkDate = addDays(checkDate, -1);
    }
    document.getElementById('stats-streak').textContent = streak;
}

function updateStatsTotals(log, last30) {
    let totalReviews = 0;
    let activeDays = 0;
    Object.values(log).forEach(day => { totalReviews += day.total; });
    last30.forEach(d => { if (log[d] && log[d].total > 0) activeDays++; });
    const avg = activeDays > 0 ? Math.round(totalReviews / Object.keys(log).length) : 0;
    document.getElementById('stats-total-reviews').textContent = totalReviews.toLocaleString();
    document.getElementById('stats-avg-daily').textContent = avg;
}

function renderDailyChart(log, last30) {
    const container = document.getElementById('stats-daily-chart');
    const maxVal = Math.max(1, ...last30.map(d => (log[d] ? log[d].total : 0)));

    let html = '<div class="bar-chart">';
    last30.forEach((d, i) => {
        const val = log[d] ? log[d].total : 0;
        const height = Math.round((val / maxVal) * 100);
        const dateObj = new Date(d);
        const label = (dateObj.getMonth() + 1) + '/' + dateObj.getDate();
        const showLabel = (i % 5 === 0 || i === 29);
        html += `<div class="bar-col" title="${label}: ${val}問">
            <div class="bar-value">${val > 0 ? val : ''}</div>
            <div class="bar" style="height: ${height}%"></div>
            <div class="bar-label">${showLabel ? label : ''}</div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

function renderAccuracyChart(log, last30) {
    const container = document.getElementById('stats-accuracy-chart');
    const points = [];
    last30.forEach(d => {
        if (log[d] && log[d].total > 0) {
            points.push({ date: d, rate: Math.round((log[d].correct / log[d].total) * 100) });
        }
    });

    if (points.length === 0) {
        container.innerHTML = '<p class="stats-empty">まだデータがありません。復習を始めると正答率が表示されます。</p>';
        return;
    }

    // SVG line chart
    const width = 600;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const xStep = points.length > 1 ? chartW / (points.length - 1) : chartW / 2;

    let pathD = '';
    let dots = '';
    points.forEach((p, i) => {
        const x = padding.left + (points.length > 1 ? i * xStep : chartW / 2);
        const y = padding.top + chartH - (p.rate / 100) * chartH;
        if (i === 0) pathD += `M ${x} ${y}`;
        else pathD += ` L ${x} ${y}`;
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="var(--primary)" />`;
    });

    // Grid lines
    let grid = '';
    [0, 25, 50, 75, 100].forEach(v => {
        const y = padding.top + chartH - (v / 100) * chartH;
        grid += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;
        grid += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${v}%</text>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="accuracy-svg">
        ${grid}
        <path d="${pathD}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
    </svg>`;
}

function renderEvalDistribution(theories) {
    const container = document.getElementById('stats-eval-distribution');
    const learnedTheories = theories.filter(t => t.learned);
    const counts = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
    learnedTheories.forEach(t => {
        if (counts[t.evaluation] !== undefined) counts[t.evaluation]++;
    });
    const total = learnedTheories.length || 1;
    const unlearnedCount = theories.length - learnedTheories.length;

    const colors = {
        S: 'var(--eval-s, #FFD700)', A: 'var(--eval-a, #4CAF50)', B: 'var(--eval-b, #2196F3)',
        C: 'var(--eval-c, #FF9800)', D: 'var(--eval-d, #f44336)', E: 'var(--eval-e, #9E9E9E)'
    };

    let html = '<div class="eval-dist-bars">';
    ['S', 'A', 'B', 'C', 'D', 'E'].forEach(eval_ => {
        const pct = Math.round((counts[eval_] / total) * 100);
        html += `<div class="eval-dist-row">
            <span class="eval-dist-label">${eval_}</span>
            <div class="eval-dist-bar-bg">
                <div class="eval-dist-bar-fill" style="width: ${pct}%; background: ${colors[eval_]}"></div>
            </div>
            <span class="eval-dist-count">${counts[eval_]}問 (${pct}%)</span>
        </div>`;
    });
    if (unlearnedCount > 0) {
        html += `<div class="eval-dist-row">
            <span class="eval-dist-label">未</span>
            <div class="eval-dist-bar-bg">
                <div class="eval-dist-bar-fill" style="width: ${Math.round((unlearnedCount / theories.length) * 100)}%; background: #ddd"></div>
            </div>
            <span class="eval-dist-count">${unlearnedCount}問</span>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function renderSubjectProgress() {
    const container = document.getElementById('stats-subject-progress');
    let html = '';

    theoryData.subjects.forEach(subject => {
        if (!subject.active) return;
        let total = 0, mastered = 0, learning = 0;
        subject.books.forEach(book => {
            book.chapters.forEach(chapter => {
                chapter.theories.forEach(theory => {
                    total++;
                    if (['S', 'A'].includes(theory.evaluation) && theory.learned) mastered++;
                    else if (theory.learned) learning++;
                });
            });
        });
        const masteredPct = total > 0 ? Math.round((mastered / total) * 100) : 0;
        const learningPct = total > 0 ? Math.round((learning / total) * 100) : 0;

        html += `<div class="subject-progress-row">
            <div class="subject-progress-header">
                <span class="subject-progress-name">${subject.name}</span>
                <span class="subject-progress-detail">${mastered + learning}/${total}問 学習済み</span>
            </div>
            <div class="subject-progress-bar">
                <div class="subject-progress-mastered" style="width: ${masteredPct}%" title="定着 (S/A): ${mastered}問"></div>
                <div class="subject-progress-learning" style="width: ${learningPct}%" title="学習中 (B-E): ${learning}問"></div>
            </div>
            <div class="subject-progress-labels">
                <span>定着 ${masteredPct}%</span>
                <span>学習中 ${learningPct}%</span>
            </div>
        </div>`;
    });

    if (!html) html = '<p class="stats-empty">アクティブな科目がありません。</p>';
    container.innerHTML = html;
}

// ========================================
// Test Mode
// ========================================

function setupTestSelectors() {
    const subjectSelect = document.getElementById('test-subject-select');
    subjectSelect.innerHTML = '<option value="">すべて</option>';
    theoryData.subjects.forEach(s => {
        const o = document.createElement('option');
        o.value = s.name;
        o.textContent = s.name;
        subjectSelect.appendChild(o);
    });
    document.getElementById('test-book-select').innerHTML = '<option value="">すべて</option>';
    document.getElementById('test-book-select').disabled = true;
    document.getElementById('test-chapter-select').innerHTML = '<option value="">すべて</option>';
    document.getElementById('test-chapter-select').disabled = true;
    updateTestAvailableCount();
}

function onTestSubjectChange() {
    const value = document.getElementById('test-subject-select').value;
    const bookSelect = document.getElementById('test-book-select');
    const chapterSelect = document.getElementById('test-chapter-select');
    bookSelect.innerHTML = '<option value="">すべて</option>';
    chapterSelect.innerHTML = '<option value="">すべて</option>';
    chapterSelect.disabled = true;
    if (!value) { bookSelect.disabled = true; updateTestAvailableCount(); return; }
    const subject = theoryData.subjects.find(s => s.name === value);
    if (!subject) { bookSelect.disabled = true; return; }
    subject.books.forEach(b => {
        const o = document.createElement('option');
        o.value = b.name;
        o.textContent = b.name;
        bookSelect.appendChild(o);
    });
    bookSelect.disabled = false;
    updateTestAvailableCount();
}

function onTestBookChange() {
    const subjectName = document.getElementById('test-subject-select').value;
    const bookName = document.getElementById('test-book-select').value;
    const chapterSelect = document.getElementById('test-chapter-select');
    chapterSelect.innerHTML = '<option value="">すべて</option>';
    if (!bookName || !subjectName) { chapterSelect.disabled = true; updateTestAvailableCount(); return; }
    const subject = theoryData.subjects.find(s => s.name === subjectName);
    const book = subject && subject.books.find(b => b.name === bookName);
    if (!book) { chapterSelect.disabled = true; return; }
    book.chapters.forEach(ch => {
        const o = document.createElement('option');
        o.value = ch.name;
        o.textContent = ch.name;
        chapterSelect.appendChild(o);
    });
    chapterSelect.disabled = false;
    updateTestAvailableCount();
}

function getTestCandidates() {
    const subjectName = document.getElementById('test-subject-select').value;
    const bookName = document.getElementById('test-book-select').value;
    const chapterName = document.getElementById('test-chapter-select').value;
    let theories = getAllTheories();
    theories = theories.filter(t => t.learned);
    if (subjectName) theories = theories.filter(t => t.subjectName === subjectName);
    if (bookName) theories = theories.filter(t => t.bookName === bookName);
    if (chapterName) theories = theories.filter(t => t.chapterName === chapterName);
    return theories;
}

function updateTestAvailableCount() {
    const candidates = getTestCandidates();
    const el = document.getElementById('test-available-count');
    if (el) el.textContent = `出題可能: ${candidates.length}問（既習のみ）`;
}

function startTest() {
    const candidates = getTestCandidates();
    if (candidates.length === 0) {
        showToast('出題できる問題がありません。既習の問題を登録してください。', 'warning');
        return;
    }

    const countMode = document.getElementById('test-count-mode').value;
    const isRandom = document.getElementById('test-random').checked;
    let questions = [...candidates];

    if (isRandom) shuffleArray(questions);

    if (countMode === 'custom') {
        const count = Math.max(1, parseInt(document.getElementById('test-count-input').value) || 20);
        questions = questions.slice(0, count);
    }

    testQuestions = questions;
    testCurrentIndex = 0;
    testResults = [];
    testIsAnswerVisible = false;

    document.getElementById('test-setup-area').style.display = 'none';
    document.getElementById('test-execution-area').style.display = 'block';
    document.getElementById('test-result-area').style.display = 'none';

    displayTestCard();
}

function displayTestCard() {
    if (testCurrentIndex >= testQuestions.length) {
        showTestResults();
        return;
    }

    const theory = testQuestions[testCurrentIndex];
    const total = testQuestions.length;
    testIsAnswerVisible = false;

    document.getElementById('test-progress-text').textContent = `No.${testCurrentIndex + 1} / ${total}`;
    const pct = Math.round((testCurrentIndex / total) * 100);
    document.getElementById('test-progress-fill').style.width = pct + '%';

    const container = document.getElementById('test-card-display');
    container.innerHTML = `
        <div class="theory-card">
            <div class="card-header">
                <div class="card-path">${theory.subjectName} &gt; ${theory.bookName} &gt; ${theory.chapterName}</div>
                <div class="card-number">No.${testCurrentIndex + 1} / ${total}</div>
            </div>
            <div class="question-section" id="test-question-section" style="cursor: pointer;">
                <h4>【問題】</h4>
                <p>${formatQuestionText(theory)}</p>
            </div>
            <div class="answer-section" id="test-answer-section" style="display: none;">
                <h4>【解答】</h4>
                <p>${formatAnswerText(theory.answerText)}</p>
            </div>
            <div class="card-info">
                <div class="current-eval">
                    現在：<span class="eval-badge eval-${theory.evaluation.toLowerCase()}">${theory.evaluation}</span>
                </div>
            </div>
        </div>
    `;

    // Tap to toggle answer
    const questionSection = document.getElementById('test-question-section');
    const answerSection = document.getElementById('test-answer-section');
    const toggleTestAnswer = () => {
        testIsAnswerVisible = !testIsAnswerVisible;
        if (testIsAnswerVisible) {
            answerSection.style.display = 'block';
            answerSection.classList.add('answer-reveal');
            answerSection.addEventListener('animationend', () => answerSection.classList.remove('answer-reveal'), { once: true });
        } else {
            answerSection.style.display = 'none';
        }
    };
    questionSection.addEventListener('click', toggleTestAnswer);
    answerSection.style.cursor = 'pointer';
    answerSection.addEventListener('click', toggleTestAnswer);
}

function recordTestAnswer(correct) {
    testResults.push({
        theory: testQuestions[testCurrentIndex],
        correct: correct
    });
    testCurrentIndex++;
    displayTestCard();
}

function abortTest() {
    if (!confirm('テストを中止しますか？')) return;
    document.getElementById('test-setup-area').style.display = 'block';
    document.getElementById('test-execution-area').style.display = 'none';
    document.getElementById('test-result-area').style.display = 'none';
}

function showTestResults() {
    document.getElementById('test-execution-area').style.display = 'none';
    document.getElementById('test-result-area').style.display = 'block';

    const total = testResults.length;
    const correctCount = testResults.filter(r => r.correct).length;
    const incorrectCount = total - correctCount;
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    let html = '';

    // Score
    html += `
        <div class="test-result-score">
            <div class="score-number">${pct}%</div>
            <div class="score-label">正答率</div>
            <div class="score-detail">${correctCount}問正解 / ${total}問中</div>
        </div>
    `;

    // Eval breakdown bar chart
    const evalGroups = {};
    testResults.forEach(r => {
        const ev = r.theory.evaluation;
        if (!evalGroups[ev]) evalGroups[ev] = { correct: 0, total: 0 };
        evalGroups[ev].total++;
        if (r.correct) evalGroups[ev].correct++;
    });

    const evalColors = {
        'S': 'var(--eval-s)', 'A': 'var(--eval-a)', 'B': 'var(--eval-b)',
        'C': 'var(--eval-c)', 'D': 'var(--eval-d)', 'E': 'var(--eval-e)'
    };

    html += '<div class="test-result-section"><h3>評価別の正答率</h3>';
    ['E', 'D', 'C', 'B', 'A', 'S'].forEach(ev => {
        if (!evalGroups[ev]) return;
        const g = evalGroups[ev];
        const evPct = Math.round((g.correct / g.total) * 100);
        html += `
            <div class="test-eval-bar-row">
                <span class="test-eval-bar-label">${ev}</span>
                <div class="test-eval-bar-bg">
                    <div class="test-eval-bar-fill" style="width: ${evPct}%; background: ${evalColors[ev] || '#999'};"></div>
                </div>
                <span class="test-eval-bar-pct">${g.correct}/${g.total} (${evPct}%)</span>
            </div>
        `;
    });
    html += '</div>';

    // Subject breakdown
    const subjectGroups = {};
    testResults.forEach(r => {
        const key = r.theory.subjectName;
        if (!subjectGroups[key]) subjectGroups[key] = { correct: 0, total: 0 };
        subjectGroups[key].total++;
        if (r.correct) subjectGroups[key].correct++;
    });

    if (Object.keys(subjectGroups).length > 1) {
        html += '<div class="test-result-section"><h3>科目別の正答率</h3>';
        Object.entries(subjectGroups).forEach(([name, g]) => {
            const sPct = Math.round((g.correct / g.total) * 100);
            html += `
                <div class="test-eval-bar-row">
                    <span class="test-eval-bar-label" style="width: auto; min-width: 60px; text-align: left; font-size: 0.8rem;">${name}</span>
                    <div class="test-eval-bar-bg">
                        <div class="test-eval-bar-fill" style="width: ${sPct}%; background: var(--primary);"></div>
                    </div>
                    <span class="test-eval-bar-pct">${g.correct}/${g.total} (${sPct}%)</span>
                </div>
            `;
        });
        html += '</div>';
    }

    // Incorrect list
    const incorrectResults = testResults.filter(r => !r.correct);
    if (incorrectResults.length > 0) {
        html += '<div class="test-result-section"><h3>間違えた問題（' + incorrectResults.length + '問）</h3>';
        incorrectResults.forEach((r, i) => {
            const t = r.theory;
            html += `
                <div class="test-incorrect-item" onclick="this.classList.toggle('expanded')">
                    <div class="incorrect-question">
                        <span>${t.questionText.substring(0, 50)}${t.questionText.length > 50 ? '...' : ''}</span>
                        <span class="eval-badge eval-${t.evaluation.toLowerCase()}" style="flex-shrink: 0;">${t.evaluation}</span>
                    </div>
                    <div class="incorrect-detail">
                        <div class="question-section" style="margin-bottom: 8px;">
                            <h4>【問題】</h4>
                            <p>${formatQuestionText(t)}</p>
                        </div>
                        <div class="answer-section">
                            <h4>【解答】</h4>
                            <p>${formatAnswerText(t.answerText)}</p>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // Action buttons
    html += `
        <div class="test-result-actions">
            <button class="btn btn-primary" onclick="restartTest()">🔄 もう一度テスト</button>
            ${incorrectResults.length > 0 ? '<button class="btn btn-danger" onclick="retestIncorrect()">❌ 間違いだけ再テスト</button>' : ''}
        </div>
    `;

    document.getElementById('test-result-area').innerHTML = html;
}

function restartTest() {
    document.getElementById('test-setup-area').style.display = 'block';
    document.getElementById('test-execution-area').style.display = 'none';
    document.getElementById('test-result-area').style.display = 'none';
    setupTestSelectors();
}

function retestIncorrect() {
    const incorrectTheories = testResults.filter(r => !r.correct).map(r => r.theory);
    if (incorrectTheories.length === 0) return;

    testQuestions = [...incorrectTheories];
    shuffleArray(testQuestions);
    testCurrentIndex = 0;
    testResults = [];
    testIsAnswerVisible = false;

    document.getElementById('test-setup-area').style.display = 'none';
    document.getElementById('test-execution-area').style.display = 'block';
    document.getElementById('test-result-area').style.display = 'none';

    displayTestCard();
}

// ========================================
// Tab Help
// ========================================

function showTabHelp(tabId) {
    const helpTexts = {
        'today-review': '問題文をタップで解答表示。正解/不正解で評価が変動します。スワイプで前後のカードに移動できます。',
        'test-mode': '範囲を選択してテストモードで実力を確認できます。テスト結果は評価別・科目別に分析できます。',
        'calendar': '日付をタップで、その日の復習予定を確認できます。色が濃いほど復習の負荷が高いことを示します。',
        'incorrect-review': '今日の復習で不正解だった問題を再確認できます。夜の復習に最適です。',
        'all-theories': '評価・科目・検索で問題を絞り込み。各問題の確認・編集・削除ができます。',
        'statistics': '学習量・正答率・評価分布・科目別の進捗を確認できます。',
        'management': '復習設定・教材登録・教材構造の管理・バックアップの各機能にアクセスできます。'
    };

    const text = helpTexts[tabId] || '';
    if (!text) return;

    const overlay = document.createElement('div');
    overlay.className = 'help-modal-overlay';
    overlay.innerHTML = `
        <div class="help-modal-content">
            <h3>操作ヘルプ</h3>
            <p>${text}</p>
            <button class="btn btn-primary" onclick="this.closest('.help-modal-overlay').remove()">OK</button>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// ========================================
// Usage Guide
// ========================================

function showUsageGuide() {
    const overlay = document.createElement('div');
    overlay.className = 'guide-modal-overlay';
    overlay.innerHTML = `
        <div class="guide-modal-content">
            <h2 style="text-align: center; color: var(--primary); margin-bottom: 20px; font-size: 1.2rem;">📖 推奨学習フロー</h2>

            <div class="guide-step">
                <div class="guide-step-number">1</div>
                <div class="guide-step-content">
                    <h4>教材登録</h4>
                    <p>設定 → 教材登録 で問題と解答を登録します。一括登録も可能です。</p>
                </div>
            </div>

            <div class="guide-step">
                <div class="guide-step-number">2</div>
                <div class="guide-step-content">
                    <h4>初回学習</h4>
                    <p>一覧タブで未習の問題を「既習」に変更して、初回の復習対象にします。</p>
                </div>
            </div>

            <div class="guide-step">
                <div class="guide-step-number">3</div>
                <div class="guide-step-content">
                    <h4>毎日の復習</h4>
                    <p>「今日の復習」タブで日々の復習を行います。正解すると評価が上がり、復習間隔が伸びます。</p>
                </div>
            </div>

            <div class="guide-step">
                <div class="guide-step-number">4</div>
                <div class="guide-step-content">
                    <h4>弱点対策</h4>
                    <p>「不正解」タブで今日間違えた問題を再確認。夜の復習に活用できます。</p>
                </div>
            </div>

            <div class="guide-step">
                <div class="guide-step-number">5</div>
                <div class="guide-step-content">
                    <h4>テスト</h4>
                    <p>「テスト」タブで範囲を指定してテストモード。定着度を客観的に確認できます。</p>
                </div>
            </div>

            <div class="guide-step">
                <div class="guide-step-number">6</div>
                <div class="guide-step-content">
                    <h4>負荷管理</h4>
                    <p>「負荷予測」カレンダーで今後の復習量を確認し、計画的に学習を進めましょう。</p>
                </div>
            </div>

            <button class="btn btn-primary" style="width: 100%; margin-top: 10px;" onclick="this.closest('.guide-modal-overlay').remove()">閉じる</button>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}
