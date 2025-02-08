// public/app.js

// Глобальные переменные и настройки
const API_URL = "https://mkntw-github-io.onrender.com"; // Замените на нужный URL
let currentUserId = null;
let currentMerchantId = null;
let pendingMinedCoins = parseFloat(localStorage.getItem("pendingMinedCoins")) || 0;
let isMining = false;
let mineTimer = null;
let localBalance = 0;
let merchantBalance = 0;
let updateInterval = null;
let currentHalvingStep = 0;

// Централизованная функция для fetch с уведомлениями об ошибках
async function fetchWithNotification(url, options) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      notify(`Ошибка: ${data.error || 'Неизвестная ошибка'}`, 'error');
      throw new Error(data.error || 'Ошибка');
    }
    return data;
  } catch (err) {
    notify(`Ошибка связи с сервером: ${err.message}`, 'error');
    throw err;
  }
}

// Пример функции логина с использованием уведомлений
async function login() {
  const loginVal = document.getElementById("loginInput")?.value;
  const passVal = document.getElementById("passwordInput")?.value;
  if (!loginVal || !passVal) {
    notify("Введите логин и пароль", 'error');
    return;
  }
  try {
    const userResp = await fetchWithNotification(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: loginVal, password: passVal })
    });
    if (userResp.success) {
      currentUserId = userResp.userId;
      localStorage.setItem("userId", currentUserId);
      localStorage.removeItem("merchantId");
      currentMerchantId = null;
      notify("Успешный вход", 'success');
      document.getElementById("authModal")?.remove();
      createUI();
      updateUI();
      fetchUserData();
      return;
    }
  } catch (err) {
    // Ошибка уже уведомлена
  }
  // Если логин пользователя не удался, пробуем логин мерчанта
  try {
    const merchResp = await fetchWithNotification(`${API_URL}/merchantLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: loginVal, password: passVal })
    });
    if (merchResp.success) {
      currentMerchantId = merchResp.merchantId;
      localStorage.setItem("merchantId", currentMerchantId);
      localStorage.removeItem("userId");
      currentUserId = null;
      notify("Мерчант успешно вошёл", 'success');
      document.getElementById("authModal")?.remove();
      openMerchantUI();
    }
  } catch (err) {
    // Ошибка уведомлена
  }
}

// Аналогичные функции register(), logout(), createUI(), updateUI(), fetchUserData() и др.
// (Реализуйте их согласно вашим требованиям, добавляя вызовы notify() для уведомлений.)

function createUI() {
  // Создание основных элементов интерфейса
  showMainUI();
}

function showMainUI() {
  // Пример создания topBar
  if (!document.getElementById("topBar")) {
    const topBar = document.createElement("div");
    topBar.id = "topBar";
    topBar.innerHTML = `<div id="appTitle">GugaCoin</div><div id="userIdDisplay"></div><button id="logoutBtn">Выход</button>`;
    document.body.appendChild(topBar);
    document.getElementById("logoutBtn").addEventListener("click", logout);
  }
  document.getElementById("topBar").classList.remove("hidden");
  // Аналогично создайте bottomBar, balanceDisplay, mineContainer и пр.
  updateInterval = setInterval(fetchUserData, 2000);
}

function updateUI() {
  if (currentUserId) {
    showMainUI();
    updateTopBar();
  } else if (currentMerchantId) {
    openMerchantUI();
  } else {
    openAuthModal();
  }
}

function updateTopBar() {
  const userIdDisplay = document.getElementById("userIdDisplay");
  if (userIdDisplay) {
    userIdDisplay.textContent = currentUserId ? `ID: ${currentUserId}` : "";
  }
}

function logout() {
  localStorage.removeItem("userId");
  localStorage.removeItem("merchantId");
  currentUserId = null;
  currentMerchantId = null;
  document.getElementById("topBar")?.remove();
  document.getElementById("bottomBar")?.remove();
  document.getElementById("balanceDisplay")?.classList.add("hidden");
  document.getElementById("mineContainer")?.classList.add("hidden");
  clearInterval(updateInterval);
  openAuthModal();
  notify("Вы вышли из аккаунта", 'info');
}

function openAuthModal() {
  // Реализуйте показ модального окна авторизации
  // Например, создание div#authModal с формами логина/регистрации
  // И привяжите обработчики событий (например, document.getElementById("loginSubmitBtn").addEventListener("click", login);)
}

function fetchUserData() {
  if (isMining || !currentUserId) return;
  fetchWithNotification(`${API_URL}/user?userId=${currentUserId}`)
    .then(data => {
      if (data.success && data.user) {
        if (data.user.blocked === 1) {
          notify("Ваш аккаунт заблокирован", 'error');
          logout();
          return;
        }
        localBalance = parseFloat(data.user.balance || 0);
        updateBalanceUI();
        // Также обновляем информацию для обмена, топ-апа и пр.
        updateTopBar();
      }
    })
    .catch(err => {
      // Ошибка уже уведомлена
    });
}

function updateBalanceUI() {
  const balanceValue = document.getElementById("balanceValue");
  if (balanceValue) {
    balanceValue.textContent = parseFloat(localBalance).toFixed(5);
  }
}

// Привяжите остальные функции (openOperationsModal, openHistoryModal, openExchangeModal, openMerchantUI, и т.д.)

document.addEventListener("DOMContentLoaded", () => {
  const savedMerchantId = localStorage.getItem("merchantId");
  if (savedMerchantId) {
    currentMerchantId = savedMerchantId;
    openMerchantUI();
    return;
  }
  const savedUserId = localStorage.getItem("userId");
  if (savedUserId) {
    currentUserId = savedUserId;
    createUI();
    fetchUserData();
  } else {
    openAuthModal();
  }
});
