// === CSRF и API ===
let csrfToken = "";
const API_URL = "https://apiforbeta.gugapay.ru";

/**
 * Fetches a new CSRF token from the server and stores it in csrfToken.
 */
async function fetchCsrfToken() {
  try {
    const res = await fetch(`${API_URL}/csrf-token`, { credentials: "include" });
    const data = await res.json();
    if (data.csrfToken) {
      csrfToken = data.csrfToken;
    }
  } catch (err) {
    console.error("CSRF token not fetched:", err);
  }
}

fetchCsrfToken();

// 0) Ваш публичный VAPID-ключ от web-push (Base64 URL-safe)
const PUBLIC_VAPID_KEY = 'BO-xrqEyeoH4EHZkg6YJgrO5tfniBp52aRL3V1JKokIe59OLPwFcoyHpciJnpJ3jBRlEXwMewKWYYcVFpuKOcoI';

// 1) Утилита для конвертации Base64 URL-safe в Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Shows a connection error notification to the user.
 * @param {string} [msg] - Custom message to display.
 */
function showConnectionError(msg) {
  showNotification(msg || "Ошибка соединения с сервером", "error");
}

// === Supabase ===
const supabaseUrl = 'https://hjdcryfdhqxazdllhjsv.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZGNyeWZkaHF4YXpkbGxoanN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg2MDQyOTUsImV4cCI6MjA1NDE4MDI5NX0.yGYZ2_bkIismVidBNFYTdRRh1rZrfo1rT90UzNxhDWc';                
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
const STORAGE_BUCKET = "avatars";

// === Глобальные переменные ===
let currentUserId = null;
let currentMerchantId = null;

let pendingMinedCoins = parseFloat(localStorage.getItem("pendingMinedCoins")) || 0;
let mineTimer = null;
let updateInterval = null;

let currentHalvingStep = 0;
let lastDirection = null;
let cycleCount = 0;
let exchangeChartInstance = null;

/**************************************************
 * BASE STYLES INJECTION
 **************************************************/
const appStyle = document.createElement('style');
appStyle.textContent = `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }

  #appContainer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .scrollable-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    padding-bottom: 80px;
  }
`;
document.head.appendChild(appStyle);

/**************************************************
 * UTILITIES
 **************************************************/
/**
 * Formats a number with a fixed number of decimal places.
 * @param {number|string} num - Number to format.
 * @param {number} [decimals=5] - Decimal places.
 * @param {string} [defaultValue="0.00000"] - Default if input is invalid.
 * @returns {string} Formatted number.
 */
function formatBalance(num, decimals = 5, defaultValue = "0.00000") {
  const parsed = parseFloat(num);
  return isNaN(parsed) ? defaultValue : parsed.toFixed(decimals);
}

/**
 * Shows the global loading indicator.
 */
function showGlobalLoading() {
  if (!loadingIndicator) {
    console.warn("Loading indicator element not found.");
    return;
  }
  loadingIndicator.style.display = "flex";
}

/**
 * Hides the global loading indicator.
 */
function hideGlobalLoading() {
  if (!loadingIndicator) {
    console.warn("Loading indicator element not found.");
    return;
  }
  loadingIndicator.style.display = "none";
}

// Cache the loading indicator element.
const loadingIndicator = document.getElementById("loadingIndicator");

/**
 * Dynamically load the main stylesheet.
 */
function loadCSSStylesheet() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "styles.css"; // Ensure this path is correct
  document.head.appendChild(link);
}
// Load CSS on page load
loadCSSStylesheet();

/**************************************************
 * PUSH
 **************************************************/

// 1. Регистрируем SW
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('SW зарегистрирован:', reg);

      // 2. Запрашиваем разрешение на уведомления
      return Notification.requestPermission().then(permission => {
        if (permission !== 'granted') {
          console.warn('Уведомления не разрешены');
          return null;
        }
        // 3. Получаем подписку
        return reg.pushManager.getSubscription()
          .then(sub => {
            if (sub) return sub;
            // applicationServerKey — ваш публичный VAPID‑ключ, законвертированный в Uint8Array
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
            });
          });
      });
    })
    .then(subscription => {
      if (!subscription) return;
      // 4. Отправляем subscription на бэкенд
      fetch(`${API_URL}/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(subscription)
      });
    })
    .catch(err => console.error('SW/Push registration error', err));
}

/**************************************************
 * MODALS (Generic Modal Management)
 **************************************************/
/**
 * Creates a modal window.
 * @param {string} id - Unique identifier for the modal.
 * @param {string} content - HTML content for the modal.
 * @param {Object} options - Modal options.
 * @param {boolean} [options.showCloseBtn=true] - Show close button.
 * @param {boolean} [options.hasVerticalScroll=true] - Enable vertical scroll.
 * @param {boolean} [options.defaultFromBottom=true] - Animate from bottom.
 * @param {number} [options.cornerTopMargin=0] - Top margin in px.
 * @param {number} [options.cornerTopRadius=0] - Corner radius for top corners.
 * @param {boolean} [options.noRadiusByDefault=false] - Remove default radius.
 * @param {Object} [options.customStyles] - Additional inline styles for modal container.
 * @param {Function} [options.onClose] - Callback on close.
 * @param {string} id - Unique identifier for the modal.
 * @param {string} content - HTML content for the modal.
 * @param {Object} options - Modal options.
 */
function createModal(
  id,
  content,
  {
    showCloseBtn = true,
    hasVerticalScroll = true,
    cornerTopMargin = 0,
    cornerTopRadius = 0,
    noRadiusByDefault = false,
    customStyles = {},
    onClose = null,
  } = {}
) {
  // 1. Чистим старые модалки и блокируем фон
  removeAllModals();
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overscrollBehavior = 'none';

  // 2. Оверлей
  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'modal';
  Object.assign(modal.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.5)',
    zIndex: '100000',
    overscrollBehavior: 'none',
  });

  // 3. Контейнер содержимого
  const contentDiv = document.createElement('div');
  contentDiv.className = 'modal-content';
  Object.assign(contentDiv.style, {
    position: 'absolute',
    top: `calc(${cornerTopMargin}px + env(safe-area-inset-top, 0px))`,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: '500px',
    bottom: '0',
    overflowY: hasVerticalScroll ? 'auto' : 'hidden',
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    borderRadius: noRadiusByDefault
      ? '0'
      : `${cornerTopRadius}px ${cornerTopRadius}px 0 0`,
    background: '#fff',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    padding: '20px',
    ...customStyles,
  });

  // 4. Вставляем HTML и сразу делаем у всех кнопок type="button"
  contentDiv.innerHTML = `
    ${showCloseBtn ? '<button class="modal-close-btn">&times;</button>' : ''}
    ${content}
  `;
  contentDiv.querySelectorAll('button').forEach(btn => btn.type = 'button');

  // 5. Клики по контенту не должны уходить на оверлей
  contentDiv.addEventListener('click', e => e.stopPropagation());

  // 6. При первом касании кнопки — снимаем фокус с активного элемента
  const blurHandler = e => {
    if (e.target.closest('button')) {
      const active = document.activeElement;
      if (active && active.blur) active.blur();
    }
  };
  modal.addEventListener('pointerdown', blurHandler, { capture: true });
  modal.addEventListener('touchstart',  blurHandler, { capture: true });

  // 7. Подгоняем высоту при изменении размеров viewport (iOS клавиатура)
  const resizeHandler = () => {
    contentDiv.style.maxHeight = `${window.innerHeight - cornerTopMargin}px`;
  };
  window.addEventListener('resize', resizeHandler);
  resizeHandler();

  // 8. Стили и обработчик для крестика
  if (showCloseBtn) {
    const closeBtn = contentDiv.querySelector('.modal-close-btn');
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '15px',
      right: '20px',
      width: '30px',
      height: '30px',
      backgroundColor: '#000',
      color: '#fff',
      borderRadius: '50%',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'transform 0.3s',
      zIndex: '1001',
    });
    closeBtn.addEventListener('click', cleanup);
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.transform = 'scale(1.1)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.transform = 'scale(1)';
    });
  }

  // 9. Монтируем в DOM
  modal.appendChild(contentDiv);
  document.body.appendChild(modal);

  // 10. Клик по фону закрывает
  modal.addEventListener('click', cleanup);

  // 11. Убираем слушатели и возвращаем прокрутку
  function cleanup() {
    modal.remove();
    window.removeEventListener('resize', resizeHandler);
    modal.removeEventListener('pointerdown', blurHandler, { capture: true });
    modal.removeEventListener('touchstart',  blurHandler, { capture: true });
    document.body.style.overflow = '';
    document.documentElement.style.overscrollBehavior = '';
    if (typeof onClose === 'function') onClose();
  }
}

/**
 * Удаляет все модалки и возвращает прокрутку боди.
 */
function removeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.remove());
  document.body.style.overflow = '';
  document.documentElement.style.overscrollBehavior = '';
}

/**************************************************
 * AUTHENTICATION (Login/Registration)
 **************************************************/
/**
 * General API request for auth (login, register, etc).
 * @param {string} endpoint - API endpoint (relative, without leading slash).
 * @param {Object} payload - Request body.
 * @returns {Promise<Object>} Response data.
 */
async function apiAuthRequest(endpoint, payload) {
  try {
    showGlobalLoading();
    // Ensure CSRF token is fetched
    if (!csrfToken) {
      await fetchCsrfToken();
    }
    const response = await fetch(`${API_URL}/${endpoint}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showConnectionError("Ответ не является JSON");
      throw err;
    }
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Неизвестная ошибка");
    }
    return data;
  } catch (err) {
    console.error(`Auth request error at ${endpoint}:`, err);
    throw err;
  } finally {
    hideGlobalLoading();
  }
}

/**
 * User login handler.
 */
async function login() {
  const loginVal = document.getElementById("loginInput")?.value.trim();
  const passVal = document.getElementById("passwordInput")?.value.trim();

  if (!validateInput(loginVal, 1) || !validateInput(passVal, 6)) {
    showNotification("Введите корректный логин (мин. 1 символ) и пароль (мин. 6 символов)", "error");
    return;
  }
  try {
    // Try as normal user
    await apiAuthRequest("login", { username: loginVal, password: passVal });
    await fetchUserData();
    closeAllAuthModals();
    createMainUI();
    updateUI();
  } catch {
    try {
      // Try as merchant
      await apiAuthRequest("merchantLogin", { username: loginVal, password: passVal });
      await fetchMerchantData();
      closeAllAuthModals();
      openMerchantUI();
    } catch (err) {
      console.error("Logout error:", err);
      showNotification("❌ " + err.message, "error");
    }
  }
}

/**
 * User registration handler.
 */
async function register() {
  const loginVal = document.getElementById("regLogin")?.value.trim();
  const passVal = document.getElementById("regPassword")?.value.trim();

  if (!validateInput(loginVal, 1) || !validateInput(passVal, 6)) {
    showNotification("Введите корректный логин (мин. 1 символ) и пароль (мин. 6 символов)", "error");
    return;
  }
  try {
    const data = await apiAuthRequest("register", { username: loginVal, password: passVal });
    showNotification(`Аккаунт успешно создан! Ваш userId: ${data.userId}`, "success");
    // Auto login after registration
    await login();
  } catch (err) {
    showNotification("Ошибка регистрации: " + err.message, "error");
  }
}

/**
 * Logout handler.
 */
async function logout() {
  try {
    await fetch(`${API_URL}/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      }
    });
    showNotification("Вы вышли из системы", "success");
  } catch (err) {
    console.error("Logout error:", err);
    showNotification("Ошибка при выходе", "error");
  }
  // Clear user and merchant state
  currentUserId = null;
  currentMerchantId = null;
  removeAllModals();
  hideMainUI();
  // Fetch new CSRF token for next login session
  await fetchCsrfToken();
  openAuthModal();
}

/**
 * Simple input validation.
 * @param {string} value - The input value.
 * @param {number} minLength - Minimum length required.
 * @returns {boolean} True if valid.
 */
function validateInput(value, minLength = 1) {
  return value && value.length >= minLength;
}

/**
 * Close any open authentication modals.
 */
function closeAllAuthModals() {
  document.getElementById("authModal")?.remove();
}

/**************************************************
 * REQUEST PAYMENT (QR generation for user request)
 **************************************************/
function openRequestModal() {
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";

  createModal(
    "requestModal",
    `
      <div style="
        max-width: 400px;
        margin: 0 auto;
        padding: 24px;
        background: #FFFFFF;
        border-radius: 24px;
        box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.1);
        position: relative;
        margin-top: 40px;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 32px;
        ">
          <img src="photo/15.png" style="width: 40px; height: 40px;">
          <div>
            <div style="font-size: 20px; font-weight: 600; color: #1A1A1A;">GUGA</div>
            <div style="font-size: 16px; color: #666;">Запрос на перевод</div>
          </div>
        </div>

        <div style="margin-bottom: 24px;">
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            color: #666;
            font-size: 14px;
          ">
            <span>Сумма перевода</span>
          </div>
          
          <div style="
            background: #F8F9FB;
            border-radius: 16px;
            padding: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid #E6E6EB;
          ">
            <input 
              type="number" 
              id="requestAmountInput" 
              placeholder="0.00"
              style="
                flex: 1;
                background: none;
                border: none;
                color: #1A1A1A;
                font-size: 18px;
                outline: none;
                padding: 0;
                font-weight: 500;
              ">
            <span style="color: #666; font-size: 16px;">₲</span>
          </div>
        </div>

        <button 
          id="generateQRBtn" 
          style="
            width: 100%;
            padding: 16px;
            background: linear-gradient(90deg, #2F80ED, #2D9CDB);
            border: none;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 8px;
          ">
          Создать QR-код
        </button>
      </div>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false,
      contentMaxHeight: "calc(100vh - 160px)",
      onClose: () => {
        if (bottomBar) bottomBar.style.display = "flex";
        if (window.stopQRListener) {
          clearInterval(window.stopQRListener);
          window.stopQRListener = null;
        }
      }
    }
  );

  document.getElementById("generateQRBtn").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("requestAmountInput").value);
    if (!amount || amount <= 0) {
      showNotification("Введите корректную сумму!", "error");
      return;
    }
    if (!currentUserId) {
      showNotification("Требуется авторизация", "error");
      return;
    }

    // Удаляем предыдущее модальное окно
    document.getElementById("requestModal")?.remove();

    const qrData = `guga://type=person&toUserId=${currentUserId}&amount=${amount}`;
    createModal(
      "qrModal",
      `
        <div style="
          max-width: 400px;
          margin: 0 auto;
          padding: 24px;
          background: #FFFFFF;
          border-radius: 24px;
          text-align: center;
        ">
          <div style="
            display: flex;
            align-items: center;
            gap: 12px;
            justify-content: center;
            margin-bottom: 24px;
          ">
            <img src="photo/15.png" style="width: 40px; height: 40px;">
            <div style="font-size: 20px; font-weight: 600;">GUGA</div>
          </div>
          
          <div id="qrCodeContainer" style="
            background: white;
            padding: 16px;
            border-radius: 16px;
            margin: 0 auto 20px;
            width: fit-content;
            box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.1);
          "></div>
          
          <div style="
            font-size: 18px;
            color: #1A1A1A;
            font-weight: 500;
            margin-bottom: 8px;
          ">
            ${formatBalance(amount, 5)} ₲
          </div>
          
          <div style="color: #666; font-size: 14px;">
            Отсканируйте QR-код для перевода
          </div>
        </div>
      `,
      {
        showCloseBtn: true,
        cornerTopMargin: 0,
        cornerTopRadius: 0,
        hasVerticalScroll: true,
        defaultFromBottom: true,
        noRadiusByDefault: false,
        contentMaxHeight: "calc(100vh - 160px)",
        onClose: () => {
          if (bottomBar) bottomBar.style.display = "flex";
          if (window.stopQRListener) {
            clearInterval(window.stopQRListener);
            window.stopQRListener = null;
          }
        }
      }
    );

    new QRCode(document.getElementById("qrCodeContainer"), {
      text: qrData,
      width: 200,
      height: 200,
      colorDark: "#1A1A1A",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    // Live check for incoming payments (mocked by polling, replace with websocket if needed)
    window.stopQRListener = setInterval(async () => {
      try {
        const resp = await fetch(`${API_URL}/payments/check?userId=${currentUserId}`);
        const data = await resp.json();
        if (data.success && data.payment) {
          clearInterval(window.stopQRListener);
          window.stopQRListener = null;
          document.getElementById("qrModal")?.remove();
          const fromName = data.payment.fromName || `пользователя #${data.payment.fromUserId}`;
          showNotification(`✅ Получен перевод ${formatBalance(data.payment.amount, 5)} ₲ от ${fromName}`);
          fetchUserData();
        }
      } catch (err) {
        console.error("Ошибка при проверке оплаты", err);
      }
    }, 3000);
  });
}

/**************************************************
 * AUTH MODAL (Login/Register UI)
 **************************************************/
function openAuthModal() {
  hideMainUI();
  removeAllModals();

  createModal("authModal", `
    <div class="auth-fullscreen white-background">
      <div class="auth-header">
        <img src="photo/15.png" alt="logo" class="auth-logo" />
        <span class="auth-app-name">GugaPay</span>
        <span class="auth-beta-tag">beta</span>
      </div>

      <p class="auth-subtitle">Для входа в GugaPay, пожалуйста, авторизуйтесь с помощью логина и пароля или через Telegram.</p>

      <div class="auth-overlay">
        <!-- Login Form -->
        <div id="loginSection" class="auth-form">
          <input type="text" id="loginInput" placeholder="Логин" class="auth-input" />
          <div class="password-wrapper">
            <input type="password" id="passwordInput" placeholder="Пароль" class="auth-input password-input" />
            <span class="toggle-password" onclick="togglePasswordVisibility('passwordInput', this)">👁️</span>
          </div>
          <button id="loginSubmitBtn" class="auth-button">Войти</button>
        </div>

        <!-- Register Form -->
        <div id="registerSection" class="auth-form" style="display: none;">
          <input type="text" id="regLogin" placeholder="Логин" class="auth-input" />
          <div class="password-wrapper">
            <input type="password" id="regPassword" placeholder="Пароль" class="auth-input password-input" />
            <span class="toggle-password" onclick="togglePasswordVisibility('regPassword', this)">👁️</span>
          </div>
          <button id="registerSubmitBtn" class="auth-button">Зарегистрироваться</button>
        </div>

        <!-- Toggle -->
        <button id="toggleAuthBtn" class="toggle-auth">Войти / Зарегистрироваться</button>

        <div class="divider">или</div>

        <div id="telegramBtnContainer"></div>
      </div>
    </div>
  `, {
    showCloseBtn: false,
    hasVerticalScroll: false,
    defaultFromBottom: false,
    noRadiusByDefault: true,
    customStyles: { backgroundColor: "#ffffff" }
  });
['loginInput', 'passwordInput', 'regLogin', 'regPassword'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("touchstart", () => {
        requestAnimationFrame(() => input.focus());
      }, { once: true });
    }
  });

  document.getElementById("loginSubmitBtn").addEventListener("click", async () => {
    await login();
    document.getElementById("bottomBar").style.display = "flex";
  });
  document.getElementById("registerSubmitBtn").addEventListener("click", async () => {
    await register();
    document.getElementById("bottomBar").style.display = "flex";
  });
  document.getElementById("toggleAuthBtn").addEventListener("click", toggleAuthForms);

  // Enter key submits form
  document.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const loginVisible = document.getElementById("loginSection").style.display !== "none";
      if (loginVisible) {
        await login();
        document.getElementById("bottomBar").style.display = "flex";
      } else {
        await register();
        document.getElementById("bottomBar").style.display = "flex";
      }
    }
  });

  if (window.Telegram?.WebApp) {
    const telegramBtn = document.createElement("button");
    telegramBtn.innerHTML = `
      <img src="https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg" style="height:20px; margin-right:10px;" />
      Войти через Telegram
    `;
    Object.assign(telegramBtn.style, {
      width: "100%",
      padding: "14px",
      backgroundColor: "#0088cc",
      color: "white",
      border: "none",
      borderRadius: "12px",
      cursor: "pointer",
      fontSize: "16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });
    telegramBtn.addEventListener("click", async () => {
      try {
        showGlobalLoading();
        Telegram.WebApp.ready();
        const initData = Telegram.WebApp.initData;
        if (!initData || !initData.includes("hash")) throw new Error("Некорректные initData из Telegram");

        const response = await fetch(`${API_URL}/auth/telegram`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken
          },
          body: JSON.stringify({ initData })
        });

        if (!response.ok) throw new Error((await response.json()).error || "Ошибка сервера");

        document.getElementById("authModal")?.remove();
        await fetchUserData();
        createMainUI();
        updateUI();
        document.getElementById("bottomBar").style.display = "flex";
      } catch (err) {
        showNotification(err.message, "error");
      } finally {
        hideGlobalLoading();
      }
    });
    document.getElementById("telegramBtnContainer").appendChild(telegramBtn);
  }

  function toggleAuthForms() {
    const login = document.getElementById("loginSection");
    const reg = document.getElementById("registerSection");
    login.style.display = login.style.display === "none" ? "flex" : "none";
    reg.style.display = reg.style.display === "none" ? "flex" : "none";
  }

  if (!document.getElementById("authStyleSheet")) {
    const style = document.createElement("style");
    style.id = "authStyleSheet";
    style.textContent = `
    .auth-fullscreen {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: 48px;
      background-color: #ffffff;
    }
    .white-background {
      background: #ffffff;
    }
    .auth-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .auth-logo {
      height: 36px;
      width: 36px;
      object-fit: cover;
      border-radius: 8px;
    }
    .auth-app-name {
      font-size: 22px;
      font-weight: 600;
      color: #1a1a1a;
    }
    .auth-beta-tag {
      background: #e0e0e0;
      padding: 2px 8px;
      border-radius: 8px;
      font-size: 12px;
      color: #555;
    }
    .auth-overlay {
      width: 100%;
      max-width: 400px;
      padding: 24px;
      background: #F8F9FB;
      border-radius: 24px;
      // box-shadow: 0 8px 30px rgba(0,0,0,0.05);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .auth-subtitle {
      font-size: 15px;
      color: #444;
      text-align: center;
      max-width: 400px;
      line-height: 1.5;
      margin: 20px 20px 40px;
    }
    .auth-title {
      font-size: 24px;
      font-weight: 700;
      text-align: center;
      color: #1a1a1a;
    }
    .auth-title span {
      background: linear-gradient(90deg, #2F80ED, #2D9CDB);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    .auth-input {
      padding: 14px 16px;
      border: 1px solid #E6E6EB;
      border-radius: 12px;
      font-size: 16px;
      width: 100%;
    }
    .auth-button {
      padding: 14px;
      background: linear-gradient(90deg, #2F80ED, #2D9CDB);
      border: none;
      border-radius: 12px;
      color: white;
      font-weight: 600;
      font-size: 16px;
      cursor: pointer;
    }
    .toggle-auth {
      background: none;
      border: none;
      font-size: 14px;
      color: #2F80ED;
      text-align: center;
      cursor: pointer;
      text-decoration: underline;
    }
    .divider {
      text-align: center;
      font-size: 14px;
      color: #888;
    }
    .password-wrapper {
      position: relative;
    }
    .toggle-password {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      cursor: pointer;
      font-size: 18px;
    }
    `;
    document.head.appendChild(style);
  }
}

function togglePasswordVisibility(inputId, toggleEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    toggleEl.textContent = "🙈";
  } else {
    input.type = "password";
    toggleEl.textContent = "👁️";
  }
}

/**************************************************
 * MAIN UI (Home screen with gradient header and balances)
 **************************************************/
function createMainUI() {
  injectMainUIStyles();

  if (!currentMerchantId && !document.getElementById("profileIconContainer")) {
    const profileIconContainer = document.createElement("div");
    profileIconContainer.id = "profileIconContainer";
    Object.assign(profileIconContainer.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      width: "35px",
      height: "35px",
      background: "#fff",
      borderRadius: "12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 2px 5px rgba(0, 0, 0, 0.1)",
      cursor: "pointer",
      zIndex: "9999",
    });
    const profileIcon = document.createElement("img");
    profileIcon.id = "profileIcon";
    profileIcon.src = "photo/68.png";
    Object.assign(profileIcon.style, {
      width: "28px",
      height: "28px",
      borderRadius: "6px",
      objectFit: "cover",
    });
    profileIconContainer.appendChild(profileIcon);
    document.body.appendChild(profileIconContainer);
    profileIconContainer.addEventListener("click", openProfileModal);
  }

  let headerEl = document.getElementById("mainHeaderContainer");
  if (!headerEl) {
    headerEl = document.createElement("div");
    headerEl.id = "mainHeaderContainer";
    headerEl.className = "main-header";
    document.body.appendChild(headerEl);
    const actionContainer = document.createElement("div");
    actionContainer.className = "action-container";
    actionContainer.innerHTML = `
      <button id="transferBtn" class="action-btn">
        <div class="icon-wrap"><img src="photo/81.png" class="action-icon"/></div><span>Перевести</span>
      </button>
      <button id="requestBtn" class="action-btn">
        <div class="icon-wrap"><img src="photo/82.png" class="action-icon"/></div><span>Запросить</span>
      </button>
      <button id="payQRBtn" class="action-btn">
        <div class="icon-wrap"><img src="photo/90.png" class="action-icon"/></div><span>Оплатить</span>
      </button>
      <button id="exchangeBtn" class="action-btn">
        <div class="icon-wrap"><img src="photo/71.png" class="action-icon"/></div><span>Обменять</span>
      </button>`;
    headerEl.appendChild(actionContainer);
    actionContainer.querySelector("#transferBtn").addEventListener("click", () => {
      removeAllModals(); openTransferModal();
    });
    actionContainer.querySelector("#requestBtn").addEventListener("click", () => {
      removeAllModals(); openRequestModal();
    });
    actionContainer.querySelector("#payQRBtn").addEventListener("click", () => {
      removeAllModals(); openPayQRModal();
    });
    actionContainer.querySelector("#exchangeBtn").addEventListener("click", () => {
      removeAllModals(); openExchangeModal();
    });
    headerEl.appendChild(document.createElement("div")).className = "header-divider";
  }

  // ──────────────────────────────────────────────
  // Баланс блок в белом контейнере с скруглением
  // ──────────────────────────────────────────────
  if (!document.querySelector(".balance-wrapper")) {
    const balanceWrapper = document.createElement("div");
    balanceWrapper.className = "balance-wrapper";

    const balanceContainer = document.createElement("div");
    balanceContainer.id = "balanceContainer";
    balanceContainer.className = "balance-container";
    balanceWrapper.appendChild(balanceContainer);
    document.body.appendChild(balanceWrapper);

    const rubCard = document.createElement("div");
    rubCard.className = "balance-card rub";
    rubCard.innerHTML = `
      <div class="balance-icon-wrap"><img src="photo/18.png" class="balance-icon"></div>
      <div class="balance-info"><div class="balance-label">RUB</div><div id="rubBalanceValue" class="balance-amount">0.00 ₽</div></div>`;
    balanceContainer.appendChild(rubCard);

    const gugaCard = document.createElement("div");
    gugaCard.className = "balance-card guga";
    gugaCard.innerHTML = `
      <div class="balance-icon-wrap"><img src="photo/15.png" class="balance-icon"></div>
      <div class="balance-info"><div class="balance-label">GUGA</div><div id="gugaBalanceValue" class="balance-amount">0.00000 ₲</div></div>`;
    balanceContainer.appendChild(gugaCard);
  }

  // Нижняя панель навигации
  if (!document.getElementById("bottomBar")) {
    const bottomBar = document.createElement("div");
    bottomBar.id = "bottomBar";
    bottomBar.className = "bottom-bar";
    bottomBar.innerHTML = `
      <button id="btnMain" class="nav-btn"><img src="photo/69.png" class="nav-icon"><span>Главная</span></button>
      <button id="historyBtn" class="nav-btn"><img src="photo/70.png" class="nav-icon"><span>История</span></button>
      <button id="chatBtn" class="nav-btn"><img src="photo/101.svg" class="nav-icon1"><span>Чаты</span></button>`;
    document.body.appendChild(bottomBar);
    bottomBar.querySelector("#btnMain").addEventListener("click", () => {
      removeAllModals();
    });
    bottomBar.querySelector("#historyBtn").addEventListener("click", () => {
      removeAllModals(); openHistoryModal();
    });
    bottomBar.querySelector("#chatBtn").addEventListener("click", () => {
      removeAllModals(); openChatListModal();
    });
  }

  const balanceDisplay = document.getElementById("balanceDisplay");
  if (balanceDisplay) balanceDisplay.style.display = "block";
  const mineContainer = document.getElementById("mineContainer");
  if (mineContainer) mineContainer.style.display = "none";

  fetchUserData();
  clearInterval(updateInterval);
  updateInterval = setInterval(fetchUserData, 2000);
}

function injectMainUIStyles() {
  if (document.getElementById("mainUIStyles")) return;
  const style = document.createElement("style");
  style.id = "mainUIStyles";
  style.textContent = `
    body {
      margin: 0;
      padding: 0;
      font-family: "Oswald", sans-serif;
      background: linear-gradient(180deg, #2F80ED, #2D9CDB);
      min-height: 100vh;
    }
    .main-header {
  width: 100%;
  background: linear-gradient(90deg, #2F80ED, #2D9CDB);
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  padding: 16px;
  padding-top: calc(16px + env(safe-area-inset-top, 0px)); /* 👈 вот это */
  box-sizing: border-box;
  z-index: 90000;
}
    .action-container {
      display: flex;
      gap: 4px;
      justify-content: center;
      margin-bottom: 16px;
      margin-top: 45px;
    }
    .action-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      border: none;
      background: none;
      cursor: pointer;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
    }
    .icon-wrap {
      width: 50px;
      height: 50px;
      background: #fff;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    }
    .action-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      object-fit: cover;
    }
    .header-divider { height: 0px; }
    .balance-wrapper {
    position: absolute;
    top: 290px;
    left: 0;
    right: 0;
    bottom: 0;
    background: #fff;
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 20px 16px 100px;
    box-sizing: border-box;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
    overflow-y: auto;
}
    .balance-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .balance-card {
      background: #F8F9FB;
      border-radius: 20px;
      padding: 10px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .balance-icon-wrap {
      width: 50px;
      height: 50px;
      background: #F0F0F0;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .balance-icon {
      width: 30px;
      height: 30px;
    }
    .balance-info {
      display: flex;
      flex-direction: column;
    }
    .balance-label {
      font-size: 15px;
      font-weight: 500;
      color: #1A1A1A;
    }
    .balance-amount {
      font-size: 16px;
      font-weight: 500;
      color: #666;
    }
    .bottom-bar {
      position: fixed;
      bottom: 0; left: 0;
      width: 100%;
      background-color: #fff;
      display: flex;
      justify-content: space-around;
      align-items: center;
      padding-bottom: 20px;
      box-shadow: 0 -2px 5px rgba(0,0,0,0.1);
      z-index: 999999;
    }
    .nav-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      border: none;
      background: none;
      cursor: pointer;
      color: #000;
      font-size: 14px;
      padding: 10px;
    }
    .nav-icon {
      width: 30px;
      height: 30px;
      margin-bottom: 4px;
    }
    .nav-icon1 {
      width: 23px;
      height: 23px;
      margin-bottom: 8px;
      margin-top: 3px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Форматирует число с пробелами в качестве разделителей тысяч
 * и фиксированным числом знаков после десятичной точки.
 * @param {number|string} num
 * @param {number} [decimals=5]
 * @param {string} [defaultValue="0.00000"]
 * @returns {string}
 */
function formatBalance(num, decimals = 2, defaultValue = "0.00") {
  const parsed = parseFloat(num);
  if (isNaN(parsed)) return defaultValue;
  const fixed = parsed.toFixed(decimals);
  const parts = fixed.split('.');
  // разделяем тысячи пробелом
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

/**************************************************
 * USER DATA & SYNC
 **************************************************/
let users = []; // глобальный массив пользователей

async function fetchUserData() {
  try {
    const [userResp, ratesResp] = await Promise.all([
      fetch(`${API_URL}/user`, { credentials: "include" }),
      fetch(`${API_URL}/exchangeRates?limit=1`, { credentials: "include" })
    ]);

    const userData = await userResp.json();
    const ratesData = await ratesResp.json();

    if (userData.success && userData.user) {
      if (userData.user.blocked) {
        showNotification("Ваш аккаунт заблокирован. Доступ ограничен.", "error");
        logout();
        return;
      }

      // === сохраняем базовые данные ===
      currentUserId = userData.user.user_id;
      const coinBalance = userData.user.balance || 0;
      const rubBalance  = userData.user.rub_balance || 0;
      const currentRate = (ratesData.success && ratesData.rates.length)
        ? parseFloat(ratesData.rates[0].exchange_rate)
        : 0;
      const firstName = userData.user.first_name || "GugaUser";
      const photoUrl  = userData.user.photo_url || "/photo/15.png";

      // === шапка: профиль — фото + имя и ID ===
      let userInfoContainer = document.getElementById("user-info");
      if (!userInfoContainer) {
        userInfoContainer = document.createElement("div");
        userInfoContainer.id = "user-info";
        userInfoContainer.classList.add("user-info");
        document.body.appendChild(userInfoContainer);
      }

      // фото
      let userPhotoEl = userInfoContainer.querySelector(".user-photo");
      if (!userPhotoEl) {
        userPhotoEl = document.createElement("img");
        userPhotoEl.classList.add("user-photo");
        userPhotoEl.alt = "User Photo";
        userInfoContainer.appendChild(userPhotoEl);
      }
      userPhotoEl.src = photoUrl;

      // контейнер текста (имя+ID)
      let userText = userInfoContainer.querySelector(".user-text");
      if (!userText) {
        userText = document.createElement("div");
        userText.classList.add("user-text");
        userInfoContainer.appendChild(userText);
      }

      // имя
      let userNameEl = userText.querySelector(".user-name");
      if (!userNameEl) {
        userNameEl = document.createElement("span");
        userNameEl.classList.add("user-name");
        userText.appendChild(userNameEl);
      }
      userNameEl.textContent = firstName;

      // ID
      let userIdEl = userText.querySelector(".user-id");
      if (!userIdEl) {
        userIdEl = document.createElement("span");
        userIdEl.classList.add("user-id");
        userText.appendChild(userIdEl);
      }
      userIdEl.textContent = `ID: ${currentUserId}`;

      // === общий баланс в рублях для шапки ===
      const totalRub = rubBalance + coinBalance * currentRate;
      const headerEl = document.getElementById("mainHeaderContainer");
      if (headerEl) {
        let headerBalanceEl = headerEl.querySelector("#headerBalance");
        if (!headerBalanceEl) {
          headerBalanceEl = document.createElement("div");
          headerBalanceEl.id = "headerBalance";
          // стили можно вынести в CSS, здесь для примера сразу inline
          headerBalanceEl.style.cssText = `
            text-align: center;
            font-size: 32px;
            font-weight: 600;
            color: #ffffff;
            margin-top: 80px;
          `;
          // вставляем перед кнопками
          const actionContainer = headerEl.querySelector(".action-container");
          headerEl.insertBefore(headerBalanceEl, actionContainer);
        }
        headerBalanceEl.textContent = `${formatBalance(totalRub, 2)} ₽`;
      }

      // === обновляем детальные карточки баланса ниже ===
      const rubBalanceInfo = document.getElementById("rubBalanceValue");
      if (rubBalanceInfo) {
        rubBalanceInfo.textContent = `${formatBalance(rubBalance, 2)} ₽`;
      }
      const gugaBalanceEl = document.getElementById("gugaBalanceValue");
      if (gugaBalanceEl) {
        gugaBalanceEl.textContent = `${formatBalance(coinBalance, 5)} ₲`;
      }
      const convertedBalanceEl = document.getElementById("convertedBalance");
      if (convertedBalanceEl) {
        convertedBalanceEl.textContent = `${formatBalance(coinBalance * currentRate, 2)} ₽`;
      }
      const rateDisplayEl = document.getElementById("currentRateDisplay");
      if (rateDisplayEl) {
        rateDisplayEl.textContent = formatBalance(currentRate, 2);
      }

      // === подгружаем список пользователей для истории/деталей транзакций ===
      try {
        const allResp      = await fetch(`${API_URL}/users`, { credentials: "include" });
        const allUsersData = await allResp.json();
        if (allUsersData.success && Array.isArray(allUsersData.users)) {
          users = allUsersData.users;
        }
      } catch (err) {
        console.warn("Не удалось загрузить список пользователей:", err);
      }
    }
  } catch (err) {
    console.error("fetchUserData error:", err);
    // в случае ошибки показываем дефолтный баланс
    const headerBalanceEl = document.getElementById("headerBalance");
    if (headerBalanceEl) headerBalanceEl.textContent = "-- ₽";
  }
}

/**************************************************
 * MINING (if any)
 **************************************************/
function mineCoins() {
  pendingMinedCoins += 0.00001;
  console.log("Mined: ", pendingMinedCoins);
}

async function flushMinedCoins() {
  if (pendingMinedCoins <= 0) return;
  try {
    if (!csrfToken) {
      await fetchCsrfToken();
    }
    const resp = await fetch(`${API_URL}/update`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ amount: pendingMinedCoins })
    });
    if (resp.ok) {
      pendingMinedCoins = 0;
      console.log("Coins flushed successfully");
    } else {
      console.error("Server refused flush");
    }
  } catch (e) {
    console.error("flushMinedCoins error:", e);
    showConnectionError("Ошибка соединения при отправке намайненных монет");
  }
}

/**************************************************
 * saveProfileChanges
 **************************************************/
async function saveProfileChanges() {
  const newName = document.getElementById("profileNameInput").value.trim();
  const fileInput = document.getElementById("profilePhotoInput");
  let photoUrl;

  try {
    if (!newName) throw new Error("Имя не может быть пустым");

    const oldPhoto = document.getElementById("profilePhotoPreview").src;
    let oldPath;
    if (oldPhoto.includes(supabaseUrl)) {
      const parts = oldPhoto.split("/storage/v1/object/public/");
      if (parts[1]) oldPath = parts[1];
    }

    // Загрузка нового фото (если выбран)
    if (fileInput.files.length) {
      const file = fileInput.files[0];
      const path = `${currentUserId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase
        .storage
        .from(STORAGE_BUCKET)
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { data: publicData, error: urlError } = supabase
        .storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(path);
      if (urlError) throw urlError;
      photoUrl = publicData.publicUrl;

      // Удаляем старое, если это не дефолт
      if (oldPath && !oldPath.includes("15.png")) {
        await supabase.storage.from(STORAGE_BUCKET).remove([oldPath]);
      }
    }

    // Обновление данных на сервере
    if (!csrfToken) await fetchCsrfToken();
    const form = new FormData();
    form.append("first_name", newName);
    if (photoUrl) form.append("photo_url", photoUrl);

    const res    = await fetch(`${API_URL}/user`, {
      method:      "PUT",
      credentials: "include",
      headers:     { "X-CSRF-Token": csrfToken },
      body:        form,
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Ошибка обновления профиля");

    // Обновляем UI в главном экране
    const userPhoto = document.querySelector("#user-info .user-photo");
    const userName  = document.querySelector("#user-info .user-name");
    if (photoUrl && userPhoto) userPhoto.src = photoUrl;
    if (newName  && userName)  userName.textContent = newName;

    // **Убираем закрытие модалки**, чтобы остаться в профиле
    showNotification("Профиль обновлён", "success");
  }
  catch (err) {
    console.error("Ошибка при обновлении профиля:", err);
    showNotification(err.message || "Ошибка обновления", "error");
  }
}

/**************************************************
 * PROFILE
 **************************************************/
function openProfileModal() {
  // Скрываем нижнюю панель навигации
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";

  // Текущие фото и имя
  const photo = document.querySelector("#user-info .user-photo")?.src || "photo/15.png";
  const name  = document.querySelector("#user-info .user-name")?.textContent || "GugaUser";

  // Открываем модалку
  createModal(
    "profileModal",
    `
      <div id="profileContainer" style="
        max-width: 400px;
        margin: 0 auto;
        background: #FFFFFF;
        border-radius: 24px;
        position: relative;
        margin-top: 40px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 24px;
        box-sizing: border-box;
      ">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <img id="profilePhotoPreview" src="${photo}" style="
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            cursor: pointer;
          " />
          <div style="font-size: 14px; color: #555;">
            Нажмите на фото, чтобы изменить
          </div>
          <input type="file" id="profilePhotoInput" accept="image/*" style="display: none;" />
        </div>

        <div>
          <label for="profileNameInput" style="
            display: block;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 6px;
            color: #333;
          ">Имя пользователя</label>
          <input type="text" id="profileNameInput" value="${name}" style="
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #E6E6EB;
            border-radius: 12px;
            font-size: 16px;
            box-sizing: border-box;
          "/>        
        </div>

        <button id="saveProfileBtn" style="
          width: 100%;
          padding: 14px;
          background: linear-gradient(90deg, #2F80ED, #2D9CDB);
          border: none;
          border-radius: 12px;
          color: white;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
        ">Сохранить</button>
      </div>

      <!-- Кнопка "Выйти" фиксированно внизу экрана -->
      <button id="profileLogoutBtn" style="
        position: fixed;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        width: calc(100% - 32px);
        max-width: 400px;
        padding: 14px;
        background: #808080;
        border: none;
        border-radius: 12px;
        color: white;
        font-weight: 600;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s;
        z-index: 1000;
      ">Выйти из аккаунта</button>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false,
      onClose: closeProfileModal
    }
  );

  // Элементы управления модалкой
  const photoPreview = document.getElementById("profilePhotoPreview");
  const photoInput   = document.getElementById("profilePhotoInput");
  const nameInput    = document.getElementById("profileNameInput");
  const saveBtn      = document.getElementById("saveProfileBtn");
  const logoutBtn    = document.getElementById("profileLogoutBtn");

  // Тип кнопок — button, чтобы не было submit
  saveBtn.type   = "button";
  logoutBtn.type = "button";

  // При нажатии (pointerdown) — сначала blur, скрываем клавиатуру
  const blurOnPress = () => nameInput.blur();
  saveBtn.addEventListener('pointerdown', blurOnPress);
  logoutBtn.addEventListener('pointerdown', blurOnPress);

  // Изменение фото
  photoPreview.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      photoPreview.src = reader.result;
      saveProfileChanges();
    };
    reader.readAsDataURL(file);
  });

  // Сохранение имени
  saveBtn.addEventListener("click", saveProfileChanges);

  // Выход из аккаунта
  logoutBtn.addEventListener("click", () => {
    logout();
    closeProfileModal();
  });
}

function closeProfileModal() {
  document.getElementById("profileModal")?.remove();
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "flex";
}

/**************************************************
 * TRANSFER (styled like REQUEST modal, updated)
 **************************************************/
function openTransferModal() {
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";

  createModal("transferModal", `
    <div style="
      max-width: 400px;
      margin: 0 auto;
      // padding: 24px;
      background: #FFFFFF;
      border-radius: 24px;
      // box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.1);
      position: relative;
      margin-top: 40px;
    ">
      <div style="
        font-size: 20px;
        font-weight: 600;
        color: #1A1A1A;
        text-align: center;
        margin-bottom: 32px;
      ">
        Перевод средств
      </div>

      <div style="display: flex; gap: 12px; margin-bottom: 30px;">
        <div id="btnCurrencyGUGA" class="currency-card" style="border: 2px solid #E6E6EB; border-radius: 16px; padding: 12px; cursor: pointer; flex: 1;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="photo/15.png" style="width: 32px; height: 32px; border-radius: 8px;">
            <div>
              <div style="font-weight: 500; color: #1A1A1A; font-size: 14px;">GUGA</div>
              <div style="font-size: 13px; color: #909099;">Криптовалюта</div>
            </div>
          </div>
          <div id="gugaBalance" style="margin-top: 12px; font-size: 14px; color: #666;">
            Доступно: 0.00000 ₲
          </div>
        </div>

        <div id="btnCurrencyRUB" class="currency-card" style="border: 2px solid #E6E6EB; border-radius: 16px; padding: 12px; cursor: pointer; flex: 1;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="photo/18.png" style="width: 32px; height: 32px; border-radius: 8px;">
            <div>
              <div style="font-weight: 500; color: #1A1A1A; font-size: 14px;">RUB</div>
              <div style="font-size: 13px; color: #909099;">Фиатные деньги</div>
            </div>
          </div>
          <div id="rubBalance" style="margin-top: 12px; font-size: 14px; color: #666;">
            Доступно: 0.00 ₽
          </div>
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display:block; margin-bottom: 6px; color:#666; font-size: 14px;">Получатель</label>
        <div style="
          background: #F8F9FB;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          align-items: center;
          border: 1px solid #E6E6EB;
        ">
          <input 
            type="text" 
            id="toUserIdInput" 
            placeholder="Введите ID пользователя"
            style="
              flex: 1;
              background: none;
              border: none;
              color: #1A1A1A;
              font-size: 16px;
              outline: none;
              font-weight: 500;
            ">
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label style="color:#666; font-size:14px;">Сумма</label>
          <div id="transferBalanceInfo" style="font-size: 13px; color: #909099;"></div>
        </div>
        <div style="
          background: #F8F9FB;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          align-items: center;
          border: 1px solid #E6E6EB;
        ">
          <input 
            type="number" 
            id="transferAmountInput" 
            placeholder="0.00"
            style="
              flex: 1;
              background: none;
              border: none;
              color: #1A1A1A;
              font-size: 16px;
              outline: none;
              font-weight: 500;
            ">
          <span id="currencySymbol" style="color: #666; font-size: 16px;">₲</span>
        </div>
      </div>

      <button 
        id="sendTransferBtn" 
        style="
          width: 100%;
          padding: 16px;
          background: linear-gradient(90deg, #2F80ED, #2D9CDB);
          border: none;
          border-radius: 12px;
          color: white;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
        ">
        Подтвердить перевод
      </button>
    </div>
  `, {
    showCloseBtn: true,
    cornerTopMargin: 0,
    cornerTopRadius: 0,
    hasVerticalScroll: true,
    defaultFromBottom: true,
    noRadiusByDefault: false,
    onClose: closeTransferModal
  });

  let currentTransferCurrency = "GUGA";

  const updateTransferUI = () => {
    const currencySymbol = document.getElementById("currencySymbol");
    const balanceInfo = document.getElementById("transferBalanceInfo");
    const gugaBalance = document.getElementById("gugaBalance");
    const rubBalance = document.getElementById("rubBalance");

    document.querySelectorAll(".currency-card").forEach(card => {
      card.style.borderColor = "#E6E6EB";
    });

    const activeCard = currentTransferCurrency === "GUGA"
      ? document.getElementById("btnCurrencyGUGA")
      : document.getElementById("btnCurrencyRUB");
    activeCard.style.borderColor = "#2F80ED";

    if (currentTransferCurrency === "GUGA") {
      const balance = parseFloat(document.getElementById("gugaBalanceValue")?.innerText || 0);
      currencySymbol.textContent = '₲';
      document.getElementById("transferAmountInput").step = "0.00001";
      gugaBalance.innerHTML = `Доступно: ${formatBalance(balance, 5)} ₲`;
      balanceInfo.textContent = `Макс: ${formatBalance(balance, 5)} ₲`;
    } else {
      const balance = parseFloat(document.getElementById("rubBalanceValue")?.innerText || 0);
      currencySymbol.textContent = '₽';
      document.getElementById("transferAmountInput").step = "0.01";
      rubBalance.innerHTML = `Доступно: ${formatBalance(balance, 2)} ₽`;
      balanceInfo.textContent = `Макс: ${formatBalance(balance, 2)} ₽`;
    }
  };

  document.getElementById("btnCurrencyGUGA").addEventListener("click", () => {
    currentTransferCurrency = "GUGA";
    updateTransferUI();
  });

  document.getElementById("btnCurrencyRUB").addEventListener("click", () => {
    currentTransferCurrency = "RUB";
    updateTransferUI();
  });

  document.getElementById("sendTransferBtn").onclick = async () => {
    const toUser = document.getElementById("toUserIdInput")?.value.trim();
    const amount = parseFloat(document.getElementById("transferAmountInput")?.value);

    if (!toUser || !amount || amount <= 0) {
      return showNotification("❌ Введите корректные данные!", "error");
    }

    if (toUser === currentUserId) {
      return showNotification("❌ Нельзя перевести самому себе", "error");
    }

    const endpoint = currentTransferCurrency === "GUGA" ? "/transfer" : "/transferRub";

    try {
      if (!csrfToken) await fetchCsrfToken();

      const resp = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ toUserId: toUser, amount })
      });

      const data = await resp.json();

      if (data.success) {
        showNotification("✅ Перевод выполнен!", "success");
        closeTransferModal();
        fetchUserData();
      } else {
        showNotification("❌ " + (data.error || "Ошибка перевода"), "error");
      }
    } catch (err) {
      console.error("Transfer error:", err);
      showConnectionError("Ошибка при выполнении перевода");
    }
  };

  fetchUserData().then(() => {
    const rubBalanceElement = document.getElementById("rubBalance");
    const rubBalanceValue = parseFloat(document.getElementById("rubBalanceValue")?.innerText || 0);
    if (rubBalanceElement) {
      rubBalanceElement.textContent = `Доступно: ${rubBalanceValue.toFixed(2)} ₽`;
    }
    updateTransferUI();
  });
}

function closeTransferModal() {
  const modal = document.getElementById("transferModal");
  if (modal) modal.remove();
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "flex";
}

/**************************************************
 * QR PAYMENT (Scanner Modal)
 **************************************************/
function openPayQRModal() {
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";

  createModal(
    "payQRModal",
    `
      <div class="qr-scanner-wrapper">
        <video id="opPayVideo" muted playsinline></video>
        <div class="scanner-overlay"></div>
        <div class="scan-frame">
          <div class="corner top-left"></div>
          <div class="corner top-right"></div>
          <div class="corner bottom-left"></div>
          <div class="corner bottom-right"></div>
        </div>
        <button id="closeQRScannerBtn" style="
          position: absolute;
          bottom: 32px;
          left: 50%;
          transform: translateX(-50%);
          background: #ffffff;
          color: #1A1A1A;
          font-weight: 600;
          font-size: 16px;
          border: none;
          border-radius: 12px;
          padding: 14px 28px;
          cursor: pointer;
          z-index: 9999;
        ">Закрыть</button>
      </div>
    `,
    {
      showCloseBtn: false,
      customStyles: {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.9)',
        zIndex: 10000,
        padding: '0',
        overflow: 'hidden'
      },
      onClose: () => {
        const bottomBar = document.getElementById("bottomBar");
        if (bottomBar) bottomBar.style.display = "flex";
        stopVideoStream();
      }
    }
  );

  const style = document.createElement('style');
  style.innerHTML = `
    .qr-scanner-wrapper {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    #opPayVideo {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scale(1.02);
    }
    .scan-frame {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 80%;
      max-width: 300px;
      height: 40vh;
      max-height: 300px;
      z-index: 2;
      pointer-events: none;
    }
    .corner {
      position: absolute;
      width: 38px;
      height: 38px;
      border: 4px solid #fff;
    }
    .top-left {
      top: 0;
      left: 0;
      border-right: none;
      border-bottom: none;
    }
    .top-right {
      top: 0;
      right: 0;
      border-left: none;
      border-bottom: none;
    }
    .bottom-left {
      bottom: 0;
      left: 0;
      border-right: none;
      border-top: none;
    }
    .bottom-right {
      bottom: 0;
      right: 0;
      border-left: none;
      border-top: none;
    }
    .scanner-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        to bottom,
        rgba(0,0,0,0.6) 0,
        rgba(0,0,0,0.6) 40px,
        transparent 40px,
        transparent calc(100% - 80px),
        rgba(0,0,0,0.6) calc(100% - 80px),
        rgba(0,0,0,0.6) 100%
      );
      z-index: 1;
      pointer-events: none;
    }
    @media (orientation: landscape) {
      .scan-frame {
        width: 60vh;
        height: 80%;
      }
    }
  `;
  document.head.appendChild(style);

  const videoEl = document.getElementById("opPayVideo");
  startUniversalQRScanner(videoEl, (rawValue) => {
    let success = false;
    try {
      const parsed = parseQRCodeData(rawValue);
      if (parsed.type === "person") {
        if (!parsed.userId) throw new Error("❌ Неверный QR. Нет userId.");
        confirmPayUserModal(parsed);
        success = true;
      } else if (parsed.type === "merchant") {
        if (!parsed.merchantId) throw new Error("❌ Неверный QR. Нет merchantId.");
        confirmPayMerchantModal(parsed);
        success = true;
      } else {
        throw new Error("❌ Неверный тип QR-кода.");
      }
    } catch (err) {
      showNotification(err.message || "Ошибка сканирования", "error");
    } finally {
      setTimeout(() => {
        document.getElementById("payQRModal")?.remove();
        stopVideoStream();
        if (bottomBar) bottomBar.style.display = "flex";
      }, success ? 500 : 1000);
    }
  });

  function stopVideoStream() {
    const video = document.getElementById("opPayVideo");
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
  }

  document.getElementById("closeQRScannerBtn").addEventListener("click", () => {
    document.getElementById("payQRModal")?.remove();
    stopVideoStream();
    if (bottomBar) bottomBar.style.display = "flex";
  });
}

/**************************************************
 * CONFIRM PAYMENT TO MERCHANT
 **************************************************/
function confirmPayMerchantModal({ merchantId, amount, purpose }) {
  createModal(
    "confirmPayMerchantModal",
    `
      <h3 style="text-align:center;">Подтверждение оплаты</h3>
      <p>Мерчант: ${merchantId}</p>
      <p>Сумма: ${formatBalance(amount, 5)} ₲</p>
      <p>Назначение: ${purpose}</p>
      <button id="confirmPayBtn" style="padding:10px;margin-top:10px;">Оплатить</button>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 50,
      cornerTopRadius: 20,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false
    }
  );
  document.getElementById("confirmPayBtn").onclick = async () => {
    if (!currentUserId) return;
    try {
      if (!csrfToken) {
        await fetchCsrfToken();
      }
      const resp = await fetch(`${API_URL}/payMerchantOneTime`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ userId: currentUserId, merchantId, amount, purpose })
      });
      const data = await resp.json();
      if (data.success) {
        alert("✅ Оплачено!");
        document.getElementById("confirmPayMerchantModal")?.remove();
        fetchUserData();
      } else {
        alert("❌ Ошибка: " + data.error);
      }
    } catch (err) {
      console.error("Error paying merchant:", err);
      showConnectionError("Ошибка соединения при оплате мерчанту");
    }
  };
}

/**************************************************
 * CONFIRM USER‑TO‑USER TRANSFER (via scanned QR)
 * — обновляет список users и гарантирует скрытие bottomBar
 **************************************************/
async function confirmPayUserModal({ userId, amount, purpose }) {
  /* ───────── валидация ───────── */
  if (!userId || !amount || amount <= 0) {
    showNotification("❌ Некорректные данные для перевода", "error");
    return;
  }

  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";               // прячем сразу

  /* ───────── обновляем глобальный список пользователей ───────── */
  try {
    const uRes  = await fetch(`${API_URL}/users`, { credentials: "include" });
    const uJson = await uRes.json();
    if (uJson.success && Array.isArray(uJson.users)) {
      window.users = uJson.users;                // id, first_name, photo_url
    } else {
      window.users = window.users || [];
    }
  } catch (err) {
    console.error("Ошибка при получении /users:", err);
    window.users = window.users || [];
  }

  /* ───────── ищем пользователя ───────── */
  const userData = users.find(u => u.id === userId) || {
    first_name: `ID: ${userId}`,
    photo_url : "photo/default.png"
  };

  /* ───────── вёрстка модалки ───────── */
  const userHtml = `
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="${userData.photo_url}"
           style="width:48px;height:48px;border-radius:50%;object-fit:cover;box-shadow:0 0 4px rgba(0,0,0,0.1);" />
      <div>
        <div style="font-weight:600;color:#1A1A1A;font-size:16px;">
          ${userData.first_name}
        </div>
        <div style="font-size:12px;color:#888;">ID: ${userId}</div>
      </div>
    </div>`;

  createModal(
    "confirmPayUserModal",
    `
      <div style="
        max-width:400px;margin:0 auto;padding:24px;
        background:#fff;border-radius:24px;
        box-shadow:0 4px 20px rgba(0,0,0,0.1);margin-top:60px;
      ">
        <div style="text-align:center;margin-bottom:24px;">
          ${userHtml}
        </div>
        <div style="margin-bottom:24px;">
          <div style="background:#F8F9FB;border-radius:16px;padding:16px;">
            <div style="color:#666;font-size:14px;margin-bottom:4px;">Сумма</div>
            <div style="font-weight:500;color:#1A1A1A;">
              ${formatBalance(amount, 5)} ₲
            </div>
          </div>
        </div>
        ${purpose ? `
          <div style="background:#F8F9FB;border-radius:16px;padding:16px;margin-bottom:24px;">
            <div style="color:#666;font-size:14px;margin-bottom:4px;">Назначение</div>
            <div style="font-weight:500;color:#1A1A1A;">${purpose}</div>
          </div>` : ''}
        <button id="confirmPayUserBtn" style="
          width:100%;padding:16px;
          background:linear-gradient(90deg,#2F80ED,#2D9CDB);
          border:none;border-radius:12px;color:#fff;
          font-weight:600;font-size:16px;cursor:pointer;
        ">
          Подтвердить перевод
        </button>
      </div>
    `,
    {
      showCloseBtn      : true,
      cornerTopMargin   : 0,
      cornerTopRadius   : 0,
      hasVerticalScroll : true,
      defaultFromBottom : true,
      noRadiusByDefault : false,
      contentMaxHeight  : "calc(100vh - 160px)",
      onClose           : () => {                 // показываем обратно только при закрытии
        if (bottomBar) bottomBar.style.display = "flex";
      }
    }
  );

  /* на всякий случай ещё раз убеждаемся, что панель скрыта */
  if (bottomBar) bottomBar.style.display = "none";

  /* ───────── обработчик кнопки "Подтвердить" ───────── */
  document.getElementById("confirmPayUserBtn").onclick = async () => {
    try {
      if (!currentUserId) throw new Error("Требуется авторизация");
      if (!csrfToken) await fetchCsrfToken();

      const resp = await fetch(`${API_URL}/transfer`, {
        method      : "POST",
        credentials : "include",
        headers     : {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ toUserId: userId, amount: Number(amount) })
      });
      const result = await resp.json();
      if (!resp.ok || !result.success) {
        throw new Error(result.error || "Ошибка сервера");
      }

      showNotification("✅ Перевод успешно выполнен", "success");
      document.getElementById("confirmPayUserModal")?.remove();
      if (bottomBar) bottomBar.style.display = "flex";
      await fetchUserData();
    } catch (err) {
      console.error("Transfer error:", err);
      document.getElementById("confirmPayUserModal")?.remove();
      if (bottomBar) bottomBar.style.display = "flex";
      showNotification(`❌ ${err.message}`, "error");
    }
  };
}

/**************************************************
 * QR CODE DATA PARSING
 **************************************************/
function parseQRCodeData(qrString) {
  const obj = { type: null, userId: null, merchantId: null, amount: 0, purpose: "" };
  try {
    if (!qrString.startsWith("guga://")) return obj;
    
    const queryString = qrString.replace("guga://", "");
    const searchParams = new URLSearchParams(queryString);

    obj.type = searchParams.get("type") || null;
    obj.userId = searchParams.get("userId") || searchParams.get("toUserId") || null;
    obj.merchantId = searchParams.get("merchantId") || null;
    obj.amount = parseFloat(searchParams.get("amount")) || 0;
    obj.purpose = decodeURIComponent(searchParams.get("purpose") || "");

  } catch (err) {
    console.error("Error parsing QR code:", err);
  }
  return obj;
}

/**************************************************
 * CURRENCY EXCHANGE
 **************************************************/
/* =========  CURRENCY EXCHANGE  ========= */
let currentExchangeDirection = "coin_to_rub";
let currentExchangeRate = 0;

async function openExchangeModal() {
  showGlobalLoading();

  // прячем нижнюю панель, когда открываем модалку
  const bottomBar = document.getElementById('bottomBar');
  if (bottomBar) bottomBar.style.display = 'none';

  createModal(
    "exchangeModal",
    `
<div class="exchange-container">
    <div class="exchange-header">
        <div class="header-info">
            <div class="exchange-title">Обмен валюты</div>
            <div id="currentRate" class="current-rate">1 ₲ = 0.00 ₽</div>
        </div>
    </div>

    <div class="chart-container">
        <div class="chart-header">
            <span class="rate-label">Курс GUGA/RUB</span>
            <div class="rate-change">
                <span id="rateChangeArrow" class="rate-arrow">→</span>
                <span id="rateChangePercent" class="rate-percent">0.00%</span>
            </div>
        </div>
        <div class="chart-wrapper">
            <canvas id="exchangeChart"></canvas>
        </div>
    </div>
    
    <div class="currency-block from-currency">
        <div class="currency-header">
            <span class="currency-label">Отдаёте</span>
            <span id="fromBalance" class="balance">0.00000 ₲</span>
        </div>
        <div class="input-group">
            <input 
                type="number" 
                id="amountInput" 
                placeholder="0.00" 
                class="currency-input">
            <div class="currency-display">
                <img src="photo/15.png" class="currency-icon">
                <span class="currency-symbol">GUGA</span>
            </div>
        </div>
    </div>

    <!-- Swap button -->
    <button id="swapBtn" class="swap-btn">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M8 11L12 7L16 11M16 13L12 17L8 13" stroke="#2F80ED" stroke-width="2"/>
        </svg>
    </button>

    <div class="currency-block to-currency">
        <div class="currency-header">
            <span class="currency-label">Получаете</span>
            <span id="toBalance" class="balance">0.00 ₽</span>
        </div>
        <div class="input-group">
            <input 
                type="text" 
                id="toAmount" 
                placeholder="0.00" 
                class="currency-input"
                disabled>
            <div class="currency-display">
                <img src="photo/18.png" class="currency-icon">
                <span class="currency-symbol">RUB</span>
            </div>
        </div>
    </div>

    <!-- Confirm exchange button -->
    <button id="btnPerformExchange" class="submit-btn">
        Подтвердить обмен
    </button>

    <div class="bottom-spacer"></div>
</div>
    `,
    {
      showCloseBtn: true,          // включаем кнопку закрытия
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      contentMaxHeight: "100vh",
      noRadiusByDefault: true,
      onClose: () => {
        // возвращаем bottomBar при закрытии
        if (bottomBar) bottomBar.style.display = 'flex';
      }
    }
  );

  initExchange();
}

/**************************************************
 * EXCHANGE STYLES
 **************************************************/
const exchangeStyles = `
.exchange-container {
  margin-bottom: 150px;
}
.exchange-header {
  margin-bottom: 32px;
}
.exchange-title {
  font-size: 24px;
  font-weight: 600;
  color: #1A1A1A;
  margin-bottom: 8px;
}
.current-rate {
  font-size: 24px;
  color: #2f80ed;
}
.chart-container {
  background: #F8F9FB;
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 24px;
}
.chart-wrapper canvas {
  height: 200px !important;
}
.currency-block {
  background: #F8F9FB;
  border-radius: 16px;
  padding: 16px;
  margin: 8px 0;
}
.currency-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.balance {
  font-weight: 500;
}
.swap-btn {
  width: 56px;
  height: 56px;
  background: #F8F9FB;
  border: 2px solid #E6E6EB;
  border-radius: 50%;
  margin: 1px auto;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, transform 0.2s;
  cursor: pointer;
}
.swap-btn:hover {
  background: #eef0f3;
}
@keyframes swapRotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.swap-btn:active {
  animation: swapRotate 0.5s forwards ease;
}
.input-group {
  display: flex;
  gap: 12px;
  align-items: center;
}
.currency-input {
  flex: 1;
  border: none;
  background: none;
  font-size: 20px;
  padding: 12px 0;
  color: #1A1A1A;
  font-weight: 500;
}
.currency-input::placeholder {
  color: #B1B8C5;
}
.currency-display {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #F8F9FB;
  border-radius: 12px;
  padding: 10px 16px;
  border: 1px solid #E6E6EB;
}
.submit-btn {
  position: fixed;
  bottom: 20px;
  left: 16px;
  right: 16px;
  padding: 18px;
  background: linear-gradient(90deg, #2F80ED, #2D9CDB);
  border: none;
  border-radius: 12px;
  color: white;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.1);
  z-index: 9999;
  margin-bottom: 0px;
}
.bottom-spacer {
  height: 0px;
}

.currency-block .input-group {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

.currency-block .currency-input {
  /* input будет занимать всё доступное место и при этом не вылезет */
  flex: 1 1 auto;
  min-width: 0;
}

.currency-block .currency-display {
  /* иконка + символ всегда «свёрстаны» по содержимому */
  flex: 0 0 auto;
}
`;
const style = document.createElement('style');
style.textContent = exchangeStyles;
document.head.appendChild(style);

/**************************************************
 * EXCHANGE INITIALIZATION
 **************************************************/
async function initExchange() {
  try {
    const [ratesResp, userResp] = await Promise.all([
      fetch(`${API_URL}/exchangeRates?limit=100`, { credentials: "include" }),
      fetch(`${API_URL}/user`, { credentials: "include" })
    ]);
    const ratesData = await ratesResp.json();
    const userData = await userResp.json();
    if (ratesData.success) {
      currentExchangeRate = ratesData.rates[0]?.exchange_rate || 0;
      updateRateDisplay(ratesData.rates);
      initChart(ratesData.rates);
    }
    if (userData.success) {
      document.getElementById('fromBalance').textContent =
        formatBalance(userData.user.balance, 5) + " ₲";
      document.getElementById('toBalance').textContent =
        formatBalance(userData.user.rub_balance, 2) + " ₽";
    }
    document.getElementById('swapBtn').addEventListener('click', swapCurrencies);
    document.getElementById('amountInput').addEventListener('input', updateConversion);
    document.getElementById('btnPerformExchange').addEventListener('click', performExchange);
  } catch (error) {
    showNotification('Не удалось загрузить данные', 'error');
    console.error(error);
  } finally {
    hideGlobalLoading();
  }
}

/**************************************************
 * UPDATE CURRENT RATE DISPLAY (+% change)
 **************************************************/
function updateRateDisplay(rates) {
  if (!rates || rates.length < 2) return;
  const current = rates[0].exchange_rate;
  const previous = rates[1].exchange_rate;
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  document.getElementById('currentRate').textContent = `1 ₲ = ${formatBalance(current, 2)} ₽`;
  const arrow = document.getElementById('rateChangeArrow');
  const ratePercent = document.getElementById('rateChangePercent');
  if (diff > 0) {
    arrow.textContent = '↑';
    arrow.style.color = '#4BA857';
    ratePercent.textContent = `+${percent.toFixed(2)}%`;
    ratePercent.style.color = '#4BA857';
  } else {
    arrow.textContent = '↓';
    arrow.style.color = '#D21B1B';
    ratePercent.textContent = `${percent.toFixed(2)}%`;
    ratePercent.style.color = '#D21B1B';
  }
}

/**************************************************
 * INIT CHART
 **************************************************/
function initChart(rates) {
  const ctx = document.getElementById('exchangeChart').getContext('2d');
  const labels = rates.slice(0, 100).reverse().map(r =>
    new Date(r.created_at).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    })
  );
  if (exchangeChartInstance) exchangeChartInstance.destroy();
  exchangeChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: rates.slice(0, 100).reverse().map(r => r.exchange_rate),
        borderWidth: 2,
        borderColor: '#2F80ED',
        tension: 0.4,
        fill: false,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          position: 'right',
          grid: { color: '#E6E6EB' },
          ticks: {
            color: '#76808F',
            callback: value => `${value} ₽`
          }
        }
      }
    }
  });
}

/**************************************************
 * HELPER FUNCTIONS FOR BALANCES
 **************************************************/
function parseBalanceString(str) {
  const parts = str.trim().split(" ");
  if (parts.length < 2) {
    return { amount: 0, symbol: "" };
  }
  const amount = parseFloat(parts[0]) || 0;
  const symbol = parts[1];
  return { amount, symbol };
}

function formatBalanceValue(num, symbol) {
  if (symbol === "₲") {
    return formatBalance(num, 5) + " ₲";
  } else if (symbol === "₽") {
    return formatBalance(num, 2) + " ₽";
  }
  return num + " " + symbol;
}

/**************************************************
 * SWAP CURRENCIES (exchange form swap)
 **************************************************/
function swapCurrencies() {
  const swapBtn = document.getElementById('swapBtn');
  swapBtn.style.animation = 'swapRotate 0.5s forwards ease';
  setTimeout(() => { swapBtn.style.animation = 'none'; }, 500);
  currentExchangeDirection = currentExchangeDirection === 'coin_to_rub' ? 'rub_to_coin' : 'coin_to_rub';
  const fromDisplay = document.querySelector('.from-currency .currency-display');
  const toDisplay = document.querySelector('.to-currency .currency-display');
  const fromBalanceEl = document.getElementById('fromBalance');
  const toBalanceEl = document.getElementById('toBalance');
  const amountInput = document.getElementById('amountInput');
  const toAmount = document.getElementById('toAmount');
  // Swap input values
  [amountInput.value, toAmount.value] = [toAmount.value, amountInput.value];
  // Swap display currencies
  if (currentExchangeDirection === 'coin_to_rub') {
    fromDisplay.innerHTML = `
      <img src="photo/15.png" class="currency-icon">
      <span class="currency-symbol">GUGA</span>
    `;
    toDisplay.innerHTML = `
      <img src="photo/18.png" class="currency-icon">
      <span class="currency-symbol">RUB</span>
    `;
  } else {
    fromDisplay.innerHTML = `
      <img src="photo/18.png" class="currency-icon">
      <span class="currency-symbol">RUB</span>
    `;
    toDisplay.innerHTML = `
      <img src="photo/15.png" class="currency-icon">
      <span class="currency-symbol">GUGA</span>
    `;
  }
  // Swap balance values
  const oldFrom = parseBalanceString(fromBalanceEl.textContent);
  const oldTo = parseBalanceString(toBalanceEl.textContent);
  fromBalanceEl.textContent = formatBalanceValue(oldTo.amount, oldFrom.symbol);
  toBalanceEl.textContent = formatBalanceValue(oldFrom.amount, oldTo.symbol);
  // Update conversion output
  updateConversion();
}

/**************************************************
 * UPDATE CONVERSION (on input change)
 **************************************************/
function updateConversion() {
  const input = document.getElementById('amountInput');
  const output = document.getElementById('toAmount');
  const value = parseFloat(input.value) || 0;
  if (currentExchangeDirection === 'coin_to_rub') {
    output.value = formatBalance(value * currentExchangeRate, 2);
  } else {
    output.value = formatBalance(value / currentExchangeRate, 5);
  }
}

/**************************************************
 * PERFORM EXCHANGE (API request)
 **************************************************/
async function performExchange() {
  const amount = parseFloat(document.getElementById('amountInput').value);
  if (!amount || amount <= 0) {
    showNotification('Введите корректную сумму', 'error');
    return;
  }
  // Prevent immediate repeat in same direction
  if (lastDirection === currentExchangeDirection) {
    showNotification('Пожалуйста, обновите курс или смените направление', 'error');
    return;
  }
  showGlobalLoading();
  try {
    if (!csrfToken) {
      await fetchCsrfToken();
    }
    const response = await fetch(`${API_URL}/exchange`, {
      method: "POST",
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        direction: currentExchangeDirection,
        amount
      })
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showConnectionError("Ответ не является JSON");
      throw err;
    }
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Ошибка обмена');
    }
    showNotification('Обмен выполнен успешно!', 'success');
    lastDirection = currentExchangeDirection;
    setTimeout(() => { lastDirection = null; }, 5000);
    await initExchange(); // Refresh data (balances, rate)
  } catch (error) {
    showNotification(error.message, 'error');
    console.error(error);
  } finally {
    hideGlobalLoading();
  }
}

/**************************************************
 * NOTIFICATIONS (Toast style)
 **************************************************/
// Inject notification styles
const notificationStyle = document.createElement("style");
notificationStyle.textContent = `
  #notificationContainer {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 9999999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-end;
  }
  .notification {
    font-family: "Oswald", sans-serif;
    font-size: 14px;
    position: relative;
    min-width: 220px;
    max-width: 340px;
    word-break: break-word;
    background: #fff;
    border: 1px solid #E6E6EB;
    border-radius: 12px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    color: #333;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .notification::before {
    content: "";
    display: block;
    position: absolute;
    left: 0; top: 0;
    width: 10px;
    height: 100%;
    border-radius: 12px 0 0 12px;
  }
  .notification-success::before {
    background-color: #2F80ED;
  }
  .notification-error::before {
    background-color: #D21B1B;
  }
  .notification-info::before {
    background-color: #2D9CDB;
  }
  .notification-close {
    background: none;
    border: none;
    color: #999;
    font-size: 20px;
    cursor: pointer;
    margin-left: 8px;
    transition: color 0.2s;
  }
  .notification-close:hover {
    color: #666;
  }
`;
document.head.appendChild(notificationStyle);
// Create notification container
const notificationContainer = document.createElement("div");
notificationContainer.id = "notificationContainer";
document.body.appendChild(notificationContainer);

/**
 * Show a notification in a unified style.
 * @param {string} message - Message text.
 * @param {'success'|'error'|'info'} [type='info'] - Type of notification (color).
 * @param {number} [duration=5000] - Auto-close duration in ms (0 for no auto-close).
 */
function showNotification(message, type = "info", duration = 5000) {
  const notif = document.createElement("div");
  notif.classList.add("notification");
  switch (type) {
    case "success":
      notif.classList.add("notification-success");
      break;
    case "error":
      notif.classList.add("notification-error");
      break;
    default:
      notif.classList.add("notification-info");
      break;
  }
  // Message text
  const textEl = document.createElement("div");
  textEl.style.flex = "1";
  textEl.textContent = message;
  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "notification-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => {
    if (notif.parentNode === notificationContainer) {
      notificationContainer.removeChild(notif);
    }
  });
  notif.appendChild(textEl);
  notif.appendChild(closeBtn);
  notificationContainer.appendChild(notif);
  // Auto-remove after duration
  if (duration && duration > 0) {
    setTimeout(() => {
      if (notif.parentNode === notificationContainer) {
        notificationContainer.removeChild(notif);
      }
    }, duration);
  }
}

/**************************************************
 * TRANSACTION HISTORY
 **************************************************/
function openHistoryModal(horizontalSwitch) {
  createModal(
    "historyModal",
    `
      <div class="history-container">
        <div class="history-header">
          <h2 class="history-title">История</h2>
        </div>
        <div class="history-content">
          <ul id="transactionList" class="transaction-list"></ul>
        </div>
      </div>
    `,
    {
      showCloseBtn: false,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: true,
      horizontalSwitch: !!horizontalSwitch
    }
  );
  fetchTransactionHistory();

  // Inject styles for history if not already
  if (!document.getElementById("historyStyles")) {
    const historyStyles = `
.transaction-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.transaction-group {
  margin-bottom: 16px;
}
.transaction-date {
  font-size: 14px;
  font-weight: 600;
  color: #1A1A1A;
  margin: 16px 0 8px;
}
.transaction-card {
  background: #F8F9FB;
  border-radius: 12px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  cursor: pointer;
}
.transaction-card:hover {
  background: #E6E6EB;
}
.transaction-icon-wrap {
  flex-shrink: 0;
}
.transaction-text-wrap {
  flex: 1;
  margin: 0 12px;
  min-width: 0;
}
.transaction-title {
  font-size: 16px;
  font-weight: 500;
  color: #1A1A1A;
}
.transaction-subtitle {
  font-size: 14px;
  color: #909099;
}
.transaction-info-wrap {
  text-align: right;
}
.transaction-amount {
  font-size: 16px;
  font-weight: 500;
}
.transaction-time {
  font-size: 13px;
  color: #909099;
}
.no-operations {
  text-align: center;
  color: #909099;
  font-style: italic;
  padding: 16px;
}
`;
    const styleEl = document.createElement("style");
    styleEl.id = "historyStyles";
    styleEl.textContent = historyStyles;
    document.head.appendChild(styleEl);
  }
}

/**
 * Fetch transaction history and populate the list.
 */
async function fetchTransactionHistory() {
  if (!currentUserId) return;
  showGlobalLoading();
  try {
    const resp = await fetch(`${API_URL}/transactions?userId=${currentUserId}`, {
      credentials: "include"
    });
    const data = await resp.json();
    if (data.success && data.transactions) {displayTransactionHistory(data.transactions);
    } else {
      console.error("History error:", data.error);
    }
  } catch (err) {
    console.error("fetchTransactionHistory error:", err);
  } finally {
    hideGlobalLoading();
  }
}

/**
 * Render transaction history into the DOM.
 */
function displayTransactionHistory(transactions) {
  const list = document.getElementById("transactionList");
  if (!list) return;
  list.innerHTML = "";
  if (!transactions.length) {
    list.innerHTML = "<li class='no-operations'>Нет операций</li>";
    return;
  }
  const groups = {};
  transactions.forEach((tx) => {
    const d = new Date(tx.client_time || tx.created_at);
    const label = getDateLabel(d);
    if (!groups[label]) groups[label] = [];
    groups[label].push(tx);
  });
  const sortedDates = Object.keys(groups).sort((a, b) => {
    const dA = new Date(groups[a][0].client_time || groups[a][0].created_at);
    const dB = new Date(groups[b][0].client_time || groups[b][0].created_at);
    return dB - dA;
  });
  sortedDates.forEach((dateStr) => {
    const dateItem = document.createElement("li");
    dateItem.className = "transaction-group";
    const dateHeader = document.createElement("div");
    dateHeader.className = "transaction-date";
    dateHeader.textContent = dateStr;
    dateItem.appendChild(dateHeader);
    groups[dateStr].forEach((tx) => {
      const timeStr = new Date(tx.client_time || tx.created_at).toLocaleTimeString("ru-RU");
      let iconSrc = "";
      let titleText = "";
      let detailsText = "";
      let amountSign = "";
      let amountValue = formatBalance(tx.amount, 5);
      let currencySymbol = "₲";
      let color = "#000";
      if (tx.currency === "RUB") {
        amountValue = formatBalance(tx.amount, 2);
        currencySymbol = "₽";
      }
      if (tx.type === "merchant_payment") {
        iconSrc = "photo/92.png";
        titleText = "Оплата по QR";
        detailsText = `Мерчант: ${tx.merchant_id || (tx.to_user_id && tx.to_user_id.replace("MERCHANT:", "")) || "???"}`;
        amountSign = "-";
        color = "#000";
      } else if (tx.from_user_id === currentUserId) {
        iconSrc = "photo/67.png";
        titleText = "Отправлено";
        detailsText = `Кому: ${tx.to_user_id}`;
        amountSign = "-";
        color = "#000";
      } else if (tx.to_user_id === currentUserId) {
        iconSrc = "photo/66.png";
        titleText = "Получено";
        detailsText = `От кого: ${tx.from_user_id}`;
        amountSign = "+";
        color = "rgb(25, 150, 70)";
      } else if (tx.type === "exchange") {
        iconSrc = "photo/67.png";
        titleText = "Обмен";
        detailsText = `Направление: ${tx.direction === "rub_to_coin" ? "Рубли → Монеты" : "Монеты → Рубли"}`;
        amountSign = tx.direction === "rub_to_coin" ? "+" : "-";
        color = tx.direction === "rub_to_coin" ? "rgb(25, 150, 70)" : "rgb(102, 102, 102)";
        amountValue = formatBalance(tx.amount, 5);
        currencySymbol = tx.direction === "rub_to_coin" ? "₲" : "₽";
      }
      const cardDiv = document.createElement("div");
      cardDiv.className = "transaction-card";
      cardDiv.dataset.hash = tx.hash;
      cardDiv.addEventListener("click", () => {
        if (tx.hash) showTransactionDetails(tx.hash);
      });
      const leftDiv = document.createElement("div");
      leftDiv.className = "transaction-icon-wrap";
      const iconImg = document.createElement("img");
      iconImg.src = iconSrc;
      iconImg.alt = "icon";
      iconImg.style.width = "34px";
      iconImg.style.height = "34px";
      leftDiv.appendChild(iconImg);
      const centerDiv = document.createElement("div");
      centerDiv.className = "transaction-text-wrap";
      const titleEl = document.createElement("div");
      titleEl.className = "transaction-title";
      titleEl.textContent = titleText;
      const detailsEl = document.createElement("div");
      detailsEl.className = "transaction-subtitle";
      detailsEl.textContent = detailsText;
      centerDiv.appendChild(titleEl);
      centerDiv.appendChild(detailsEl);
      const rightDiv = document.createElement("div");
      rightDiv.className = "transaction-info-wrap";
      const amountEl = document.createElement("div");
      amountEl.className = "transaction-amount";
      amountEl.style.color = color;
      amountEl.textContent = `${amountSign}${amountValue} ${currencySymbol}`;
      const timeEl = document.createElement("div");
      timeEl.className = "transaction-time";
      timeEl.textContent = timeStr;
      rightDiv.appendChild(amountEl);
      rightDiv.appendChild(timeEl);
      cardDiv.appendChild(leftDiv);
      cardDiv.appendChild(centerDiv);
      cardDiv.appendChild(rightDiv);
      dateItem.appendChild(cardDiv);
    });
    list.appendChild(dateItem);
  });
}

/**
 * Formats date as "Сегодня"/"Вчера"/"DD.MM.YYYY".
 */
function getDateLabel(dateObj) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dateObj.toDateString() === today.toDateString()) return "Сегодня";
  if (dateObj.toDateString() === yesterday.toDateString()) return "Вчера";
  return dateObj.toLocaleDateString("ru-RU");
}

/**************************************************
 * MERCHANT UI
 **************************************************/
async function openMerchantUI() {
  if (!currentMerchantId) {
    await fetchMerchantInfo();
    if (!currentMerchantId) {
      alert("Ошибка: мерчант не авторизован");
      return;
    }
  }
  // Hide previous UI if needed
  hideMainUI();
  removeAllModals();
  // Show merchant dashboard modal
  createModal(
    "merchantUIModal",
    `
      <div style="
        background:#f7f7f7;
        border-radius:20px;
        padding:20px;
        max-width:400px;
        margin:40px auto 0 auto;
        box-shadow:0 2px 5px rgba(0,0,0,0.1);
        display:flex;
        flex-direction:column;
        gap:16px;
        align-items:center;
      ">
        <h2 style="margin:0;">Кабинет мерчанта</h2>
        <p>Мерчант: <strong>${currentMerchantId}</strong></p>
        <p>Баланс: <span id="merchantBalanceValue">0.00000</span> ₲</p>

        <div style="display:flex; gap:10px; margin-top:20px;">
          <button id="merchantCreateQRBtn" style="padding:10px; border:none; border-radius:8px; cursor:pointer; background:#000; color:#fff;">
            Создать QR
          </button>
          <button id="merchantTransferBtn" style="padding:10px; border:none; border-radius:8px; cursor:pointer; background:#000; color:#fff;">
            Перевести
          </button>
          <button id="merchantLogoutBtn" style="padding:10px; border:none; border-radius:8px; cursor:pointer; background:#000; color:#fff;">
            Выйти
          </button>
        </div>
      </div>
    `,
    {
      showCloseBtn: false,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: true
    }
  );
  // Button events
  document.getElementById("merchantCreateQRBtn").onclick = openOneTimeQRModal;
  document.getElementById("merchantTransferBtn").onclick = openMerchantTransferModal;
  document.getElementById("merchantLogoutBtn").onclick = logout;
  // Load merchant balance
  fetchMerchantData();
}

async function fetchMerchantData() {
  await fetchMerchantBalance();
  try {
    const resp = await fetch(`${API_URL}/halvingInfo`, { credentials: "include" });
    const data = await resp.json();
    if (data.success) {
      currentHalvingStep = data.halvingStep || 0;
    }
  } catch (err) {
    console.error("fetchMerchantData halvingInfo:", err);
  }
}

async function fetchMerchantInfo() {
  try {
    const resp = await fetch(`${API_URL}/merchant/info`, { credentials: "include" });
    const data = await resp.json();
    if (resp.ok && data.success && data.merchant) {
      currentMerchantId = data.merchant.merchant_id;
    }
  } catch (err) {
    console.error("fetchMerchantInfo:", err);
  }
}

async function fetchMerchantBalance() {
  if (!currentMerchantId) return;
  try {
    const resp = await fetch(`${API_URL}/merchantBalance?merchantId=${currentMerchantId}`, {
      credentials: "include"
    });
    const data = await resp.json();
    if (data.success) {
      const balanceValueEl = document.getElementById("merchantBalanceValue");
      if (balanceValueEl) {
        balanceValueEl.textContent = formatBalance(data.balance, 5);
      }
    }
  } catch (err) {
    console.error("fetchMerchantBalance:", err);
  }
}

/* Create payment request QR (merchant) */
function openOneTimeQRModal() {
  createModal(
    "createOneTimeQRModal",
    `
      <h3>Создать запрос на оплату</h3>
      <label>Сумма (₲):</label>
      <input type="number" id="qrAmountInput" step="0.00001" style="padding:8px;font-size:16px;" oninput="calcRubEquivalent()">
      <p id="qrRubEquivalent"></p>
      <label>Назначение:</label>
      <input type="text" id="qrPurposeInput" style="padding:8px;font-size:16px;">
      <button id="createQRBtn" style="padding:10px;margin-top:10px;">Создать</button>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 50,
      cornerTopRadius: 20,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false
    }
  );
  document.getElementById("createQRBtn").onclick = () => {
    const amount = parseFloat(document.getElementById("qrAmountInput").value);
    const purpose = document.getElementById("qrPurposeInput").value || "";
    if (!amount || amount <= 0) {
      alert("Некорректная сумма");
      return;
    }
    document.getElementById("createOneTimeQRModal")?.remove();
    createMerchantQR(amount, purpose);
  };
}

function calcRubEquivalent() {
  const coinVal = parseFloat(document.getElementById("qrAmountInput").value) || 0;
  if (!currentExchangeRate || isNaN(currentExchangeRate)) {
    document.getElementById("qrRubEquivalent").textContent = "Курс не доступен";
    return;
  }
  const rubVal = coinVal * currentExchangeRate;
  document.getElementById("qrRubEquivalent").textContent =
    "≈ " + formatBalance(rubVal, 2) + " RUB";
}

function createMerchantQR(amount, purpose) {
  const qrData = `guga://merchantId=${currentMerchantId}&amount=${amount}&purpose=${encodeURIComponent(purpose)}`;
  createModal(
    "merchantQRModal",
    `
      <div style="
        background:#f7f7f7;
        border-radius:20px;
        padding:20px;
        max-width:400px;
        margin:0 auto;
        box-shadow:0 2px 5px rgba(0,0,0,0.1);
        display:flex;
        flex-direction:column;
        margin-top:50px;
        align-items:center;
      ">
        <div id="merchantQRModalContainer" style="display:flex; justify-content:center; margin-bottom:10px;"></div>
        <p style="margin-top:10px;">
          Запрашиваемая сумма: <strong>${formatBalance(amount, 5)} ₲</strong>
        </p>
        <p style="margin:0;">
          Назначение: <strong>${purpose}</strong>
        </p>
      </div>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 50,
      cornerTopRadius: 20,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false
    }
  );
  // Generate QR (350x350)
  if (typeof QRCode === "function") {
    const container = document.getElementById("merchantQRModalContainer");
    if (container) {
      const qrElem = document.createElement("div");
      container.appendChild(qrElem);
      new QRCode(qrElem, {
        text: qrData,
        width: 350,
        height: 350
      });
    }
  } else {
    const cont = document.getElementById("merchantQRModalContainer");
    if (cont) {
      cont.textContent = "QR data: " + qrData;
    }
  }
  // Start polling for payment status
  monitorPayment(qrData);
}

function monitorPayment(qrData) {
  const timer = setInterval(async () => {
    try {
      const resp = await fetch(
        `${API_URL}/checkPaymentStatus?merchantId=${currentMerchantId}&qrData=${encodeURIComponent(qrData)}`,
        { credentials: "include" }
      );
      const data = await resp.json();
      if (data.success && data.paid) {
        clearInterval(timer);
        document.getElementById("merchantQRModal")?.remove();
        alert("✅ Оплата прошла успешно!");
        fetchMerchantBalance();
      }
    } catch (err) {
      console.error("monitorPayment:", err);
    }
  }, 3000);
}

/* Transfer modal (merchant -> user) */
function openMerchantTransferModal() {
  createModal(
    "merchantTransferModal",
    `
      <h3>Перевести на пользователя</h3>
      <label>ID пользователя:</label>
      <input type="text" id="merchantToUserIdInput" style="padding:8px;font-size:16px;">
      <label>Сумма (₲):</label>
      <input type="number" id="merchantTransferAmountInput" step="0.00001" style="padding:8px;font-size:16px;">
      <button id="merchantTransferSendBtn" style="padding:10px;margin-top:10px;">Отправить</button>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 50,
      cornerTopRadius: 20,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false
    }
  );
  document.getElementById("merchantTransferSendBtn").onclick = async () => {
    const toUserId = document.getElementById("merchantToUserIdInput").value;
    const amount = parseFloat(document.getElementById("merchantTransferAmountInput").value);
    if (!toUserId || !amount || amount <= 0) {
      alert("Некорректные данные");
      return;
    }
    try {
      if (!csrfToken) {
        await fetchCsrfToken();
      }
      const resp = await fetch(`${API_URL}/merchantTransfer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ merchantId: currentMerchantId, toUserId, amount })
      });
      const data = await resp.json();
      if (data.success) {
        alert("Перевод выполнен!");
        document.getElementById("merchantTransferModal")?.remove();
        fetchMerchantBalance();
      } else {
        alert("Ошибка: " + data.error);
      }
    } catch (err) {
      console.error("merchantTransfer error:", err);
      showConnectionError("Ошибка при переводе мерчанта");
    }
  };
}

/**************************************************
 * UPDATE UI
 **************************************************/
function updateUI() {
  if (currentUserId && !currentMerchantId) {
    createMainUI();
  } else if (currentMerchantId) {
    openMerchantUI();
  } else {
    openAuthModal();
  }
}

/**************************************************
 * HIDE MAIN UI (for merchant switch)
 **************************************************/
function hideMainUI() {
  const balanceDisplay = document.getElementById("balanceDisplay");
  if (balanceDisplay) balanceDisplay.style.display = "none";
  const mineContainer = document.getElementById("mineContainer");
  if (mineContainer) mineContainer.style.display = "none";
  const actionContainer = document.getElementById("actionButtonsContainer");
  if (actionContainer) actionContainer.remove();
}

/**************************************************
 * QR SCANNER UTILITY
 **************************************************/
function startUniversalQRScanner(videoElement, onResultCallback) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Камера не поддерживается вашим браузером");
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((stream) => {
      videoElement.srcObject = stream;
      videoElement.setAttribute("playsinline", true);
      videoElement.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let alreadyScanned = false;
      function tick() {
        if (!alreadyScanned && videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          if (code) {
            alreadyScanned = true;
            stopStream(stream);
            onResultCallback(code.data);
            return;
          }
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })
    .catch((err) => {
      alert("Доступ к камере отклонён: " + err);
    });
}

function stopStream(stream) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**************************************************
 * DOMContentLoaded (initialization)
 **************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  await fetchCsrfToken();
  await fetchUserData();
  updateUI();
  const mineBtn = document.getElementById("mineBtn");
  if (mineBtn) {
    mineBtn.addEventListener("click", mineCoins);
  }
});

/**************************************************
 * TRANSACTION DETAILS MODAL
 **************************************************/
async function showTransactionDetails(hash) {
  const bottomBar = document.getElementById("bottomBar");
  if (bottomBar) bottomBar.style.display = "none";

  try {
    /* 1. параллельно запрашиваем транзакцию и свежих пользователей */
    const [txRes, usersRes] = await Promise.all([
      fetch(`${API_URL}/transaction/${hash}`, { credentials: "include" }),
      fetch(`${API_URL}/users`,           { credentials: "include" })
    ]);

    const txData    = await txRes.json();
    const usersData = await usersRes.json();

    if (!txData.success || !txData.transaction) {
      showNotification("Операция не найдена", "error");
      if (bottomBar) bottomBar.style.display = "flex";
      return;
    }

    /* 2. перезаписываем глобальный массив users (чтобы был всегда актуален) */
    if (usersData.success && Array.isArray(usersData.users)) {
      window.users = usersData.users;   // id, first_name, photo_url
    } else {
      window.users = window.users || [];  // fallback, если /users не ответил
    }

    const tx = txData.transaction;

    /* 3. остальной код без изменений */
    const symbol       = tx.currency === "RUB" ? "₽" : "₲";
    const amountValue  = formatBalance(tx.amount, tx.currency === "RUB" ? 2 : 5);
    const isOutgoing   = tx.from_user_id === currentUserId;
    const sign         = isOutgoing ? '-' : '+';
    const amount       = `${sign}${amountValue} ${symbol}`;
    const amountClass  = isOutgoing ? 'negative' : 'positive';
    const timestamp    = new Date(tx.created_at || tx.client_time).toLocaleString('ru-RU');

    const fromUser = users.find(u => u.id === tx.from_user_id) || {};
    const toUser   = users.find(u => u.id === tx.to_user_id)   || {};

    const fromAva  = fromUser.photo_url  || 'photo/15.png';
    const toAva    = toUser.photo_url    || 'photo/15.png';
    const fromName = fromUser.first_name || tx.from_user_id;
    const toName   = toUser.first_name   || tx.to_user_id;
    
    const fromIdLabel = `
      <div class="tx-user-info">
        <img src="${fromAva}" class="tx-avatar" />
        <div>
          <div class="tx-user-name">${fromName}</div>
          <div class="tx-user-id">ID: ${tx.from_user_id}</div>
        </div>
      </div>`;
    const toIdLabel = `
      <div class="tx-user-info">
        <img src="${toAva}" class="tx-avatar" />
        <div>
          <div class="tx-user-name">${toName}</div>
          <div class="tx-user-id">ID: ${tx.to_user_id}</div>
        </div>
      </div>`;

    // Иконка: 66 — входящий, 67 — исходящий
    const iconId = isOutgoing ? '67' : '66';

    createModal(
      "transactionDetailsModal",
      `
        <div class="tx-sheet">
          <div class="tx-icon">
            <img src="photo/${iconId}.png" width="48" height="48" />
          </div>
          <div class="tx-amount-main ${amountClass}">${amount}</div>
          <div class="tx-status success">Операция прошла успешно</div>

          <div class="tx-detail-box">
            <div class="tx-detail-row">
              <div class="tx-label">Дата и время</div>
              <div class="tx-value">${timestamp}</div>
            </div>

            <div class="tx-detail-row">
              <div class="tx-label">Отправитель</div>
              <div class="tx-value">${fromIdLabel}</div>
            </div>

            <div class="tx-detail-row">
              <div class="tx-label">Получатель</div>
              <div class="tx-value">${toIdLabel}</div>
            </div>

            <div class="tx-detail-row">
              <div class="tx-label">ID транзакции</div>
              <div class="tx-value copyable">
                <span>${tx.hash}</span>
                <button onclick="navigator.clipboard.writeText('${tx.hash}')">📋</button>
              </div>
            </div>

            ${tx.tags ? `
              <div class="tx-detail-row">
                <div class="tx-label">Теги</div>
                <div class="tx-value">${tx.tags}</div>
              </div>` : ''}
          </div>
        </div>
      `,
      {
        showCloseBtn: true,
        cornerTopMargin: 0,
        cornerTopRadius: 0,
        hasVerticalScroll: false,
        defaultFromBottom: true,
        noRadiusByDefault: false,
        onClose: () => {
          if (bottomBar) bottomBar.style.display = "flex";
        }
      }
    );

    // Инъекция стилей один раз
    if (!document.getElementById("txDetailStyles")) {
  const styleEl = document.createElement("style");
  styleEl.id = "txDetailStyles";
  styleEl.textContent = `
/* центрируем модалку и даём внутренний padding */
.tx-sheet{
  max-width:360px;
  margin:50px auto 0;     /* auto по горизонтали → по центру */
  background:#fff;
  border-radius:20px;
  // padding:20px;           /* содержимое не прилипает к левому краю */
  // box-shadow:0 4px 12px rgba(0,0,0,.1);
}

.tx-icon{ text-align:center; margin-bottom:12px; }
.tx-icon img{ width:80px; height:80px; }

.tx-amount-main{ text-align:center; font-size:24px; font-weight:700; margin:8px 0; }
.tx-amount-main.positive{ color:#27AE60; }
.tx-amount-main.negative{ color:#EB5757; }

.tx-status{
  text-align:center;
  margin-bottom:50px;
  font-size:12px;
  padding:4px 12px;
  background:#E8F6EF;
  color:#219653;
  border-radius:12px;
  display:inline-block;
}

.tx-detail-box{ background:#F8F9FB; border-radius:16px; padding:16px; }
.tx-detail-row{ display:flex; justify-content:space-between; align-items:center;
                padding:10px 0; border-bottom:1px solid #E6E6EB; }
.tx-detail-row:last-child{ border-bottom:none; }

.tx-label{ font-size:13px; color:#666; }
.tx-value{ font-size:14px; color:#1A1A1A; display:flex; align-items:center; gap:6px; }

.tx-user-info{ display:flex; align-items:center; gap:10px; }
.tx-avatar{ width:32px; height:32px; border-radius:50%; object-fit:cover;
            box-shadow:0 0 4px rgba(0,0,0,.1); }
.tx-user-name{ font-weight:600; color:#1A1A1A; }
.tx-user-id{ font-size:12px; color:#888; }

.copyable button{ background:none; border:none; cursor:pointer; font-size:14px; }
  `;
  document.head.appendChild(styleEl);
}
  } catch (err) {
    console.error("Ошибка при получении данных транзакции:", err);
    showNotification("Ошибка при загрузке", "error");
    if (bottomBar) bottomBar.style.display = "flex";
  }
}

/**************************************************
 * Telegram WebApp login handler
 **************************************************/
async function loginWithTelegramWebApp() {
  try {
    const initData = Telegram.WebApp.initData;
    if (!initData) {
      showNotification("Не удалось получить данные Telegram", "error");
      return;
    }

    const response = await fetch(`${API_URL}/auth/telegram`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ initData })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Ошибка Telegram авторизации");
    }

    // Успешная авторизация
    console.log("Telegram авторизация прошла успешно:", data.user);
    currentUserId = data.user.user_id;

    closeAllAuthModals();
    createMainUI();
    updateUI();
  } catch (err) {
    console.error("Ошибка Telegram авторизации:", err);
    showNotification("Ошибка Telegram входа: " + err.message, "error");
  }
}

/************************************************************
 *  🟦  CLIENT‑SIDE E2EE CHATS  (добавить в конец script.js)
 ************************************************************/

/* ========= 1.  Крипто‑утилиты ========== */
async function ensureKeyPair(userId) {
  if (localStorage.getItem('privateKey')) return;               // уже есть
  const kp   = nacl.box.keyPair();
  const pub  = nacl.util.encodeBase64(kp.publicKey);
  const priv = nacl.util.encodeBase64(kp.secretKey);
  localStorage.setItem('privateKey', priv);
  await supabase.from('users').update({ public_key: pub }).eq('user_id', userId);
}

function encryptMessage(plain, recipientPubB64) {
  const nonce  = nacl.randomBytes(24);
  const shared = nacl.box.before(
      nacl.util.decodeBase64(recipientPubB64),
      nacl.util.decodeBase64(localStorage.getItem('privateKey'))
  );
  const enc = nacl.box.after(nacl.util.decodeUTF8(plain), nonce, shared);
  return {
    encrypted_message: nacl.util.encodeBase64(enc),
    nonce            : nacl.util.encodeBase64(nonce),
    sender_public_key: recipientPubB64
  };
}

function decryptMessage(encB64, nonceB64, senderPubB64) {
  try {
    const shared = nacl.box.before(
      nacl.util.decodeBase64(senderPubB64),
      nacl.util.decodeBase64(localStorage.getItem('privateKey'))
    );
    const plain = nacl.box.open.after(
      nacl.util.decodeBase64(encB64),
      nacl.util.decodeBase64(nonceB64),
      shared
    );
    if (!plain) return '[не удалось расшифровать]';
    return nacl.util.encodeUTF8(plain);
  } catch (err) {
    console.error('Ошибка при расшифровке:', err);
    return '[ошибка]';
  }
}

/* ========= 2.  Вспомогательная карточка пользователя ========== */
async function fetchUserCard(id) {
  const { data } = await supabase.from('users')
        .select('first_name, photo_url, public_key')
        .eq('user_id', id).maybeSingle();
  return {
    id,
    name : data?.first_name || `ID: ${id}`,
    photo: data?.photo_url  || 'photo/default.png',
    pub  : data?.public_key || ''
  };
}

/* ========= 3.  Список чатов ========== */
let chatListInterval = null;

async function openChatListModal() {
  showGlobalLoading();

  createModal('chatListModal', `
    <div class="modal-body chat-list-body" style="padding: 0px 0 80px; margin-top: 0px;"></div>
  `, {
    showCloseBtn: false,      // убираем крестик
    cornerTopRadius: 0,
    hasVerticalScroll: true,
    onClose: () => {
      if (chatListInterval) clearInterval(chatListInterval);
    }
  });

  const container = document.querySelector('#chatListModal .modal-body');

  async function renderChatList() {
    const { data: chats } = await supabase
      .from('chats')
      .select('*')
      .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`);

    const chatData = await Promise.all(chats.map(async ch => {
      const otherId = ch.user1_id === currentUserId ? ch.user2_id : ch.user1_id;
      const u       = await fetchUserCard(otherId);

      // подставляем дефолт сразу, чтобы не было миготения
      const avatarUrl = u.photo ? u.photo : '/photo/15.png';

      const { data: lastMsg } = await supabase
        .from('messages')
        .select(`encrypted_message, media_type,
                 sender_public_key, nonce, created_at`)
        .eq('chat_id', ch.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let previewText = '';
      let previewTime = '';
      let lastTs      = 0;

      if (lastMsg) {
        lastTs = new Date(lastMsg.created_at).getTime();
        if (lastMsg.encrypted_message) {
          const isEnc = lastMsg.nonce && lastMsg.sender_public_key;
          previewText = isEnc
            ? decryptMessage(
                lastMsg.encrypted_message,
                lastMsg.nonce,
                lastMsg.sender_public_key
              )
            : lastMsg.encrypted_message;
        }
        if (!previewText && lastMsg.media_type) {
          previewText = lastMsg.media_type === 'image'
            ? 'Фото'
            : lastMsg.media_type === 'video'
              ? 'Видео'
              : 'Файл';
        }
        previewTime = new Date(lastMsg.created_at)
          .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      }

      const { data: unread } = await supabase
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('chat_id', ch.id)
        .not('read_by', 'cs', `{${currentUserId}}`);
      const unreadCount = unread?.length || 0;

      const rowHtml = `
        <div class="chat-row"
             data-chat="${ch.id}"
             data-partner="${otherId}"
             style="display:flex; align-items:center; padding:10px; cursor:pointer;">
          <div style="position:relative; margin-right:12px;">
            <img src="${avatarUrl}"
                 class="chat-avatar"
                 style="width:48px; height:48px; border-radius:50%; object-fit:cover;"
            />
            ${unreadCount > 0
              ? `<div style="
                    position:absolute;
                    top:-2px; right:-2px;
                    background:#E63946;
                    color:#fff;
                    font-size:12px;
                    width:20px; height:20px;
                    border-radius:50%;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                  ">
                  ${unreadCount}
                </div>`
              : ''}
          </div>
          <div class="chat-info" style="flex:1; min-width:0;">
            <div style="font-weight:500; line-height:1.2; margin-bottom:4px;">
              ${u.name}
              <span style="font-size:12px; color:#999; margin-left:4px;">
                ID:${u.id}
              </span>
            </div>
            <div style="
                   font-size:13px; color:#777;
                   overflow:hidden; white-space:nowrap;
                   text-overflow:ellipsis;">
              ${previewText || 'нет сообщений'}
            </div>
          </div>
          <div style="margin-left:12px; font-size:12px; color:#999;">
            ${previewTime}
          </div>
        </div>
      `;

      return { rowHtml, lastTs };
    }));

    chatData.sort((a, b) => b.lastTs - a.lastTs);
    const rowsHtml = chatData.map(c => c.rowHtml).join('');

    const newChatBtn = `
  <button id="newChatBtn" style="
    display: block;
    width: 100%;
    margin: 0 0 12px 0;
    padding: 12px;
    border: none;
    background: #2F80ED;
    color: #fff;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
  ">
        + Новый чат
      </button>`;

    container.innerHTML = newChatBtn + rowsHtml;

    document.getElementById('newChatBtn')
      .addEventListener('click', openNewChatModal);

    document.querySelectorAll('.chat-row').forEach(el => {
      el.addEventListener('click', () => {
        openChatWindow(el.dataset.chat, el.dataset.partner);
      });
    });
  }

  await renderChatList();
  hideGlobalLoading();
  chatListInterval = setInterval(renderChatList, 1000);
}

/* ========= 4.  Создание нового чата ========== */
function openNewChatModal() {
  createModal('newChatModal', `
    <h3 style="text-align:center;margin-bottom:16px;">Новый чат</h3>
    <input id="partnerIdInput" placeholder="ID пользователя"
           style="width:100%;padding:14px;border:1px solid #E6E6EB;
                  border-radius:12px;font-size:16px;margin-bottom:16px;">
    <button id="startChatBtn" style="
       width:100%;padding:14px;background:#2F80ED;color:#fff;
       border:none;border-radius:12px;font-weight:600;cursor:pointer;">
       Начать чат
    </button>
  `,{cornerTopRadius:0});

  document.getElementById('startChatBtn').onclick = async()=>{
    const partnerId = document.getElementById('partnerIdInput').value.trim();
    if(!partnerId){ showNotification('Введите ID','error'); return; }
    try{
      showGlobalLoading();
      const ids = [currentUserId, partnerId].sort();
      let { data: chat } = await supabase
            .from('chats')
            .select('*')
            .eq('user1_id', ids[0])
            .eq('user2_id', ids[1]).maybeSingle();
      if(!chat){
        ({ data: chat } = await supabase
           .from('chats')
           .insert([{ user1_id: ids[0], user2_id: ids[1] }])
           .select().single());
      }
      removeAllModals();
      openChatWindow(chat.id, partnerId);
    }catch(err){ showNotification('Ошибка','error'); }
    finally{ hideGlobalLoading(); }
  };
}

/* ========= 5. Окно переписки ========== */
async function openChatWindow(chatId, partnerId) {
  // Получаем данные партнёра
  const partner = await fetchUserCard(partnerId);
  let chatChannel = null;
  let refreshInterval = null;
  // Таймстамп последнего полученного сообщения
  let lastMessageTime = null;

  // Проверяем блокировки
  const { data: blockedByMe } = await supabase
    .from('blocked_users')
    .select('*')
    .eq('blocker_id', currentUserId)
    .eq('blocked_id', partnerId)
    .maybeSingle();

  const { data: blockedMe } = await supabase
    .from('blocked_users')
    .select('*')
    .eq('blocker_id', partnerId)
    .eq('blocked_id', currentUserId)
    .maybeSingle();

  // Открываем модалку чата
  createModal('chatModal', `
    <div class="chat-container" style="
      touch-action: manipulation;
      display: flex;
      flex-direction: column;
      height: 100%;
    ">
      <!-- === ШАПКА ЧАТА (без ⋮) === -->
      <div class="chat-header" style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border-bottom: 1px solid #eee;
      ">
        <img
          src="${partner.photo}"
          class="chat-avatar"
          style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
          "
          onerror="this.onerror=null;this.src='/photo/15.png';"
        />
        <div class="chat-title" style="display: flex; flex-direction: column;">
          <span style="font-weight: 600; color: #333;">${partner.name}</span>
          <span style="font-size: 12px; color: #999; margin-top: 2px;">
            ID: ${partner.id}
          </span>
        </div>
      </div>

      <!-- === ЛЕНТА СООБЩЕНИЙ === -->
      <div id="chatMessages" class="chat-messages" style="
        flex: 1 1 auto;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      "></div>

      <!-- === ПАНЕЛЬ ВВОДА С ПРЕДПРОСМОТРОМ === -->
      <div id="chatInputBar" class="chat-inputbar" style="
        position: sticky;
        bottom: 0;
        background: #fff;
        z-index: 2;
        box-sizing: border-box;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      ">
        ${blockedByMe || blockedMe
          ? `<div style="
               flex: 1;
               padding: 14px;
               text-align: center;
               color: #999;
               background: #f8f8f8;
               border-radius: 12px;
               font-style: italic;
             ">
               ${blockedByMe
                 ? 'Вы заблокировали этого пользователя'
                 : 'Вы были заблокированы этим пользователем'}
             </div>`
          : `
          <!-- превью файла -->
          <div id="mediaPreview" style="
            display: none;
            position: relative;
            max-height: 250px;
            overflow: hidden;
            border-radius: 12px;
            background: rgba(0,0,0,0.05);
          ">
            <div id="mediaPreviewContent"></div>
            <button id="cancelPreviewBtn" style="
              position: absolute;
              top: 4px;
              right: 4px;
              background: #fff;
              border: none;
              border-radius: 50%;
              cursor: pointer;
            ">✖</button>
            <div style="
              margin-top: 8px;
              display: flex;
              align-items: center;
              gap: 8px;
            ">
              <progress id="uploadProgress"
                        max="100"
                        value="0"
                        style="
                          flex: 1;
                          height: 6px;
                          border-radius: 4px;
                          overflow: hidden;
                          display: none;
                        "></progress>
              <span id="uploadPercent" style="
                font-size: 12px;
                color: #555;
                display: none;
              ">0%</span>
            </div>
          </div>

          <!-- строка ввода и кнопок -->
          <div style="display: flex; gap: 0px; align-items: center;">
            <input id="chatText" class="chat-input" placeholder="Сообщение…"
                   style="
                     flex: 1;
                     width: 100%;
                     box-sizing: border-box;
                     font-size: 16px;
                     padding: 12px;
                     border-radius: 12px;
                     border: 1px solid #ccc;
                   " />
            <input type="file"
                   id="mediaInput"
                   accept="image/*,video/*"
                   style="display: none;" />
            <button id="uploadMediaBtn" style="
              background: none;
              border: none;
              font-size: 20px;
              cursor: pointer;
              margin: 5px;
            ">📎</button>
            <button id="chatSend" style="
              padding: 14px 16px;
              background: #2F80ED;
              color: #fff;
              font-weight: 600;
              border: none;
              border-radius: 12px;
              cursor: pointer;
            ">Отправить</button>
          </div>
        `}
      </div>
    </div>
  `, {
    cornerTopRadius: 0,
    hasVerticalScroll: false,
    onClose: () => {
      document.getElementById('bottomBar').style.display = 'flex';
      if (chatChannel) supabase.removeChannel(chatChannel);
      if (refreshInterval) clearInterval(refreshInterval);
    }
  });

  // Скрываем нижнюю системную панель
  document.getElementById('bottomBar').style.display = 'none';
  const box = document.getElementById('chatMessages');

  // Рендер одного сообщения
  function renderMessage(m) {
    const side = m.sender_id === currentUserId ? 'out' : 'in';
    const isEncrypted = m.encrypted_message && m.nonce && m.sender_public_key;
    const text = isEncrypted
      ? decryptMessage(m.encrypted_message, m.nonce, m.sender_public_key)
      : m.encrypted_message;
    const tm = new Date(m.created_at)
      .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = `bubble ${side} slide-in-up`;

    let mediaPart = '';
    if (m.media_url) {
      if (m.media_type === 'image') {
        mediaPart = `<img src="${m.media_url}"
                          style="max-width: 200px;
                                 border-radius: 12px;
                                 display: block;
                                 margin-bottom: 6px;" />`;
      } else if (m.media_type === 'video') {
        mediaPart = `<video src="${m.media_url}"
                             controls preload="metadata"
                             style="max-width: 200px;
                                    border-radius: 12px;
                                    display: block;
                                    margin-bottom: 6px;"></video>`;
      } else {
        mediaPart = `<a href="${m.media_url}"
                         target="_blank"
                         style="display: block;
                                margin-bottom: 6px;">📎 Файл</a>`;
      }
    }

    bubble.innerHTML = `
      ${mediaPart}
      ${text ? `<div>${text}</div>` : ''}
      <span class="time-label">${tm}</span>
    `;
    return bubble;
  }

  // Загрузка новых сообщений
  async function loadMessages() {
    let query = supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (lastMessageTime) {
      query = query.gt('created_at', lastMessageTime);
    }

    const { data: msgs } = await query;
    if (!msgs || msgs.length === 0) return;

    msgs.forEach(m => {
      box.appendChild(renderMessage(m));
      lastMessageTime = m.created_at;
    });
    box.scrollTop = box.scrollHeight;

    // Пометить прочитанным
    await fetch(`${API_URL}/chat/read`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ chatId, userId: currentUserId })
    });
  }

  // Инициализация
  await loadMessages();
  refreshInterval = setInterval(loadMessages, 1000);
  chatChannel = supabase
    .channel(`chat-${chatId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `chat_id=eq.${chatId}`
    }, loadMessages)
    .subscribe();

  // Если не заблокированы — подключаем ввод
  if (!blockedByMe && !blockedMe) {
    const input         = document.getElementById('chatText');
    const sendBtn       = document.getElementById('chatSend');
    const mediaInput    = document.getElementById('mediaInput');
    const uploadBtn     = document.getElementById('uploadMediaBtn');
    const mediaPreview  = document.getElementById('mediaPreview');
    const mediaContent  = document.getElementById('mediaPreviewContent');
    const cancelPreview = document.getElementById('cancelPreviewBtn');
    const progressElem  = document.getElementById('uploadProgress');
    const percentLabel  = document.getElementById('uploadPercent');
    let selectedFile = null;

    // Открыть выбор файла
    uploadBtn.onclick = () => mediaInput.click();

    // При выборе — показать превью, но НЕ загружать
    mediaInput.onchange = () => {
      const file = mediaInput.files[0];
      if (file && file.type.match(/image|video/)) {
        mediaContent.innerHTML = '';
        const isImg = file.type.startsWith('image/');
        const el = document.createElement(isImg ? 'img' : 'video');
        el.src = URL.createObjectURL(file);
        if (!isImg) el.controls = true;
        el.style.maxWidth = '100%';
        el.style.borderRadius = '12px';
        mediaContent.appendChild(el);

        selectedFile = file;
        mediaPreview.style.display = 'block';
      } else {
        showNotification('Можно загружать только фото или видео', 'error');
      }
    };

    // Отмена превью
    cancelPreview.onclick = () => {
      selectedFile = null;
      mediaPreview.style.display = 'none';
      mediaContent.innerHTML = '';
    };

    // Drag & drop
    const chatModal = document.querySelector('.chat-container');
    chatModal.addEventListener('dragover', e => e.preventDefault());
    chatModal.addEventListener('drop', e => {
      e.preventDefault();
      mediaInput.files = e.dataTransfer.files;
      mediaInput.onchange();
    });

    // Отправка
    sendBtn.onclick = async () => {
      const textVal = input.value.trim();
      if (!textVal && !selectedFile) {
        return showNotification('Введите сообщение или прикрепите файл', 'error');
      }

      const payload = { chat_id: chatId, sender_id: currentUserId };

      // Шифруем текст, если есть
      if (textVal) {
        if (!partner.pub) {
          const { data } = await supabase
            .from('users')
            .select('public_key')
            .eq('user_id', partnerId)
            .single();
          partner.pub = data?.public_key || '';
        }
        if (partner.pub) {
          const { encrypted_message, nonce, sender_public_key } =
            encryptMessage(textVal, partner.pub);
          Object.assign(payload, { encrypted_message, nonce, sender_public_key });
        } else {
          payload.encrypted_message = textVal;
        }
      }

      // Если есть файл — загружаем только теперь
      if (selectedFile) {
        const ext = selectedFile.name.split('.').pop();
        const filename = `${Date.now()}_${currentUserId}.${ext}`;
        const filePath = `chat_media/${chatId}/${filename}`;

        // Показ прогресса
        progressElem.style.display = 'block';
        percentLabel.style.display = 'inline';

        const { data, error: uploadError } = await supabase
          .storage
          .from('media')
          .upload(filePath, selectedFile, {
            cacheControl: '3600',
            upsert: false,
            onUploadProgress: (e) => {
              const pct = Math.round(e.loaded * 100 / e.total);
              progressElem.value = pct;
              percentLabel.textContent = pct + '%';
            }
          });

        if (uploadError) {
          return showNotification('Ошибка загрузки файла', 'error');
        }

        const { publicUrl } = supabase
          .storage
          .from('media')
          .getPublicUrl(filePath).data;

        payload.media_url  = publicUrl;
        payload.media_type = selectedFile.type.startsWith('image/') ? 'image' : 'video';
      }

      // Отправляем в БД
      const { error } = await supabase.from('messages').insert([payload]);
      if (error) {
        return showNotification('Не удалось отправить сообщение', 'error');
      }

      // Сброс полей
      input.value = '';
      if (selectedFile) {
        selectedFile = null;
        mediaPreview.style.display = 'none';
        mediaContent.innerHTML = '';
        progressElem.style.display = 'none';
        percentLabel.style.display = 'none';
      }

      // Прокрутка вниз
      setTimeout(() => {
        box.scrollTop = box.scrollHeight;
      }, 50);
    };

    // Отправка по Enter
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }
}

/* ========= 6.  Вызвать ensureKeyPair сразу после успешного логина ========= */
(async()=>{ if(currentUserId) await ensureKeyPair(currentUserId); })();

/* ========= 7.  Кнопка «Чаты» уже добавлена в bottomBar  ========= */
document.getElementById('chatBtn')?.addEventListener('click',()=>{
  removeAllModals();
  openChatListModal();
});

/**************************************************
 * WINDOW EVENTS
 **************************************************/
// Flush mined coins before leaving page
window.addEventListener("beforeunload", () => {
  if (pendingMinedCoins > 0) {
    flushMinedCoins();
  }
});
