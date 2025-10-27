// 弹出窗口逻辑
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  // 加载并显示配置
  loadConfig();
  
  // 获取当前状态
  getCurrentStatus();
  
  // 切换按钮点击事件
  toggleBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 检查是否在正确的网站上
    if (!tab.url.includes('lms.ouchn.cn')) {
      alert('请在 lms.ouchn.cn 学习平台上使用此插件');
      return;
    }
    
    // 发送切换消息到content script
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('发送消息失败:', chrome.runtime.lastError);
        alert('无法连接到页面，请刷新页面后重试');
        return;
      }
      
      if (response && response.isRunning !== undefined) {
        updateStatus(response.isRunning);
      }
    });
  });
  
  // 设置按钮点击事件
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // 定期更新状态
  setInterval(getCurrentStatus, 1000);
});

// 获取当前运行状态
async function getCurrentStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('lms.ouchn.cn')) {
      updateStatus(false);
      return;
    }
    
    chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        // 忽略错误，可能页面还未加载content script
        return;
      }
      
      if (response && response.isRunning !== undefined) {
        updateStatus(response.isRunning);
      }
    });
  } catch (error) {
    console.error('获取状态失败:', error);
  }
}

// 更新UI状态
function updateStatus(isRunning) {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  if (isRunning) {
    toggleBtn.textContent = '停止学习';
    toggleBtn.classList.add('stop');
    statusDot.classList.add('active');
    statusText.textContent = '运行中';
  } else {
    toggleBtn.textContent = '开始学习';
    toggleBtn.classList.remove('stop');
    statusDot.classList.remove('active');
    statusText.textContent = '已停止';
  }
}

// 加载并显示配置
function loadConfig() {
  chrome.storage.sync.get({
    scrollSpeed: 100,
    scrollDelay: 200,
    waitAtBottom: 3000,
    autoClickNext: true
  }, (items) => {
    document.getElementById('scrollSpeed').textContent = `${items.scrollSpeed} px`;
    document.getElementById('scrollDelay').textContent = `${items.scrollDelay} ms`;
    document.getElementById('waitAtBottom').textContent = `${items.waitAtBottom / 1000} s`;
  });
}

