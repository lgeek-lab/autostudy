// 后台服务脚本
// 管理插件状态和消息传递

// 插件安装时
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[AutoStudy] 插件已安装');
    
    // 设置默认配置
    chrome.storage.sync.set({
      scrollSpeed: 100,
      scrollDelay: 200,
      waitAtBottom: 3000,
      autoClickNext: true
    });
    
    // 打开欢迎页面（可选）
    // chrome.tabs.create({ url: 'options.html' });
  } else if (details.reason === 'update') {
    console.log('[AutoStudy] 插件已更新');
  }
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateStatus') {
    console.log('[AutoStudy] 状态更新:', request.isRunning);
    
    // 可以在这里更新badge或图标
    if (request.isRunning) {
      chrome.action.setBadgeText({ text: '运行', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: sender.tab.id });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
    }
  }
  
  return true;
});

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当页面加载完成时
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('lms.ouchn.cn')) {
    console.log('[AutoStudy] 页面已加载:', tab.url);
    
    // 可以在这里自动启动（如果需要的话）
    // 目前设计为手动启动
  }
});

// 监听标签页关闭
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log('[AutoStudy] 标签页已关闭:', tabId);
});

console.log('[AutoStudy] 后台服务已启动');

