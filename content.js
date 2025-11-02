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

// 默认配置 - 确保始终有可用的配置
const defaultConfig = {
  scrollSpeed: 80,         // 每次滚动的像素（减少步长，让滚动更平滑）
  scrollDelay: 400,        // 滚动间隔（毫秒）- 增加间隔让动画有时间完成
  waitAtBottom: 3000,      // 到达底部后等待时间（毫秒）
  autoClickNext: true,     // 是否自动点击下一个
  maxRetries: 5,           // 最大重试次数
  pageLoadWait: 4000,      // 页面加载等待时间
  pdfFlipDelay: 1000,      // PDF翻页延迟（毫秒）
  videoSpeed: 2.0,         // 视频播放倍速
  showNotifications: true, // 是否显示通知
  notificationInterval: 5000, // 通知最小间隔（毫秒）
  autoHandleFileList: true // 是否自动处理文件列表
};

// 当前配置 - 初始化为默认配置
let config = { ...defaultConfig };

// 验证并修复配置
function validateConfig() {
  console.log('[AutoStudy] 验证配置前:', config);
  
  // 确保关键配置项存在且有效
  if (!config.scrollDelay || config.scrollDelay <= 0) {
    console.log('[AutoStudy] scrollDelay 无效，使用默认值');
    config.scrollDelay = defaultConfig.scrollDelay;
  }
  
  if (!config.scrollSpeed || config.scrollSpeed <= 0) {
    console.log('[AutoStudy] scrollSpeed 无效，使用默认值');
    config.scrollSpeed = defaultConfig.scrollSpeed;
  }
  
  // 确保所有配置项都存在
  Object.keys(defaultConfig).forEach(key => {
    if (config[key] === undefined || config[key] === null) {
      console.log(`[AutoStudy] ${key} 缺失，使用默认值`);
      config[key] = defaultConfig[key];
    }
  });
  
  console.log('[AutoStudy] 验证配置后:', config);
}

// 从存储加载配置
function loadConfig() {
  console.log('[AutoStudy] 开始加载配置...');
  
  try {
    chrome.storage.sync.get(defaultConfig, (items) => {
      try {
        config = { ...defaultConfig, ...items }; // 确保合并默认配置
        maxRetries = config.maxRetries || defaultConfig.maxRetries;
        validateConfig();
        console.log('[AutoStudy] 配置已加载并验证:', config);
        
        // 标记配置已加载
        window.configLoaded = true;
      } catch (error) {
        console.error('[AutoStudy] 配置处理出错:', error);
        config = { ...defaultConfig };
        window.configLoaded = true;
      }
    });
  } catch (error) {
    console.error('[AutoStudy] 加载配置出错:', error);
    config = { ...defaultConfig };
    window.configLoaded = true;
  }
}

// 检测是否到达页面底部 - 增强版（同时检测文档和容器滚动）
function isAtBottom() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  
  // 检查文档级别的滚动
  const documentScrollable = scrollHeight - clientHeight;
  
  // 查找可滚动的内容容器（优先PDF查看器）
  const scrollableContainers = [
    // PDF查看器容器（最高优先级）
    document.querySelector('#viewerContainer'),
    document.querySelector('#viewer'), 
    document.querySelector('.pdfViewer'),
    document.querySelector('[class*="pdf-viewer"]'),
    document.querySelector('[class*="document-viewer"]'),
    // 其他容器
    document.querySelector('.full-screen-mode-content'),
    document.querySelector('main'),
    document.querySelector('.content')
  ].filter(el => el && el.scrollHeight > el.clientHeight + 20);
  
  // 检查主要内容容器的滚动状态
  let containerAtBottom = true; // 默认认为容器已到底部
  let containerScrollInfo = null;
  
  if (scrollableContainers.length > 0) {
    const container = scrollableContainers[0]; // 使用第一个可滚动容器
    const containerScrollTop = container.scrollTop;
    const containerScrollHeight = container.scrollHeight;
    const containerClientHeight = container.clientHeight;
    const containerScrollable = containerScrollHeight - containerClientHeight;
    
    if (containerScrollable > 20) { // 只有当容器确实可滚动时才检查
      const containerDistanceFromBottom = containerScrollHeight - (containerScrollTop + containerClientHeight);
      const containerScrollPercentage = containerScrollable > 0 ? (containerScrollTop / containerScrollable) * 100 : 100;
      
      // 对PDF容器使用更宽松的底部检测
      const isPdfContainer = container.id === 'viewerContainer' || 
                            container.id === 'viewer' || 
                            container.classList.contains('pdfViewer');
      
      const tolerance = isPdfContainer ? 100 : 30; // PDF容器使用更大的容差
      
      containerAtBottom = containerDistanceFromBottom <= tolerance || containerScrollPercentage >= 90;
      
      containerScrollInfo = {
        容器类名: container.className || container.tagName,
        容器ID: container.id || '无',
        容器滚动位置: Math.round(containerScrollTop),
        容器总高度: containerScrollHeight,
        容器可见高度: containerClientHeight,
        容器可滚动高度: containerScrollable,
        容器距离底部: Math.round(containerDistanceFromBottom),
        容器滚动百分比: Math.round(containerScrollPercentage * 100) / 100,
        容器已到底部: containerAtBottom,
        是否PDF容器: isPdfContainer,
        使用容差: tolerance
      };
    }
  }
  
  // 文档级别的滚动检测
  let documentAtBottom = true;
  if (documentScrollable > 10) {
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const scrollPercentage = documentScrollable > 0 ? (scrollTop / documentScrollable) * 100 : 100;
    
    const isNearBottom = distanceFromBottom <= 30 && scrollPercentage >= 80;
    const isNearComplete = scrollPercentage >= 95 && scrollAttempts >= 10;
    
    documentAtBottom = isNearBottom || isNearComplete;
  }
  
  // 综合判断：文档和容器都到底部才认为完成
  const result = documentAtBottom && containerAtBottom;
  
  // 调试信息输出（每10次或检测到底部时输出）
  if (result || scrollAttempts % 10 === 0) {
    console.log('🔍 [AutoStudy] 底部检测详情:', {
      文档滚动位置: Math.round(scrollTop),
      文档总高度: scrollHeight,
      文档可见高度: clientHeight,
      文档可滚动高度: documentScrollable,
      文档已到底部: documentAtBottom,
      容器信息: containerScrollInfo || '无可滚动容器',
      滚动次数: scrollAttempts,
      最终结果: result ? '✅ 已到达底部' : '❌ 未到达底部'
    });
  }
  
  return result;
}

// 查找"下一个"按钮 - 增强版
function findNextButton() {
  console.log('[AutoStudy] 开始查找下一个按钮...');
  
  // 针对lms.ouchn.cn和通用系统的特定选择器
  const specificSelectors = [
    // 开放大学系统专用
    'a[href*="learning-activity"]',  // 学习活动链接
    'a[href*="nextpage"]',
    'a[href*="next-page"]',
    'a[class*="next"]',
    'button[class*="next"]',
    
    // 通用分页和导航
    '.next',
    '.next-page',
    '.next-lesson',
    '.page-next',
    '.btn-next',
    'a.next-page',
    'button.next-page',
    'button.next-lesson',
    '.pagination a:last-child',
    '.page-navigation a:last-child',
    '.learning-nav a:last-child',
    '.nav-next',
    '.step-next',
    '.forward',
    
    // 带有data属性的按钮
    '[data-action="next"]',
    '[data-page="next"]',
    '[data-nav="next"]',
    
    // 课程系统常用
    '.course-nav-next',
    '.lesson-next',
    '.chapter-next',
    '.content-next'
  ];
  
  // 文本匹配关键词 - 扩展版
  const nextKeywords = [
    '下一个', '下一页', '下一节', '下一课', '下一章',
    'next', 'Next', 'NEXT', '继续', '下一步', '下一单元',
    '进入下一页', '下一项', '下个', '后一页', '下页',
    '→', '»', '>', '▶', '▷', '➤', '➔',
    'continue', 'Continue', 'CONTINUE',
    'forward', 'Forward', 'FORWARD'
  ];
  
  // 候选按钮数组，用于排序选择最佳候选
  const candidates = [];
  
  // 1. 首先尝试特定选择器
  for (let selector of specificSelectors) {
    const elements = document.querySelectorAll(selector);
    for (let element of elements) {
      if (isValidNextButton(element)) {
        candidates.push({
          element: element,
          priority: 10, // 特定选择器优先级最高
          source: 'selector:' + selector,
          text: element.textContent.trim()
        });
      }
    }
  }
  
  // 2. 查找所有可能的链接和按钮
  const allElements = document.querySelectorAll('a, button, [onclick], [role="button"], .btn, .button');
  
  for (let element of allElements) {
    // 跳过已经通过选择器找到的元素
    if (candidates.some(c => c.element === element)) continue;
    
    const text = element.textContent.trim();
    const title = element.getAttribute('title') || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const href = element.getAttribute('href') || '';
    
    // 检查文本内容
    for (let keyword of nextKeywords) {
      if (text.includes(keyword) || title.includes(keyword) || ariaLabel.includes(keyword)) {
        if (isValidNextButton(element)) {
          let priority = 8; // 文本匹配高优先级
          
          // 精确匹配给更高优先级
          if (text === keyword || title === keyword || ariaLabel === keyword) {
            priority = 9;
          }
          
          // 常用关键词给更高优先级
          if (['下一个', '下一页', '继续', 'next', 'Next'].includes(keyword)) {
            priority += 1;
          }
          
          candidates.push({
            element: element,
            priority: priority,
            source: 'text:' + keyword,
            text: text
          });
          break; // 找到匹配就跳出关键词循环
        }
      }
    }
    
    // 检查href中的特征
    if (href && (href.includes('next') || href.includes('page') || href.includes('lesson'))) {
      if (isValidNextButton(element) && !candidates.some(c => c.element === element)) {
        candidates.push({
          element: element,
          priority: 6, // href匹配中等优先级
          source: 'href:' + href.substring(0, 50),
          text: text
        });
      }
    }
  }
  
  // 3. 尝试查找分页器中的下一页
  const paginationNext = findPaginationNext();
  if (paginationNext && !candidates.some(c => c.element === paginationNext)) {
    candidates.push({
      element: paginationNext,
      priority: 7, // 分页器较高优先级
      source: 'pagination',
      text: paginationNext.textContent.trim()
    });
  }
  
  // 4. 排序候选按钮并选择最佳的
  if (candidates.length > 0) {
    // 按优先级排序，优先级相同则按位置排序（靠下的优先）
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // 优先级高的在前
      }
      
      // 优先级相同，比较位置（靠下的按钮通常是下一页）
      const rectA = a.element.getBoundingClientRect();
      const rectB = b.element.getBoundingClientRect();
      return rectB.top - rectA.top;
    });
    
    const best = candidates[0];
    console.log('[AutoStudy] 找到按钮候选:', candidates.length, '个, 选择最佳:', {
      source: best.source,
      text: best.text,
      priority: best.priority
    });
    
    console.log('[AutoStudy] 所有候选按钮:', candidates.map(c => ({
      source: c.source,
      text: c.text.substring(0, 20),
      priority: c.priority
    })));
    
    return best.element;
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

// 检测页面类型 - 增强调试版
function detectPageType() {
  console.log('=== [AutoStudy] 开始页面类型检测 ===');
  console.log('[AutoStudy] 当前URL:', window.location.href);
  console.log('[AutoStudy] 页面标题:', document.title);
  
  // 详细的页面元素统计
  const pageStats = {
    videos: document.querySelectorAll('video').length,
    videoIframes: document.querySelectorAll('iframe[src*="player"], iframe[src*="video"], iframe[src*="bilibili"], iframe[src*="youku"]').length,
    allIframes: document.querySelectorAll('iframe').length,
    buttons: document.querySelectorAll('button').length,
    links: document.querySelectorAll('a').length,
    images: document.querySelectorAll('img').length,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    needsScroll: document.documentElement.scrollHeight > window.innerHeight,
    autoHandleFileList: config.autoHandleFileList
  };
  
  console.log('[AutoStudy] 页面元素统计:', pageStats);
  
  // 检测DOM特殊元素
  const specialElements = {
    pdfViewers: document.querySelectorAll('.pdf-viewer, #pdf-viewer, iframe[src*="pdf"]').length,
    videoPlayers: document.querySelectorAll('.video-player, .player, [class*="video"]').length,
    fileElements: document.querySelectorAll('[href*=".pdf"], [href*=".doc"], [href*=".ppt"]').length,
    listContainers: document.querySelectorAll('ul, ol, table, .list').length,
    navigations: document.querySelectorAll('nav, .navigation, .nav, .menu').length
  };
  
  console.log('[AutoStudy] 特殊元素检测:', specialElements);
  
  // 文本内容分析
  const textStats = {
    totalTextLength: document.body.textContent.length,
    paragraphs: document.querySelectorAll('p').length,
    headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
    codeBlocks: document.querySelectorAll('pre, code').length
  };
  
  console.log('[AutoStudy] 文本内容分析:', textStats);
  
  // 优先检测文件预览类型（PDF、文档查看器等）
  // 这应该在视频检测之前，避免误判
  const filePreviewDetection = detectFilePreview(specialElements);
  console.log('[AutoStudy] 文件预览检测结果:', filePreviewDetection);
  if (filePreviewDetection) {
    console.log('✅ [AutoStudy] 页面类型：文件预览');
    return 'filepreview';
  }
  
  // 检测视频类型（排除PDF/文档查看器）
  const videoDetection = detectVideo();
  console.log('[AutoStudy] 视频检测结果:', videoDetection);
  if (videoDetection) {
    console.log('✅ [AutoStudy] 页面类型：视频');
    return 'video';
  }
  
  // 检测文件列表类型（只在启用自动处理时）
  const fileListDetection = config.autoHandleFileList ? detectFileList() : false;
  console.log('[AutoStudy] 文件列表检测结果:', fileListDetection, '(启用:', config.autoHandleFileList, ')');
  if (fileListDetection) {
    console.log('✅ [AutoStudy] 页面类型：文件列表');
    return 'filelist';
  }
  
  // 页面可滚动性检查
  const scrollInfo = {
    canScroll: pageStats.needsScroll,
    scrollRatio: Math.round((pageStats.pageHeight / pageStats.viewportHeight) * 100) / 100,
    hasLongContent: pageStats.totalTextLength > 1000
  };
  
  console.log('[AutoStudy] 滚动信息:', scrollInfo);
  
  // 默认为文本类型
  console.log('✅ [AutoStudy] 页面类型：文本（默认）');
  console.log('=== [AutoStudy] 页面类型检测完成 ===');
  return 'text';
}

// 检测是否为文件预览页面（PDF、文档查看器等）
function detectFilePreview(specialElements) {
  console.log('[AutoStudy] === 开始文件预览检测 ===');
  
  // 检查PDF查看器 - 增强版（包含PDF.js元素）
  const pdfViewers = document.querySelectorAll(
    '.pdf-viewer, #pdf-viewer, ' +
    'iframe[src*="pdf"], iframe[src*=".pdf"], ' +
    'embed[type*="pdf"], embed[type="application/pdf"], ' +
    '[class*="pdf-viewer"], [id*="pdf-viewer"], ' +
    'object[data*="pdf"], object[data*=".pdf"], ' +
    // PDF.js 特有元素
    '#viewerContainer, #viewer, .pdfViewer, ' +
    '.textLayer, .annotationLayer, .page, ' +
    '[data-page-number], .canvasWrapper'
  );
  
  // 检查文档查看器（可能包含PDF、Word、PPT等）
  const documentViewers = document.querySelectorAll(
    '.document-viewer, .doc-viewer, .file-viewer, .preview-viewer, ' +
    '[class*="preview"], [class*="viewer"], ' +
    '[class*="document-viewer"], [id*="document-viewer"], ' +
    'iframe[src*="viewer"], iframe[src*="preview"], iframe[src*="view"]'
  );
  
  // 检查URL是否包含预览相关关键词（更严格的匹配）
  const url = window.location.href.toLowerCase();
  const isPreviewUrl = url.includes('preview') || 
                       url.includes('file-viewer') ||
                       url.includes('document-viewer') ||
                       url.includes('.pdf') ||
                       url.includes('pdf-view') ||
                       url.includes('file-view') ||
                       url.includes('/view/') && (url.includes('pdf') || url.includes('doc'));
  
  // 检查页面标题是否包含PDF或文档（更严格的匹配）
  const title = document.title.toLowerCase();
  const isPreviewTitle = title.includes('pdf') || 
                        title.includes('.pdf') ||
                        title.includes('文档预览') || 
                        title.includes('文件预览') ||
                        title.includes('document preview') ||
                        title.includes('file preview');
  
  // 检查是否有PDF相关的iframe或embed
  let hasPdfContent = false;
  const allIframes = document.querySelectorAll('iframe');
  for (let iframe of allIframes) {
    const src = (iframe.src || '').toLowerCase();
    const name = (iframe.name || '').toLowerCase();
    const id = (iframe.id || '').toLowerCase();
    const className = (iframe.className || '').toLowerCase();
    
    // 更严格的PDF内容检测
    if (src.includes('pdf') || 
        src.includes('.pdf') ||
        src.includes('pdf-viewer') ||
        src.includes('document-viewer') ||
        name.includes('pdf') ||
        id.includes('pdf') ||
        className.includes('pdf') ||
        className.includes('pdf-viewer') ||
        className.includes('document-viewer')) {
      hasPdfContent = true;
      break;
    }
  }
  
  // 检查PDF.js特有元素（最可靠的PDF预览指标）
  const hasPdfJsElements = document.querySelector('#viewerContainer') ||
                          document.querySelector('#viewer') ||
                          document.querySelector('.pdfViewer') ||
                          document.querySelector('.textLayer') ||
                          document.querySelector('[data-page-number]');
  
  // 更严格的综合判断：需要明确的PDF/文档特征
  const result = pdfViewers.length > 0 || 
                 hasPdfJsElements ||
                 (documentViewers.length > 0 && (isPreviewUrl || isPreviewTitle)) ||
                 (hasPdfContent && isPreviewUrl && isPreviewTitle) ||
                 (specialElements && specialElements.pdfViewers > 0);
  
  // 额外检查：如果是学习平台的正常页面，但有明确PDF特征，仍判断为预览
  const isLearningPage = url.includes('learning') || 
                         url.includes('course') || 
                         url.includes('study') ||
                         title.includes('学') ||
                         title.includes('课程');
  
  // 有PDF.js元素或标题含.pdf时，优先判断为文件预览
  const hasClearPdfFeatures = hasPdfJsElements || title.includes('.pdf');
  const finalResult = result && (!isLearningPage || hasClearPdfFeatures);
  
  console.log('[AutoStudy] 文件预览检测详情:', {
    pdfViewers: pdfViewers.length,
    documentViewers: documentViewers.length,
    hasPdfJsElements: !!hasPdfJsElements,
    hasPdfContent,
    isPreviewUrl,
    isPreviewTitle,
    isLearningPage,
    hasClearPdfFeatures,
    初步结果: result,
    最终结果: finalResult
  });
  
  console.log('[AutoStudy] === 文件预览检测完成 ===');
  return finalResult;
}

// 检测是否为文件列表页面 - 更精确的检测
function detectFileList() {
  console.log('[AutoStudy] === 开始文件列表检测 ===');
  
  // 首先检查是否有"查看"、"预览"、"打开"等操作按钮
  const viewButtons = getFileListViewButtons();
  console.log('[AutoStudy] 找到查看按钮数量:', viewButtons.length);
  
  // 如果没有查看按钮，直接返回false
  if (viewButtons.length === 0) {
    console.log('[AutoStudy] 没有找到查看按钮，不是文件列表页面');
    return false;
  }
  
  // 有查看按钮的情况下，进一步检查页面结构
  const structuralIndicators = {
    // 明确的文件列表容器
    explicitFileContainers: document.querySelectorAll('.file-list, .document-list, .resource-list, .attachment-list').length,
    
    // 文件相关的数据属性
    fileDataElements: document.querySelectorAll('[data-file], [data-document], [data-attachment]').length,
    
    // 文件图标或类型指示器
    fileIcons: document.querySelectorAll('.file-icon, .document-icon, i[class*="file"], i[class*="document"]').length,
    
    // 文件扩展名显示
    fileExtensions: document.querySelectorAll('.file-ext, .extension, [class*="pdf"], [class*="doc"], [class*="xls"]').length
  };
  
  console.log('[AutoStudy] 文件列表结构指标:', structuralIndicators);
  
  // 检查文件下载链接
  const filePatterns = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|txt)(\?.*)?$/i;
  const allLinks = document.querySelectorAll('a[href]');
  
  let fileLinksCount = 0;
  const fileLinks = [];
  
  for (let link of allLinks) {
    if (filePatterns.test(link.href)) {
      fileLinksCount++;
      fileLinks.push({
        href: link.href,
        text: link.textContent.trim().substring(0, 30)
      });
    }
  }
  
  console.log('[AutoStudy] 文件链接检测:', {
    count: fileLinksCount,
    samples: fileLinks.slice(0, 3)
  });
  
  // 综合判断逻辑
  const hasExplicitFileStructure = structuralIndicators.explicitFileContainers > 0 || 
                                   structuralIndicators.fileDataElements > 0 ||
                                   structuralIndicators.fileIcons > 0;
  
  const hasMultipleFiles = fileLinksCount >= 3; // 至少3个文件才考虑为文件列表
  
  // 降低文件列表检测门槛：只要有查看按钮就认为可能是文件列表
  const hasViewButtonsAndFiles = viewButtons.length >= 1;
  
  const result = hasViewButtonsAndFiles;
  
  console.log('[AutoStudy] 文件列表判断:', {
    hasViewButtons: viewButtons.length > 0,
    viewButtonsCount: viewButtons.length,
    hasExplicitFileStructure,
    hasMultipleFiles,
    finalResult: result
  });
  
  if (result) {
    console.log('✅ [AutoStudy] 确认为文件列表页面');
  } else {
    console.log('❌ [AutoStudy] 不是文件列表页面，可能只是包含表格的普通文本页面');
  }
  
  console.log('[AutoStudy] === 文件列表检测完成 ===');
  return result;
}

// 获取文件列表中的查看按钮 - 增强版
function getFileListViewButtons() {
  const viewButtons = [];
  
  console.log('[AutoStudy] 开始查找文件查看按钮...');
  
  // 更全面的按钮查找
  const allClickableElements = document.querySelectorAll(
    'button, a, .btn, [role="button"], ' +
    '[onclick], [href], span[class*="btn"], div[class*="btn"], ' +
    'td a, tr a, .file-item a, .document-item a'
  );
  
  console.log('[AutoStudy] 找到', allClickableElements.length, '个可点击元素');
  
  let foundButtons = 0;
  
  for (let element of allClickableElements) {
    const text = element.textContent.trim().toLowerCase();
    const title = (element.getAttribute('title') || '').toLowerCase();
    const href = element.getAttribute('href') || '';
    const className = element.className.toLowerCase();
    const dataAction = element.getAttribute('data-action') || '';
    
    // 更宽松的文本匹配
    const hasViewText = text.includes('查看') || text.includes('预览') || 
                       text.includes('打开') || text.includes('view') || 
                       text.includes('open') || text.includes('preview') ||
                       text === '查看' || text === '预览' || text === '打开';
    
    const hasViewTitle = title.includes('查看') || title.includes('预览') || 
                        title.includes('打开') || title.includes('view') || 
                        title.includes('open') || title.includes('preview');
    
    const hasViewClass = className.includes('view') || className.includes('preview') || 
                        className.includes('open') || className.includes('btn');
    
    const hasViewAction = dataAction === 'view' || dataAction === 'open' || dataAction === 'preview';
    
    // 检查是否是指向PDF等文件的直接链接
    const isFileLink = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx)(\?.*)?$/i.test(href);
    
    if (hasViewText || hasViewTitle || hasViewAction || isFileLink) {
      // 检查元素是否可见和可点击
      if (isValidButton(element)) {
        viewButtons.push(element);
        foundButtons++;
        
        console.log('[AutoStudy] 找到查看按钮', foundButtons + ':', {
          text: text.substring(0, 20),
          title: title.substring(0, 20),
          href: href.substring(0, 50),
          className: className.substring(0, 30),
          tagName: element.tagName
        });
      }
    }
  }
  
  console.log(`[AutoStudy] 总共找到 ${viewButtons.length} 个有效查看按钮`);
  return viewButtons;
}

// 验证按钮是否有效
function isValidButton(button) {
  try {
    if (!button) return false;
    
    // 检查元素是否在DOM中
    if (!document.contains(button)) return false;
    
    // 检查元素是否可见（更健壮的检查）
    const style = window.getComputedStyle(button);
    if (style.display === 'none' || style.visibility === 'hidden' || 
        style.opacity === '0' || button.offsetWidth === 0 || button.offsetHeight === 0) {
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn('[AutoStudy] 按钮验证出错:', error);
    return false;
  }
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

// 处理文件列表页面 - 增强版
function handleFileListPage() {
  if (isProcessingFileList) {
    console.log('[AutoStudy] 已在处理文件列表，跳过重复调用');
    return;
  }
  
  console.log('=== [AutoStudy] 开始处理文件列表页面 ===');
  isProcessingFileList = true;
  fileListIndex = 0;
  
  // 等待页面稳定后再获取按钮
  setTimeout(() => {
    console.log('[AutoStudy] 开始检测文件列表按钮...');
    const viewButtons = getFileListViewButtons();
    
    console.log(`[AutoStudy] 文件列表检测结果: 找到 ${viewButtons.length} 个查看按钮`);
    
    if (viewButtons.length === 0) {
      console.log('[AutoStudy] 未找到查看按钮，可能不是文件列表或无可操作文件');
      console.log('[AutoStudy] 转为文本页面处理...');
      
      isProcessingFileList = false;
      currentPageType = 'text';
      
      showNotification('未找到文件查看按钮，转为文本滚动模式', 'info');
      
      // 延迟启动文本滚动
      setTimeout(() => {
        if (isRunning) {
          console.log('[AutoStudy] 启动文本滚动作为备用方案');
          startTextScrolling();
        }
      }, 1000);
      return;
    }
    
    // 显示文件列表处理信息
    console.log(`[AutoStudy] 开始处理 ${viewButtons.length} 个文件...`);
    showNotification(`找到 ${viewButtons.length} 个文件，开始逐个查看...`, 'info');
    
    processNextFileInList(viewButtons);
  }, 2000); // 增加等待时间，确保页面完全加载
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

// 处理文件内容查看 - 简化版（直接翻页）
function handleFileContentView() {
  if (!isRunning || !isProcessingFileList) {
    console.log('[AutoStudy] 插件未运行或未处理文件列表，跳过文件内容查看');
    return;
  }
  
  console.log('[AutoStudy] === 文件预览已打开，准备浏览 ===');
  showNotification('文件加载中...', 'info');
  
  // 已经进入预览，不需要检测容器，直接等待内容加载后开始浏览
  // 使用配置的页面加载等待时间，或默认2秒
  const loadWaitTime = Math.min(config.pageLoadWait || 2000, 3000);
  
  console.log(`[AutoStudy] 等待 ${loadWaitTime/1000} 秒让文件加载...`);
  
  setTimeout(() => {
    if (!isRunning || !isProcessingFileList) {
      console.log('[AutoStudy] 状态已改变，取消文件浏览');
      return;
    }
    
    console.log('[AutoStudy] 文件加载完成，开始浏览');
    startSimpleFileViewing();
  }, loadWaitTime);
}

// 简化的文件浏览流程 - 文件列表专用
function startSimpleFileViewing() {
  if (!isRunning || !isProcessingFileList) {
    console.log('[AutoStudy] 状态已改变，取消文件浏览');
    return;
  }
  
  console.log('[AutoStudy] 启动简化文件浏览流程...');
  
  // 等待并检测PDF查看器（可能需要时间加载）
  detectAndStartViewing();
}

// 检测并启动浏览（带重试机制）
function detectAndStartViewing() {
  let attempts = 0;
  const maxAttempts = 5;
  
  const checkPdfViewer = () => {
    attempts++;
    
    if (!isRunning || !isProcessingFileList) {
      return;
    }
    
    // 检测PDF查看器容器（包括主文档和iframe）
    let hasPdfViewer = document.querySelector('#viewerContainer') || 
                       document.querySelector('#viewer') ||
                       document.querySelector('.pdfViewer');
    
    let searchLocation = '主文档';
    
    // 如果主文档中没有，检查iframe
    if (!hasPdfViewer) {
      const iframes = document.querySelectorAll('iframe');
      
      for (let iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const pdfInIframe = iframeDoc.querySelector('#viewerContainer') || 
                               iframeDoc.querySelector('#viewer') ||
                               iframeDoc.querySelector('.pdfViewer');
            
            if (pdfInIframe) {
              hasPdfViewer = pdfInIframe;
              searchLocation = `iframe[src="${iframe.src?.substring(0, 50)}..."]`;
              console.log('[AutoStudy] ✅ 在iframe中找到PDF容器!', {
                iframe_src: iframe.src,
                容器ID: pdfInIframe.id,
                容器类: pdfInIframe.className
              });
              break;
            }
          }
        } catch (e) {
          // 跨域iframe无法访问，跳过
          console.log(`[AutoStudy] 无法访问iframe (可能跨域):`, e.message);
        }
      }
    }
    
    // 只在首次或找到容器时打印
    if (attempts === 1 || hasPdfViewer) {
      console.log(`[AutoStudy] PDF容器检测 ${attempts}/${maxAttempts}:`, hasPdfViewer ? '✅ 已找到' : '等待中...');
    }
    
    if (hasPdfViewer) {
      console.log('[AutoStudy] ✅ 检测到PDF查看器，等待翻页按钮就绪...');
      waitForPageButton();
    } else if (attempts < maxAttempts) {
      // 继续等待
      setTimeout(checkPdfViewer, 800);
    } else {
      console.log('[AutoStudy] ⚠️ 未检测到PDF查看器，执行快速浏览');
      doQuickView();
    }
  };
  
  // 立即开始第一次检查
  checkPdfViewer();
}

// 等待翻页按钮就绪
function waitForPageButton() {
  let attempts = 0;
  const maxAttempts = 5; // 最多等待5次，每次1秒
  
  const checkButton = () => {
    attempts++;
    
    if (!isRunning || !isProcessingFileList) {
      return;
    }
    
    const pdfSuccess = tryPdfPageFlipping();
    
    if (pdfSuccess) {
      console.log('[AutoStudy] ✅ 找到翻页按钮，使用PDF翻页模式');
      return;
    }
    
    // 继续等待或放弃
    if (attempts < maxAttempts) {
      setTimeout(checkButton, 1000);
    } else {
      console.log('[AutoStudy] ⚠️ 未找到翻页按钮，执行快速浏览');
      doQuickView();
    }
  };
  
  // 立即开始第一次检查
  checkButton();
}

// 快速浏览文件
function doQuickView() {
  if (!isRunning || !isProcessingFileList) {
    return;
  }
  
  console.log('[AutoStudy] 执行快速浏览');
  showNotification('快速浏览文件...', 'info');
  
  // 快速浏览：等待配置的浏览时间后直接关闭
  const quickViewTime = Math.min(config.scrollDelay * 3, 3000); // 最多3秒
  
  setTimeout(() => {
    if (!isRunning || !isProcessingFileList) {
      return;
    }
    
    console.log('[AutoStudy] 快速浏览完成，关闭文件');
    showNotification('文件浏览完成', 'success');
    closeFileView();
  }, quickViewTime);
}

// 启动文件滚动的函数
function startFileScrolling() {
  if (!isRunning || !isProcessingFileList) {
    console.log('[AutoStudy] 状态已改变，取消文件内容滚动');
    return;
  }
  
  // 检查是否是PDF查看器，如果是，优先使用翻页模式
  const isPdfViewer = document.querySelector('#viewerContainer') || 
                      document.querySelector('#viewer') ||
                      document.querySelector('.pdfViewer');
  
  if (isPdfViewer) {
    // 尝试使用翻页模式
    const pdfPageSuccess = tryPdfPageFlipping();
    
    if (pdfPageSuccess) {
      return; // 使用翻页模式，不再使用滚动
    }
  }
  
  // 延迟一下再开始滚动（回退方案）
  setTimeout(() => {
    if (!isRunning || !isProcessingFileList) {
      console.log('[AutoStudy] 状态已改变，取消文件内容滚动');
      return;
    }
    
    // 查找可能的滚动容器（文件预览可能在模态框或iframe中）
    const possibleContainers = [
      document.querySelector('.modal-body'),
      document.querySelector('.preview-container'),
      document.querySelector('.file-preview'),
      document.querySelector('.document-viewer'),
      document.querySelector('#viewerContainer'),
      document.querySelector('#viewer'),
      document.querySelector('.pdfViewer'),
      document.querySelector('[class*="preview"]'),
      document.querySelector('[class*="modal"]'),
      document.querySelector('iframe')
    ].filter(el => el && el.scrollHeight > el.clientHeight + 20);
  
  // 先滚动到顶部确保从头开始
  window.scrollTo({ top: 0, behavior: 'instant' });
    possibleContainers.forEach(container => {
      try {
        container.scrollTop = 0;
      } catch (e) {
        // 静默忽略
      }
    });
    
    // 启动独立的文件内容滚动
    scrollFileContent(possibleContainers);
    
  }, 500); // 减少延迟，因为已经在 waitForPdfLoad 中等待过了
}

// PDF 翻页模式 - 通过点击下一页按钮浏览（增强版，支持iframe）
function tryPdfPageFlipping() {
  // 首先确定搜索范围（主文档或iframe）
  let searchDoc = document;
  let searchContext = '主文档';
  
  // 检查iframe中是否有PDF
  const iframes = document.querySelectorAll('iframe');
  for (let iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const hasPdf = iframeDoc.querySelector('#viewerContainer') || 
                      iframeDoc.querySelector('#viewer') ||
                      iframeDoc.querySelector('.pdfViewer');
        if (hasPdf) {
          searchDoc = iframeDoc;
          searchContext = 'iframe';
          break;
        }
      }
    } catch (e) {
      // 跨域iframe，跳过
    }
  }
  
  // 增强翻页按钮选择器列表
  const nextButtonSelectors = [
    '#next', // PDF.js 标准
    '#pageDown',
    '.toolbarButton.pageDown',
    'button[title*="下一页"]',
    'button[title*="Next"]',
    'button[title*="next"]',
    'button[title*="下"]',
    'button[aria-label*="下一页"]',
    'button[aria-label*="Next"]',
    'button[id*="next"]',
    'button[id*="Next"]',
    'button[id*="pageDown"]',
    'button[class*="next"]',
    'button[class*="pageDown"]',
    'button[class*="page-down"]',
    '[data-l10n-id="next"]',
    '[data-l10n-id="page_down"]',
    'a[title*="下一页"]',
    'a[title*="Next"]',
    'span[title*="下一页"]',
    '.next-page',
    '.page-next',
    '.btn-next'
  ];
  
  let nextButton = null;
  let foundSelector = '';
  
  // 遍历查找可用的按钮（在正确的文档中搜索）
  const buttonCheckResults = [];
  
  for (let selector of nextButtonSelectors) {
    try {
      const btn = searchDoc.querySelector(selector);
      if (btn) {
        // 使用多种方式检查可见性
        let isVisible = false;
        try {
          isVisible = btn.offsetParent !== null;
        } catch (e) {
          // offsetParent 可能报错，使用其他方式
          const style = window.getComputedStyle(btn);
          isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }
        
        const isEnabled = !btn.disabled;
        
        buttonCheckResults.push({
          选择器: selector,
          找到: true,
          可见: isVisible,
          可用: isEnabled,
          id: btn.id,
          class: btn.className
        });
        
        // 放宽条件：只要找到按钮且未禁用就可以，不强制要求可见性检查
        if (isEnabled && (isVisible || selector === '#next' || selector === '#pageDown')) {
          nextButton = btn;
          foundSelector = selector;
          break;
        }
      }
    } catch (e) {
      // 忽略选择器错误
    }
  }
  
  if (!nextButton) {
    console.log('[AutoStudy] 未找到PDF翻页按钮');
    return false;
  }
  
  console.log(`[AutoStudy] ✅ 找到PDF翻页按钮 (${searchContext})`);

  
  
  // 查找页码信息（在正确的文档中）
  const pageNumberSelectors = [
    '#pageNumber',
    'input[id*="pageNumber"]',
    'input[id*="page"]',
    '.pageNumber'
  ];
  
  let pageNumberInput = null;
  for (let selector of pageNumberSelectors) {
    try {
      const input = searchDoc.querySelector(selector);
      if (input) {
        pageNumberInput = input;
        break;
      }
    } catch (e) {
      // 忽略
    }
  }
  
  // 查找总页数
  const numPagesSelectors = [
    '#numPages',
    '.numPages',
    '[id*="numPages"]',
    'span[id*="Pages"]'
  ];
  
  let totalPages = 0;
  for (let selector of numPagesSelectors) {
    try {
      const element = searchDoc.querySelector(selector);
      if (element) {
        const text = element.textContent.trim();
        const num = parseInt(text);
        if (!isNaN(num) && num > 0) {
          totalPages = num;
          break;
        }
      }
    } catch (e) {
      // 忽略
    }
  }
  
  // 如果没找到总页数，尝试从文本中提取 "1 / 10" 格式
  if (totalPages === 0) {
    try {
      const toolbar = searchDoc.querySelector('#toolbarViewer') || 
                     searchDoc.querySelector('.toolbar') ||
                     searchDoc.querySelector('[class*="toolbar"]');
      
      if (toolbar) {
        const text = toolbar.textContent;
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          totalPages = parseInt(match[2]);
        }
      }
    } catch (e) {
      // 静默忽略
    }
  }
  
  if (totalPages === 0) {
    totalPages = 100; // 设置一个最大值
  }
  
  console.log(`[AutoStudy] ✅ PDF翻页就绪: 共${totalPages}页`);
  
  // 开始翻页
  startPdfPageFlipping(nextButton, pageNumberInput, totalPages);
  
  return true;
}

// 执行PDF翻页
function startPdfPageFlipping(nextButton, pageNumberInput, totalPages) {
  let currentPage = 1;
  let flipAttempts = 0;
  const maxFlipAttempts = totalPages + 10; // 加一些容错
  const pageDelay = config.pdfFlipDelay || 1000; // 使用配置的PDF翻页延迟
  
  console.log(`[AutoStudy] PDF翻页开始: ${totalPages}页 (间隔${pageDelay}ms)`);
  showNotification(`开始翻页 (共${totalPages}页)...`, 'info');
  
  const flipNextPage = () => {
    if (!isRunning || !isProcessingFileList) {
      return;
    }
    
    flipAttempts++;
    
    // 获取当前页码
    if (pageNumberInput) {
      try {
        currentPage = parseInt(pageNumberInput.value) || currentPage;
      } catch (e) {
        // 忽略
      }
    }
    
    // 减少日志：每10页打印一次
    if (currentPage % 10 === 0 || currentPage === 1) {
      showNotification(`浏览: ${currentPage}/${totalPages}页`, 'info');
    }
    
    // 检查是否完成
    if (currentPage >= totalPages || flipAttempts >= maxFlipAttempts) {
      console.log(`[AutoStudy] PDF浏览完成: ${currentPage}页`);
      showNotification('PDF浏览完成！', 'success');
      
      setTimeout(() => {
        closeFileView();
      }, 2000);
      
      return;
    }
    
    // 检查按钮是否还可用
    if (!nextButton || nextButton.disabled || nextButton.offsetParent === null) {
      console.log('[AutoStudy] 翻页按钮不可用，结束浏览');
      
      setTimeout(() => {
        closeFileView();
      }, 2000);
      
      return;
    }
    
    // 点击下一页
    try {
      nextButton.click();
      
      // 等待页面加载后继续
      setTimeout(flipNextPage, pageDelay);
      
    } catch (error) {
      console.error('[AutoStudy] 点击翻页失败:', error);
      
      setTimeout(() => {
        closeFileView();
      }, 2000);
    }
  };
  
  // 开始第一次翻页
  setTimeout(flipNextPage, pageDelay);
}

// 独立的文件内容滚动函数 - 增强兼容性版本
function scrollFileContent(scrollableContainers = []) {
  console.log('[AutoStudy] 启动滚动模式...');
  
  let fileScrollAttempts = 0;
  let fileLastScrollHeight = 0;
  let fileLastScrollTop = 0;
  let fileStuckCount = 0;
  const maxFileScrollAttempts = 300;
  const maxFileStuckCount = 15;
  
  // 检查是否为侧边栏或导航元素（需要排除）
  const isSidebarOrNavigation = (element) => {
    if (!element) return false;
    
    const className = (element.className || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    
    // 排除关键词
    const excludeKeywords = [
      'sidebar', 'side-bar', 'sidenav', 'side-nav',
      'menu', 'navigation', 'nav-', 'aside',
      'left-panel', 'right-panel', 'side-panel',
      'toolbar', 'tool-bar', 'outline', 'toc',
      'thumbnail', 'minimap'
    ];
    
    const isExcluded = excludeKeywords.some(keyword => 
      className.includes(keyword) || id.includes(keyword)
    );
    
    if (isExcluded) {
      console.log('[AutoStudy] 🚫 排除侧边栏/导航元素:', {
        类名: className,
        ID: id
      });
      return true;
    }
    
    // 检查位置和大小（侧边栏通常较窄）
    try {
      const rect = element.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      
      // 宽度小于窗口30%的元素，可能是侧边栏
      const isNarrow = rect.width < windowWidth * 0.3;
      
      // 在最左侧或最右侧的窄元素
      const isLeftSide = rect.left < 50 && isNarrow;
      const isRightSide = rect.right > windowWidth - 50 && isNarrow;
      
      if (isLeftSide || isRightSide) {
        console.log('[AutoStudy] 🚫 排除窄边栏元素:', {
          宽度: Math.round(rect.width),
          位置: isLeftSide ? '左侧' : '右侧',
          类名: className
        });
        return true;
      }
    } catch (e) {
      // 忽略错误
    }
    
    return false;
  };
  
  // 查找最佳滚动容器（更智能的选择）
  const findBestScrollContainer = () => {
    // PDF.js 特定容器（最高优先级）
    const pdfContainers = [
      document.querySelector('#viewerContainer'),
      document.querySelector('#viewer'),
      document.querySelector('.pdfViewer'),
      document.querySelector('[id*="viewer"]'),
      document.querySelector('[class*="viewer"]')
    ].filter(el => el && !isSidebarOrNavigation(el));
    
    if (pdfContainers.length > 0) {
      // 选择可滚动的PDF容器
      for (let container of pdfContainers) {
        // 降低阈值：即使差值为0，也选择它（PDF可能还在加载）
        if (container.scrollHeight >= container.clientHeight) {
          if (fileScrollAttempts === 0) {
            console.log('[AutoStudy] ✅ 选择PDF容器:', container.id || container.className);
          }
          return container;
        }
      }
      
      // 如果都不可滚动，但有 #viewerContainer 或 #viewer，仍然返回它
      const primaryContainer = pdfContainers.find(c => 
        c.id === 'viewerContainer' || c.id === 'viewer'
      );
      
      if (primaryContainer) {
        if (fileScrollAttempts === 0) {
          console.log('[AutoStudy] 选择PDF容器（等待加载）:', primaryContainer.id);
        }
        return primaryContainer;
      }
    }
    
    // 使用传入的容器（但排除侧边栏）
    if (scrollableContainers.length > 0) {
      const validContainers = scrollableContainers.filter(c => !isSidebarOrNavigation(c));
      if (validContainers.length > 0) {
        return validContainers[0];
      }
    }
    
    // 查找主要内容区域的可滚动容器
    const mainContentSelectors = [
      'main',
      '[role="main"]',
      '.main-content',
      '#main-content',
      '.content',
      '#content',
      '.page-content',
      '.document-content',
      '.full-screen-mode-content', // 全屏内容区
      '.preview-content',
      '.file-content'
    ];
    
    for (let selector of mainContentSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && !isSidebarOrNavigation(element)) {
          const style = window.getComputedStyle(element);
          const isScrollable = element.scrollHeight > element.clientHeight + 50;
          const hasOverflow = style.overflowY === 'scroll' || style.overflowY === 'auto';
          
          if (isScrollable && hasOverflow) {
            if (fileScrollAttempts === 0) {
              console.log('[AutoStudy] 选择主内容区域:', selector);
            }
            return element;
          }
        }
      } catch (e) {
        // 忽略选择器错误
      }
    }
    
    // 查找任何可滚动的容器（排除侧边栏）
    const allDivs = document.querySelectorAll('div');
    const candidates = [];
    
    for (let div of allDivs) {
      if (isSidebarOrNavigation(div)) continue; // 跳过侧边栏
      
      if (div.scrollHeight > div.clientHeight + 50) {
        const style = window.getComputedStyle(div);
        if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
          candidates.push({
            element: div,
            scrollableHeight: div.scrollHeight - div.clientHeight,
            width: div.getBoundingClientRect().width,
            className: div.className || '',
            id: div.id || ''
          });
        }
      }
    }
    
    // 选择最大的可滚动区域（通常是主内容）
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        // 优先选择更大的可滚动高度和宽度
        const scoreA = a.scrollableHeight * a.width;
        const scoreB = b.scrollableHeight * b.width;
        return scoreB - scoreA;
      });
      
      const best = candidates[0];
      if (fileScrollAttempts === 0) {
        console.log('[AutoStudy] 选择容器:', best.id || best.className || 'div');
      }
      
      return best.element;
    }
    
    return null;
  };
  
  // 递归滚动函数
  const scrollStep = () => {
    // 状态检查
    if (!isRunning || !isProcessingFileList) {
      console.log('[AutoStudy] 文件滚动中断 - 状态改变');
      return;
    }
    
    fileScrollAttempts++;
    
    // 每次重新查找容器（防止DOM变化）
    const primaryContainer = findBestScrollContainer();
    
    // 获取当前滚动信息（文档级别）
    const docScrollHeight = document.documentElement.scrollHeight;
    const docScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const docClientHeight = document.documentElement.clientHeight;
    
    // 检查容器滚动
    let containerScrollInfo = null;
    
    if (primaryContainer) {
      try {
        containerScrollInfo = {
          scrollHeight: primaryContainer.scrollHeight,
          scrollTop: primaryContainer.scrollTop,
          clientHeight: primaryContainer.clientHeight,
          maxScroll: primaryContainer.scrollHeight - primaryContainer.clientHeight,
          element: primaryContainer
        };
      } catch (e) {
        console.warn('[AutoStudy] 获取容器信息失败:', e.message);
      }
    }
    
    // 综合判断滚动位置
    const docProgress = docScrollHeight > docClientHeight ? 
      (docScrollTop / (docScrollHeight - docClientHeight)) * 100 : 100;
    
    const containerProgress = containerScrollInfo ? 
      (containerScrollInfo.scrollTop / containerScrollInfo.maxScroll) * 100 : 100;
    
    // 每20次打印一次简要信息
    if (fileScrollAttempts % 20 === 0 || fileScrollAttempts === 1) {
      const progress = containerScrollInfo ? 
        Math.round(containerProgress) : 
        Math.round(docProgress);
      console.log(`[AutoStudy] 滚动进度: ${progress}% (第${fileScrollAttempts}次)`);
    }
    
    // 检查是否卡住（文档和容器都没有变化）
    const currentTotalScroll = docScrollTop + (containerScrollInfo?.scrollTop || 0);
    const lastTotalScroll = fileLastScrollTop;
    
    if (docScrollHeight === fileLastScrollHeight && currentTotalScroll === lastTotalScroll) {
      fileStuckCount++;
    } else {
      fileStuckCount = 0;
      fileLastScrollHeight = docScrollHeight;
      fileLastScrollTop = currentTotalScroll;
    }
    
    // 判断是否完成滚动（改进版）
    const docAtBottom = (docScrollTop + docClientHeight >= docScrollHeight - 30) || docProgress >= 95;
    
    // 容器完成判断：只有当容器确实存在且到达底部时才算完成
    let containerAtBottom = false;
    if (containerScrollInfo) {
      containerAtBottom = (containerScrollInfo.scrollTop + containerScrollInfo.clientHeight >= containerScrollInfo.scrollHeight - 30) ||
                         containerProgress >= 95;
    } else {
      // 如果没有容器信息，检查是否是初期（给更多时间查找容器）
      if (fileScrollAttempts < 5) {
        // 初期没找到容器，不认为完成
        containerAtBottom = false;
      } else {
        // 多次尝试后仍没容器，依赖文档滚动
        containerAtBottom = docAtBottom;
      }
    }
    
    // 综合完成条件（更严格）
    const naturalComplete = containerScrollInfo ? 
      (docAtBottom && containerAtBottom) : // 有容器：两者都完成
      docAtBottom; // 无容器：仅文档完成
    
    const isComplete = naturalComplete || 
                      fileScrollAttempts >= maxFileScrollAttempts || 
                      fileStuckCount >= maxFileStuckCount;
    
    if (isComplete) {
      const reason = fileScrollAttempts >= maxFileScrollAttempts ? '达到最大次数' :
                    fileStuckCount >= maxFileStuckCount ? '滚动卡住' : '到达底部';
      console.log(`[AutoStudy] ✅ 滚动完成: ${reason}`);
      
      showNotification('浏览完成，准备关闭...', 'success');
      
      // 滚动完成，关闭文件视图
      setTimeout(() => {
        closeFileView();
      }, 2000);
      
    } else {
      // 继续滚动 - 使用多种兼容方式
      const scrollAmount = config.scrollSpeed || 80;
      let scrollSuccess = false;
      
      // 方法1: 优先滚动容器（使用直接设置 scrollTop）
      if (primaryContainer) {
        try {
          const beforeScroll = primaryContainer.scrollTop;
          const targetScroll = beforeScroll + scrollAmount;
          
          // 尝试多种滚动方式
          // 方式1: 直接设置 scrollTop（最兼容）
          primaryContainer.scrollTop = targetScroll;
          
          // 验证滚动是否成功
          const afterScroll = primaryContainer.scrollTop;
          if (afterScroll > beforeScroll) {
            scrollSuccess = true;
            if (fileScrollAttempts % 10 === 0 || fileScrollAttempts === 1) {
              console.log('[AutoStudy] ✅ 容器滚动成功（scrollTop）:', {
                从: beforeScroll,
                到: afterScroll,
                增加: afterScroll - beforeScroll,
                容器: primaryContainer.id || primaryContainer.className
              });
            }
          } else {
            // 方式2: 尝试 scrollBy
            try {
              primaryContainer.scrollBy(0, scrollAmount);
              if (primaryContainer.scrollTop > beforeScroll) {
                scrollSuccess = true;
                console.log('[AutoStudy] ✅ 容器滚动成功（scrollBy）');
              }
            } catch (scrollByErr) {
              console.warn('[AutoStudy] scrollBy失败:', scrollByErr.message);
            }
          }
          
          if (!scrollSuccess && fileScrollAttempts % 10 === 0) {
            console.log('[AutoStudy] ⚠️ 容器滚动未生效，可能已到底部');
          }
          
        } catch (e) {
          console.warn('[AutoStudy] ❌ 容器滚动失败:', e.message);
        }
      }
      
      // 方法2: 同时滚动文档（确保有视觉反馈）
      try {
        const beforeDocScroll = window.pageYOffset || document.documentElement.scrollTop;
        
        // 尝试多种文档滚动方式
        try {
          window.scrollBy(0, scrollAmount);
        } catch (scrollByErr) {
          // fallback: 直接设置 scrollTop
          document.documentElement.scrollTop = beforeDocScroll + scrollAmount;
        }
        
        const afterDocScroll = window.pageYOffset || document.documentElement.scrollTop;
        if (afterDocScroll > beforeDocScroll) {
          scrollSuccess = true;
          if (fileScrollAttempts % 10 === 0 || fileScrollAttempts === 1) {
            console.log('[AutoStudy] ✅ 文档滚动成功:', afterDocScroll - beforeDocScroll, 'px');
          }
        }
      } catch (e) {
        console.warn('[AutoStudy] ❌ 文档滚动失败:', e.message);
      }
      
      // 如果卡住太久，尝试更激进的滚动
      if (fileStuckCount > 8) {
        const largerAmount = scrollAmount * 3;
        console.log('[AutoStudy] 🔧 检测到卡住，使用更大步长:', largerAmount);
        
        setTimeout(() => {
          if (primaryContainer) {
            try {
              const currentTop = primaryContainer.scrollTop;
              primaryContainer.scrollTop = currentTop + largerAmount;
              console.log('[AutoStudy] 强制滚动容器:', currentTop, '->', primaryContainer.scrollTop);
            } catch (e) {
              console.warn('[AutoStudy] 强制容器滚动失败:', e);
            }
          }
          
          try {
            const currentDocTop = document.documentElement.scrollTop;
            document.documentElement.scrollTop = currentDocTop + largerAmount;
            console.log('[AutoStudy] 强制滚动文档:', currentDocTop, '->', document.documentElement.scrollTop);
          } catch (e) {
            console.warn('[AutoStudy] 强制文档滚动失败:', e);
          }
        }, 100);
      }
      
      // 如果完全卡住，尝试跳转滚动
      if (fileStuckCount > 12) {
        console.log('[AutoStudy] 🚀 严重卡住，尝试跳转滚动');
        setTimeout(() => {
          if (primaryContainer) {
            try {
              const jumpTo = Math.min(
                primaryContainer.scrollTop + scrollAmount * 5,
                primaryContainer.scrollHeight - primaryContainer.clientHeight
              );
              primaryContainer.scrollTop = jumpTo;
              console.log('[AutoStudy] 跳转容器到:', jumpTo);
            } catch (e) {
              console.warn('[AutoStudy] 跳转容器失败:', e);
            }
          }
        }, 150);
      }
      
      // 继续下一次滚动
      const delay = Math.max(config.scrollDelay || 400, 300);
      setTimeout(scrollStep, delay);
    }
  };
  
  // 开始滚动前的准备
  console.log('[AutoStudy] 文件内容滚动准备启动...');
  
  // 立即尝试查找容器
  const initialContainer = findBestScrollContainer();
  if (initialContainer) {
    console.log('[AutoStudy] ✅ 找到初始滚动容器:', {
      标签: initialContainer.tagName,
      ID: initialContainer.id || '无',
      类名: initialContainer.className || '无',
      scrollHeight: initialContainer.scrollHeight,
      clientHeight: initialContainer.clientHeight,
      可滚动高度: initialContainer.scrollHeight - initialContainer.clientHeight
    });
  } else {
    console.warn('[AutoStudy] ⚠️ 未找到明确的滚动容器，将使用文档滚动');
  }
  
  // 延迟启动滚动
  setTimeout(scrollStep, 500);
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

// 检测页面中的视频 - 增强版（排除PDF/文档查看器）
function detectVideo() {
  console.log('[AutoStudy] === 开始视频检测 ===');
  
  const videos = document.querySelectorAll('video');
  
  // 获取所有可能的视频iframe，但排除PDF/文档查看器
  const allIframes = document.querySelectorAll('iframe');
  const videoIframes = [];
  
  for (let iframe of allIframes) {
    const src = (iframe.src || '').toLowerCase();
    const name = (iframe.name || '').toLowerCase();
    const id = (iframe.id || '').toLowerCase();
    const className = (iframe.className || '').toLowerCase();
    
    // 排除PDF和文档查看器
    const isPdfViewer = src.includes('pdf') || 
                      src.includes('.pdf') ||
                      name.includes('pdf') ||
                      id.includes('pdf') ||
                      className.includes('pdf') ||
                      className.includes('pdf-viewer') ||
                      className.includes('document-viewer');
    
    // 检查是否是视频iframe
    const isVideoIframe = (src.includes('player') || 
                          src.includes('video') || 
                          src.includes('bilibili') || 
                          src.includes('youku') || 
                          src.includes('mp4') ||
                          src.includes('youtube') ||
                          name.includes('video') ||
                          className.includes('video-player')) &&
                          !isPdfViewer;
    
    if (isVideoIframe) {
      videoIframes.push(iframe);
    }
  }
  
  const videoContainers = document.querySelectorAll('.video-player, .player-container, [class*="video-player"], [id*="video-player"]');
  
  // 排除包含PDF查看器的容器
  const filteredContainers = [];
  for (let container of videoContainers) {
    const className = (container.className || '').toLowerCase();
    const id = (container.id || '').toLowerCase();
    if (!className.includes('pdf') && 
        !className.includes('document') &&
        !id.includes('pdf') &&
        !id.includes('document')) {
      filteredContainers.push(container);
    }
  }
  
  console.log(`[AutoStudy] 视频元素检测: ${videos.length} video, ${videoIframes.length} iframe, ${filteredContainers.length} 容器`);
  
  // 详细检查每个视频元素
  let activeVideos = [];
  if (videos.length > 0) {
    Array.from(videos).forEach((video, index) => {
      const isVisible = video.offsetParent !== null;
      const hasSize = video.videoWidth > 0 && video.videoHeight > 0;
      const isEnded = video.ended;
      const isNearEnd = video.currentTime > 0 && video.duration > 0 && (video.currentTime >= video.duration - 2);
      const isCompleted = isEnded || isNearEnd;
      
      console.log(`[AutoStudy] 视频 ${index + 1}:`, {
        visible: isVisible,
        hasSize: hasSize,
        duration: Math.round(video.duration || 0),
        currentTime: Math.round(video.currentTime || 0),
        ended: isEnded,
        nearEnd: isNearEnd,
        completed: isCompleted
      });
      
      if (isVisible && !isCompleted) {
        activeVideos.push(video);
      }
    });
  }
  
  // 检查iframe视频
  let activeIframes = [];
  if (videoIframes.length > 0) {
    Array.from(videoIframes).forEach((iframe, index) => {
      const isVisible = iframe.offsetParent !== null;
      const src = iframe.src || '';
      
      console.log(`[AutoStudy] 视频iframe ${index + 1}:`, {
        visible: isVisible,
        src: src.substring(0, 50) + '...'
      });
      
      if (isVisible) {
        activeIframes.push(iframe);
      }
    });
  }
  
  const result = activeVideos.length > 0 || activeIframes.length > 0;
  
  console.log('[AutoStudy] 视频检测结果:', {
    activeVideos: activeVideos.length,
    activeIframes: activeIframes.length,
    isVideoPage: result
  });
  
  console.log('[AutoStudy] === 视频检测完成 ===');
  return result;
}

// 获取页面中的视频元素（包括 iframe 中的）
function getVideoElements() {
  const result = [];
  
  // 1. 获取主文档中的视频
  const mainVideos = document.querySelectorAll('video');
  for (let video of mainVideos) {
    if (video.offsetParent !== null) { // 确保视频可见
      result.push(video);
    }
  }
  
  // 2. 检查所有 iframe 中的视频
  const iframes = document.querySelectorAll('iframe');
  console.log(`[AutoStudy] 检测到 ${iframes.length} 个 iframe`);
  
  for (let iframe of iframes) {
    try {
      // 尝试访问 iframe 内容（可能跨域）
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      
      if (iframeDoc) {
        const iframeVideos = iframeDoc.querySelectorAll('video');
        console.log(`[AutoStudy] iframe 中找到 ${iframeVideos.length} 个视频`);
        
        for (let video of iframeVideos) {
          if (video.offsetParent !== null) {
            result.push(video);
          }
        }
      }
    } catch (e) {
      // 跨域 iframe 无法访问，静默忽略
      console.log('[AutoStudy] 无法访问 iframe (跨域):', iframe.src?.substring(0, 50));
    }
  }
  
  if (result.length > 0) {
    console.log(`[AutoStudy] 总共找到 ${result.length} 个可见视频元素`);
  }
  
  return result;
}

// 处理视频播放 - 增强版（添加等待机制）
function handleVideoPlayback() {
  console.log('[AutoStudy] === 开始处理视频播放 ===');
  console.log('[AutoStudy] 当前视频配置:', {
    videoSpeed: config.videoSpeed,
    configLoaded: window.configLoaded
  });
  
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('[AutoStudy] 未找到可见的视频元素');
    return false;
  }
  
  // 检查播放器是否已加载（特别是MVP播放器）
  const mvpPlayerLoaded = document.querySelector('[class*="mvp-controls"]') !== null;
  if (!mvpPlayerLoaded) {
    console.log('[AutoStudy] ⏳ MVP播放器尚未完全加载，等待1秒后重试...');
    setTimeout(handleVideoPlayback, 1000);
    return false;
  }
  
  let hasActiveVideo = false;
  let totalVideos = videos.length;
  let playingVideos = 0;
  let completedVideos = 0;
  
  // 降级播放函数（直接调用 video.play()）- 移到循环外部
  function fallbackToDirectPlay(video, index) {
    video.play().then(() => {
      playingVideos++;
      console.log(`[AutoStudy] 视频 ${index + 1} 直接调用 play() 开始播放`);
      
      const targetSpeed = (config && config.videoSpeed) || defaultConfig.videoSpeed || 2.0;
      
      setTimeout(() => {
        video.muted = true;
        video.playbackRate = targetSpeed;
        console.log(`[AutoStudy] 视频 ${index + 1} 设置倍速: ${targetSpeed}x`);
      }, 100);
      
    }).catch(err => {
      console.warn(`[AutoStudy] 视频 ${index + 1} 自动播放失败:`, err.message);
      showNotification('视频自动播放失败，请手动点击播放', 'warning');
    });
  }
  
  videos.forEach((video, index) => {
    const videoInfo = {
      index: index + 1,
      duration: Math.round(video.duration || 0),
      currentTime: Math.round(video.currentTime || 0),
      paused: video.paused,
      ended: video.ended,
      muted: video.muted,
      playbackRate: video.playbackRate,
      readyState: video.readyState,
      networkState: video.networkState
    };
    
    console.log(`[AutoStudy] 处理视频 ${index + 1}:`, videoInfo);
    
    // 添加多种事件监听（确保能捕获视频完成和进度更新）
    // 用标记防止重复添加监听器
    if (!video.dataset.autoStudyListenerAdded) {
      // ended事件
      video.addEventListener('ended', function onVideoEnded() {
        console.log(`[AutoStudy] ✅ 视频 ${index + 1} 触发ended事件 - 真正播放完成`);
        video.dataset.videoReallyEnded = 'true';
      }, { once: true });
      
      // timeupdate事件（模拟正常观看）
      video.addEventListener('timeupdate', function onTimeUpdate() {
        // 每隔一段时间记录一次，模拟正常观看行为
        if (!video.dataset.lastLogTime || Date.now() - parseInt(video.dataset.lastLogTime) > 10000) {
          console.log(`[AutoStudy] 视频 ${index + 1} 播放中: ${Math.round(video.currentTime)}s / ${Math.round(video.duration)}s (${Math.round((video.currentTime/video.duration)*100)}%)`);
          video.dataset.lastLogTime = Date.now().toString();
          
          // 触发自定义进度事件（某些平台可能监听）
          video.dispatchEvent(new Event('progress'));
        }
      });
      
      // play事件
      video.addEventListener('play', function onPlay() {
        console.log(`[AutoStudy] 视频 ${index + 1} 开始播放`);
      });
      
      // pause事件
      video.addEventListener('pause', function onPause() {
        if (!video.ended) {
          console.log(`[AutoStudy] ⚠️ 视频 ${index + 1} 暂停了，尝试恢复播放`);
          setTimeout(() => {
            if (video.paused && !video.ended && isRunning) {
              video.play().catch(e => console.warn('[AutoStudy] 恢复播放失败:', e));
            }
          }, 500);
        }
      });
      
      video.dataset.autoStudyListenerAdded = 'true';
      console.log(`[AutoStudy] 已为视频 ${index + 1} 添加完整事件监听器`);
    }
    
    // 等待视频加载完成
    if (video.readyState < 2) { // HAVE_CURRENT_DATA
      console.log(`[AutoStudy] 视频 ${index + 1} 还在加载中，跳过处理`);
      return;
    }
    
    // 静音处理
    if (!video.muted) {
      try {
        video.muted = true;
        console.log(`[AutoStudy] 视频 ${index + 1} 已静音`);
      } catch (error) {
        console.warn(`[AutoStudy] 视频 ${index + 1} 静音失败:`, error);
      }
    }
    
    // 设置播放速度（确保config已加载，否则使用默认值）
    const targetSpeed = (config && config.videoSpeed) || defaultConfig.videoSpeed || 2.0;
    
    if (Math.abs(video.playbackRate - targetSpeed) > 0.1) {
      try {
        video.playbackRate = targetSpeed;
        console.log(`[AutoStudy] 视频 ${index + 1} 倍速设置为: ${targetSpeed}x (当前: ${video.playbackRate}x)`);
      } catch (error) {
        console.warn(`[AutoStudy] 视频 ${index + 1} 倍速设置失败:`, error);
      }
    } else {
      console.log(`[AutoStudy] 视频 ${index + 1} 播放速度已是 ${video.playbackRate}x`);
    }
    
    // 检查视频完成状态 - 更严格的判断（必须真正播放到最后）
    const hasDuration = video.duration > 0 && !isNaN(video.duration);
    const remainingTime = hasDuration ? video.duration - video.currentTime : 999;
    const isReallyNearEnd = hasDuration && video.currentTime > 0 && remainingTime <= 0.5;
    const isCompleted = video.ended || isReallyNearEnd;
    
    if (isCompleted) {
      completedVideos++;
      console.log(`[AutoStudy] 视频 ${index + 1} 已完成播放 (剩余${remainingTime.toFixed(2)}秒)`);
      return;
    }
    
    // 视频即将结束时提示（剩余5秒）
    if (hasDuration && remainingTime > 0 && remainingTime <= 5) {
      console.log(`[AutoStudy] 视频 ${index + 1} 即将播放完成，剩余${remainingTime.toFixed(1)}秒`);
    }
    
    hasActiveVideo = true;
    
    // 如果视频暂停，尝试通过点击播放按钮来播放
    if (video.paused) {
      console.log(`[AutoStudy] 视频 ${index + 1} 暂停中，查找播放按钮...`);
      
      // 优先尝试点击播放按钮（这样能触发平台的进度记录）
      const playButton = findPlayButton(video);
      
      if (playButton) {
        console.log(`[AutoStudy] ✅ 找到播放按钮，模拟点击`);
        try {
          // 模拟真实的用户点击
          playButton.click();
          
          playingVideos++;
          console.log(`[AutoStudy] 视频 ${index + 1} 通过点击按钮开始播放`);
          
          const targetSpeed = (config && config.videoSpeed) || defaultConfig.videoSpeed || 2.0;
          showNotification(`视频播放中 (${targetSpeed}x倍速)...`, 'info');
          
          // 延迟设置倍速和静音（等播放开始后）
          setTimeout(() => {
            video.muted = true;
            video.playbackRate = targetSpeed;
            console.log(`[AutoStudy] 视频 ${index + 1} 设置倍速: ${video.playbackRate}x, 静音: ${video.muted}`);
          }, 300);
          
          // 再次确保设置生效
          setTimeout(() => {
            if (Math.abs(video.playbackRate - targetSpeed) > 0.1) {
              video.playbackRate = targetSpeed;
              console.log(`[AutoStudy] 视频 ${index + 1} 再次设置倍速: ${targetSpeed}x`);
            }
            if (!video.muted) {
              video.muted = true;
            }
          }, 1000);
          
        } catch (clickError) {
          console.warn('[AutoStudy] 点击播放按钮失败:', clickError);
          // 降级到直接调用 play()
          fallbackToDirectPlay(video, index);
        }
      } else {
        // 没找到播放按钮，降级到直接调用 play()
        console.log(`[AutoStudy] ⚠️ 未找到播放按钮，尝试直接调用 play()`);
        fallbackToDirectPlay(video, index);
      }
    } else {
      playingVideos++;
      console.log(`[AutoStudy] 视频 ${index + 1} 正在播放中 (${videoInfo.currentTime}s/${videoInfo.duration}s)`);
    }
  });
  
  console.log(`[AutoStudy] 视频播放统计: 总共${totalVideos}个, 播放中${playingVideos}个, 已完成${completedVideos}个`);
  console.log('[AutoStudy] === 视频播放处理完成 ===');
  
  return hasActiveVideo;
}

// 查找视频的播放按钮 - 智能匹配（支持 iframe）- 增强版
function findPlayButton(videoElement) {
  console.log('');
  console.log('=== 🔍 [AutoStudy] 开始查找播放按钮（增强版）===');
  
  // 首先检查视频是否在 iframe 中
  let searchDocument = document;
  let isInIframe = false;
  
  // 尝试检测视频所在的文档
  try {
    if (videoElement.ownerDocument !== document) {
      searchDocument = videoElement.ownerDocument;
      isInIframe = true;
      console.log('[AutoStudy] 检测到视频在 iframe 中');
    }
  } catch (e) {
    console.log('[AutoStudy] 检测 iframe 出错:', e.message);
  }
  
  // 获取视频的位置信息（用于后续位置判断）
  const videoRect = videoElement.getBoundingClientRect();
  console.log('[AutoStudy] 视频位置:', {
    left: Math.round(videoRect.left),
    top: Math.round(videoRect.top),
    width: Math.round(videoRect.width),
    height: Math.round(videoRect.height)
  });
  
  // 1. 首先在视频的父容器中查找（扩大搜索深度）
  let container = videoElement.parentElement;
  let searchDepth = 0;
  const maxDepth = 10; // 增加搜索深度
  
  // 向上查找，直到找到一个合适的容器
  while (container && searchDepth < maxDepth) {
    const className = (container.className || '').toLowerCase();
    const id = (container.id || '').toLowerCase();
    
    if (className.includes('player') || 
        className.includes('video') || 
        className.includes('container') ||
        className.includes('wrapper') ||
        id.includes('player') ||
        id.includes('video')) {
      console.log(`[AutoStudy] 找到播放器容器 (深度${searchDepth}):`, container.className || container.id || container.tagName);
      break;
    }
    container = container.parentElement;
    searchDepth++;
  }
  
  if (!container) {
    container = searchDocument.body;
    console.log('[AutoStudy] 未找到特定容器，使用整个文档');
  }
  
  console.log('[AutoStudy] 搜索容器:', container.className || container.id || container.tagName);
  console.log('[AutoStudy] 搜索文档:', isInIframe ? 'iframe 文档' : '主文档');
  
  // 2. 定义播放按钮的选择器（按优先级排序）- 大幅扩展
  const playButtonSelectors = [
    // 平台特定的播放按钮 - MVP 播放器（用户实测有效）⭐⭐⭐
    // ⚠️ 注意：优先使用全局查找（document.querySelector），因为手动测试有效
    '[class*="mvp-controls-left"] button',      // 智能查找控制栏按钮（最高优先级）✅
    'button.mvp-toggle-play.mvp-first-btn-margin', // 完整类名匹配 ✅
    'button.mvp-toggle-play',                   // MVP 播放按钮 ✅
    'button.mvp-first-btn-margin',              // MVP 第一个按钮 ✅
    '.mvp-controls-left-area button',           // 控制栏左侧按钮
    '.mvp-replay-player-all-controls button:first-child', // 控制栏第一个按钮
    'div[class*="mvp-controls-left"] button',
    'div[class*="mvp-replay-player"] button:first-child',
    '[class*="mvp-toggle-play"]',               // 宽松匹配
    'button[class*="mvp"]',
    
    // 视频播放器常用的播放按钮类名
    '.vjs-big-play-button',           // Video.js
    '.vjs-play-control',
    '.video-play-button',
    '.prism-big-play-btn',            // 阿里云播放器
    '.prism-play-btn',
    '.bilibili-player-video-btn-start', // B站
    '.play-btn',
    '.play-button',
    '.btn-play',
    '.player-play',
    '.video-play',
    '.playButton',
    '.PlayButton',
    
    // 通用选择器 - 扩展
    'button.play',
    'button[class*="play"]',
    'button[class*="Play"]',
    'div[class*="play"][class*="button"]',
    'div[class*="play"][class*="btn"]',
    'div[class*="Play"][class*="Button"]',
    'span[class*="play"][class*="button"]',
    'a[class*="play"]',
    
    // aria-label 属性
    'button[aria-label*="播放"]',
    'button[aria-label*="Play"]',
    'button[aria-label*="play"]',
    '[role="button"][aria-label*="播放"]',
    '[role="button"][aria-label*="Play"]',
    '[role="button"][aria-label*="play"]',
    'div[aria-label*="播放"]',
    'div[aria-label*="Play"]',
    
    // title 属性
    'button[title*="播放"]',
    'button[title*="Play"]',
    'button[title*="play"]',
    'div[title*="播放"]',
    'div[title*="Play"]',
    '[title*="播放"]',
    
    // 带有播放图标的元素
    'button svg[class*="play"]',
    'button i[class*="play"]',
    'button .icon-play',
    'button .fa-play',
    'div[class*="control"] button:first-child',
    'div[class*="controls"] button:first-child',
    
    // 覆盖层上的播放按钮
    '.video-cover button',
    '.video-poster button',
    '.video-overlay button',
    '.video-mask button',
    
    // 控制栏中的播放按钮
    '.control-bar button:first-child',
    '.controls button:first-child',
    '.player-controls button:first-child',
    '.video-controls button:first-child'
  ];
  
  console.log('[AutoStudy] 使用', playButtonSelectors.length, '个选择器查找播放按钮');
  
  // 3. 优先使用全局查找（document.querySelector）- 与手动测试一致 ⭐⭐⭐
  console.log('[AutoStudy] 🔍 第一步：全局查找（优先级最高）...');
  const candidates = [];
  
  // 首先尝试用户验证有效的选择器（全局查找）
  const prioritySelectors = [
    '[class*="mvp-controls-left"] button',
    'button.mvp-toggle-play.mvp-first-btn-margin',
    'button.mvp-toggle-play',
    'button.mvp-first-btn-margin'
  ];
  
  for (let selector of prioritySelectors) {
    try {
      // 使用全局查找（document.querySelector），与手动测试一致
      const button = searchDocument.querySelector(selector);
      
      if (button) {
        console.log(`[AutoStudy] ✅ 全局查找找到按钮: "${selector}"`);
        console.log('[AutoStudy] 按钮详情:', {
          标签: button.tagName,
          类名: button.className || '(无)',
          可见: button.offsetParent !== null
        });
        
        // 基础验证
        if (button.offsetParent === null) {
          console.log('[AutoStudy] ⚠️ 按钮不可见，跳过');
          continue;
        }
        
        // 宽松验证
        const validationResult = isValidPlayButton(button, videoElement, true);
        if (validationResult.valid) {
          console.log('[AutoStudy] ✅✅✅ 找到有效播放按钮！');
          console.log('[AutoStudy] 验证原因:', validationResult.reason);
          console.log('');
          return button;
        } else {
          console.log('[AutoStudy] ⚠️ 按钮验证失败:', validationResult.reason);
          // ⭐ 关键：如果全局查找找到了按钮（与手动测试一致），即使验证失败也直接返回
          // 因为用户手动测试证明这个按钮是可以用的
          console.log('[AutoStudy] ⚠️ 但全局查找找到了按钮，与手动测试一致，直接使用');
          console.log('[AutoStudy] ✅✅✅ 使用全局查找找到的按钮！');
          console.log('');
          return button;
        }
      }
    } catch (e) {
      console.warn('[AutoStudy] 全局查找出错:', selector, e.message);
    }
  }
  
  // 4. 如果全局查找失败，尝试在容器中查找
  console.log('[AutoStudy] 🔍 第二步：在容器中查找...');
  let selectorMatchCount = 0;
  
  for (let selector of playButtonSelectors) {
    // 跳过已经全局查找过的选择器
    if (prioritySelectors.includes(selector)) continue;
    
    try {
      const buttons = container.querySelectorAll(selector);
      if (buttons.length > 0) {
        selectorMatchCount++;
        console.log(`[AutoStudy] 选择器 "${selector}" 匹配到 ${buttons.length} 个元素`);
      }
      
      for (let button of buttons) {
        // 基础可见性检查
        if (button.offsetParent === null) continue;
        
        const buttonInfo = {
          element: button,
          selector: selector,
          tagName: button.tagName,
          className: button.className || '(无)',
          id: button.id || '(无)',
          text: button.textContent?.trim().substring(0, 30) || '(无文本)',
          visible: true
        };
        
        // 验证按钮（使用宽松模式）
        const validationResult = isValidPlayButton(button, videoElement, true);
        buttonInfo.valid = validationResult.valid;
        buttonInfo.reason = validationResult.reason;
        
        candidates.push(buttonInfo);
        
        // 如果找到有效的按钮，立即返回
        if (validationResult.valid) {
          console.log('[AutoStudy] ✅ 在容器中找到有效播放按钮:', buttonInfo);
          console.log('');
          return button;
        }
      }
    } catch (e) {
      console.warn('[AutoStudy] 选择器出错:', selector, e.message);
    }
  }
  
  // 如果有候选但都无效，输出详细信息
  if (candidates.length > 0) {
    console.log(`[AutoStudy] ⚠️ 找到 ${candidates.length} 个候选按钮，但验证都失败了:`);
    candidates.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.tagName}.${c.className}`, {
        选择器: c.selector,
        文本: c.text,
        原因: c.reason
      });
    });
    if (candidates.length > 5) {
      console.log(`  ... 还有 ${candidates.length - 5} 个候选`);
    }
  } else {
    console.log('[AutoStudy] ❌ 使用所有选择器均未找到任何候选按钮');
  }
  
  // 4. 如果上面没找到，尝试更广泛的搜索（关键词匹配）
  console.log('[AutoStudy] 扩大搜索范围（关键词匹配）...');
  const allButtons = container.querySelectorAll('button, div[role="button"], [onclick], a');
  
  let keywordMatchCount = 0;
  const keywordCandidates = [];
  
  for (let button of allButtons) {
    const text = button.textContent?.trim().toLowerCase() || '';
    const className = (button.className || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const title = (button.getAttribute('title') || '').toLowerCase();
    
    // 检查是否包含播放相关的文本
    const playKeywords = ['play', '播放', '▶', '►', 'start', '开始'];
    let matchedKeyword = '';
    
    for (let keyword of playKeywords) {
      if (text.includes(keyword) || 
          className.includes(keyword) || 
          ariaLabel.includes(keyword) ||
          title.includes(keyword)) {
        matchedKeyword = keyword;
        break;
      }
    }
    
    if (matchedKeyword) {
      keywordMatchCount++;
      
      const validationResult = isValidPlayButton(button, videoElement, true);
      
      const candidateInfo = {
        element: button,
        keyword: matchedKeyword,
        text: text.substring(0, 30),
        className: className.substring(0, 50),
        valid: validationResult.valid,
        reason: validationResult.reason
      };
      
      keywordCandidates.push(candidateInfo);
      
      if (validationResult.valid) {
        console.log('[AutoStudy] ✅ 通过关键词找到播放按钮:', candidateInfo);
        console.log('');
        return button;
      }
    }
  }
  
  console.log(`[AutoStudy] 关键词匹配找到 ${keywordMatchCount} 个候选，但都无效`);
  if (keywordCandidates.length > 0) {
    keywordCandidates.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i + 1}. 关键词="${c.keyword}", 文本="${c.text}"`, {
        className: c.className,
        原因: c.reason
      });
    });
  }
  
  // 5. 尝试查找覆盖在视频上的可点击元素
  console.log('[AutoStudy] 尝试查找视频覆盖层...');
  const rect = videoElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // 获取视频中心点的元素（在正确的文档中查找）
  const elementAtCenter = searchDocument.elementFromPoint(centerX, centerY);
  
  if (elementAtCenter && elementAtCenter !== videoElement) {
    console.log('[AutoStudy] 视频中心元素:', elementAtCenter.tagName, elementAtCenter.className);
    
    // 检查这个元素或其父元素是否可点击
    let checkElement = elementAtCenter;
    let depth = 0;
    
    while (checkElement && depth < 5) {
      const style = searchDocument.defaultView.getComputedStyle(checkElement);
      const isClickable = style.cursor === 'pointer' || 
                          checkElement.onclick || 
                          checkElement.tagName === 'BUTTON' ||
                          checkElement.tagName === 'A';
      
      if (isClickable && checkElement.offsetParent !== null) {
        console.log('[AutoStudy] ✅ 在视频中心找到可点击元素:', checkElement);
        console.log('');
        return checkElement;
      }
      
      checkElement = checkElement.parentElement;
      depth++;
    }
  }
  
  // 6. 如果视频在 iframe 中，尝试在主文档中查找播放按钮
  if (isInIframe) {
    console.log('[AutoStudy] 视频在 iframe 中，尝试在主文档中查找播放按钮...');
    
    // 在主文档中搜索
    const mainPlayButtonSelectors = [
      'button.mvp-toggle-play',
      '.mvp-toggle-play',
      'button[class*="play"]',
      '.play-btn',
      '.play-button'
    ];
    
    for (let selector of mainPlayButtonSelectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (let button of buttons) {
          if (button.offsetParent !== null) {
            console.log('[AutoStudy] ✅ 在主文档中找到播放按钮:', selector, button);
            console.log('');
            return button;
          }
        }
      } catch (e) {
        // 忽略
      }
    }
  }
  
  // 7. 终极备用方案：如果有任何候选按钮，返回第一个
  console.log('[AutoStudy] 所有方法都失败了，检查是否有候选按钮...');
  
  const allCandidates = [...candidates, ...keywordCandidates];
  if (allCandidates.length > 0) {
    console.log(`[AutoStudy] ⚠️ 找到 ${allCandidates.length} 个候选，尝试使用第一个`);
    const firstCandidate = allCandidates[0];
    console.log('[AutoStudy] 🎲 尝试使用第一个候选按钮:', {
      text: firstCandidate.text,
      className: firstCandidate.className,
      原因: firstCandidate.reason
    });
    console.log('');
    return firstCandidate.element;
  }
  
  // 8. 最后的最后：尝试直接点击视频（某些播放器支持）
  console.log('[AutoStudy] ⚠️ 所有方法都失败，建议尝试直接点击视频元素');
  console.log('[AutoStudy] 提示：将返回null，会回退到直接调用 video.play()');
  console.log('');
  console.log('=== 🔍 播放按钮查找结束 ===');
  console.log('');
  
  return null;
}

// 验证播放按钮是否有效 - 增强版（支持宽松模式）
function isValidPlayButton(button, videoElement, looseMode = false) {
  if (!button) {
    return { valid: false, reason: '按钮为空' };
  }
  
  try {
    // 检查元素是否可见
    if (button.offsetParent === null) {
      return { valid: false, reason: 'offsetParent为null（不可见）' };
    }
    
    const style = window.getComputedStyle(button);
    if (style.display === 'none') {
      return { valid: false, reason: 'display: none' };
    }
    if (style.visibility === 'hidden') {
      return { valid: false, reason: 'visibility: hidden' };
    }
    if (style.opacity === '0') {
      return { valid: false, reason: 'opacity: 0' };
    }
    
    // 检查按钮是否被禁用
    if (button.disabled) {
      return { valid: false, reason: '按钮被禁用' };
    }
    
    // 获取位置信息
    const buttonRect = button.getBoundingClientRect();
    const videoRect = videoElement.getBoundingClientRect();
    
    // 特殊处理：mvp 播放器按钮（包括控制栏按钮）
    const isMvpButton = button.classList.contains('mvp-toggle-play') || 
                       button.classList.contains('mvp-first-btn-margin') ||
                       button.className.includes('mvp');
    
    // 检查是否在 MVP 控制栏中
    const inMvpControls = button.closest('.mvp-controls-left-area') ||
                         button.closest('.mvp-replay-player-all-controls') ||
                         button.closest('[class*="mvp-controls"]');
    
    if (isMvpButton || inMvpControls) {
      return { valid: true, reason: 'MVP播放器按钮（特殊处理）' };
    }
    
    // 特殊处理：如果按钮包含明确的播放类名
    const hasExplicitPlayClass = button.classList.contains('play-btn') ||
                                 button.classList.contains('play-button') ||
                                 button.classList.contains('playButton') ||
                                 button.classList.contains('vjs-play-control');
    
    if (hasExplicitPlayClass && looseMode) {
      return { valid: true, reason: '明确的播放按钮类名（宽松模式）' };
    }
    
    // 宽松模式：只要按钮在页面上的合理位置即可
    if (looseMode) {
      // 检查按钮是否在视口内
      const isInViewport = buttonRect.top >= -100 && 
                          buttonRect.bottom <= window.innerHeight + 100 &&
                          buttonRect.left >= -100 && 
                          buttonRect.right <= window.innerWidth + 100;
      
      if (isInViewport) {
        return { valid: true, reason: '按钮在视口内（宽松模式）' };
      } else {
        return { valid: false, reason: '按钮不在视口内' };
      }
    }
    
    // 严格模式：检查按钮的位置是否在视频附近
    // 大幅扩大检测范围（支持外部控制栏）
    const horizontalOverlap = 
      buttonRect.right > videoRect.left - 200 &&  // 左侧扩大到200px
      buttonRect.left < videoRect.right + 200;    // 右侧扩大到200px
    
    const verticalNearby = 
      buttonRect.top >= videoRect.top - 200 &&     // 上方扩大到200px
      buttonRect.bottom <= videoRect.bottom + 200; // 下方扩大到200px
    
    const isNearVideo = horizontalOverlap && verticalNearby;
    
    if (isNearVideo) {
      return { valid: true, reason: '按钮在视频附近' };
    }
    
    // 最后：如果按钮在整个页面的可见区域，也认为可能有效
    const isVisibleAnywhere = buttonRect.width > 0 && 
                             buttonRect.height > 0 &&
                             buttonRect.top < window.innerHeight &&
                             buttonRect.bottom > 0;
    
    if (isVisibleAnywhere) {
      return { valid: true, reason: '按钮可见（备用判断）' };
    }
    
    return { 
      valid: false, 
      reason: `位置不符：水平重叠=${horizontalOverlap}, 垂直接近=${verticalNearby}` 
    };
    
  } catch (e) {
    return { valid: false, reason: '验证出错: ' + e.message };
  }
}

// 检查所有视频是否播放完成 - 优化版（更严格的完成判断）
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
    const hasEndedEvent = video.dataset.videoReallyEnded === 'true'; // 检查是否触发了ended事件
    const hasDuration = video.duration > 0 && !isNaN(video.duration);
    
    // 更严格的完成判断：必须真正播放到最后0.5秒内，或者ended=true，或触发了ended事件
    const isReallyNearEnd = hasDuration && 
                            video.currentTime > 0 && 
                            (video.duration - video.currentTime) <= 0.5;
    
    // 只有真正结束或播放到最后0.5秒或触发了ended事件才算完成
    const isCompleted = isEnded || isReallyNearEnd || hasEndedEvent;
    
    const remainingTime = hasDuration ? Math.max(0, video.duration - video.currentTime) : 0;
    
    console.log(`[AutoStudy] 视频 ${index + 1}: 时长=${Math.round(video.duration)}s, 当前=${Math.round(video.currentTime)}s, 剩余=${remainingTime.toFixed(1)}s, ended=${isEnded}, 触发ended事件=${hasEndedEvent}, 接近结束=${isReallyNearEnd}, 已完成=${isCompleted}`);
    
    if (isCompleted) {
      completedCount++;
    }
  });
  
  const allCompleted = completedCount === totalVideos;
  console.log(`[AutoStudy] 视频完成检查: ${completedCount}/${totalVideos} 已完成, 全部完成=${allCompleted}`);
  
  return allCompleted;
}

// 开始监控视频播放 - 优化版（增加进度统计等待时间 + 模拟用户活动）
function startVideoMonitoring() {
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
  }
  
  isWatchingVideo = true;
  let videoCompletedTime = 0; // 记录视频完成的时间戳
  
  showNotification('检测到视频内容，等待播放器加载...', 'info', true);
  
  // 启动用户活动模拟（保持页面活跃状态）
  startUserActivitySimulation();
  
  // 等待播放器完全加载后再处理（特别是MVP播放器）
  console.log('[AutoStudy] 等待2秒让播放器完全加载...');
  setTimeout(() => {
    showNotification('播放器已加载，开始处理视频...', 'info');
    // 立即处理一次视频
    handleVideoPlayback();
  }, 2000);
  
  // 每2秒检查一次视频状态
  videoCheckInterval = setInterval(() => {
    if (!isRunning || !isWatchingVideo) {
      clearInterval(videoCheckInterval);
      return;
    }
    
    // 强制确保视频倍速设置（有些播放器会重置）
    const videos = getVideoElements();
    const targetSpeed = (config && config.videoSpeed) || defaultConfig.videoSpeed || 2.0;
    
    videos.forEach((video, index) => {
      try {
        // 强制静音
        if (!video.muted) {
          video.muted = true;
        }
        
        // 强制设置倍速
        if (Math.abs(video.playbackRate - targetSpeed) > 0.1) {
          video.playbackRate = targetSpeed;
          console.log(`[AutoStudy] 持续确保视频 ${index + 1} 倍速: ${targetSpeed}x`);
        }
        
        // 确保视频在视口中（有些平台需要视频可见才计算进度）
        if (!isElementInViewport(video)) {
          video.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log(`[AutoStudy] 视频 ${index + 1} 不在视口中，滚动到可见区域`);
        }
      } catch (e) {
        // 忽略错误
      }
    });
    
    // 继续处理视频设置
    handleVideoPlayback();
    
    // 检查是否播放完成
    if (areAllVideosCompleted()) {
      const now = Date.now();
      
      // 第一次检测到完成时记录时间
      if (videoCompletedTime === 0) {
        videoCompletedTime = now;
        console.log('[AutoStudy] ✅ 视频播放完成，等待5秒让平台统计进度...');
        showNotification('视频播放完成，等待平台统计进度...', 'success', true);
        return; // 不立即跳转，继续监控
      }
      
      // 已经完成，检查是否等待足够长时间（5秒）
      const waitedTime = now - videoCompletedTime;
      const requiredWaitTime = 5000; // 等待5秒让平台统计
      
      if (waitedTime >= requiredWaitTime) {
        console.log(`[AutoStudy] 已等待 ${waitedTime}ms，平台应该已统计完成，准备跳转下一页`);
        stopVideoMonitoring();
        
        // 视频播放完成且等待足够时间后，点击下一个按钮
        setTimeout(() => {
          if (isRunning && !isWaitingForNextPage) {
            console.log('[AutoStudy] 尝试点击下一个按钮');
            showNotification('进度已统计，准备进入下一页...', 'success', true);
            
            // 重置状态为非视频页面，防止重复检测
            currentPageType = 'completed';
            
            // 直接尝试点击下一个按钮
            tryClickNextButton();
          }
        }, 1000);
      } else {
        // 继续等待
        const remainingTime = Math.ceil((requiredWaitTime - waitedTime) / 1000);
        console.log(`[AutoStudy] 继续等待平台统计... 剩余 ${remainingTime} 秒`);
        if (remainingTime % 2 === 0) { // 每2秒显示一次
          showNotification(`等待平台统计进度... ${remainingTime}秒`, 'info');
        }
      }
    } else {
      // 如果检测到未完成，重置完成时间
      if (videoCompletedTime !== 0) {
        console.log('[AutoStudy] ⚠️ 检测到视频状态变为未完成，重置等待时间');
        videoCompletedTime = 0;
      }
    }
  }, 2000);
}

// 辅助函数：检查元素是否在视口中
function isElementInViewport(el) {
  try {
    const rect = el.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  } catch (e) {
    return true; // 出错时假设可见
  }
}

// 停止监控视频播放
function stopVideoMonitoring() {
  isWatchingVideo = false;
  
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
  
  // 停止用户活动模拟
  stopUserActivitySimulation();
}

// 用户活动模拟相关变量
let userActivityInterval = null;
let lastMouseX = 0;
let lastMouseY = 0;

// 启动用户活动模拟（让平台认为用户在观看）
function startUserActivitySimulation() {
  console.log('[AutoStudy] 🎭 启动用户活动模拟');
  
  // 如果已经在运行，先停止
  if (userActivityInterval) {
    clearInterval(userActivityInterval);
  }
  
  // 每10秒模拟一次用户活动
  userActivityInterval = setInterval(() => {
    if (!isWatchingVideo || !isRunning) {
      stopUserActivitySimulation();
      return;
    }
    
    try {
      // 1. 触发鼠标移动事件（小范围随机移动）
      const videos = getVideoElements();
      if (videos.length > 0) {
        const video = videos[0];
        const rect = video.getBoundingClientRect();
        
        // 在视频区域内随机生成坐标
        const randomX = rect.left + Math.random() * rect.width;
        const randomY = rect.top + Math.random() * rect.height;
        
        // 只有当坐标变化时才触发事件（避免完全相同）
        if (Math.abs(randomX - lastMouseX) > 5 || Math.abs(randomY - lastMouseY) > 5) {
          const mouseMoveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: randomX,
            clientY: randomY
          });
          
          video.dispatchEvent(mouseMoveEvent);
          
          lastMouseX = randomX;
          lastMouseY = randomY;
          
          console.log(`[AutoStudy] 模拟鼠标移动: (${Math.round(randomX)}, ${Math.round(randomY)})`);
        }
        
        // 2. 触发visibilitychange事件（确保页面被认为是可见的）
        if (document.hidden) {
          console.log('[AutoStudy] ⚠️ 页面被标记为隐藏，可能影响进度统计');
        }
        
        // 3. 触发focus事件（确保页面有焦点）
        if (document.hasFocus && !document.hasFocus()) {
          console.log('[AutoStudy] ⚠️ 页面失去焦点，尝试重新获取焦点');
          window.focus();
        }
        
        // 4. 定期检查并触发视频的自定义事件
        videos.forEach((video, index) => {
          if (!video.paused && !video.ended) {
            // 触发watching事件（某些平台可能监听此事件）
            video.dispatchEvent(new CustomEvent('watching', {
              detail: {
                currentTime: video.currentTime,
                duration: video.duration,
                timestamp: Date.now()
              }
            }));
          }
        });
        
      }
      
    } catch (error) {
      console.warn('[AutoStudy] 用户活动模拟出错:', error);
    }
    
  }, 10000); // 每10秒一次
  
  console.log('[AutoStudy] 用户活动模拟已启动，间隔10秒');
}

// 停止用户活动模拟
function stopUserActivitySimulation() {
  if (userActivityInterval) {
    clearInterval(userActivityInterval);
    userActivityInterval = null;
    console.log('[AutoStudy] 用户活动模拟已停止');
  }
}

// 自动滚动功能 - 改进版（仅用于文本页面）
let lastScrollHeight = 0;
let scrollStuckCount = 0;
let scrollAttempts = 0;

function autoScroll() {
  try {
    // 添加更详细的调试信息
    if (scrollAttempts === 0 || scrollAttempts % 10 === 0) {
      console.log(`🔄 [AutoStudy] autoScroll 开始执行 - 第${scrollAttempts + 1}次调用`);
      console.log('[AutoStudy] 当前状态:', {
        isRunning,
        currentPageType, 
        isWaitingForNextPage,
        isWatchingVideo,
        isProcessingFileList,
        scrollInterval: scrollInterval !== null,
        configDelay: config.scrollDelay,
        configSpeed: config.scrollSpeed
      });
    }
    
    // 快速状态检查
    if (!isRunning) {
      if (scrollAttempts === 0) {
        console.log('[AutoStudy] autoScroll跳过 - 插件未运行');
      }
      return;
    }
    
    if (isWaitingForNextPage || isWatchingVideo || isProcessingFileList) {
      // 降低日志频率，只有前几次才打印
      if (scrollAttempts < 3) {
        console.log('[AutoStudy] autoScroll跳过 - 状态:', {isWaitingForNextPage, isWatchingVideo, isProcessingFileList});
      }
      return;
    }
    
    // 只在文本页面进行滚动
    if (currentPageType !== 'text') {
      if (scrollAttempts === 0) {
        console.log('[AutoStudy] autoScroll跳过 - 页面类型:', currentPageType);
      }
      return;
    }
    
    // 确保配置已加载
    if (!config || !config.scrollDelay || !config.scrollSpeed) {
      console.warn('[AutoStudy] 配置未加载，使用默认值');
      validateConfig();
    }
    
    scrollAttempts++;
    const currentScrollHeight = document.documentElement.scrollHeight;
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
    const clientHeight = document.documentElement.clientHeight;
    
    // 检测页面是否卡住（高度不变且滚动位置不变）
    // 只有在滚动位置也没变化时才认为真正卡住
    const lastScrollTop = window.lastScrollTop || 0;
    if (currentScrollHeight === lastScrollHeight && currentScroll === lastScrollTop) {
      scrollStuckCount++;
    } else {
      scrollStuckCount = 0;
      lastScrollHeight = currentScrollHeight;
    }
    window.lastScrollTop = currentScroll;
    
    // 强制完成条件：到达底部、卡住太久、或滚动次数过多（增加容忍度）
    const forceComplete = scrollStuckCount > 50 || scrollAttempts > 1500;
    
    // 至少需要滚动几次后才能判断是否到达底部
    const minScrollAttempts = 5; // 减少最小滚动次数到5次
    const shouldCheckBottom = scrollAttempts >= minScrollAttempts;
    
    // 每次都打印当前滚动状态用于调试
    if (scrollAttempts % 5 === 0) {
      console.log(`📊 [AutoStudy] 滚动状态检查 - 第${scrollAttempts}次:`, {
        currentScroll: Math.round(currentScroll),
        scrollHeight: currentScrollHeight,
        clientHeight,
        shouldCheckBottom,
        isAtBottom: shouldCheckBottom ? isAtBottom() : '等待更多滚动',
        forceComplete
      });
    }
    
    if ((shouldCheckBottom && isAtBottom()) || forceComplete) {
      if (forceComplete) {
        console.log('[AutoStudy] 强制完成滚动 - 原因:', {
          scrollStuckCount, scrollAttempts, currentScroll, currentScrollHeight
        });
      } else {
        console.log('[AutoStudy] 文本页面已到达底部 - 经过', scrollAttempts, '次滚动');
      }
      
      // 重置滚动状态
      scrollAttempts = 0;
      scrollStuckCount = 0;
      lastScrollHeight = 0;
      window.lastScrollTop = 0;
      
      handleBottomReached();
    } else {
      // 继续滚动 - 使用更智能的滚动策略
      let scrollAmount = config.scrollSpeed || 80;
      
      // 如果卡住，尝试更大的滚动步长（提高阈值）
      if (scrollStuckCount > 15) {
        scrollAmount = Math.min(scrollAmount * 1.5, 200); // 限制最大滚动步长
        console.log('[AutoStudy] 检测到滚动卡住，增加滚动步长:', scrollAmount);
      }
      
      // 简化日志：每20次打印一次
      if (scrollAttempts % 20 === 1) {
        console.log(`[AutoStudy] 滚动中 #${scrollAttempts}: ${Math.round(currentScroll)}px`);
      }
      
      try {
        // 只在非文本页面才检测PDF容器，文本页面直接使用页面滚动
        if (currentPageType === 'text') {
          // 文本页面：直接使用页面级别滚动，不检测PDF容器
          try {
            window.scrollBy(0, scrollAmount);
          } catch (e) {
            // fallback: 直接设置 scrollTop
            document.documentElement.scrollTop = 
              (document.documentElement.scrollTop || 0) + scrollAmount;
          }
        } else {
          // 非文本页面：检测PDF容器
          const pdfContainerCandidates = [
            document.querySelector('#viewerContainer'),
            document.querySelector('#viewer'),
            document.querySelector('.pdfViewer'),
            document.querySelector('#outerContainer'),
            document.querySelector('.pdf-container')
          ].filter(Boolean);
          
          let scrollExecuted = false;
          let validPdfContainer = null;
          
          // 检测有效的PDF容器，排除侧边栏
          for (let container of pdfContainerCandidates) {
            if (!container) continue;
            
            try {
              const isScrollable = container.scrollHeight > container.clientHeight + 10;
              const isMainContent = !isSidebarOrNavigation(container);
              const rect = container.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;
              
              // 只在首次检测时打印详细信息
              if (scrollAttempts === 1) {
                console.log(`📄 [AutoStudy] 检测PDF容器 ${container.id || container.className}:`, {
                  是否可滚动: isScrollable,
                  是否主要内容: isMainContent,
                  是否可见: isVisible,
                  位置: rect.left < window.innerWidth * 0.3 ? '左侧' : '右侧',
                  宽度: Math.round(rect.width),
                  高度: Math.round(rect.height)
                });
              }
              
              if (isScrollable && isMainContent && isVisible) {
                validPdfContainer = container;
                break;
              }
            } catch (error) {
              console.warn('⚠️ [AutoStudy] 检测PDF容器时出错:', error.message);
            }
          }
          
          if (validPdfContainer) {
            if (scrollAttempts === 1) {
              console.log('✅ [AutoStudy] 找到有效PDF主要内容容器:', {
                容器ID: validPdfContainer.id || '无',
                容器类: validPdfContainer.className || '无'
              });
            }
            
            const beforeScroll = validPdfContainer.scrollTop;
            
            try {
              validPdfContainer.scrollBy(0, scrollAmount);
            } catch (scrollByError) {
              validPdfContainer.scrollTop = beforeScroll + scrollAmount;
            }
            
            scrollExecuted = true;
          }
          
          // 如果没有PDF容器或滚动失败，使用普通页面滚动
          if (!scrollExecuted) {
            if (scrollAttempts === 1) {
              console.log('🔄 [AutoStudy] 未找到PDF容器，使用页面级别滚动');
            }
            try {
              window.scrollBy(0, scrollAmount);
            } catch (e) {
              document.documentElement.scrollTop = 
                (document.documentElement.scrollTop || 0) + scrollAmount;
            }
          }
        }
        
        // 备用滚动：如果前面的方法都没有明显效果，尝试其他容器
        setTimeout(() => {
          const newScroll = window.pageYOffset || document.documentElement.scrollTop;
          if (newScroll === currentScroll && scrollAttempts > 5) {
            console.log('🔧 [AutoStudy] 寻找其他可滚动容器...');
            
            // 智能查找主要内容区域，避免滚动侧边栏
            const mainContentSelectors = [
              // 主要内容区域选择器（按优先级排序）
              'main', '[role="main"]', '.main-content', '#main-content',
              '.content', '#content', '.page-content', '.document-content',
              '.viewer-content', '.learning-content', '.course-content',
              '.right-content', '.main-panel', '.content-panel',
              // 避免左侧导航和侧边栏
              '.content-wrapper:not(.sidebar):not(.nav):not(.menu)',
              '.container:not(.sidebar):not(.nav):not(.menu)',
              'section:not(.sidebar):not(.nav):not(.menu)',
              'article:not(.sidebar):not(.nav):not(.menu)'
            ];
            
            const allScrollable = [];
            
            // 首先尝试主要内容区域选择器
            for (let selector of mainContentSelectors) {
              try {
                const elements = document.querySelectorAll(selector);
                for (let el of elements) {
                  if (isMainContentContainer(el)) {
                    allScrollable.push(el);
                  }
                }
              } catch (e) {
                console.warn('[AutoStudy] 选择器查找失败:', selector, e.message);
              }
            }
            
            // 如果还没找到，进行更精确的搜索
            if (allScrollable.length === 0) {
              console.log('[AutoStudy] 主要内容选择器未找到，进行精确搜索...');
              
              const allElements = document.querySelectorAll('div, section, article, main');
              for (let el of allElements) {
                if (isMainContentContainer(el) && !isSidebarOrNavigation(el)) {
                  allScrollable.push(el);
                }
              }
            }
            
            console.log('📋 [AutoStudy] 找到主要内容可滚动元素:', allScrollable.length);
            
            if (allScrollable.length > 0) {
              // 选择最合适的主要内容容器
              let bestContainer = selectBestMainContentContainer(allScrollable);
              
              if (bestContainer) {
                const maxScrollable = bestContainer.scrollHeight - bestContainer.clientHeight;
                
                console.log('🎯 [AutoStudy] 选择最佳主要内容容器:', {
                  tagName: bestContainer.tagName,
                  id: bestContainer.id || '无',
                  className: bestContainer.className || '无',
                  可滚动高度: maxScrollable,
                  位置: getElementPosition(bestContainer),
                  是否主要内容: isMainContentContainer(bestContainer)
                });
                
                const beforeScroll = bestContainer.scrollTop;
                bestContainer.scrollBy(0, scrollAmount);
                
                setTimeout(() => {
                  if (bestContainer.scrollTop > beforeScroll) {
                    console.log('✅ [AutoStudy] 主要内容容器滚动成功');
                  } else {
                    console.warn('⚠️ [AutoStudy] 主要内容容器滚动无效果');
                    // 尝试直接设置scrollTop
                    bestContainer.scrollTop = beforeScroll + scrollAmount;
                  }
                }, 100);
              } else {
                console.warn('⚠️ [AutoStudy] 没有找到合适的主要内容容器');
              }
            } else {
              console.warn('⚠️ [AutoStudy] 没有找到任何主要内容可滚动容器');
            }
          }
        }, 100);
        
        // 辅助函数：检查是否为主要内容容器
        function isMainContentContainer(el) {
          if (!el || el === document.body || el === document.documentElement) return false;
          
          try {
            const style = window.getComputedStyle(el);
            const hasOverflow = style.overflowY === 'scroll' || style.overflowY === 'auto' || style.overflow === 'auto';
            const isScrollable = el.scrollHeight > el.clientHeight + 20;
            
            return hasOverflow && isScrollable;
          } catch (e) {
            return false;
          }
        }
        
        // 辅助函数：检查是否为侧边栏或导航
        function isSidebarOrNavigation(el) {
          if (!el) return false;
          
          const className = (el.className || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          
          // 检查是否为侧边栏或导航相关的元素
          const sidebarKeywords = ['sidebar', 'nav', 'menu', 'navigation', 'aside', 'left-panel', 'side-panel'];
          const isLeftSide = el.getBoundingClientRect().left < window.innerWidth * 0.3; // 左侧30%区域
          
          const hasSidebarClass = sidebarKeywords.some(keyword => 
            className.includes(keyword) || id.includes(keyword)
          );
          
          return hasSidebarClass || (isLeftSide && el.offsetWidth < window.innerWidth * 0.4);
        }
        
        // 辅助函数：选择最佳的主要内容容器
        function selectBestMainContentContainer(containers) {
          if (containers.length === 0) return null;
          if (containers.length === 1) return containers[0];
          
          let bestContainer = null;
          let bestScore = 0;
          
          for (let container of containers) {
            try {
              const rect = container.getBoundingClientRect();
              const scrollableHeight = container.scrollHeight - container.clientHeight;
              
              // 评分系统：优先选择右侧、较大、可滚动内容多的容器
              let score = 0;
              
              // 位置分数：右侧内容区域得分更高
              if (rect.left > window.innerWidth * 0.3) score += 50;
              if (rect.left > window.innerWidth * 0.5) score += 30;
              
              // 大小分数：较大的容器得分更高
              const areaScore = (rect.width * rect.height) / (window.innerWidth * window.innerHeight) * 100;
              score += Math.min(areaScore, 50);
              
              // 可滚动内容分数
              score += Math.min(scrollableHeight / 100, 30);
              
              // 类名和ID分数：主要内容相关的得分更高
              const className = (container.className || '').toLowerCase();
              const id = (container.id || '').toLowerCase();
              if (className.includes('content') || className.includes('main')) score += 20;
              if (id.includes('content') || id.includes('main')) score += 20;
              
              console.log(`[AutoStudy] 容器评分 ${container.tagName}.${container.className}:`, {
                总分: Math.round(score),
                位置分数: rect.left > window.innerWidth * 0.3 ? '右侧+50' : '左侧+0',
                大小分数: Math.round(areaScore),
                滚动分数: Math.min(scrollableHeight / 100, 30),
                可滚动高度: scrollableHeight
              });
              
              if (score > bestScore) {
                bestScore = score;
                bestContainer = container;
              }
            } catch (e) {
              console.warn('[AutoStudy] 评估容器时出错:', e.message);
            }
          }
          
          return bestContainer;
        }
        
        // 辅助函数：获取元素位置信息
        function getElementPosition(el) {
          try {
            const rect = el.getBoundingClientRect();
            return {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              相对位置: rect.left < window.innerWidth * 0.3 ? '左侧' : 
                      rect.left > window.innerWidth * 0.7 ? '右侧' : '中间'
            };
          } catch (e) {
            return { 位置: '未知' };
          }
        }
        
      } catch (scrollError) {
        console.error('❌ [AutoStudy] 滚动执行出错:', scrollError);
        // 尝试使用更兼容的方式
        try {
          window.scrollBy(0, scrollAmount);
        } catch (fallbackError) {
          console.error('❌ [AutoStudy] 备用滚动方式也失败:', fallbackError);
        }
      }
      
      // 如果滚动卡住太久，尝试额外的滚动方式
      if (scrollStuckCount > 20) {
        setTimeout(() => {
          try {
            // 使用简单的 scrollBy 避免 offsetParent 错误
            window.scrollBy(0, scrollAmount * 2);
          } catch (e) {
            console.warn('[AutoStudy] 额外滚动失败:', e);
            // fallback
            try {
              document.documentElement.scrollTop = 
                (document.documentElement.scrollTop || 0) + (scrollAmount * 2);
            } catch (e2) {
              console.warn('[AutoStudy] 备用滚动也失败:', e2);
            }
          }
        }, 200);
      }
      
      // 最后手段：直接跳到页面末尾
      if (scrollStuckCount > 30) {
        setTimeout(() => {
          try {
            // 直接设置 scrollTop 避免 offsetParent 错误
            document.documentElement.scrollTop = document.documentElement.scrollHeight;
          } catch (e) {
            console.warn('[AutoStudy] 跳转到底部失败:', e);
          }
        }, 300);
      }
    }
  } catch (error) {
    console.error('❌ [AutoStudy] autoScroll 函数执行出错:', error);
    
    // 如果是严重错误，尝试重启定时器
    if (error.message.includes('Cannot read property') || 
        error.message.includes('Cannot access before initialization')) {
      console.warn('[AutoStudy] 检测到严重错误，尝试重启滚动定时器...');
      
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
      
      setTimeout(() => {
        if (isRunning && currentPageType === 'text') {
          console.log('[AutoStudy] 重启滚动定时器...');
          startTextScrollingTimer();
        }
      }, 2000);
    }
  }
}

// 处理到达底部的情况（仅用于文本页面） - 增强调试版
function handleBottomReached() {
  console.log('=== [AutoStudy] 处理页面底部到达事件 ===');
  console.log('[AutoStudy] 当前状态检查:', {
    isWaitingForNextPage: isWaitingForNextPage,
    currentPageType: currentPageType,
    isRunning: isRunning,
    scrollInterval: scrollInterval ? 'active' : 'inactive'
  });
  
  if (isWaitingForNextPage) {
    console.log('⏸️ [AutoStudy] 已在等待下一页，跳过处理');
    return;
  }
  
  if (currentPageType !== 'text') {
    console.log('⏸️ [AutoStudy] 页面类型不是文本，跳过处理:', currentPageType);
    return;
  }
  
  // 记录滚动完成的详细信息
  const finalScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  const scrollableHeight = scrollHeight - clientHeight;
  
  let scrollProgress = 0;
  if (scrollableHeight > 0) {
    scrollProgress = Math.round((finalScrollTop / scrollableHeight) * 100);
  } else if (scrollHeight <= clientHeight) {
    scrollProgress = 100; // 页面无需滚动时认为100%
  }
  
  const scrollStats = {
    finalScrollTop: finalScrollTop,
    scrollHeight: scrollHeight,
    clientHeight: clientHeight,
    scrollableHeight: scrollableHeight,
    scrollProgress: scrollProgress,
    totalAttempts: scrollAttempts,
    stuckCount: scrollStuckCount
  };
  
  console.log('[AutoStudy] 滚动完成统计:', scrollStats);
  showNotification(`页面滚动完成 (${scrollStats.scrollProgress}%)，准备查找下一页按钮...`, 'success');
  
  // 暂停滚动但不停止运行状态
  if (scrollInterval) {
    console.log('[AutoStudy] 清除滚动定时器 ID:', scrollInterval);
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  if (config.autoClickNext) {
    console.log('[AutoStudy] 文本页面滚动完成，等待', config.waitAtBottom, 'ms后查找下一个按钮...');
    showNotification(`等待 ${config.waitAtBottom/1000}秒后查找下一页按钮...`, 'info');
    
    setTimeout(() => {
      if (isRunning) {
        console.log('[AutoStudy] 开始查找下一个按钮...');
        tryClickNextButton();
      } else {
        console.log('[AutoStudy] 插件已停止，取消查找按钮');
      }
    }, config.waitAtBottom);
  } else {
    console.log('[AutoStudy] 自动点击已禁用，停止运行');
    showNotification('页面滚动完成，自动点击已禁用', 'warning');
    stopScrolling();
  }
  
  console.log('=== [AutoStudy] 底部处理完成 ===');
}

// 尝试点击下一个按钮（带重试机制和动态等待）
function tryClickNextButton() {
  if (!isRunning) return;
  
  // 等待动态内容加载
  console.log('[AutoStudy] 开始查找下一个按钮，等待动态内容加载...');
  
  let findAttempts = 0;
  const maxFindAttempts = 10;
  
  const findAndClick = () => {
    findAttempts++;
    const nextButton = findNextButton();
    
    if (nextButton) {
      console.log(`[AutoStudy] 找到下一个按钮 (查找尝试 ${findAttempts}, 总尝试 ${retryCount + 1}/${maxRetries}):`, nextButton);
      showNotification('找到下一页按钮，正在跳转...');
      
      // 标记等待状态
      isWaitingForNextPage = true;
      retryCount = 0; // 重置重试计数
      
      // 滚动到按钮可视区域
      try {
        nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 等待滚动完成后点击
        setTimeout(() => {
          try {
            // 再次验证按钮仍然有效
            if (isValidNextButton(nextButton)) {
              nextButton.click();
              console.log('[AutoStudy] 按钮已点击，等待页面加载...');
              setTimeout(() => {
                waitForPageLoad();
              }, 1000);
            } else {
              console.log('[AutoStudy] 按钮在点击前变为无效，重新查找');
              handleClickFailure();
            }
          } catch (error) {
            console.error('[AutoStudy] 点击按钮时出错:', error);
            handleClickFailure();
          }
        }, 500);
        
      } catch (error) {
        console.error('[AutoStudy] 滚动到按钮时出错:', error);
        // 直接尝试点击
        try {
          nextButton.click();
          setTimeout(() => {
            waitForPageLoad();
          }, 1000);
        } catch (clickError) {
          console.error('[AutoStudy] 直接点击也失败:', clickError);
          handleClickFailure();
        }
      }
      
    } else {
      // 如果没找到按钮，继续尝试查找
      if (findAttempts < maxFindAttempts) {
        console.log(`[AutoStudy] 第${findAttempts}次未找到按钮，1秒后重试查找...`);
        setTimeout(findAndClick, 1000);
      } else {
        console.log('[AutoStudy] 多次查找未找到按钮，使用原有重试机制');
        handleNoButtonFound();
      }
    }
  };
  
  // 立即开始第一次查找
  findAndClick();
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

// 根据页面类型处理 - 增强版
function handlePageByType() {
  console.log('=== [AutoStudy] 开始页面类型处理 ===');
  console.log('[AutoStudy] 当前页面类型:', currentPageType);
  console.log('[AutoStudy] 插件运行状态:', isRunning);
  
  // 确保页面类型不为空
  if (!currentPageType || currentPageType === 'unknown') {
    console.log('[AutoStudy] 页面类型未知，重新检测...');
    currentPageType = detectPageType();
    console.log('[AutoStudy] 重新检测结果:', currentPageType);
  }
  
  // 重置所有状态标志
  isWatchingVideo = false;
  isProcessingFileList = false;
  isWaitingForNextPage = false;
  
  switch (currentPageType) {
    case 'video':
      console.log('🎥 [AutoStudy] 处理视频页面');
      showNotification('检测到视频页面，开始视频处理...', 'info', true);
      startVideoMonitoring();
      break;
      
    case 'filelist':
      console.log('📁 [AutoStudy] 处理文件列表页面');
      showNotification('检测到文件列表页面，开始逐个查看文件...', 'info', true);
      fileListIndex = 0;
      handleFileListPage();
      break;
      
    case 'filepreview':
      console.log('📄 [AutoStudy] 处理文件预览页面');
      showNotification('检测到文件预览，等待内容加载...', 'info');
      
      // 文件预览使用文本滚动功能，但需要等待PDF完全加载
      currentPageType = 'text'; // 使用文本滚动逻辑
      
      // 简化PDF加载检测
      const waitForPdfLoad = () => {
        // 检查基本容器
        const pdfContainer = document.querySelector('#viewerContainer') ||
                           document.querySelector('#viewer') ||
                           document.querySelector('.pdfViewer');
        
        // 检查是否有PDF页面
        const hasPages = document.querySelectorAll('.page').length > 0;
        
        console.log('[AutoStudy] PDF加载检查:', {
          容器存在: !!pdfContainer,
          页面数量: hasPages,
          容器可滚动: pdfContainer ? pdfContainer.scrollHeight > pdfContainer.clientHeight : false
        });
        
        if (pdfContainer || hasPages) {
          console.log('[AutoStudy] PDF内容检测成功，开始滚动');
          showNotification('PDF已加载，开始滚动浏览...', 'info');
          
          if (!window.configLoaded) {
            validateConfig();
            window.configLoaded = true;
          }
          startTextScrolling();
        } else {
          console.log('[AutoStudy] PDF尚未加载完成，继续等待...');
          setTimeout(waitForPdfLoad, 1000);
        }
      };
      
      // 延迟启动，给PDF查看器时间初始化
      setTimeout(() => {
        if (isRunning && currentPageType === 'text') {
          console.log('[AutoStudy] 开始等待PDF查看器加载');
          
          // 添加PDF调试信息
          debugPdfContainer();
          
          waitForPdfLoad();
        } else {
          console.warn('[AutoStudy] 文件预览处理被取消:', {
            isRunning,
            currentPageType
          });
        }
      }, 1500); // 增加等待时间
      
      // PDF调试函数
      const debugPdfContainer = () => {
        console.log('=== [AutoStudy] PDF容器调试信息 ===');
        
        const containers = [
          { name: '#viewerContainer', element: document.querySelector('#viewerContainer') },
          { name: '#viewer', element: document.querySelector('#viewer') },
          { name: '.pdfViewer', element: document.querySelector('.pdfViewer') },
          { name: '#outerContainer', element: document.querySelector('#outerContainer') }
        ];
        
        containers.forEach(({ name, element }) => {
          if (element) {
            console.log(`📄 [AutoStudy] 发现容器 ${name}:`, {
              存在: true,
              可见: element.offsetWidth > 0 && element.offsetHeight > 0,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              scrollTop: element.scrollTop,
              可滚动: element.scrollHeight > element.clientHeight,
              overflow: window.getComputedStyle(element).overflowY
            });
          } else {
            console.log(`❌ [AutoStudy] 未找到容器 ${name}`);
          }
        });
        
        // 检查所有页面元素
        const pages = document.querySelectorAll('.page');
        console.log(`📋 [AutoStudy] PDF页面数量: ${pages.length}`);
        
        // 检查PDF.js状态
        if (window.PDFViewerApplication) {
          console.log('🔧 [AutoStudy] PDF.js状态:', {
            initialized: window.PDFViewerApplication.initialized,
            pagesCount: window.PDFViewerApplication.pagesCount || '未知',
            currentPage: window.PDFViewerApplication.page || '未知'
          });
        } else {
          console.log('❌ [AutoStudy] 未找到PDF.js应用');
        }
        
        console.log('=== [AutoStudy] PDF容器调试完成 ===');
      };
      break;
      
    case 'text':
    default:
      console.log('📄 [AutoStudy] 处理文本页面');
      showNotification('检测到文本页面，开始滚动浏览...', 'info');
      
      // 强制确保文本页面类型
      if (currentPageType !== 'text') {
        console.log('[AutoStudy] 强制设为文本类型');
        currentPageType = 'text';
      }
      
      // 延迟启动滚动，确保页面完全加载和配置加载完成
      setTimeout(() => {
        if (isRunning && currentPageType === 'text') {
          console.log('[AutoStudy] 延迟启动文本滚动 - 确保配置已加载');
          if (!window.configLoaded) {
            validateConfig();
            window.configLoaded = true;
          }
          startTextScrolling();
        } else {
          console.warn('[AutoStudy] 延迟启动被取消:', {
            isRunning,
            currentPageType
          });
        }
      }, 500);
      break;
  }
  
  console.log('=== [AutoStudy] 页面类型处理完成 ===');
}

// 开始文本页面滚动
function startTextScrolling() {
  console.log('=== [AutoStudy] 开始文本页面滚动 ===');
  console.log('[AutoStudy] 当前页面类型:', currentPageType);
  console.log('[AutoStudy] 详细状态:', {
    isRunning: isRunning,
    isWatchingVideo: isWatchingVideo,
    isProcessingFileList: isProcessingFileList,
    isWaitingForNextPage: isWaitingForNextPage,
    currentPageType: currentPageType
  });
  
  // 验证配置
  validateConfig();
  console.log('[AutoStudy] 使用配置:', {
    scrollDelay: config.scrollDelay,
    scrollSpeed: config.scrollSpeed,
    waitAtBottom: config.waitAtBottom
  });
  
  // 确保状态正确
  isWatchingVideo = false;
  isProcessingFileList = false;
  
  // 重置滚动状态变量
  lastScrollHeight = 0;
  scrollStuckCount = 0;
  scrollAttempts = 0;
  console.log('[AutoStudy] 已重置滚动状态计数器');
  
  // 清除可能存在的旧定时器
  if (scrollInterval) {
    console.log('[AutoStudy] 清除旧的滚动定时器 ID:', scrollInterval);
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  // 检查页面基本信息
  const pageInfo = {
    url: window.location.href,
    scrollTop: window.pageYOffset || document.documentElement.scrollTop,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    atBottom: isAtBottom()
  };
  console.log('[AutoStudy] 页面信息:', pageInfo);
  
  // 检查页面是否需要滚动 - 优化版（检查多种滚动可能性）
  const documentScrollable = pageInfo.scrollHeight - pageInfo.clientHeight;
  
  // 检查常见的可滚动容器（优先级排序）
  const scrollableContainers = [
    // PDF查看器容器（最高优先级）
    document.querySelector('#viewerContainer'),
    document.querySelector('#viewer'), 
    document.querySelector('.pdfViewer'),
    document.querySelector('[class*="pdf-viewer"]'),
    document.querySelector('[class*="document-viewer"]'),
    // 全屏模式容器
    document.querySelector('.full-screen-mode-content'),
    document.querySelector('[class*="full-screen"]'),
    document.querySelector('[class*="fullscreen"]'),
    // 查找可能的内容容器
    document.querySelector('main'),
    document.querySelector('.main-content'),
    document.querySelector('.content'),
    document.querySelector('#content'),
    document.querySelector('.page-content'),
    document.querySelector('.container'),
    document.querySelector('.learning-content'),
    // 查找可滚动的div（包括检查overflow样式）
    ...Array.from(document.querySelectorAll('div')).filter(div => {
      const style = window.getComputedStyle(div);
      const hasScrollableContent = div.scrollHeight > div.clientHeight + 20;
      const hasOverflowScroll = style.overflowY === 'scroll' || style.overflowY === 'auto';
      const hasScrollableClass = div.className && (
        div.className.includes('scroll') || 
        div.className.includes('content') ||
        div.className.includes('full-screen') ||
        div.className.includes('viewer') ||
        div.className.includes('pdf')
      );
      return hasScrollableContent && (hasOverflowScroll || hasScrollableClass);
    })
  ].filter(el => el && el.scrollHeight > el.clientHeight + 20);
  
  let maxContainerScrollable = 0;
  let bestContainer = null;
  scrollableContainers.forEach(container => {
    if (container) {
      const containerScrollable = container.scrollHeight - container.clientHeight;
      if (containerScrollable > maxContainerScrollable) {
        maxContainerScrollable = containerScrollable;
        bestContainer = container;
      }
    }
  });
  
  // 综合判断：文档可滚动 或 容器可滚动 或 内容足够长
  const needsScroll = documentScrollable > 20 || 
                      maxContainerScrollable > 20 || 
                      document.body.textContent.length > 1000; // 内容长度超过1000字符
  
  console.log('[AutoStudy] 滚动需求分析（增强版）:', {
    文档可滚动高度: documentScrollable,
    最大容器可滚动高度: maxContainerScrollable,
    找到可滚动容器: scrollableContainers.length,
    最佳容器: bestContainer ? bestContainer.tagName + (bestContainer.className ? '.' + bestContainer.className : '') : '无',
    内容长度: document.body.textContent.length,
    最终判断需要滚动: needsScroll
  });
  
  // 如果真的没有任何滚动可能，才跳过
  if (!needsScroll && documentScrollable <= 0 && maxContainerScrollable <= 0) {
    console.log('[AutoStudy] 页面确实无需滚动，直接标记为完成');
    showNotification('页面内容无需滚动', 'info');
    setTimeout(() => {
      if (isRunning && config.autoClickNext) {
        tryClickNextButton();
      }
    }, 1000);
    return;
  }
  
  // 默认优先尝试滚动，而不是过早判断不需要
  if (documentScrollable <= 20 && maxContainerScrollable <= 20) {
    console.log('[AutoStudy] ⚠️  页面滚动空间有限，但仍尝试滚动以确保完整浏览');
    showNotification('页面内容较少，快速浏览中...', 'info');
  }
  
  // 如果已经在底部，先回到顶部（但只有在真正滚动过之后才检测）
  // 首次启动时不检测，直接开始滚动
  const initialScroll = window.pageYOffset || document.documentElement.scrollTop;
  const isAtInitialPosition = initialScroll < 100; // 接近顶部
  
  if (!isAtInitialPosition) {
    console.log('[AutoStudy] 当前不在页面顶部，滚动到顶部重新开始');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      if (isRunning) {
        console.log('[AutoStudy] 页面已回到顶部，启动滚动定时器');
        startTextScrollingTimer();
      }
    }, 1000);
  } else {
    console.log('[AutoStudy] 页面在顶部，直接启动滚动定时器');
    startTextScrollingTimer();
  }
}

// 启动文本滚动定时器
function startTextScrollingTimer() {
  console.log('=== [AutoStudy] 尝试启动文本滚动定时器 ===');
  
  // 详细检查各种状态
  const checks = {
    isRunning: isRunning,
    currentPageType: currentPageType,
    isWatchingVideo: isWatchingVideo,
    isProcessingFileList: isProcessingFileList,
    isWaitingForNextPage: isWaitingForNextPage,
    configScrollDelay: config.scrollDelay,
    configScrollSpeed: config.scrollSpeed,
    existingInterval: scrollInterval
  };
  console.log('[AutoStudy] 状态检查:', checks);
  
  if (!isRunning) {
    console.log('❌ [AutoStudy] 插件未运行，取消滚动');
    return;
  }
  
  if (currentPageType !== 'text') {
    console.log('❌ [AutoStudy] 页面类型不是文本，取消滚动:', currentPageType);
    return;
  }
  
  // 再次验证配置
  if (!config.scrollDelay || config.scrollDelay <= 0) {
    console.log('⚠️ [AutoStudy] 滚动间隔无效，重新设置为默认值');
    config.scrollDelay = 200;
  }
  
  // 清除现有定时器（如果存在）
  if (scrollInterval) {
    console.log('[AutoStudy] 清除现有定时器 ID:', scrollInterval);
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  
  console.log(`✅ [AutoStudy] 启动文本滚动定时器, 间隔: ${config.scrollDelay}ms, 速度: ${config.scrollSpeed}px`);
  
  // 确保配置已加载
  if (!window.configLoaded) {
    console.warn('[AutoStudy] 配置尚未加载，等待配置加载...');
    validateConfig();
    window.configLoaded = true;
  }
  
  // 确保配置有效
  if (!config.scrollDelay || config.scrollDelay <= 0) {
    config.scrollDelay = defaultConfig.scrollDelay;
    console.warn('[AutoStudy] 滚动间隔无效，使用默认值:', config.scrollDelay);
  }
  if (!config.scrollSpeed || config.scrollSpeed <= 0) {
    config.scrollSpeed = defaultConfig.scrollSpeed;
    console.warn('[AutoStudy] 滚动速度无效，使用默认值:', config.scrollSpeed);
  }
  
  try {
    console.log('[AutoStudy] 正在设置滚动定时器...');
    console.log('[AutoStudy] 使用配置 - 间隔:', config.scrollDelay, 'ms, 速度:', config.scrollSpeed, 'px');
    
    scrollInterval = setInterval(() => {
      try {
        // 增加调试信息，帮助排查问题
        if (scrollAttempts % 5 === 0) { // 每5次打印一次，增加频率
          console.log('[AutoStudy] ⏰ 定时器触发 - 调用 autoScroll(), 尝试次数:', scrollAttempts, '当前滚动位置:', window.pageYOffset);
        }
        autoScroll();
      } catch (timerError) {
        console.error('❌ [AutoStudy] 定时器回调执行出错:', timerError);
      }
    }, config.scrollDelay);
    
    if (scrollInterval) {
      console.log('✅ [AutoStudy] 滚动定时器设置成功，ID:', scrollInterval);
    } else {
      console.error('❌ [AutoStudy] 滚动定时器设置失败！');
      showNotification('滚动定时器设置失败', 'error');
      return;
    }
    
    console.log('✅ [AutoStudy] 滚动定时器已成功启动，ID:', scrollInterval);
    showNotification('开始自动滚动文本内容...', 'info');
    
    // 立即触发第一次滚动，不等待定时器
    console.log('[AutoStudy] 立即执行首次滚动');
    setTimeout(() => {
      try {
        autoScroll();
      } catch (firstScrollError) {
        console.error('❌ [AutoStudy] 首次滚动出错:', firstScrollError);
      }
    }, 100);
    
    // 简化定时器验证，避免过度检查造成的问题
    setTimeout(() => {
      if (scrollInterval && isRunning && currentPageType === 'text') {
        console.log('✅ [AutoStudy] 滚动定时器验证通过，ID:', scrollInterval);
        
        // 如果还没有开始滚动，触发一次
        if (scrollAttempts === 0) {
          console.log('[AutoStudy] 触发首次滚动');
          autoScroll();
        }
      }
    }, 1000);
    
  } catch (error) {
    console.error('❌ [AutoStudy] 启动滚动定时器时出错:', error);
    showNotification('滚动功能启动失败，使用备用方式', 'warning');
    
    // 清理可能的残留定时器
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
    
    // 使用更简单的备用方式
    setTimeout(() => {
      if (isRunning && currentPageType === 'text') {
        console.log('[AutoStudy] 启动备用滚动方式...');
        scrollInterval = setInterval(autoScroll, 600); // 使用更保守的间隔
        if (scrollInterval) {
          console.log('✅ [AutoStudy] 备用滚动定时器已启动');
          showNotification('滚动功能已启动（备用模式）', 'info');
        }
      }
    }, 1000);
  }
}

// 重新开始滚动（用于页面跳转后）
function restartScrolling() {
  console.log('[AutoStudy] 重新开始学习 - 检测新页面类型');
  
  // 重置所有状态
  isWatchingVideo = false;
  isProcessingFileList = false;
  fileListIndex = 0;
  
  // 重置滚动状态变量
  lastScrollHeight = 0;
  scrollStuckCount = 0;
  scrollAttempts = 0;
  
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

// 视频进度诊断函数 - 帮助排查为什么进度只有一半
window.autoStudyVideoDebug = function() {
  console.log('');
  console.log('=== 🎥 [AutoStudy] 视频进度诊断工具 ===');
  console.log('');
  
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('❌ 未找到视频元素');
    return;
  }
  
  console.log(`✅ 找到 ${videos.length} 个视频元素`);
  console.log('');
  
  videos.forEach((video, index) => {
    console.log(`--- 视频 ${index + 1} 详细信息 ---`);
    
    // 基本信息
    console.log('📊 播放状态:', {
      '总时长': Math.round(video.duration) + 's',
      '当前时间': Math.round(video.currentTime) + 's',
      '剩余时间': Math.round(video.duration - video.currentTime) + 's',
      '播放进度': Math.round((video.currentTime / video.duration) * 100) + '%',
      '是否暂停': video.paused,
      '是否结束': video.ended,
      '播放速度': video.playbackRate + 'x',
      '是否静音': video.muted
    });
    
    // 事件监听器状态
    console.log('🎧 事件监听器:', {
      '已添加监听': video.dataset.autoStudyListenerAdded === 'true',
      'ended事件触发': video.dataset.videoReallyEnded === 'true'
    });
    
    // 可见性检查
    const rect = video.getBoundingClientRect();
    const inViewport = isElementInViewport(video);
    console.log('👁️ 可见性:', {
      '在视口中': inViewport,
      '位置': `top=${Math.round(rect.top)}, left=${Math.round(rect.left)}`,
      '尺寸': `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      'offsetParent存在': video.offsetParent !== null
    });
    
    // 页面焦点状态
    console.log('🔍 页面状态:', {
      '页面有焦点': document.hasFocus ? document.hasFocus() : '不支持检测',
      '页面可见': !document.hidden,
      '页面URL': window.location.href
    });
    
    // 检查是否有平台特定的进度记录元素
    const progressIndicators = [
      document.querySelector('.progress'),
      document.querySelector('.video-progress'),
      document.querySelector('[class*="progress"]'),
      document.querySelector('[data-progress]')
    ].filter(el => el);
    
    console.log('📈 平台进度指示器:', progressIndicators.length > 0 ? 
      progressIndicators.map(el => el.className || el.tagName) : 
      '未找到明显的进度指示器');
    
    // 网络状态
    console.log('🌐 网络状态:', {
      'readyState': video.readyState + ' (' + ['空', '元数据', '当前数据', '未来数据', '足够数据'][video.readyState] + ')',
      'networkState': video.networkState + ' (' + ['空', '闲置', '加载中', '无源'][video.networkState] + ')',
      '已缓冲': video.buffered.length > 0 ? `${video.buffered.end(0)}s` : '0s'
    });
    
    // 视频源信息
    console.log('📹 视频源:', {
      'src': video.src?.substring(0, 100) + '...' || '无直接src',
      'currentSrc': video.currentSrc?.substring(0, 100) + '...' || '无',
      'preload': video.preload
    });
    
    console.log('');
  });
  
  // 给出诊断建议
  console.log('💡 诊断建议:');
  console.log('');
  
  const allCompleted = areAllVideosCompleted();
  if (allCompleted) {
    console.log('✅ 所有视频已播放完成');
    console.log('   如果进度还是一半，可能是以下原因:');
    console.log('   1. 平台需要更长的等待时间来统计进度');
    console.log('   2. 平台检测到了自动化行为（倍速、静音）');
    console.log('   3. 平台需要特定的用户交互（如点击、拖拽进度条）');
    console.log('   4. 平台有防作弊机制（如检测鼠标活动频率）');
    console.log('');
    console.log('🔧 尝试以下方法:');
    console.log('   • 手动点击视频播放（不使用插件）观察进度');
    console.log('   • 打开浏览器开发者工具 Network 标签，查看是否有进度上报请求');
    console.log('   • 在视频播放时查看是否有XHR/Fetch请求发送进度数据');
    console.log('   • 尝试降低倍速（如1.5x代替2x）');
  } else {
    console.log('⚠️ 视频尚未播放完成');
    videos.forEach((video, index) => {
      const remaining = Math.round(video.duration - video.currentTime);
      if (remaining > 1) {
        console.log(`   视频 ${index + 1}: 还剩 ${remaining} 秒`);
      }
    });
  }
  
  console.log('');
  console.log('📞 如需进一步帮助，请在控制台保持打开状态并:');
  console.log('   1. 开启 Network 标签，筛选 XHR/Fetch');
  console.log('   2. 手动播放视频到50%时，查看是否有进度上报');
  console.log('   3. 播放到100%时，再次查看网络请求');
  console.log('   4. 对比手动和自动模式的网络请求差异');
  console.log('');
  console.log('===========================================');
  console.log('');
  
  return {
    videoCount: videos.length,
    allCompleted: allCompleted,
    pageVisible: !document.hidden,
    hasFocus: document.hasFocus ? document.hasFocus() : null
  };
};

// 暴露快速修复函数
window.autoStudyForceStart = function(pageType = 'text') {
  console.log('=== [AutoStudy] 手动强制启动 ===');
  
  // 停止当前运行
  stopScrolling();
  
  // 等待停止完成
  setTimeout(() => {
    // 重置状态
    isRunning = true;
    isWaitingForNextPage = false;
    isWatchingVideo = false;
    isProcessingFileList = false;
    currentPageType = pageType;
    
    // 重置滚动状态
    lastScrollHeight = 0;
    scrollStuckCount = 0;
    scrollAttempts = 0;
    retryCount = 0;
    fileListIndex = 0;
    
    console.log('[AutoStudy] 手动设置页面类型为:', pageType);
    console.log('[AutoStudy] 开始强制处理...');
    
    handlePageByType();
    
  }, 500);
};

// 暴露强制文本滚动函数
window.autoStudyForceTextScroll = function() {
  console.log('=== [AutoStudy] 手动强制文本滚动 ===');
  
  isRunning = true;
  currentPageType = 'text';
  isWatchingVideo = false;
  isProcessingFileList = false;
  isWaitingForNextPage = false;
  
  // 重置滚动状态
  lastScrollHeight = 0;
  scrollStuckCount = 0;
  scrollAttempts = 0;
  
  console.log('[AutoStudy] 强制启动文本滚动');
  startTextScrolling();
};

// 暴露文件列表测试函数
window.autoStudyTestFileList = function() {
  console.log('=== [AutoStudy] 测试文件列表功能 ===');
  
  // 停止当前运行
  stopScrolling();
  
  setTimeout(() => {
    isRunning = true;
    isProcessingFileList = true;
    isWatchingVideo = false;
    isWaitingForNextPage = false;
    currentPageType = 'filelist';
    fileListIndex = 0;
    
    console.log('[AutoStudy] 开始测试文件列表处理...');
    handleFileListPage();
  }, 500);
};

// 暴露文件内容滚动测试函数
window.autoStudyTestFileScroll = function() {
  console.log('=== [AutoStudy] 测试文件内容滚动 ===');
  
  isRunning = true;
  isProcessingFileList = true;
  isWatchingVideo = false;
  isWaitingForNextPage = false;
  
  console.log('[AutoStudy] 强制启动文件内容滚动');
  handleFileContentView();
};

// 暴露PDF翻页测试函数
window.autoStudyTestPdfFlip = function() {
  console.log('=== [AutoStudy] 测试PDF翻页功能 ===');
  
  isRunning = true;
  isProcessingFileList = true;
  isWatchingVideo = false;
  isWaitingForNextPage = false;
  
  console.log('[AutoStudy] 尝试PDF翻页模式');
  const success = tryPdfPageFlipping();
  
  if (!success) {
    console.log('[AutoStudy] PDF翻页模式不可用');
    showNotification('PDF翻页模式不可用，请检查控制台日志', 'warning');
  }
};

// 播放按钮智能诊断工具 - 全新升级版
window.autoStudyDiagnosePlayButton = function() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   🔬 [AutoStudy] 播放按钮智能诊断工具 v2.0          ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  
  // 第一步：检测视频
  console.log('📋 第一步：检测视频元素');
  console.log('─────────────────────────────────────────');
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('❌ 未找到视频元素');
    console.log('');
    console.log('💡 建议：');
    console.log('  1. 确保视频已加载');
    console.log('  2. 检查视频是否在 iframe 中');
    console.log('  3. 刷新页面后重试');
    return;
  }
  
  console.log(`✅ 找到 ${videos.length} 个视频元素`);
  console.log('');
  
  // 对每个视频进行诊断
  videos.forEach((video, index) => {
    console.log(`━━━━━━━━━━━━ 诊断视频 ${index + 1}/${videos.length} ━━━━━━━━━━━━`);
    console.log('');
    
    // 视频基本信息
    const videoRect = video.getBoundingClientRect();
    console.log('📹 视频信息:');
    console.log({
      标签: video.tagName,
      ID: video.id || '(无)',
      类名: video.className || '(无)',
      位置: {
        left: Math.round(videoRect.left),
        top: Math.round(videoRect.top),
        width: Math.round(videoRect.width),
        height: Math.round(videoRect.height)
      },
      状态: {
        暂停: video.paused,
        时长: Math.round(video.duration) + 's',
        当前: Math.round(video.currentTime) + 's'
      }
    });
    console.log('');
    
    // 调用播放按钮查找（带详细日志）
    console.log('🔍 第二步：查找播放按钮（将输出详细日志）');
    console.log('─────────────────────────────────────────');
    const playButton = findPlayButton(video);
    
    if (playButton) {
      console.log('');
      console.log('✅✅✅ 成功找到播放按钮！');
      console.log('');
      console.log('📍 按钮详情:');
      const buttonRect = playButton.getBoundingClientRect();
      console.log({
        标签: playButton.tagName,
        ID: playButton.id || '(无)',
        类名: playButton.className || '(无)',
        文本: playButton.textContent?.trim().substring(0, 50) || '(无)',
        位置: {
          left: Math.round(buttonRect.left),
          top: Math.round(buttonRect.top),
          width: Math.round(buttonRect.width),
          height: Math.round(buttonRect.height)
        }
      });
      console.log('');
      
      // 建议
      console.log('💡 下一步建议:');
      console.log('  ✓ 播放按钮查找成功');
      console.log('  ✓ 可以启动插件进行自动学习');
      console.log('  ✓ 插件会通过点击这个按钮来播放视频');
      console.log('');
      
    } else {
      console.log('');
      console.log('❌❌❌ 未能找到播放按钮');
      console.log('');
      console.log('🔧 故障排除建议:');
      console.log('  1. 查看上面的候选按钮列表');
      console.log('  2. 如果有候选但验证失败，可能是位置判断问题');
      console.log('  3. 手动在页面上找到播放按钮，右键检查元素');
      console.log('  4. 复制播放按钮的选择器告诉我，我会添加支持');
      console.log('');
      console.log('📝 手动查找播放按钮方法:');
      console.log('  在控制台运行:');
      console.log('    document.querySelector("你的播放按钮选择器")');
      console.log('');
      console.log('  常见选择器示例:');
      console.log('    button.play-btn');
      console.log('    .video-play-button');
      console.log('    button[aria-label="播放"]');
      console.log('');
    }
  });
  
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   📊 诊断完成                                         ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  
  return {
    videoCount: videos.length,
    hasPlayButton: videos.some(v => findPlayButton(v) !== null)
  };
};

// 兼容旧的测试函数
window.autoStudyTestPlayButton = function() {
  console.log('');
  console.log('=== 🎬 [AutoStudy] 播放按钮查找测试（支持iframe）===');
  console.log('提示: 推荐使用新的诊断工具 autoStudyDiagnosePlayButton()');
  console.log('');
  
  // 先检测 iframe
  const iframes = document.querySelectorAll('iframe');
  console.log(`📺 检测到 ${iframes.length} 个 iframe`);
  
  if (iframes.length > 0) {
    iframes.forEach((iframe, idx) => {
      console.log(`  iframe ${idx + 1}:`, {
        src: iframe.src?.substring(0, 80) || '(无src)',
        width: iframe.width || iframe.offsetWidth,
        height: iframe.height || iframe.offsetHeight
      });
      
      // 尝试访问 iframe 内容
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          const iframeVideos = iframeDoc.querySelectorAll('video');
          console.log(`    └─ 包含 ${iframeVideos.length} 个视频元素`);
        } else {
          console.log(`    └─ 无法访问（可能跨域）`);
        }
      } catch (e) {
        console.log(`    └─ 访问失败: ${e.message}`);
      }
    });
    console.log('');
  }
  
  const videos = getVideoElements();
  
  if (videos.length === 0) {
    console.log('❌ 未找到视频元素');
    console.log('');
    console.log('💡 可能的原因:');
    console.log('  1. 视频在跨域的 iframe 中');
    console.log('  2. 视频还未加载');
    console.log('  3. 页面没有视频');
    return;
  }
  
  console.log(`✅ 找到 ${videos.length} 个视频元素`);
  console.log('');
  
  videos.forEach((video, index) => {
    console.log(`--- 测试视频 ${index + 1} ---`);
    
    const videoRect = video.getBoundingClientRect();
    console.log('📺 视频位置:', {
      left: Math.round(videoRect.left),
      top: Math.round(videoRect.top),
      width: Math.round(videoRect.width),
      height: Math.round(videoRect.height)
    });
    
    // 查找播放按钮
    console.log('🔍 开始查找播放按钮...');
    const playButton = findPlayButton(video);
    
    if (playButton) {
      const buttonRect = playButton.getBoundingClientRect();
      console.log('✅ 找到播放按钮!', {
        tagName: playButton.tagName,
        className: playButton.className || '(无)',
        id: playButton.id || '(无)',
        text: playButton.textContent?.trim().substring(0, 20) || '(无文本)',
        位置: {
          left: Math.round(buttonRect.left),
          top: Math.round(buttonRect.top),
          width: Math.round(buttonRect.width),
          height: Math.round(buttonRect.height)
        }
      });
      
      console.log('');
      console.log('🧪 测试点击...');
      
      // 模拟点击测试
      try {
        playButton.click();
        console.log('✅ 点击成功！');
        
        // 检查视频是否开始播放
        setTimeout(() => {
          if (!video.paused) {
            console.log('✅ 视频已开始播放');
            console.log('📊 当前状态:', {
              paused: video.paused,
              currentTime: video.currentTime,
              playbackRate: video.playbackRate,
              muted: video.muted
            });
            
            // 暂停视频（避免影响测试）
            video.pause();
            console.log('⏸️ 已暂停视频（测试完成）');
          } else {
            console.log('⚠️ 视频未开始播放，可能需要更多等待时间或有其他限制');
          }
        }, 1000);
        
      } catch (error) {
        console.error('❌ 点击失败:', error);
      }
      
    } else {
      console.log('❌ 未找到播放按钮');
      console.log('');
      console.log('💡 尝试手动查找:');
      console.log('   1. 在控制台运行: document.querySelector("你的播放按钮选择器")');
      console.log('   2. 找到后告诉我选择器，我会添加到代码中');
    }
    
    console.log('');
  });
  
  console.log('=== 测试完成 ===');
  console.log('');
};

// 网络请求监控 - 帮助诊断进度上报
window.autoStudyMonitorNetwork = function(enable = true) {
  if (enable) {
    console.log('');
    console.log('=== 🌐 [AutoStudy] 启动网络请求监控 ===');
    console.log('正在监控所有XHR和Fetch请求...');
    console.log('');
    
    // 拦截XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._autoStudyMethod = method;
      this._autoStudyUrl = url;
      return originalXHROpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(body) {
      const url = this._autoStudyUrl;
      const method = this._autoStudyMethod;
      
      // 只记录可能与进度相关的请求
      if (url && (
        url.includes('progress') ||
        url.includes('record') ||
        url.includes('learn') ||
        url.includes('study') ||
        url.includes('video') ||
        url.includes('watch') ||
        url.includes('log') ||
        url.includes('stat')
      )) {
        console.log('📡 [XHR]', method, url);
        if (body) {
          try {
            const bodyData = typeof body === 'string' ? JSON.parse(body) : body;
            console.log('   📦 请求数据:', bodyData);
          } catch (e) {
            console.log('   📦 请求数据:', body?.toString().substring(0, 200));
          }
        }
        
        this.addEventListener('load', function() {
          console.log('   ✅ 响应状态:', this.status);
          try {
            const response = JSON.parse(this.responseText);
            console.log('   📥 响应数据:', response);
          } catch (e) {
            console.log('   📥 响应:', this.responseText?.substring(0, 200));
          }
        });
      }
      
      return originalXHRSend.apply(this, arguments);
    };
    
    // 拦截Fetch
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url.url;
      
      // 只记录可能与进度相关的请求
      if (urlStr && (
        urlStr.includes('progress') ||
        urlStr.includes('record') ||
        urlStr.includes('learn') ||
        urlStr.includes('study') ||
        urlStr.includes('video') ||
        urlStr.includes('watch') ||
        urlStr.includes('log') ||
        urlStr.includes('stat')
      )) {
        console.log('📡 [Fetch]', options.method || 'GET', urlStr);
        if (options.body) {
          try {
            const bodyData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
            console.log('   📦 请求数据:', bodyData);
          } catch (e) {
            console.log('   📦 请求数据:', options.body?.toString().substring(0, 200));
          }
        }
        
        return originalFetch.apply(this, arguments).then(response => {
          response.clone().text().then(text => {
            console.log('   ✅ 响应状态:', response.status);
            try {
              const data = JSON.parse(text);
              console.log('   📥 响应数据:', data);
            } catch (e) {
              console.log('   📥 响应:', text.substring(0, 200));
            }
          });
          return response;
        });
      }
      
      return originalFetch.apply(this, arguments);
    };
    
    window._autoStudyNetworkMonitorEnabled = true;
    console.log('✅ 网络监控已启动');
    console.log('提示: 现在播放视频，观察控制台输出的进度上报请求');
    console.log('');
    
  } else {
    console.log('⚠️ 网络监控停止功能暂不支持（需要刷新页面重置）');
  }
};

// 暴露手动滚动容器测试函数
window.autoStudyManualScrollTest = function() {
  console.log('=== [AutoStudy] 手动滚动容器测试（增强版） ===');
  
  // 查找所有可能的滚动容器
  const allDivs = document.querySelectorAll('div');
  const scrollableContainers = [];
  
  allDivs.forEach(div => {
    if (div.scrollHeight > div.clientHeight + 10) {
      const rect = div.getBoundingClientRect();
      const className = div.className || '';
      const id = div.id || '';
      
      // 检查是否为侧边栏
      const isSidebar = ['sidebar', 'side-bar', 'sidenav', 'menu', 'navigation', 'nav-', 
                         'toolbar', 'outline', 'toc', 'thumbnail'].some(keyword => 
        className.toLowerCase().includes(keyword) || id.toLowerCase().includes(keyword)
      );
      
      const isNarrow = rect.width < window.innerWidth * 0.3;
      const isEdge = rect.left < 50 || rect.right > window.innerWidth - 50;
      
      scrollableContainers.push({
        element: div,
        id: id || '(无ID)',
        className: className || '(无类名)',
        scrollHeight: div.scrollHeight,
        clientHeight: div.clientHeight,
        scrollableHeight: div.scrollHeight - div.clientHeight,
        width: Math.round(rect.width),
        isSidebar: isSidebar || (isNarrow && isEdge),
        位置: rect.left < 50 ? '左侧' : rect.right > window.innerWidth - 50 ? '右侧' : '中间'
      });
    }
  });
  
  // 按可滚动高度排序
  scrollableContainers.sort((a, b) => b.scrollableHeight - a.scrollableHeight);
  
  console.log(`\n📊 找到 ${scrollableContainers.length} 个可滚动容器:\n`);
  
  scrollableContainers.forEach((container, index) => {
    const prefix = container.isSidebar ? '🚫 [侧边栏-已排除]' : '✅ [主内容候选]';
    console.log(`${index + 1}. ${prefix}`, {
      ID: container.id,
      类名: container.className.substring(0, 40),
      可滚动高度: container.scrollableHeight,
      宽度: container.width,
      位置: container.位置
    });
    
    // 只测试前3个非侧边栏容器
    if (!container.isSidebar && index < 3) {
      const before = container.element.scrollTop;
      container.element.scrollTop = before + 100;
      const after = container.element.scrollTop;
      
      console.log(`   📝 滚动测试: ${before} -> ${after} (${after > before ? '成功✅' : '失败❌'})`);
      
      // 恢复位置
      container.element.scrollTop = before;
    }
  });
  
  // PDF.js 特定容器测试
  console.log('\n🔍 PDF.js 标准容器检测:');
  const pdfContainers = [
    { name: '#viewerContainer', el: document.querySelector('#viewerContainer') },
    { name: '#viewer', el: document.querySelector('#viewer') },
    { name: '.pdfViewer', el: document.querySelector('.pdfViewer') }
  ];
  
  pdfContainers.forEach(({ name, el }) => {
    if (el) {
      console.log(`✅ ${name}: 找到`, {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        可滚动: el.scrollHeight > el.clientHeight
      });
    } else {
      console.log(`❌ ${name}: 未找到`);
    }
  });
  
  // 文档级别滚动测试
  console.log('\n📄 文档级别滚动测试:');
  const docBefore = document.documentElement.scrollTop;
  document.documentElement.scrollTop = docBefore + 100;
  const docAfter = document.documentElement.scrollTop;
  console.log(`文档滚动: ${docBefore} -> ${docAfter} (${docAfter > docBefore ? '成功✅' : '失败❌'})`);
  document.documentElement.scrollTop = docBefore;
  
  // 推荐结果
  const recommended = scrollableContainers.filter(c => !c.isSidebar)[0];
  if (recommended) {
    console.log('\n💡 推荐使用的容器:');
    console.log({
      ID: recommended.id,
      类名: recommended.className.substring(0, 50),
      可滚动高度: recommended.scrollableHeight,
      宽度: recommended.width
    });
  }
};

// 页面加载时初始化
loadConfig();
console.log('[AutoStudy] v3.6 已加载 - MVP播放器等待优化版 🎯');
console.log('[AutoStudy] 当前页面:', window.location.href);
console.log('');
console.log('✨ v3.6 核心优化:');
console.log('  🎯 添加播放器加载等待机制 ⭐ 新增');
console.log('  🎯 启动时自动等待2秒让播放器就绪 ⭐ 新增');
console.log('  🎯 MVP播放器专属等待检测 ⭐ 新增');
console.log('  🎯 支持动态ID的播放器 ✅');
console.log('  ✅ 已验证 MVP 播放器按钮查找');
console.log('  ✅ 点击播放按钮触发平台进度统计');
console.log('  ✅ 自动设置倍速和静音');
console.log('  ✅ 视频播放到最后0.5秒');
console.log('  ✅ 完成后等待5秒统计进度');
console.log('');
console.log('🎬 已验证的播放器:');
console.log('  • 开放大学 MVP 播放器 ✅ 用户实测');
console.log('  • Video.js');
console.log('  • 阿里云播放器');
console.log('  • B站播放器');
console.log('  • 通用 HTML5 播放器');
console.log('');
console.log('🛠️ 调试函数:');
console.log('  autoStudyTestMvpButton() - 快速测试MVP按钮 ⭐推荐');
console.log('  autoStudyDiagnosePlayButton() - 完整诊断');
console.log('  autoStudyDebug() - 查看整体状态');
console.log('');
console.log('💡 使用方法:');
console.log('  1. 等待页面完全加载（看到视频播放器）');
console.log('  2. 点击插件图标启动');
console.log('  3. 插件会自动等待2秒，然后查找播放按钮');
console.log('  4. 观察控制台确认"✅ 找到播放按钮"');
console.log('  5. 如果看到"通过点击按钮开始播放"即为成功！');
console.log('');

// 延迟执行页面类型检测，用于调试
setTimeout(() => {
  console.log('=== [AutoStudy] 页面加载完成后的自动检测 ===');
  const detectedType = detectPageType();
  console.log('[AutoStudy] 自动检测到的页面类型:', detectedType);
  
  // 显示当前配置
  console.log('[AutoStudy] 当前配置:', config);
  
  // 根据页面类型给出提示
  if (!isRunning) {
    console.log('💡 [AutoStudy] 提示: 点击插件图标启动自动学习，或在控制台运行 autoStudyForceStart() 强制启动');
    
    if (detectedType === 'filelist') {
      console.log('📁 [AutoStudy] 检测到文件列表页面');
      console.log('   提示: 启动后将自动逐个打开文件并滚动浏览');
      console.log('   测试: 运行 autoStudyTestFileList() 可单独测试文件列表功能');
    }
  }
}, 2000);

// 添加快捷键支持（可选）
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Shift + S 切换运行状态
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleRunning();
    showNotification(isRunning ? '已启动自动学习' : '已停止自动学习', 'info');
  }
});

// 快速测试 MVP 播放器按钮 - 用户专用
window.autoStudyTestMvpButton = function() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   🎯 [AutoStudy] 测试 MVP 播放器按钮                 ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  
  // 尝试所有 MVP 选择器
  const mvpSelectors = [
    '.mvp-controls-left-area button',
    '.mvp-replay-player-all-controls button:first-child',
    '.mvp-controls-left-area > button',
    '.mvp-controls-left-area button:first-child'
  ];
  
  console.log('尝试', mvpSelectors.length, '个 MVP 选择器...');
  console.log('');
  
  let found = false;
  
  for (let selector of mvpSelectors) {
    const button = document.querySelector(selector);
    
    if (button) {
      console.log('✅ 找到按钮:', selector);
      console.log({
        标签: button.tagName,
        类名: button.className || '(无)',
        文本: button.textContent?.trim().substring(0, 30) || '(无)',
        可见: button.offsetParent !== null
      });
      console.log('');
      
      if (!found) {
        console.log('🧪 测试点击...');
        try {
          button.click();
          console.log('✅ 点击成功！');
          
          setTimeout(() => {
            const videos = document.querySelectorAll('video');
            if (videos.length > 0 && !videos[0].paused) {
              console.log('');
              console.log('✅✅✅ 视频已开始播放！');
              console.log('');
              console.log('🎉🎉🎉 成功找到正确的播放按钮！');
              console.log('');
              console.log('📝 使用的选择器:', selector);
              console.log('');
              console.log('💡 现在可以启动插件，插件会自动使用这个按钮！');
              console.log('');
              
              // 暂停视频
              videos[0].pause();
              console.log('⏸️ 已暂停视频（等待插件启动）');
              console.log('');
            } else {
              console.log('⚠️ 点击后视频未播放');
            }
          }, 1000);
          
          found = true;
        } catch (error) {
          console.error('❌ 点击失败:', error);
        }
      }
    } else {
      console.log('❌ 未找到:', selector);
    }
  }
  
  if (!found) {
    console.log('');
    console.log('⚠️ 所有选择器都失败了');
    console.log('');
    console.log('💡 建议:');
    console.log('  1. 确保视频页面已完全加载');
    console.log('  2. 运行 autoStudyDiagnosePlayButton() 获取详细诊断');
    console.log('  3. 手动点击播放按钮，看视频是否能正常播放');
    console.log('');
  }
};

