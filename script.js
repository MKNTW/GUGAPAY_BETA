// CSRF token handling
let csrfToken = "";
const API_URL = "https://api.gugapay.ru";

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

/**
 * Shows a connection error notification to the user.
 * @param {string} [msg] - Custom message to display.
 */
function showConnectionError(msg) {
  showNotification(msg || "Ошибка соединения с сервером", "error");
}

/**************************************************
 * GLOBAL VARIABLES
 **************************************************/
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
 */
function createModal(
  id,
  content,
  {
    showCloseBtn = true,
    hasVerticalScroll = true,
    defaultFromBottom = true,
    cornerTopMargin = 0,
    cornerTopRadius = 0,
    noRadiusByDefault = false,
    customStyles = {},
    onClose = null,
  } = {}
) {
  // Remove existing modal with same ID
  const existingModal = document.getElementById(id);
  if (existingModal) {
    existingModal.remove();
  }

  // Main modal overlay
  const modal = document.createElement("div");
  modal.id = id;
  modal.className = "modal";
  modal.style.position = "fixed";
  modal.style.top = "0";
  modal.style.left = "0";
  modal.style.width = "100%";
  modal.style.height = "100%";
  modal.style.display = "flex";
  modal.style.justifyContent = "center";
  modal.style.alignItems = "center";
  modal.style.background = "rgba(0,0,0,0.5)";
  modal.style.zIndex = "100000";

  // Content container
  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-content";
  contentDiv.style.width = "100%";
  contentDiv.style.maxWidth = "500px";
  contentDiv.style.marginTop = `${cornerTopMargin}px`;
  contentDiv.style.height = `calc(100% - ${cornerTopMargin}px)`;
  contentDiv.style.overflowY = hasVerticalScroll ? "auto" : "hidden";
  contentDiv.style.borderRadius = noRadiusByDefault ? "0" : `${cornerTopRadius}px ${cornerTopRadius}px 0 0`;
  contentDiv.style.background = "#fff";
  contentDiv.style.boxShadow = "0 2px 5px rgba(0,0,0,0.1)";
  contentDiv.style.padding = "20px";
  // Apply any custom inline styles
  Object.assign(contentDiv.style, customStyles);

  // Insert content and close button
  contentDiv.innerHTML = `
        ${showCloseBtn ? '<button class="modal-close-btn">&times;</button>' : ""}
        ${content}
    `;

  // Style close button if present
  const closeBtn = contentDiv.querySelector(".modal-close-btn");
  if (closeBtn) {
    Object.assign(closeBtn.style, {
      position: "absolute",
      top: "15px",
      right: "20px",
      width: "30px",
      height: "30px",
      backgroundColor: "#000",
      color: "#fff",
      borderRadius: "50%",
      border: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
      transition: "all 0.3s ease",
      zIndex: "1001",
    });
    // Hover effects for close button
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.backgroundColor = "#333";
      closeBtn.style.transform = "scale(1.1)";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.backgroundColor = "#000";
      closeBtn.style.transform = "scale(1)";
    });
  }

  modal.appendChild(contentDiv);
  document.body.appendChild(modal);

  // Close button event
  if (showCloseBtn && closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.remove();
      if (onClose) onClose();
    });
  }
  // Close on overlay click
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.remove();
      if (onClose) onClose();
    }
  });
}

/**
 * Removes all modal windows from the DOM.
 */
function removeAllModals() {
  document.querySelectorAll(".modal").forEach((modal) => modal.remove());
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
    showNotification(err.message, "error");
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
      showNotification("Ошибка авторизации: " + err.message, "error");
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
            background: #1A1A1A;
            border: none;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 8px;
            background: linear-gradient(90deg, #2F80ED, #2D9CDB);
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
      contentMaxHeight: "calc(100vh - 160px)"
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
    const qrData = `guga://type=person&userId=${currentUserId}&amount=${amount}`;
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
        cornerTopMargin: 20,
        cornerTopRadius: 24,
        hasVerticalScroll: true,
        defaultFromBottom: true,
        noRadiusByDefault: false,
        contentMaxHeight: "calc(100vh - 160px)"
      }
    );
    // Generate QR code
    new QRCode(document.getElementById("qrCodeContainer"), {
      text: qrData,
      width: 200,
      height: 200,
      colorDark: "#1A1A1A",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  });
}

/**************************************************
 * USER QR CODE GENERATION (New)
 **************************************************/
function createUserQR(userId, amount, purpose) {
  if (!userId) {
    console.error("Error: userId is missing.");
    return null;
  }
  const qrData = `guga://type=person&userId=${userId}&amount=${amount}&purpose=${encodeURIComponent(purpose)}`;
  console.log("Generated QR code:", qrData);
  // Optionally show the QR to user
  createModal(
    "qrModal",
    `
      <h3>Ваш QR-код</h3>
      <div id="qrCodeContainer" style="display: flex; justify-content: center; align-items: center; margin: 20px 0;"></div>
      <p>Сумма: <strong>${amount.toFixed(2)}</strong></p>
      ${purpose ? `<p>Назначение: <strong>${purpose}</strong></p>` : ""}
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
  const qrCodeContainer = document.getElementById("qrCodeContainer");
  new QRCode(qrCodeContainer, {
    text: qrData,
    width: 300,
    height: 300
  });
  return qrData;
}

/**************************************************
 * AUTH MODAL (Login/Register UI)
 **************************************************/
function openAuthModal() {
  hideMainUI();
  removeAllModals();
  createModal(
    "authModal",
    `
      <div class="auth-container">
        <h2>GUGACOIN</h2>

        <!-- Login -->
        <div id="loginSection">
          <input type="text" id="loginInput" placeholder="Логин" class="auth-input">
          <input type="password" id="passwordInput" placeholder="Пароль" class="auth-input">
          <button id="loginSubmitBtn" class="auth-button">Войти</button>
        </div>

        <!-- Registration -->
        <div id="registerSection" style="display:none;">
          <input type="text" id="regLogin" placeholder="Логин" class="auth-input">
          <input type="password" id="regPassword" placeholder="Пароль" class="auth-input">
          <button id="registerSubmitBtn" class="auth-button">Зарегистрироваться</button>
        </div>

        <!-- Toggle Auth Forms -->
        <button id="toggleAuthBtn" class="toggle-auth-btn">Войти / Зарегистрироваться</button>

        <!-- Telegram Login Button will be added here -->
        <div id="telegramBtnContainer" style="margin-top:15px;">
          <div style="text-align:center; color:#666; margin-bottom:30px;">Или</div>
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
      customStyles: { backgroundColor: "#f7f7f7" }
    }
  );
  // Standard auth button handlers
  document.getElementById("loginSubmitBtn").addEventListener("click", login);
  document.getElementById("registerSubmitBtn").addEventListener("click", register);
  document.getElementById("toggleAuthBtn").addEventListener("click", toggleAuthForms);

  // Add Telegram login button if available
  if (window.Telegram?.WebApp) {
    const telegramBtn = document.createElement("button");
    telegramBtn.innerHTML = `
      <img src="https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg" style="height:20px; margin-right:10px;">
      Войти через Telegram
    `;
    // Style the Telegram button
    Object.assign(telegramBtn.style, {
      width: "100%",
      padding: "12px",
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
    // Telegram auth handler
    telegramBtn.addEventListener("click", async () => {
  try {
    showGlobalLoading();

    // Убедись, что Telegram WebApp готов
    Telegram.WebApp.ready();

    // Получаем initData как СТРОКУ
    const initData = Telegram.WebApp.initData;

    if (!initData || !initData.includes("hash")) {
      throw new Error("Некорректные initData из Telegram");
    }

    // Отправляем строку initData на сервер
    const response = await fetch(`${API_URL}/auth/telegram`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ initData }) // <-- не трогаем строку!
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Ошибка сервера");
    }

    // Успех — продолжаем
    document.getElementById("authModal")?.remove();
    await fetchUserData();
    createMainUI();
    updateUI();
  } catch (err) {
    showNotification(err.message, "error");
  } finally {
    hideGlobalLoading();
  }
});
    document.getElementById("telegramBtnContainer").appendChild(telegramBtn);
  }

  // Helper to toggle between login and register forms
  function toggleAuthForms() {
    const loginSection = document.getElementById("loginSection");
    const registerSection = document.getElementById("registerSection");
    loginSection.style.display = loginSection.style.display === "none" ? "flex" : "none";
    registerSection.style.display = registerSection.style.display === "none" ? "flex" : "none";
  }

  // Inject styles for auth modal if not already done
  if (!document.getElementById("authStyles")) {
    const authStyles = `
.auth-container {
  max-width: 400px;
  margin: 40px auto 0 auto;
  padding: 20px;
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.auth-container h2 {
  text-align: center;
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #1A1A1A;
}
.auth-input {
  width: 100%;
  padding: 12px 16px;
  background: #FFFFFF;
  border: 1px solid #E6E6EB;
  border-radius: 8px;
  font-size: 16px;
  box-sizing: border-box;
}
.auth-button {
  width: 100%;
  padding: 12px;
  background: linear-gradient(90deg, #2F80ED, #2D9CDB);
  border: none;
  border-radius: 12px;
  color: #FFFFFF;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.auth-button:hover {
  opacity: 0.9;
}
.auth-button:active {
  transform: translateY(1px);
}
.toggle-auth-btn {
  background: none;
  border: none;
  color: #2F80ED;
  cursor: pointer;
  text-decoration: underline;
  font-size: 14px;
}
#loginSection, #registerSection {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
`;
    const styleEl = document.createElement("style");
    styleEl.id = "authStyles";
    styleEl.textContent = authStyles;
    document.head.appendChild(styleEl);
  }
}

/**************************************************
 * MAIN UI (Home screen with gradient header and balances)
 **************************************************/
function createMainUI() {
  // Inject main UI styles
  injectMainUIStyles();
  // Profile icon (top-right)
  if (!currentMerchantId && !document.getElementById("profileIconContainer")) {
    const profileIconContainer = document.createElement("div");
    profileIconContainer.id = "profileIconContainer";
    profileIconContainer.style.position = "absolute";
    profileIconContainer.style.top = "10px";
    profileIconContainer.style.right = "10px";
    profileIconContainer.style.width = "35px";
    profileIconContainer.style.height = "35px";
    profileIconContainer.style.background = "#fff";
    profileIconContainer.style.borderRadius = "12px";
    profileIconContainer.style.display = "flex";
    profileIconContainer.style.alignItems = "center";
    profileIconContainer.style.justifyContent = "center";
    profileIconContainer.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.1)";
    profileIconContainer.style.cursor = "pointer";
    profileIconContainer.style.zIndex = "9999";
    const profileIcon = document.createElement("img");
    profileIcon.id = "profileIcon";
    profileIcon.src = "photo/68.png";
    profileIcon.style.width = "28px";
    profileIcon.style.height = "28px";
    profileIcon.style.borderRadius = "6px";
    profileIcon.style.objectFit = "cover";
    profileIconContainer.appendChild(profileIcon);
    document.body.appendChild(profileIconContainer);
    profileIconContainer.addEventListener("click", openProfileModal);
  }

  // Header container with action buttons
  let headerEl = document.getElementById("mainHeaderContainer");
  if (!headerEl) {
    headerEl = document.createElement("div");
    headerEl.id = "mainHeaderContainer";
    headerEl.className = "main-header";
    document.body.appendChild(headerEl);
    // Action buttons (Transfer, Request, Pay)
    const actionContainer = document.createElement("div");
    actionContainer.className = "action-container";
    actionContainer.innerHTML = `
      <button id="transferBtn" class="action-btn">
        <div class="icon-wrap">
          <img src="photo/81.png" class="action-icon"/>
        </div>
        <span>Перевести</span>
      </button>
      <button id="requestBtn" class="action-btn">
        <div class="icon-wrap">
          <img src="photo/82.png" class="action-icon"/>
        </div>
        <span>Запросить</span>
      </button>
      <button id="payQRBtn" class="action-btn">
        <div class="icon-wrap">
          <img src="photo/90.png" class="action-icon"/>
        </div>
        <span>Оплатить</span>
      </button>
    `;
    headerEl.appendChild(actionContainer);
    // Button event handlers
    actionContainer.querySelector("#transferBtn").addEventListener("click", () => {
      removeAllModals();
      openTransferModal();
    });
    actionContainer.querySelector("#requestBtn").addEventListener("click", () => {
      removeAllModals();
      openRequestModal();
    });
    actionContainer.querySelector("#payQRBtn").addEventListener("click", () => {
      removeAllModals();
      openPayQRModal();
    });
    // Divider (or spacing at bottom of header)
    const headerDivider = document.createElement("div");
    headerDivider.className = "header-divider";
    headerEl.appendChild(headerDivider);
  }

  // Balance cards container
  let balanceContainer = document.getElementById("balanceContainer");
  if (!balanceContainer) {
    balanceContainer = document.createElement("div");
    balanceContainer.id = "balanceContainer";
    balanceContainer.className = "balance-container";
    document.body.appendChild(balanceContainer);
    // RUB card
    const rubCard = document.createElement("div");
    rubCard.className = "balance-card rub";
    rubCard.innerHTML = `
      <div class="balance-icon-wrap">
        <img src="photo/18.png" alt="RUB" class="balance-icon">
      </div>
      <div class="balance-info">
        <div class="balance-label">RUB</div>
        <div id="rubBalanceValue" class="balance-amount">0.00 ₽</div>
      </div>
    `;
    balanceContainer.appendChild(rubCard);
    // GUGA card
    const gugaCard = document.createElement("div");
    gugaCard.className = "balance-card guga";
    gugaCard.innerHTML = `
      <div class="balance-icon-wrap">
        <img src="photo/15.png" alt="GUGA" class="balance-icon">
      </div>
      <div class="balance-info">
        <div class="balance-label">GUGA</div>
        <div id="gugaBalanceValue" class="balance-amount">0.00000 ₲</div>
      </div>
    `;
    balanceContainer.appendChild(gugaCard);
  }

  // Bottom navigation bar
  if (!document.getElementById("bottomBar")) {
    const bottomBar = document.createElement("div");
    bottomBar.id = "bottomBar";
    bottomBar.className = "bottom-bar";
    bottomBar.innerHTML = `
      <button id="btnMain" class="nav-btn">
        <img src="photo/69.png" class="nav-icon">
        <span>Главная</span>
      </button>
      <button id="historyBtn" class="nav-btn">
        <img src="photo/70.png" class="nav-icon">
        <span>История</span>
      </button>
      <button id="exchangeBtn" class="nav-btn">
        <img src="photo/71.png" class="nav-icon">
        <span>Обменять</span>
      </button>
    `;
    document.body.appendChild(bottomBar);
    bottomBar.querySelector("#btnMain").addEventListener("click", () => {
      removeAllModals();
    });
    bottomBar.querySelector("#historyBtn").addEventListener("click", () => {
      removeAllModals();
      openHistoryModal();
    });
    bottomBar.querySelector("#exchangeBtn").addEventListener("click", () => {
      removeAllModals();
      openExchangeModal();
    });
  }

  // Show main balance display if present
  const balanceDisplay = document.getElementById("balanceDisplay");
  if (balanceDisplay) {
    balanceDisplay.style.display = "block";
  }
  // Hide mining UI if present
  const mineContainer = document.getElementById("mineContainer");
  if (mineContainer) {
    mineContainer.style.display = "none";
  }
  // Fetch data (balances, user info) and set up periodic refresh
  fetchUserData();
  clearInterval(updateInterval);
  updateInterval = setInterval(fetchUserData, 2000);
}

/**
 * Inject main UI CSS (called once).
 */
function injectMainUIStyles() {
  if (document.getElementById("mainUIStyles")) return;
  const style = document.createElement("style");
  style.id = "mainUIStyles";
  style.textContent = `
    body {
      margin: 0;
      padding: 0;
      font-family: "Oswald", sans-serif;
    }
    /* Gradient header */
    .main-header {
      width: 100%;
      background: linear-gradient(90deg, #2F80ED, #2D9CDB);
      border-bottom-left-radius: 20px;
      border-bottom-right-radius: 20px;
      padding: 16px;
      box-sizing: border-box;
      z-index: 90000;
    }
    .action-container {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 16px;
      margin-top: 175px;
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
      text-transform: uppercase;
    }
    .action-btn:hover {
      opacity: 0.9;
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
    .header-divider {
      width: 100%;
      height: 0px;
    }
    .balance-container {
      position: absolute;
      top: 320px;
      width: 90%;
      max-width: 500px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .balance-card {
      background: #F8F9FB;
      border-radius: 15px;
      padding: 10px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 16px;
      margin-left: -5px;
      margin-right: -5px;
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
  `;
  document.head.appendChild(style);
}

/**************************************************
 * USER DATA & SYNC
 **************************************************/
/**
 * Fetches user data and latest exchange rate, then updates UI.
 */
async function fetchUserData() {
  try {
    const [userResp, ratesResp] = await Promise.all([
      fetch(`${API_URL}/user`, { credentials: "include" }),
      fetch(`${API_URL}/exchangeRates?limit=1`, { credentials: "include" })
    ]);
    const userData = await userResp.json();
    const ratesData = await ratesResp.json();
    if (userData.success && userData.user) {
      // If user is blocked
      if (userData.user.blocked) {
        showNotification("Ваш аккаунт заблокирован. Доступ ограничен.", "error");
        logout();
        return;
      }
      // Set current user ID
      currentUserId = userData.user.user_id;
      const coinBalance = userData.user.balance || 0;
      const rubBalance = userData.user.rub_balance || 0;
      const currentRate = (ratesData.success && ratesData.rates.length) ? parseFloat(ratesData.rates[0].exchange_rate) : 0;
      // Update user info (photo and name)
      const photoUrl = userData.user.photo_url || "";
      const firstName = userData.user.first_name || "Гость";
      const userInfoContainer = document.getElementById("user-info");
      if (userInfoContainer) {
        const userPhotoEl = userInfoContainer.querySelector(".user-photo");
        const userNameEl = userInfoContainer.querySelector(".user-name");
        if (userPhotoEl) userPhotoEl.src = photoUrl;
        if (userNameEl) userNameEl.textContent = firstName;
      } else {
        const newUserInfoContainer = document.createElement("div");
        newUserInfoContainer.id = "user-info";
        newUserInfoContainer.classList.add("user-info");
        const userPhotoEl = document.createElement("img");
        userPhotoEl.classList.add("user-photo");
        userPhotoEl.src = photoUrl;
        userPhotoEl.alt = "User Photo";
        const userNameEl = document.createElement("span");
        userNameEl.classList.add("user-name");
        userNameEl.textContent = firstName;
        newUserInfoContainer.appendChild(userPhotoEl);
        newUserInfoContainer.appendChild(userNameEl);
        document.body.appendChild(newUserInfoContainer);
      }
      // Legacy display updates
      const balanceValue = document.getElementById("balanceValue");
      if (balanceValue) {
        const totalRub = rubBalance + (coinBalance * currentRate);
        balanceValue.textContent = `${formatBalance(totalRub, 2)} ₽`;
      }
      const userIdEl = document.getElementById("userIdDisplay");
      if (userIdEl) {
        userIdEl.textContent = "ID: " + currentUserId;
      }
      // Update RUB balance (old logic)
      const rubBalanceInfo = document.getElementById("rubBalanceValue");
      if (rubBalanceInfo) {
        rubBalanceInfo.textContent = `${formatBalance(rubBalance, 2)} ₽`;
      }
      // Update GUGA balance
      const gugaBalanceElement = document.getElementById("gugaBalanceValue");
      if (gugaBalanceElement) {
        gugaBalanceElement.textContent = `${formatBalance(coinBalance, 5)} ₲`;
      }
      // Converted balance (coins in rubles)
      const convertedBalanceElement = document.getElementById("convertedBalance");
      if (convertedBalanceElement) {
        convertedBalanceElement.textContent = `${formatBalance(coinBalance * currentRate, 2)} ₽`;
      }
      // Current rate display
      const rateDisplayElement = document.getElementById("currentRateDisplay");
      if (rateDisplayElement) {
        rateDisplayElement.textContent = formatBalance(currentRate, 2);
      }
    }
  } catch (err) {
    console.error("fetchUserData error:", err);
    const balanceValue = document.getElementById("balanceValue");
    if (balanceValue) {
      balanceValue.textContent = "-- ₽";
    }
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
 * PROFILE
 **************************************************/
function openProfileModal() {
  createModal(
    "profileModal",
    `
      <h3 style="text-align:center;">Профиль</h3>
      <button id="profileLogoutBtn" style="padding:10px;margin-top:20px;">Выйти из аккаунта</button>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: false,
      noRadiusByDefault: true
    }
  );
  document.getElementById("profileLogoutBtn").onclick = logout;
}

/**************************************************
 * TRANSFER
 **************************************************/
function openTransferModal() {
  createModal(
    "transferModal",
    `
<div class="transfer-container">
    <div class="transfer-header">
        <div class="header-info">
            <div class="transfer-title">Перевод средств</div>
        </div>
    </div>

    <!-- Currency selection block -->
    <div class="currency-select">
        <div id="btnCurrencyGUGA" class="currency-card">
            <div style="display: flex; align-items: center; gap: 12px;">
                <img src="photo/15.png" style="width: 32px; height: 32px; border-radius: 8px;">
                <div>
                    <div style="font-weight: 500; color: #1A1A1A;">GUGA</div>
                    <div style="font-size: 13px; color: #909099;">Криптовалюта</div>
                </div>
            </div>
            <div id="gugaBalance" style="margin-top: 12px; font-size: 14px; color: #666;">
                Доступно: 0.00000 ₲
            </div>
        </div>
        
        <div id="btnCurrencyRUB" class="currency-card">
            <div style="display: flex; align-items: center; gap: 12px;">
                <img src="photo/18.png" style="width: 32px; height: 32px; border-radius: 8px;">
                <div>
                    <div style="font-weight: 500; color: #1A1A1A;">RUB</div>
                    <div style="font-size: 13px; color: #909099;">Фиатные деньги</div>
                </div>
            </div>
            <div id="rubBalance" style="margin-top: 12px; font-size: 14px; color: #666;">
                Доступно: 0.00 ₽
            </div>
        </div>
    </div>

    <!-- Transfer form -->
    <div class="transfer-form">
        <div class="transfer-field">
            <label class="transfer-label">Получатель</label>
            <input 
                type="text" 
                id="toUserIdInput" 
                placeholder="Введите ID пользователя" 
                class="transfer-input">
        </div>

        <div class="transfer-field">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="transfer-label">Сумма</label>
                <div id="transferBalanceInfo" style="font-size: 13px; color: #909099;"></div>
            </div>
            <div class="transfer-amount">
                <input 
                    type="number" 
                    id="transferAmountInput"
                    placeholder="0.00">
                <span id="currencySymbol">₲</span>
            </div>
        </div>
    </div>

    <!-- Submit button -->
    <button id="sendTransferBtn" class="transfer-submit-btn">
        Подтвердить перевод
    </button>
</div>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false
    }
  );
  // Common styles for transfer modal
  const transferStyles = `
  .transfer-container {
    background: #FFFFFF;
    border-radius: 16px;
    padding: 0px;
    margin-top: 25px;
    max-width: 440px;
  }
  .transfer-header {
    margin-bottom: 24px;
    text-align: center;
  }
  .transfer-title {
    font-size: 24px;
    font-weight: 600;
    color: #1A1A1A;
    margin: 0;
  }
  .currency-select {
    display: flex;
    gap: 12px;
    margin-bottom: 30px;
  }
  .currency-card {
    flex: 1;
    padding: 16px;
    border: 1px solid #E6E6EB;
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .currency-card.active {
    border-color: #2F80ED;
    background: #F5F9FF;
    box-shadow: 0 2px 8px rgba(47, 128, 237, 0.1);
  }
  .transfer-form {
    background: #F8F9FB;
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 24px;
  }
  .transfer-field {
    margin-bottom: 20px;
  }
  .transfer-label {
    display: block;
    font-size: 14px;
    color: #666;
    margin-bottom: 8px;
  }
  .transfer-input {
    width: 100%;
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #E6E6EB;
    border-radius: 8px;
    font-size: 16px;
    box-sizing: border-box;
  }
  .transfer-amount {
    position: relative;
    display: flex;
    align-items: center;
  }
  .transfer-amount input {
    flex: 1;
    width: 100%;
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #E6E6EB;
    border-radius: 8px;
    font-size: 16px;
    box-sizing: border-box;
  }
  .transfer-amount span {
    display: inline-block;
    width: 32px;
    height: 100%;
    background: #E6E6EB;
    border-radius: 0 8px 8px 0;
    text-align: center;
    line-height: 36px;
  }
  .transfer-submit-btn {
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
  }
  .transfer-submit-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  .transfer-submit-btn:active {
    transform: translateY(0);
  }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = transferStyles;
  document.head.appendChild(styleEl);

  // Current currency ("GUGA" or "RUB")
  let currentTransferCurrency = "GUGA";

  const updateTransferUI = () => {
    const currencySymbol = document.getElementById("currencySymbol");
    const balanceInfo = document.getElementById("transferBalanceInfo");
    const gugaBalance = document.getElementById("gugaBalance");
    const rubBalance = document.getElementById("rubBalance");
    // Remove active class from all currency cards
    document.querySelectorAll('.currency-card').forEach(card => {
      card.classList.remove('active');
    });
    // Set active on selected currency card
    const activeCard = (currentTransferCurrency === "GUGA")
      ? document.getElementById("btnCurrencyGUGA")
      : document.getElementById("btnCurrencyRUB");
    activeCard.classList.add('active');
    // Update symbol, input step, and balance display
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

  // Currency switch events
  document.getElementById("btnCurrencyGUGA").addEventListener('click', () => {
    currentTransferCurrency = "GUGA";
    updateTransferUI();
  });
  document.getElementById("btnCurrencyRUB").addEventListener('click', () => {
    currentTransferCurrency = "RUB";
    updateTransferUI();
  });

  // Send transfer button
  document.getElementById("sendTransferBtn").onclick = async () => {
    const toUser = document.getElementById("toUserIdInput")?.value.trim();
    const amount = parseFloat(document.getElementById("transferAmountInput")?.value);
    if (!toUser || !amount || amount <= 0) {
      alert("❌ Введите корректные данные!");
      return;
    }
    if (toUser === currentUserId) {
      alert("❌ Нельзя перевести самому себе");
      return;
    }
    const endpoint = (currentTransferCurrency === "GUGA") ? "/transfer" : "/transferRub";
    try {
      if (!csrfToken) {
        await fetchCsrfToken();
      }
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
        alert("✅ Перевод выполнен!");
        document.getElementById("transferModal")?.remove();
        fetchUserData();
      } else {
        alert("❌ Ошибка перевода: " + data.error);
      }
    } catch (err) {
      console.error("Transfer error:", err);
      showConnectionError("Ошибка при выполнении перевода");
    }
  };

  // After balances are loaded, update UI and initialize
  fetchUserData().then(() => {
    const rubBalanceElement = document.getElementById("rubBalance");
    const rubBalanceValue = parseFloat(document.getElementById("rubBalanceValue")?.innerText || 0);
    if (rubBalanceElement) {
      rubBalanceElement.textContent = `Доступно: ${rubBalanceValue.toFixed(2)} ₽`;
    }
    updateTransferUI();
  });
}

/**************************************************
 * QR PAYMENT (Scanner Modal)
 **************************************************/
function openPayQRModal() {
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
      }
    }
  );
  // Inject scanner styles
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
    const parsed = parseQRCodeData(rawValue);
    if (parsed.type === "person") {
      // User-to-user transfer
      if (!parsed.userId) {
        alert("❌ Неверный QR. Нет userId.");
        return;
      }
      confirmPayUserModal(parsed);
    } else if (parsed.type === "merchant") {
      // Payment to merchant
      if (!parsed.merchantId) {
        alert("❌ Неверный QR. Нет merchantId.");
        return;
      }
      confirmPayMerchantModal(parsed);
    } else {
      alert("❌ Неверный тип QR-кода.");
      return;
    }
    // Close scanner after successful scan
    setTimeout(() => {
      document.getElementById("payQRModal")?.remove();
    }, 500);
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
 * CONFIRM USER-TO-USER TRANSFER (via scanned QR)
 **************************************************/
async function confirmPayUserModal({ userId, amount, purpose }) {
  if (!userId || !amount || amount <= 0) {
    showNotification("❌ Некорректные данные для перевода", "error");
    return;
  }
  createModal(
    "confirmPayUserModal",
    `
      <div style="
        max-width: 400px;
        margin: 0 auto;
        padding: 24px;
        background: #FFFFFF;
        border-radius: 24px;
        box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.1);
        margin-top: 60px;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        ">
          <img src="photo/15.png" style="width: 40px; height: 40px;">
          <div>
            <div style="font-size: 20px; font-weight: 600; color: #1A1A1A;">Подтверждение перевода</div>
            <div style="font-size: 16px; color: #666;">Операция с GUGA</div>
          </div>
        </div>

        <div style="margin-bottom: 24px;">
          <div style="
            background: #F8F9FB;
            border-radius: 16px;
            padding: 16px;
            margin-bottom: 16px;
          ">
            <div style="color: #666; font-size: 14px; margin-bottom: 4px;">Получатель</div>
            <div style="font-weight: 500; color: #1A1A1A;">${userId}</div>
          </div>

          <div style="
            background: #F8F9FB;
            border-radius: 16px;
            padding: 16px;
          ">
            <div style="color: #666; font-size: 14px; margin-bottom: 4px;">Сумма</div>
            <div style="font-weight: 500; color: #1A1A1A;">${formatBalance(amount, 5)} ₲</div>
          </div>
        </div>

        ${purpose ? `
          <div style="
            background: #F8F9FB;
            border-radius: 16px;
            padding: 16px;
            margin-bottom: 24px;
          ">
            <div style="color: #666; font-size: 14px; margin-bottom: 4px;">Назначение</div>
            <div style="font-weight: 500; color: #1A1A1A;">${purpose}</div>
          </div>
        ` : ''}

        <button 
          id="confirmPayUserBtn" 
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
            transition: opacity 0.2s;
          ">
          Подтвердить перевод
        </button>
      </div>
    `,
    {
      showCloseBtn: true,
      cornerTopMargin: 20,
      cornerTopRadius: 24,
      hasVerticalScroll: true,
      defaultFromBottom: true,
      noRadiusByDefault: false,
      contentMaxHeight: "calc(100vh - 160px)"
    }
  );
  document.getElementById("confirmPayUserBtn").onclick = async () => {
    try {
      if (!currentUserId) throw new Error("Требуется авторизация");
      const payload = {
        fromUserId: currentUserId,
        toUserId: userId,
        amount: Number(amount),
        purpose: purpose || ""
      };
      if (!csrfToken) {
        await fetchCsrfToken();
      }
      const resp = await fetch(`${API_URL}/transfer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || "Ошибка сервера");
      }
      showNotification("✅ Перевод успешно выполнен", "success");
      document.getElementById("confirmPayUserModal")?.remove();
      await fetchUserData();
    } catch (err) {
      console.error("Transfer error:", err);
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
    const query = qrString.replace("guga://", "");
    const parts = query.split("&");
    for (const part of parts) {
      const [key, val] = part.split("=");
      if (key === "type") obj.type = val;
      if (key === "userId") obj.userId = val;
      if (key === "merchantId") obj.merchantId = val;
      if (key === "amount") obj.amount = parseFloat(val);
      if (key === "purpose") obj.purpose = decodeURIComponent(val);
    }
  } catch (err) {
    console.error("Error parsing QR code:", err);
  }
  return obj;
}

/**************************************************
 * CURRENCY EXCHANGE
 **************************************************/
let currentExchangeDirection = "coin_to_rub";
let currentExchangeRate = 0;

function openExchangeModal() {
  showGlobalLoading();
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
      showCloseBtn: false,
      cornerTopMargin: 0,
      cornerTopRadius: 0,
      contentMaxHeight: "100vh",
      noRadiusByDefault: true
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
  margin-bottom: 80px;
}
.bottom-spacer {
  height: 0px;
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
  try {
    const res = await fetch(`${API_URL}/transaction/${hash}`, { credentials: "include" });
    const data = await res.json();
    if (!data.success || !data.transaction) {
      return showNotification("Операция не найдена", "error");
    }
    const tx = data.transaction;
    const symbol = tx.currency === "RUB" ? "₽" : "₲";
    const amountValue = formatBalance(tx.amount, tx.currency === "RUB" ? 2 : 5);
    const sign = (tx.from_user_id === currentUserId) ? "-" : "+";
    const amount = `${sign}${amountValue} ${symbol}`;
    const timestamp = new Date(tx.created_at || tx.client_time).toLocaleString("ru-RU");
    let fromLabel = tx.from_user_id;
    let toLabel = tx.to_user_id;
    if (typeof fromLabel === "string" && fromLabel.startsWith("MERCHANT:")) {
      fromLabel = "Мерчант " + fromLabel.replace("MERCHANT:", "");
    }
    if (typeof toLabel === "string" && toLabel.startsWith("MERCHANT:")) {
      toLabel = "Мерчант " + toLabel.replace("MERCHANT:", "");
    }
    // Остальной код функции
  } catch (error) {
    console.error("Ошибка при получении данных транзакции:", error);
  }
}
    createModal(
      "transactionDetailsModal",
      `
        <div class="tx-sheet">
          <div class="tx-icon">
            <img src="photo/${tx.currency === "RUB" ? "92" : "67"}.png" alt="icon" width="48" height="48" />
          </div>
          <div class="tx-amount-main ${sign === '+' ? 'positive' : 'negative'}">${amount}</div>
          <div class="tx-status success">Успешно</div>
          <div class="tx-detail-box">
            <div class="tx-detail-row">
              <div class="tx-label">Дата и время</div>
              <div class="tx-value">${timestamp}</div>
            </div>
            <div class="tx-detail-row">
              <div class="tx-label">Отправитель</div>
              <div class="tx-value">${fromLabel}</div>
            </div>
            <div class="tx-detail-row">
              <div class="tx-label">Получатель</div>
              <div class="tx-value">${toLabel}</div>
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
              </div>` : ""
            }
          </div>
        </div>
      `,
      {
        showCloseBtn: true,
        cornerTopMargin: 0,
        cornerTopRadius: 0
      }
    );
    // Inject styles for transaction details if not already
    if (!document.getElementById("txDetailStyles")) {
      const detailStyles = `
.tx-icon {
  text-align: center;
  margin-bottom: 16px;
}
.tx-amount-main {
  text-align: center;
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 4px;
}
.tx-amount-main.positive {
  color: rgb(25, 150, 70);
}
.tx-amount-main.negative {
  color: #1A1A1A;
}
.tx-status {
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 16px;
}
.tx-status.success {
  color: #219653;
}
.tx-detail-box {
  background: #F8F9FB;
  border-radius: 12px;
  padding: 16px;
  text-align: left;
}
.tx-detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tx-label {
  font-size: 14px;
  color: #666;
}
.tx-value {
  font-size: 14px;
  color: #1A1A1A;
  word-break: break-all;
  text-align: right;
}
.copyable button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
}
.copyable button:active {
  transform: translateY(1px);
}
`;
      try {
  const styleEl = document.createElement("style");
  styleEl.id = "txDetailStyles";
  styleEl.textContent = detailStyles;
  document.head.appendChild(styleEl);
} catch (err) {
  console.error("Ошибка при загрузке транзакции:", err);
  showNotification("Ошибка при загрузке", "error");
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

/**************************************************
 * WINDOW EVENTS
 **************************************************/
// Flush mined coins before leaving page
window.addEventListener("beforeunload", () => {
  if (pendingMinedCoins > 0) {
    flushMinedCoins();
  }
});
    };
