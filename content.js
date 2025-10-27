// 自动学习助手 - 内容脚本
// 负责页面自动滚动和点击下一页

let isRunning = false;
let scrollInterval = null;
let retryCount = 0;
let maxRetries = 5;
let isWaitingForNextPage = false;
let isWatchingVideo = false;
let videoCheckInterval = null;
let lastNotificationTime = 0;
let isProcessingFileList = false;
let currentPageType = 'unknown';
let fileListIndex = 0;

let config = {
  scrollSpeed: 100,        // 每次滚动的像素
  scrollDelay: 200,        // 滚动间隔（毫秒）
  waitAtBottom: 3000,      // 到达底部后等待时间（毫秒）
  autoClickNext: true,     // 是否自动点击下一个
  maxRetries: 5,           // 最大重试次数
  pageLoadWait: 4000,      // 页面加载等待时间
  videoSpeed: 2.0,         // 视频播放倍速
  showNotifications: true, // 是否显示通知
  notificationInterval: 5000, // 通知最小间隔（毫秒）
  autoHandleFileList: true // 是否自动处理文件列表
};

// 从存储加载配置
function loadConfig() {
  chrome.storage.sync.get({
    scrollSpeed: 100,
    scrollDelay: 200,
    waitAtBottom: 3000,
    autoClickNext: true,
    maxRetries: 5,
    pageLoadWait: 4000,
    videoSpeed: 2.0,
    showNotifications: true,
    notificationInterval: 5000,
    autoHandleFileList: true
  }, (items) => {
    config = items;
    maxRetries = config.maxRetries;
    console.log('[AutoStudy] 配置已加载:', config);
  });
}

// 检测是否到达页面底部
function isAtBottom() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  
  // 允许10px的误差
  return (scrollTop + clientHeight) >= (scrollHeight - 10);
}

// 查找"下一个"按钮 - 改进版
function findNextButton() {
  console.log('[AutoStudy] 开始查找下一个按钮...');
  
  // 针对lms.ouchn.cn的特定选择器
  const specificSelectors = [
    'a[href*="learning-activity"]',  // 学习活动链接
    'a.next-page',
    'a.next-lesson',
    'button.next-page',
    'button.next-lesson',
    '.pagination a:last-child',
    '.page-navigation a:last-child',
    '.learning-nav a:last-child'
  ];
  
  // 文本匹配关键词
  const nextKeywords = [
    '下一个', '下一页', '下一节', '下一课', 
    'next', 'Next', 'NEXT', '继续',
    '下一步', '下一章', '下一单元',
    '→', '»', '>'
  ];
  
  // 1. 首先尝试特定选择器
  for (let selector of specificSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let element of elements) {
      if (isValidNextButton(element)) {
        console.log('[AutoStudy] 通过选择器找到按钮:', selector, element);
        return element;
      }
    }
  }
  
  // 2. 查找所有可能的链接和按钮
  const allElements = document.querySelectorAll('a, button, [onclick], [role="button"], .btn, .button');
  
  for (let element of allElements) {
    const text = element.textContent.trim();
    const title = element.getAttribute('title') || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const href = element.getAttribute('href') || '';
    
    // 检查文本内容
    for (let keyword of nextKeywords) {
      if (text.includes(keyword) || title.includes(keyword) || ariaLabel.includes(keyword)) {
        if (isValidNextButton(element)) {
          console.log('[AutoStudy] 通过文本找到按钮:', keyword, element);
          return element;
        }
      }
    }
    
    // 检查href中的特征
    if (href && (href.includes('next') || href.includes('page') || href.includes('lesson'))) {
      if (isValidNextButton(element)) {
        console.log('[AutoStudy] 通过href找到按钮:', href, element);
        return element;
      }
    }
  }
  
  // 3. 尝试查找分页器中的下一页
  const paginationNext = findPaginationNext();
  if (paginationNext) {
    console.log('[AutoStudy] 通过分页器找到按钮:', paginationNext);
    return paginationNext;
  }
  
  console.log('[AutoStudy] 未找到下一个按钮');
  return null;
}

// 验证是否为有效的下一个按钮
function isValidNextButton(element) {
  if (!element || !element.offsetParent) return false; // 不可见元素
  
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return false;
  
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false; // 无尺寸元素
  
  // 检查是否被禁用
  if (element.disabled || element.classList.contains('disabled')) return false;
  
  // 检查是否为当前页面链接
  const href = element.getAttribute('href');
  if (href && (href === '#' || href === window.location.href)) return false;
  
  return true;
}

// 查找分页器中的下一页按钮
function findPaginationNext() {
  const paginationContainers = document.querySelectorAll('.pagination, .pager, .page-nav, .page-navigation, .nav-pages');
  
  for (let container of paginationContainers) {
    // 查找最后一个链接（通常是下一页）
    const links = container.querySelectorAll('a');
    if (links.length > 0) {
      const lastLink = links[links.length - 1];
      if (isValidNextButton(lastLink)) {
        return lastLink;
      }
    }
    
    // 查找带有特定类名的下一页按钮
    const nextBtn = container.querySelector('.next, .page-next, [rel="next"]');
    if (nextBtn && isValidNextButton(nextBtn)) {
      return nextBtn;
    }
  }
  
  return null;
}

// 检测页面类型
function detectPageType() {
  console.log('[AutoStudy] 开始检测页面类型...');
  console.log('[AutoStudy] 当前URL:', window.location.href);
  
  // 等待页面稳定
  const videos = document.querySelectorAll('video').length;
  const iframes = document.querySelectorAll('iframe[src*="player"], iframe[src*="video"]').length;
  const viewButtons = document.querySelectorAll('button, a').length;
  
  console.log('[AutoStudy] 页面元素统计:', {
    videos: videos,
    iframes: iframes, 
    buttons: viewButtons,
    autoHandleFileList: config.autoHandleFileList
  });
  
  // 检测视频类型
  if (detectVideo()) {
    console.log('[AutoStudy] 页面类型：视频');
    return 'video';
  }
  
  // 检测文件列表类型（只在启用自动处理时）
  if (config.autoHandleFileList && detectFileList()) {
    console.log('[AutoStudy] 页面类型：文件列表');
    return 'filelist';
  }
  
  // 默认为文本类型
  console.log('[AutoStudy] 页面类型：文本（默认）');
  return 'text';
}

// 检测是否为文件列表页面
function detectFileList() {
  // 查找常见的文件列表特征
  const fileListIndicators = [
    // 表格结构
    'table tbody tr',
    '.file-list',
    '.document-list',
    '.resource-list',
    // 列表结构
    'ul.files li',
    'ol.documents li',
    '.list-group-item',
    // 带有"查看"按钮的容器
    '[data-action="view"]',
    'button:contains("查看")',
    'a:contains("查看")',
    'button:contains("预览")',
    'a:contains("预览")',
    'button:contains("打开")',
    'a:contains("打开")'
  ];
  
  for (let selector of fileListIndicators) {
    if (selector.includes(':contains')) {
      // 手动检查文本内容
      const allElements = document.querySelectorAll('button, a, .btn');
      for (let element of allElements) {
        const text = element.textContent.trim();
        if (text.includes('查看') || text.includes('预览') || text.includes('打开')) {
          console.log('[AutoStudy] 检测到文件列表特征:', selector, element);
          return true;
        }
      }
    } else {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log('[AutoStudy] 检测到文件列表特征:', selector, elements.length, '个元素');
        return true;
      }
    }
  }
  
  // 检测文件扩展名或下载链接
  const filePatterns = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|txt)$/i;
  const allLinks = document.querySelectorAll('a[href]');
  
  let fileCount = 0;
  for (let link of allLinks) {
    if (filePatterns.test(link.href)) {
      fileCount++;
    }
  }
  
  if (fileCount >= 2) {
    console.log('[AutoStudy] 检测到多个文件下载链接，判断为文件列表页面');
    return true;
  }
  
  return false;
}

// 获取文件列表中的查看按钮
function getFileListViewButtons() {
  const viewButtons = [];
  
  // 查找各种可能的查看按钮
  const selectors = [
    'button:contains("查看")',
    'a:contains("查看")',
    'button:contains("预览")',
    'a:contains("预览")',
    'button:contains("打开")',
    'a:contains("打开")',
    '[data-action="view"]',
    '.view-btn',
    '.preview-btn',
    '.open-btn'
  ];
  
  // 手动查找包含特定文本的按钮
  const allButtons = document.querySelectorAll('button, a, .btn, [role="button"]');
  
  for (let button of allButtons) {
    const text = button.textContent.trim();
    const title = button.getAttribute('title') || '';
    const dataAction = button.getAttribute('data-action') || '';
    
    if (text.includes('查看') || text.includes('预览') || text.includes('打开') ||
        title.includes('查看') || title.includes('预览') || title.includes('打开') ||
        dataAction === 'view' || button.classList.contains('view-btn') ||
        button.classList.contains('preview-btn') || button.classList.contains('open-btn')) {
      
      // 检查按钮是否可见和可点击
      if (isValidButton(button)) {
        viewButtons.push(button);
      }
    }
  }
  
  console.log('[AutoStudy] 找到', viewButtons.length, '个查看按钮');
  return viewButtons;
}

// 验证按钮是否有效
function isValidButton(button) {
  if (!button || !button.offsetParent) return false;
  
  const computedStyle = window.getComputedStyle(button);
  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return false;
  
  const rect = button.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  
  if (button.disabled || button.classList.contains('disabled')) return false;
  
  return true;
}

// 查找关闭按钮（叉号）
function findCloseButton() {
  console.log('[AutoStudy] 开始查找关闭按钮...');
  
  const closeSelectors = [
    '.close',
    '.btn-close',
    'button[aria-label="Close"]',
    'button[title*="关闭"]',
    'button[title*="close"]',
    'button[title*="Close"]',
    '.modal-close',
    '.dialog-close',
    '[data-dismiss="modal"]',
    '[data-bs-dismiss="modal"]',
    // PDF查看器常用选择器
    '.pdfjs-close',
    '.pdf-close',
    '.viewer-close',
    'button[class*="close"]',
    '[onclick*="close"]'
  ];
  
  // 1. 先尝试标准选择器
  for (let selector of closeSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let element of elements) {
      if (isValidButton(element)) {
        console.log('[AutoStudy] 通过选择器找到关闭按钮:', selector, element);
        return element;
      }
    }
  }
  
  // 2. 查找包含×文本的按钮（更宽泛的查找）
  const allElements = document.querySelectorAll('*');
  const closeTexts = ['×', '✕', 'X', '关闭', 'close', 'Close', 'CLOSE'];
  
  for (let element of allElements) {
    const text = element.textContent.trim();
    const title = element.getAttribute('title') || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    
    // 检查文本内容
    for (let closeText of closeTexts) {
      if (text === closeText || title.includes(closeText) || ariaLabel.includes(closeText)) {
        // 检查元素是否可点击
        if (element.onclick || element.addEventListener || 
            element.tagName === 'BUTTON' || element.tagName === 'A' ||
            element.getAttribute('role') === 'button' ||
            element.style.cursor === 'pointer' ||
            window.getComputedStyle(element).cursor === 'pointer') {
          
          if (isValidButton(element)) {
            console.log('[AutoStudy] 通过文本找到关闭按钮:', closeText, element);
            return element;
          }
        }
      }
    }
  }
  
  // 3. 查找右上角位置的可疑按钮
  const suspiciousElements = document.querySelectorAll('button, a, div, span, i');
  for (let element of suspiciousElements) {
    if (!isValidButton(element)) continue;
    
    const rect = element.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // 检查是否在右上角区域
    if (rect.right > windowWidth * 0.8 && rect.top < windowHeight * 0.2) {
      const text = element.textContent.trim();
      // 右上角的小元素，很可能是关闭按钮
      if (text === '' || text === '×' || text === '✕' || text === 'X' || 
          rect.width < 50 || rect.height < 50) {
        console.log('[AutoStudy] 通过位置找到疑似关闭按钮:', element);
        return element;
      }
    }
  }
  
  console.log('[AutoStudy] 未找到关闭按钮');
  return null;
}

// 处理文件列表页面
function handleFileListPage() {
  if (isProcessingFileList) return;
  
  console.log('[AutoStudy] 开始处理文件列表页面');
  isProcessingFileList = true;
  
  const viewButtons = getFileListViewButtons();
  
  if (viewButtons.length === 0) {
    console.log('[AutoStudy] 未找到查看按钮，按文本页面处理');
    isProcessingFileList = false;
    currentPageType = 'text';
    startScrolling();
    return;
  }
  
  processNextFileInList(viewButtons);
}

// 处理文件列表中的下一个文件
function processNextFileInList(viewButtons) {
  if (!isRunning || !isProcessingFileList) {
    return;
  }
  
  if (fileListIndex >= viewButtons.length) {
    console.log('[AutoStudy] 所有文件已处理完成，继续下一页');
    isProcessingFileList = false;
    fileListIndex = 0;
    // 文件列表处理完成，点击下一个按钮
    setTimeout(() => {
      tryClickNextButton();
    }, config.waitAtBottom);
    return;
  }
  
  const currentButton = viewButtons[fileListIndex];
  console.log(`[AutoStudy] 处理第 ${fileListIndex + 1}/${viewButtons.length} 个文件`);
  showNotification(`正在查看第 ${fileListIndex + 1}/${viewButtons.length} 个文件...`, 'info', true);
  
  // 点击查看按钮
  try {
    currentButton.click();
    console.log('[AutoStudy] 已点击查看按钮，等待文件加载...');
    showNotification(`文件加载中，${config.pageLoadWait/1000}秒后开始滚动...`, 'info');
    
    // 等待内容加载，使用配置的页面加载等待时间
    setTimeout(() => {
      if (isRunning && isProcessingFileList) {
        console.log('[AutoStudy] 文件加载完成，开始滚动文件内容');
        handleFileContentView();
      }
    }, config.pageLoadWait || 4000);
    
  } catch (error) {
    console.error('[AutoStudy] 点击查看按钮失败:', error);
    fileListIndex++;
    processNextFileInList(viewButtons);
  }
}

// 处理文件内容查看
function handleFileContentView() {
  if (!isRunning || !isProcessingFileList) {
    console.log('[AutoStudy] 插件未运行或未处理文件列表，跳过文件内容查看');
    return;
  }
  
  console.log('[AutoStudy] === 开始处理文件内容查看 ===');
  showNotification('开始滚动文件内容...', 'info');
  
  // 检查页面是否已加载
  const initialHeight = document.documentElement.scrollHeight;
  console.log('[AutoStudy] 初始页面高度:', initialHeight);
  
  // 先滚动到顶部确保从头开始
  window.scrollTo({ top: 0, behavior: 'instant' });
  console.log('[AutoStudy] 已滚动到页面顶部');
  
  let scrollAttempts = 0;
  let lastScrollHeight = 0;
  let stuckCount = 0;
  const maxScrollAttempts = 300; // 增加最大滚动次数
  const maxStuckCount = 10; // 高度不变的最大次数
  
  // 滚动到页面底部
  const scrollToBottom = () => {
    if (!isRunning || !isProcessingFileList) {
      console.log('[AutoStudy] 状态改变，停止文件滚动');
      return;
    }
    
    scrollAttempts++;
    
    const scrollHeight = document.documentElement.scrollHeight;
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
    const clientHeight = document.documentElement.clientHeight;
    
    // 检查页面是否卡住（高度没有变化）
    if (scrollHeight === lastScrollHeight) {
      stuckCount++;
    } else {
      stuckCount = 0;
      lastScrollHeight = scrollHeight;
    }
    
    console.log(`[AutoStudy] 文件滚动: ${currentScroll}/${scrollHeight} (${Math.round(currentScroll/scrollHeight*100)}%), 第${scrollAttempts}次, 卡住${stuckCount}次`);
    
    // 检查是否完成滚动
    const isAtBottom = currentScroll + clientHeight >= scrollHeight - 20;
    const shouldStop = isAtBottom || scrollAttempts >= maxScrollAttempts || stuckCount >= maxStuckCount;
    
    if (shouldStop) {
      console.log('[AutoStudy] 文件滚动完成原因:', {
        atBottom: isAtBottom,
        maxAttempts: scrollAttempts >= maxScrollAttempts,
        stuck: stuckCount >= maxStuckCount,
        currentScroll,
        scrollHeight,
        clientHeight
      });
      
      showNotification('文件内容浏览完成，准备关闭...', 'success');
      
      // 滚动完成，查找并点击关闭按钮
      setTimeout(() => {
        closeFileView();
      }, 2000);
    } else {
      // 继续滚动
      const scrollAmount = config.scrollSpeed || 100;
      window.scrollBy({
        top: scrollAmount,
        behavior: 'instant' // 使用instant避免动画干扰
      });
      
      // 使用更短的间隔以提高效率
      const delay = Math.max(config.scrollDelay || 200, 50);
      setTimeout(scrollToBottom, delay);
    }
  };
  
  // 延迟开始滚动，确保页面加载完成
  console.log('[AutoStudy] 等待1秒后开始滚动文件内容...');
  setTimeout(() => {
    if (isRunning && isProcessingFileList) {
      console.log('[AutoStudy] 开始执行文件内容滚动');
      scrollToBottom();
    }
  }, 1000);
}

// 关闭文件查看
function closeFileView() {
  console.log('[AutoStudy] 开始关闭文件查看');
  const closeButton = findCloseButton();
  
  if (closeButton) {
    console.log('[AutoStudy] 找到关闭按钮，点击关闭');
    showNotification('关闭文件，准备查看下一个...', 'info');
    
    try {
      closeButton.click();
      
      // 等待关闭完成，然后继续下一个文件
      setTimeout(() => {
        continueFileListProcessing();
      }, 2000);
      
    } catch (error) {
      console.error('[AutoStudy] 点击关闭按钮失败:', error);
      // 尝试按ESC键关闭
      tryAlternativeClose();
    }
  } else {
    console.log('[AutoStudy] 未找到关闭按钮，尝试其他关闭方法');
    tryAlternativeClose();
  }
}

// 尝试其他关闭方法
function tryAlternativeClose() {
  console.log('[AutoStudy] 尝试ESC键关闭');
  
  // 按ESC键
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
  
  // 也尝试点击页面背景（可能关闭模态框）
  const backdrop = document.querySelector('.modal-backdrop, .overlay, .popup-backdrop');
  if (backdrop) {
    backdrop.click();
  }
  
  setTimeout(() => {
    continueFileListProcessing();
  }, 2000);
}

// 继续文件列表处理
function continueFileListProcessing() {
  if (!isRunning || !isProcessingFileList) {
    return;
  }
  
  fileListIndex++;
  console.log(`[AutoStudy] 继续处理文件列表，当前索引: ${fileListIndex}`);
  
  // 重新获取文件列表按钮（防止页面变化）
  const viewButtons = getFileListViewButtons();
  processNextFileInList(viewButtons);
}

// 检测页面中的视频
function detectVideo() {
  const videos = document.querySelectorAll('video');
  const iframes = document.querySelectorAll('iframe[src*="player"], iframe[src*="video"], iframe[src*="bilibili"], iframe[src*="youku"]');
  
  console.log(`[AutoStudy] 检测到 ${videos.length} 个video元素, ${iframes.length} 个视频iframe`);
  
  // 如果没有视频元素，不是视频页面
  if (videos.length === 0 && iframes.length === 0) {
    return false;
  }
  
  // 如果有视频元素，检查是否都已完成
  if (videos.length > 0) {
    const visibleVideos = Array.from(videos).filter(video => video.offsetParent !== null);
    if (visibleVideos.length > 0) {
      // 检查是否所有可见视频都已完成
      const allCompleted = visibleVideos.every(video => {
        const isEnded = video.ended;
        const isNearEnd = video.currentTime > 0 && video.duration > 0 && (video.currentTime >= video.duration - 2);
        return isEnded || isNearEnd;
      });
      
      if (allCompleted) {
        console.log('[AutoStudy] 所有视频都已完成，不再识别为视频页面');
        return false;
      }
      
      console.log('[AutoStudy] 发现未完成的视频，识别为视频页面');
      return true;
    }
  }
  
  // 有视频iframe就认为是视频页面（iframe无法直接检测完成状态）
  if (iframes.length > 0) {
    console.log('[AutoStudy] 发现视频iframe，识别为视频页面');
    return true;
  }
  
  return false;
}

// 获取页面中的视频元素
function getVideoElements() {
  const videos = document.querySelectorAll('video');
  const result = [];
  
  for (let video of videos) {
    if (video.offsetParent !== null) { // 确保视频可见
      result.push(video);
    }
  }
  
  return result;
}

// 处理视频播放
function handleVideoPlayback() {
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('[AutoStudy] 未找到可见的视频元素');
    return false;
  }
  
  let hasActiveVideo = false;
  
  videos.forEach((video, index) => {
    const videoInfo = {
      index: index + 1,
      duration: Math.round(video.duration || 0),
      currentTime: Math.round(video.currentTime || 0),
      paused: video.paused,
      ended: video.ended,
      muted: video.muted,
      playbackRate: video.playbackRate
    };
    
    console.log(`[AutoStudy] 处理视频 ${index + 1}:`, videoInfo);
    
    // 静音
    if (!video.muted) {
      video.muted = true;
      console.log(`[AutoStudy] 视频 ${index + 1} 已静音`);
    }
    
    // 设置播放速度
    if (video.playbackRate !== config.videoSpeed) {
      video.playbackRate = config.videoSpeed;
      console.log(`[AutoStudy] 视频 ${index + 1} 倍速设置为: ${config.videoSpeed}x`);
    }
    
    // 检查视频状态
    if (!video.ended) {
      hasActiveVideo = true;
      
      // 如果视频暂停，尝试播放
      if (video.paused) {
        console.log(`[AutoStudy] 视频 ${index + 1} 暂停中，尝试播放...`);
        video.play().then(() => {
          console.log(`[AutoStudy] 视频 ${index + 1} 开始播放`);
          // 再次确保设置生效
          video.muted = true;
          video.playbackRate = config.videoSpeed;
        }).catch(err => {
          console.warn(`[AutoStudy] 视频 ${index + 1} 自动播放失败:`, err.message);
          showNotification('视频播放需要手动点击，请点击播放按钮', 'warning');
        });
      } else {
        console.log(`[AutoStudy] 视频 ${index + 1} 正在播放中 (${videoInfo.currentTime}s/${videoInfo.duration}s)`);
      }
    } else {
      console.log(`[AutoStudy] 视频 ${index + 1} 已播放完成`);
    }
  });
  
  return hasActiveVideo;
}

// 检查所有视频是否播放完成
function areAllVideosCompleted() {
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('[AutoStudy] 没有找到视频元素，认为已完成');
    return true; // 没有视频认为是完成状态
  }
  
  let completedCount = 0;
  let totalVideos = videos.length;
  
  videos.forEach((video, index) => {
    const isEnded = video.ended;
    const isNearEnd = video.currentTime > 0 && video.duration > 0 && (video.currentTime >= video.duration - 2);
    const isCompleted = isEnded || isNearEnd;
    
    console.log(`[AutoStudy] 视频 ${index + 1}: 时长=${Math.round(video.duration)}s, 当前=${Math.round(video.currentTime)}s, 已结束=${isEnded}, 接近结束=${isNearEnd}, 已完成=${isCompleted}`);
    
    if (isCompleted) {
      completedCount++;
    }
  });
  
  const allCompleted = completedCount === totalVideos;
  console.log(`[AutoStudy] 视频完成检查: ${completedCount}/${totalVideos} 已完成, 全部完成=${allCompleted}`);
  
  return allCompleted;
}

// 开始监控视频播放
function startVideoMonitoring() {
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
  }
  
  isWatchingVideo = true;
  
  showNotification('检测到视频内容，自动静音并调整倍速...', 'info', true);
  
  // 立即处理一次视频
  handleVideoPlayback();
  
  // 每2秒检查一次视频状态
  videoCheckInterval = setInterval(() => {
    if (!isRunning || !isWatchingVideo) {
      clearInterval(videoCheckInterval);
      return;
    }
    
    // 继续处理视频设置
    handleVideoPlayback();
    
    // 检查是否播放完成
    if (areAllVideosCompleted()) {
      console.log('[AutoStudy] 所有视频播放完成');
      stopVideoMonitoring();
      
      // 视频播放完成，直接点击下一个按钮
      setTimeout(() => {
        if (isRunning && !isWaitingForNextPage) {
          console.log('[AutoStudy] 视频播放完成，尝试点击下一个按钮');
          showNotification('视频播放完成，准备进入下一页...', 'success', true);
          
          // 重置状态为非视频页面，防止重复检测
          currentPageType = 'completed';
          
          // 直接尝试点击下一个按钮
          tryClickNextButton();
        }
      }, 2000);
    }
  }, 2000);
}

// 停止监控视频播放
function stopVideoMonitoring() {
  isWatchingVideo = false;
  
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
}

// 自动滚动功能 - 改进版（仅用于文本页面）
function autoScroll() {
  // 快速状态检查
  if (!isRunning) {
    console.log('[AutoStudy] autoScroll跳过 - 插件未运行');
    return;
  }
  
  if (isWaitingForNextPage || isWatchingVideo || isProcessingFileList) {
    // 降低日志频率，只有前几次才打印
    if (Math.random() < 0.01) { // 1%的概率打印日志
      console.log('[AutoStudy] autoScroll跳过 - 状态:', {isWaitingForNextPage, isWatchingVideo, isProcessingFileList});
    }
    return;
  }
  
  // 只在文本页面进行滚动
  if (currentPageType !== 'text') {
    console.log('[AutoStudy] autoScroll跳过 - 页面类型:', currentPageType);
    return;
  }
  
  if (isAtBottom()) {
    console.log('[AutoStudy] 文本页面已到达底部');
    handleBottomReached();
  } else {
    // 继续滚动
    const scrollAmount = config.scrollSpeed || 100;
    window.scrollBy({
      top: scrollAmount,
      behavior: 'smooth'
    });
    
    // 偶尔打印滚动进度（减少日志噪音）
    if (Math.random() < 0.05) { // 5%的概率
      const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const progress = Math.round((currentScroll / scrollHeight) * 100);
      console.log(`[AutoStudy] 文本滚动进度: ${progress}% (${currentScroll}/${scrollHeight})`);
    }
  }
}

// 处理到达底部的情况（仅用于文本页面）
function handleBottomReached() {
  if (isWaitingForNextPage || currentPageType !== 'text') return;
  
  // 暂停滚动但不停止运行状态
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  if (config.autoClickNext) {
    console.log('[AutoStudy] 文本页面滚动完成，等待', config.waitAtBottom, 'ms后查找下一个按钮...');
    showNotification(`页面滚动完成，${config.waitAtBottom/1000}秒后查找下一页...`);
    
    setTimeout(() => {
      tryClickNextButton();
    }, config.waitAtBottom);
  } else {
    console.log('[AutoStudy] 自动点击已禁用，停止运行');
    stopScrolling();
  }
}

// 尝试点击下一个按钮（带重试机制）
function tryClickNextButton() {
  if (!isRunning) return;
  
  const nextButton = findNextButton();
  
  if (nextButton) {
    console.log(`[AutoStudy] 找到下一个按钮 (尝试 ${retryCount + 1}/${maxRetries}):`, nextButton);
    showNotification('找到下一页按钮，正在跳转...');
    
    // 标记等待状态
    isWaitingForNextPage = true;
    retryCount = 0; // 重置重试计数
    
    // 点击按钮
    try {
      nextButton.click();
      
      // 等待页面加载
      console.log('[AutoStudy] 按钮已点击，等待页面加载...');
      setTimeout(() => {
        waitForPageLoad();
      }, 1000);
      
    } catch (error) {
      console.error('[AutoStudy] 点击按钮时出错:', error);
      handleClickFailure();
    }
    
  } else {
    handleNoButtonFound();
  }
}

// 处理找不到按钮的情况
function handleNoButtonFound() {
  retryCount++;
  
  if (retryCount < maxRetries) {
    console.log(`[AutoStudy] 未找到下一个按钮，${retryCount}/${maxRetries} 次尝试，3秒后重试...`);
    
    // 只在第一次和每5次重试时显示通知，减少频率
    if (retryCount === 1 || retryCount % 5 === 0) {
      showNotification(`未找到下一页按钮，${retryCount}/${maxRetries} 次尝试，3秒后重试...`);
    }
    
    setTimeout(() => {
      tryClickNextButton();
    }, 3000);
    
  } else {
    console.log('[AutoStudy] 达到最大重试次数，可能课程已结束');
    showNotification('课程可能已学完或无法找到下一页按钮', 'warning');
    
    // 询问是否继续
    setTimeout(() => {
      if (confirm('无法找到下一页按钮，可能课程已学完。是否重新开始滚动当前页面？')) {
        retryCount = 0;
        isWaitingForNextPage = false;
        restartScrolling();
      } else {
        stopScrolling();
      }
    }, 2000);
  }
}

// 处理点击失败的情况
function handleClickFailure() {
  retryCount++;
  
  if (retryCount < maxRetries) {
    console.log(`[AutoStudy] 点击失败，${retryCount}/${maxRetries} 次尝试，2秒后重试...`);
    showNotification(`点击失败，${retryCount}/${maxRetries} 次尝试，2秒后重试...`);
    
    isWaitingForNextPage = false;
    setTimeout(() => {
      tryClickNextButton();
    }, 2000);
    
  } else {
    console.log('[AutoStudy] 点击重试次数已达上限');
    showNotification('多次点击失败，已停止运行', 'error');
    stopScrolling();
  }
}

// 等待页面加载完成
function waitForPageLoad() {
  let loadCheckCount = 0;
  const maxLoadChecks = 20; // 最多检查20次
  const currentUrl = window.location.href;
  
  const checkLoad = () => {
    loadCheckCount++;
    
    // 检查URL是否改变
    if (window.location.href !== currentUrl) {
      console.log('[AutoStudy] 检测到页面URL变化，新页面已加载');
      onPageLoaded();
      return;
    }
    
    // 检查页面加载状态
    if (document.readyState === 'complete') {
      console.log('[AutoStudy] 页面加载完成');
      onPageLoaded();
      return;
    }
    
    if (loadCheckCount < maxLoadChecks) {
      setTimeout(checkLoad, 500);
    } else {
      console.log('[AutoStudy] 页面加载检查超时，继续执行');
      onPageLoaded();
    }
  };
  
  setTimeout(checkLoad, 500);
}

// 页面加载完成后的处理
function onPageLoaded() {
  isWaitingForNextPage = false;
  retryCount = 0;
  
  if (isRunning) {
    console.log('[AutoStudy] 新页面已加载，继续学习...');
    showNotification('新页面已加载，继续自动学习');
    
    // 等待一段时间让页面稳定，然后重新开始滚动
    setTimeout(() => {
      if (isRunning) {
        restartScrolling();
      }
    }, 1500);
  }
}

// 开始滚动
function startScrolling() {
  if (isRunning) return;
  
  isRunning = true;
  retryCount = 0;
  isWaitingForNextPage = false;
  
  console.log('[AutoStudy] 开始自动学习');
  showNotification('自动学习已启动', 'success', true); // 强制显示启动通知
  
  // 检测页面类型并执行相应策略
  currentPageType = detectPageType();
  handlePageByType();
  
  // 更新状态到后台脚本
  chrome.runtime.sendMessage({ action: 'updateStatus', isRunning: true }).catch(() => {
    // 忽略发送失败的错误
  });
}

// 根据页面类型处理
function handlePageByType() {
  console.log('[AutoStudy] 根据页面类型处理:', currentPageType);
  
  // 确保页面类型不为空
  if (!currentPageType || currentPageType === 'unknown') {
    console.log('[AutoStudy] 页面类型未知，强制设为文本类型');
    currentPageType = 'text';
  }
  
  switch (currentPageType) {
    case 'video':
      showNotification('检测到视频页面，开始视频处理...', 'info', true);
      startVideoMonitoring();
      break;
      
    case 'filelist':
      showNotification('检测到文件列表页面，开始逐个查看文件...', 'info', true);
      fileListIndex = 0;
      handleFileListPage();
      break;
      
    case 'text':
    default:
      console.log('[AutoStudy] 处理文本页面，确保状态正确');
      showNotification('检测到文本页面，开始滚动浏览...', 'info');
      // 确保文本页面类型
      currentPageType = 'text';
      startTextScrolling();
      break;
  }
}

// 开始文本页面滚动
function startTextScrolling() {
  console.log('[AutoStudy] 开始文本页面滚动，当前页面类型:', currentPageType);
  console.log('[AutoStudy] 配置信息:', {
    scrollDelay: config.scrollDelay,
    scrollSpeed: config.scrollSpeed,
    isRunning: isRunning
  });
  
  // 确保状态正确
  isWatchingVideo = false;
  isProcessingFileList = false;
  
  // 清除可能存在的旧定时器
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
    console.log('[AutoStudy] 清除了旧的滚动定时器');
  }
  
  // 确保配置已加载
  if (!config.scrollDelay || config.scrollDelay <= 0) {
    console.log('[AutoStudy] 配置异常，使用默认值');
    config.scrollDelay = 200;
    config.scrollSpeed = 100;
  }
  
  // 如果已经在底部，先回到顶部
  if (isAtBottom()) {
    console.log('[AutoStudy] 当前在页面底部，滚动到顶部重新开始');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      startTextScrollingTimer();
    }, 1000);
  } else {
    startTextScrollingTimer();
  }
}

// 启动文本滚动定时器
function startTextScrollingTimer() {
  if (!isRunning) {
    console.log('[AutoStudy] 插件未运行，取消滚动');
    return;
  }
  
  if (currentPageType !== 'text') {
    console.log('[AutoStudy] 页面类型不是文本，取消滚动:', currentPageType);
    return;
  }
  
  console.log('[AutoStudy] 启动文本滚动定时器, 间隔:', config.scrollDelay, 'ms');
  scrollInterval = setInterval(() => {
    console.log('[AutoStudy] 滚动定时器执行 - autoScroll');
    autoScroll();
  }, config.scrollDelay);
  
  console.log('[AutoStudy] 文本页面滚动定时器已启动，ID:', scrollInterval);
  
  // 验证定时器是否正常工作
  setTimeout(() => {
    if (scrollInterval) {
      console.log('[AutoStudy] 滚动定时器运行正常');
    } else {
      console.error('[AutoStudy] 滚动定时器异常！');
    }
  }, 2000);
}

// 重新开始滚动（用于页面跳转后）
function restartScrolling() {
  console.log('[AutoStudy] 重新开始学习 - 检测新页面类型');
  
  // 重置所有状态
  isWatchingVideo = false;
  isProcessingFileList = false;
  fileListIndex = 0;
  
  // 清除现有的定时器
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
  
  // 滚动到页面顶部
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  // 稍等一下让页面稳定，然后重新检测页面类型
  setTimeout(() => {
    if (isRunning) {
      currentPageType = detectPageType();
      handlePageByType();
      console.log('[AutoStudy] 新页面学习已启动，类型:', currentPageType);
    }
  }, 1500);
}

// 停止滚动
function stopScrolling() {
  isRunning = false;
  isWaitingForNextPage = false;
  isWatchingVideo = false;
  isProcessingFileList = false;
  retryCount = 0;
  fileListIndex = 0;
  
  // 清除所有定时器
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
  
  console.log('[AutoStudy] 停止自动学习');
  showNotification('自动学习已停止', 'info', true); // 强制显示停止通知
  
  // 更新状态到后台脚本
  chrome.runtime.sendMessage({ action: 'updateStatus', isRunning: false }).catch(() => {
    // 忽略发送失败的错误
  });
}

// 切换运行状态
function toggleRunning() {
  if (isRunning) {
    stopScrolling();
  } else {
    startScrolling();
  }
}

// 显示通知 - 支持不同类型和频率控制
function showNotification(message, type = 'info', force = false) {
  // 检查通知频率限制
  if (!force && !config.showNotifications) {
    return;
  }
  
  const now = Date.now();
  if (!force && (now - lastNotificationTime) < config.notificationInterval) {
    console.log('[AutoStudy] 通知被频率限制跳过:', message);
    return;
  }
  
  lastNotificationTime = now;
  
  // 移除现有通知
  const existing = document.querySelector('.autostudy-notification');
  if (existing) {
    existing.remove();
  }
  
  // 创建新通知
  const notification = document.createElement('div');
  notification.className = 'autostudy-notification';
  notification.textContent = message;
  
  // 根据类型设置颜色
  let backgroundColor;
  switch (type) {
    case 'success':
      backgroundColor = '#4CAF50';
      break;
    case 'warning':
      backgroundColor = '#FF9800';
      break;
    case 'error':
      backgroundColor = '#f44336';
      break;
    default:
      backgroundColor = '#2196F3';
  }
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${backgroundColor};
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    z-index: 99999;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-weight: 500;
    max-width: 300px;
    word-wrap: break-word;
    animation: slideIn 0.3s ease-out;
  `;
  
  // 添加CSS动画
  if (!document.querySelector('#autostudy-styles')) {
    const style = document.createElement('style');
    style.id = 'autostudy-styles';
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // 自动移除通知
  const duration = type === 'error' ? 5000 : 3000;
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.transition = 'opacity 0.5s, transform 0.5s';
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 500);
    }
  }, duration);
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AutoStudy] 收到消息:', request);
  
  if (request.action === 'toggle') {
    toggleRunning();
    sendResponse({ isRunning: isRunning });
  } else if (request.action === 'getStatus') {
    sendResponse({ isRunning: isRunning });
  } else if (request.action === 'updateConfig') {
    config = request.config;
    console.log('[AutoStudy] 配置已更新:', config);
    sendResponse({ success: true });
  }
  
  return true;
});

// 页面变化监听
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    console.log('[AutoStudy] 检测到URL变化:', lastUrl, '->', currentUrl);
    lastUrl = currentUrl;
    
    // 如果正在等待页面加载，触发加载完成
    if (isWaitingForNextPage) {
      setTimeout(onPageLoaded, 1000);
    }
  }
});

// 监听页面变化
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 监听浏览器前进后退
window.addEventListener('popstate', () => {
  console.log('[AutoStudy] 检测到页面导航变化');
  if (isWaitingForNextPage) {
    setTimeout(onPageLoaded, 1000);
  }
});

// 页面可见性变化监听
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('[AutoStudy] 页面隐藏，暂停运行');
  } else {
    console.log('[AutoStudy] 页面显示，恢复运行');
  }
});

// 调试函数 - 检查当前状态
function debugStatus() {
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  
  console.log('========== AutoStudy 详细调试信息 ==========');
  console.log('⚡ 运行状态:', {
    isRunning: isRunning,
    isWaitingForNextPage: isWaitingForNextPage,
    isWatchingVideo: isWatchingVideo,
    isProcessingFileList: isProcessingFileList,
    currentPageType: currentPageType,
    fileListIndex: fileListIndex
  });
  
  console.log('⏰ 定时器状态:', {
    scrollInterval: scrollInterval ? `运行中(ID: ${scrollInterval})` : '未运行',
    videoCheckInterval: videoCheckInterval ? `运行中(ID: ${videoCheckInterval})` : '未运行'
  });
  
  console.log('⚙️ 配置:', config);
  
  console.log('📄 页面信息:', {
    url: window.location.href,
    title: document.title,
    scrollTop: currentScroll,
    scrollHeight: scrollHeight,
    clientHeight: clientHeight,
    atBottom: isAtBottom(),
    scrollProgress: Math.round((currentScroll / scrollHeight) * 100) + '%'
  });
  
  // 页面类型检测
  const detectedType = detectPageType();
  const videos = document.querySelectorAll('video, iframe[src*="video"], .video-player');
  const fileButtons = getFileListViewButtons();
  const nextBtn = findNextButton();
  
  console.log('🔍 页面检测结果:', {
    currentType: currentPageType,
    detectedType: detectedType,
    videoCount: videos.length,
    fileButtonCount: fileButtons.length,
    hasNextButton: !!nextBtn
  });
  
  if (videos.length > 0) {
    console.log('🎥 视频详情:', Array.from(videos).map((v, i) => ({
      index: i,
      tagName: v.tagName,
      src: v.src || v.currentSrc || '无源',
      paused: v.paused,
      ended: v.ended,
      visible: v.offsetParent !== null
    })));
  }
  
  if (fileButtons.length > 0) {
    console.log('📁 文件按钮详情:', Array.from(fileButtons).slice(0, 5).map((btn, i) => ({
      index: i,
      text: btn.textContent?.trim().substring(0, 20),
      visible: btn.offsetParent !== null,
      enabled: !btn.disabled
    })));
    if (fileButtons.length > 5) {
      console.log(`... 还有 ${fileButtons.length - 5} 个按钮`);
    }
  }
  
  if (nextBtn) {
    console.log('▶️ 下一个按钮:', {
      text: nextBtn.textContent?.trim(),
      tagName: nextBtn.tagName,
      visible: nextBtn.offsetParent !== null,
      enabled: !nextBtn.disabled
    });
  }
  
  console.log('===========================================');
  
  // 返回简化的状态信息
  return {
    running: isRunning,
    pageType: currentPageType,
    scrollProgress: Math.round((currentScroll / scrollHeight) * 100),
    hasTimer: !!scrollInterval,
    elements: {
      videos: videos.length,
      files: fileButtons.length,
      nextBtn: !!nextBtn
    }
  };
}

// 暴露调试函数到全局（方便在控制台调用）
window.autoStudyDebug = debugStatus;

// 页面加载时初始化
loadConfig();
console.log('[AutoStudy] 内容脚本已加载 - v2.2');
console.log('[AutoStudy] 当前页面:', window.location.href);
console.log('[AutoStudy] 调试提示: 在控制台输入 autoStudyDebug() 查看详细状态');

// 添加快捷键支持（可选）
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Shift + S 切换运行状态
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleRunning();
    showNotification(isRunning ? '已启动自动学习' : '已停止自动学习', 'info');
  }
});

