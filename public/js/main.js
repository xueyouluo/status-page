document.addEventListener('DOMContentLoaded', function() {
  // 初始化
  updateLastUpdated();
  loadServiceStatus();
  loadIncidents();
  
  // 每30秒刷新一次数据
  setInterval(() => {
    updateLastUpdated();
    loadServiceStatus();
    loadIncidents();
  }, 30000);
});

// 更新"上次更新"时间
function updateLastUpdated() {
  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${padZero(now.getMonth() + 1)}-${padZero(now.getDate())} ${padZero(now.getHours())}:${padZero(now.getMinutes())}:${padZero(now.getSeconds())}`;
  document.querySelector('#last-updated span').textContent = formattedDate;
}

// 加载服务状态
async function loadServiceStatus() {
  try {
    const response = await fetch('/api/services/status');
    if (!response.ok) {
      throw new Error('获取服务状态失败');
    }
    
    const data = await response.json();
    renderServiceStatus(data);
    renderUptimeHistory(data);
  } catch (error) {
    console.error('加载服务状态出错:', error);
    document.getElementById('status-list').innerHTML = '<div class="status-loading">加载服务状态出错</div>';
  }
}

// 加载事件信息
async function loadIncidents() {
  try {
    const response = await fetch('/api/incidents');
    if (!response.ok) {
      throw new Error('获取事件信息失败');
    }
    
    const incidents = await response.json();
    renderIncidents(incidents);
  } catch (error) {
    console.error('加载事件信息出错:', error);
  }
}

// 渲染服务状态
function renderServiceStatus(services) {
  const statusList = document.getElementById('status-list');
  
  if (services.length === 0) {
    statusList.innerHTML = '<div class="status-loading">暂无服务</div>';
    return;
  }
  
  let html = '';
  
  services.forEach(service => {
    const status = service.status || 'unknown';
    const statusText = getStatusText(status);
    
    html += `
      <div class="status-item status-${status}">
        <div class="status-info">
          <div class="status-name">${service.name}</div>
          ${service.description ? `<div class="status-description">${service.description}</div>` : ''}
        </div>
        <div class="status-indicator">
          <div class="status-dot"></div>
          <div class="status-text">${statusText}</div>
        </div>
      </div>
    `;
  });
  
  statusList.innerHTML = html;
}

// 渲染可用性历史
function renderUptimeHistory(services) {
  const uptimeList = document.getElementById('uptime-list');
  
  if (services.length === 0) {
    uptimeList.innerHTML = '';
    return;
  }
  
  const fetchHistoryPromises = services.map(service => 
    fetch(`/api/services/${service.id}/history?days=7`)
      .then(response => response.json())
      .then(history => ({ service, history }))
      .catch(error => {
        console.error(`获取服务 ${service.name} 的历史记录失败:`, error);
        return { service, history: [] };
      })
  );
  
  Promise.all(fetchHistoryPromises)
    .then(results => {
      let html = '';
      
      results.forEach(({ service, history }) => {
        const uptimePercentage = calculateUptimePercentage(history);
        const timelineHtml = generateTimelineHtml(history);
        
        html += `
          <div class="uptime-item">
            <div class="uptime-header">
              <div class="uptime-name">${service.name}</div>
              <div class="uptime-percentage">${uptimePercentage}% 可用</div>
            </div>
            <div class="uptime-timeline">
              ${timelineHtml}
            </div>
          </div>
        `;
      });
      
      uptimeList.innerHTML = html;
    });
}

// 渲染事件信息
function renderIncidents(incidents) {
  const incidentBanner = document.getElementById('incident-banner');
  const incidentSummary = document.getElementById('incident-summary');
  
  if (incidents.length === 0) {
    incidentBanner.style.display = 'none';
    return;
  }
  
  const activeIncident = incidents[0]; // 显示最新事件
  incidentSummary.textContent = `${activeIncident.service_name}: ${activeIncident.title} - ${activeIncident.description}`;
  incidentBanner.style.display = 'flex';
}

// 计算可用性百分比
function calculateUptimePercentage(history) {
  if (history.length === 0) {
    return '100.00';
  }
  
  const operationalCount = history.filter(item => item.status === 'operational').length;
  const percentage = (operationalCount / history.length) * 100;
  return percentage.toFixed(2);
}

// 生成时间线HTML
function generateTimelineHtml(history) {
  if (history.length === 0) {
    return Array(7).fill('<div class="uptime-day uptime-unknown"></div>').join('');
  }
  
  // 按天对历史记录进行分组
  const dailyStatus = {};
  
  history.forEach(item => {
    const date = new Date(item.timestamp);
    const day = `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}`;
    
    if (!dailyStatus[day]) {
      dailyStatus[day] = [];
    }
    
    dailyStatus[day].push(item.status);
  });
  
  // 生成过去7天的日期
  const days = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const day = `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}`;
    days.push(day);
  }
  
  // 生成时间线HTML
  return days.map(day => {
    const statuses = dailyStatus[day] || [];
    let statusClass = 'unknown';
    
    if (statuses.length > 0) {
      if (statuses.includes('down')) {
        statusClass = 'down';
      } else if (statuses.includes('degraded')) {
        statusClass = 'degraded';
      } else {
        statusClass = 'operational';
      }
    }
    
    return `<div class="uptime-day uptime-${statusClass}"></div>`;
  }).join('');
}

// 获取状态文本
function getStatusText(status) {
  switch(status) {
    case 'operational':
      return '正常运行';
    case 'degraded':
      return '性能下降';
    case 'down':
      return '服务中断';
    default:
      return '未知状态';
  }
}

// 数字补零
function padZero(num) {
  return num.toString().padStart(2, '0');
} 