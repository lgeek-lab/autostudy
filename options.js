// 设置页面逻辑
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

// 默认设置
const defaultSettings = {
  scrollSpeed: 100,
  scrollDelay: 200,
  waitAtBottom: 3000,
  maxRetries: 5,
  pageLoadWait: 4000,
  videoSpeed: 2.0,
  showNotifications: true,
  notificationInterval: 5000,
  autoClickNext: true,
  autoHandleFileList: true
};

// 加载设置
function loadSettings() {
  chrome.storage.sync.get(defaultSettings, (items) => {
    // 滚动速度
    document.getElementById('scrollSpeed').value = items.scrollSpeed;
    document.getElementById('scrollSpeedValue').value = items.scrollSpeed;
    
    // 滚动间隔
    document.getElementById('scrollDelay').value = items.scrollDelay;
    document.getElementById('scrollDelayValue').value = items.scrollDelay;
    
    // 底部等待时间（转换为秒）
    const waitSeconds = items.waitAtBottom / 1000;
    document.getElementById('waitAtBottom').value = waitSeconds;
    document.getElementById('waitAtBottomValue').value = waitSeconds;
    
    // 最大重试次数
    document.getElementById('maxRetries').value = items.maxRetries;
    document.getElementById('maxRetriesValue').value = items.maxRetries;
    
    // 页面加载等待时间（转换为秒）
    const pageLoadSeconds = items.pageLoadWait / 1000;
    document.getElementById('pageLoadWait').value = pageLoadSeconds;
    document.getElementById('pageLoadWaitValue').value = pageLoadSeconds;
    
    // 视频播放倍速
    document.getElementById('videoSpeed').value = items.videoSpeed;
    document.getElementById('videoSpeedValue').value = items.videoSpeed;
    
    // 通知间隔（转换为秒）
    const notificationSeconds = items.notificationInterval / 1000;
    document.getElementById('notificationInterval').value = notificationSeconds;
    document.getElementById('notificationIntervalValue').value = notificationSeconds;
    
    // 自动点击下一个
    document.getElementById('autoClickNext').checked = items.autoClickNext;
    
    // 自动处理文件列表
    document.getElementById('autoHandleFileList').checked = items.autoHandleFileList;
    
    // 显示通知
    document.getElementById('showNotifications').checked = items.showNotifications;
  });
}

// 设置事件监听器
function setupEventListeners() {
  // 滚动速度
  const scrollSpeed = document.getElementById('scrollSpeed');
  const scrollSpeedValue = document.getElementById('scrollSpeedValue');
  scrollSpeed.addEventListener('input', () => {
    scrollSpeedValue.value = scrollSpeed.value;
  });
  scrollSpeedValue.addEventListener('input', () => {
    scrollSpeed.value = scrollSpeedValue.value;
  });
  
  // 滚动间隔
  const scrollDelay = document.getElementById('scrollDelay');
  const scrollDelayValue = document.getElementById('scrollDelayValue');
  scrollDelay.addEventListener('input', () => {
    scrollDelayValue.value = scrollDelay.value;
  });
  scrollDelayValue.addEventListener('input', () => {
    scrollDelay.value = scrollDelayValue.value;
  });
  
  // 底部等待时间
  const waitAtBottom = document.getElementById('waitAtBottom');
  const waitAtBottomValue = document.getElementById('waitAtBottomValue');
  waitAtBottom.addEventListener('input', () => {
    waitAtBottomValue.value = waitAtBottom.value;
  });
  waitAtBottomValue.addEventListener('input', () => {
    waitAtBottom.value = waitAtBottomValue.value;
  });
  
  // 最大重试次数
  const maxRetries = document.getElementById('maxRetries');
  const maxRetriesValue = document.getElementById('maxRetriesValue');
  maxRetries.addEventListener('input', () => {
    maxRetriesValue.value = maxRetries.value;
  });
  maxRetriesValue.addEventListener('input', () => {
    maxRetries.value = maxRetriesValue.value;
  });
  
  // 页面加载等待时间
  const pageLoadWait = document.getElementById('pageLoadWait');
  const pageLoadWaitValue = document.getElementById('pageLoadWaitValue');
  pageLoadWait.addEventListener('input', () => {
    pageLoadWaitValue.value = pageLoadWait.value;
  });
  pageLoadWaitValue.addEventListener('input', () => {
    pageLoadWait.value = pageLoadWaitValue.value;
  });
  
  // 视频播放倍速
  const videoSpeed = document.getElementById('videoSpeed');
  const videoSpeedValue = document.getElementById('videoSpeedValue');
  videoSpeed.addEventListener('input', () => {
    videoSpeedValue.value = videoSpeed.value;
  });
  videoSpeedValue.addEventListener('input', () => {
    videoSpeed.value = videoSpeedValue.value;
  });
  
  // 通知间隔
  const notificationInterval = document.getElementById('notificationInterval');
  const notificationIntervalValue = document.getElementById('notificationIntervalValue');
  notificationInterval.addEventListener('input', () => {
    notificationIntervalValue.value = notificationInterval.value;
  });
  notificationIntervalValue.addEventListener('input', () => {
    notificationInterval.value = notificationIntervalValue.value;
  });
  
  // 表单提交
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);
  
  // 恢复默认按钮
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
}

// 保存设置
function saveSettings(e) {
  e.preventDefault();
  
  const settings = {
    scrollSpeed: parseInt(document.getElementById('scrollSpeed').value),
    scrollDelay: parseInt(document.getElementById('scrollDelay').value),
    waitAtBottom: parseInt(document.getElementById('waitAtBottom').value) * 1000, // 转换为毫秒
    maxRetries: parseInt(document.getElementById('maxRetries').value),
    pageLoadWait: parseInt(document.getElementById('pageLoadWait').value) * 1000, // 转换为毫秒
    videoSpeed: parseFloat(document.getElementById('videoSpeed').value),
    notificationInterval: parseInt(document.getElementById('notificationInterval').value) * 1000, // 转换为毫秒
    autoClickNext: document.getElementById('autoClickNext').checked,
    autoHandleFileList: document.getElementById('autoHandleFileList').checked,
    showNotifications: document.getElementById('showNotifications').checked
  };
  
  chrome.storage.sync.set(settings, () => {
    showMessage('设置已保存！', 'success');
    
    // 通知所有content script更新配置
    chrome.tabs.query({ url: 'https://lms.ouchn.cn/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateConfig',
          config: settings
        }).catch(() => {
          // 忽略错误，可能某些标签页还未加载
        });
      });
    });
  });
}

// 恢复默认设置
function resetSettings() {
  if (confirm('确定要恢复默认设置吗？')) {
    chrome.storage.sync.set(defaultSettings, () => {
      loadSettings();
      showMessage('已恢复默认设置！', 'success');
    });
  }
}

// 显示消息
function showMessage(text, type) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = `message ${type}`;
  
  setTimeout(() => {
    message.className = 'message';
  }, 3000);
}

