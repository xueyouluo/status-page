const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置会话
app.use(session({
  secret: 'status-page-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 3600000 } // 1小时过期
}));

// 身份验证中间件
const requireAuth = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.redirect('/login');
  }
};

// 初始化数据库
const dbPath = path.join(__dirname, 'data', 'status.db');
const db = new sqlite3.Database(dbPath);

// 创建数据表
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT DEFAULT 'investigating',
    FOREIGN KEY (service_id) REFERENCES services(id)
  )`);
});

// 检查是否有初始数据
db.get("SELECT COUNT(*) as count FROM services", (err, row) => {
  if (err) {
    console.error('Error checking services:', err);
    return;
  }
  
  if (row.count === 0) {
    // 添加示例服务
    db.run("INSERT INTO services (name, url, description) VALUES (?, ?, ?)", 
      ["API服务", "http://your-api-endpoint/health", "核心API服务"]);
  }
});

// 健康检查函数
async function checkServiceHealth(service) {
  try {
    const response = await axios.get(service.url, { timeout: 5000 });
    return { 
      serviceId: service.id, 
      status: response.status === 200 ? 'operational' : 'degraded',
      timestamp: new Date()
    };
  } catch (error) {
    return { 
      serviceId: service.id, 
      status: 'down',
      timestamp: new Date()
    };
  }
}

// 记录状态到数据库
function logStatus(statusData) {
  db.run(
    "INSERT INTO status_logs (service_id, status) VALUES (?, ?)",
    [statusData.serviceId, statusData.status]
  );
  
  // 如果服务从正常变为异常，创建一个新的事件
  db.get(
    "SELECT status FROM status_logs WHERE service_id = ? ORDER BY id DESC LIMIT 1,1",
    [statusData.serviceId],
    (err, row) => {
      if (err) {
        console.error('Error getting previous status:', err);
        return;
      }
      
      if (row && row.status === 'operational' && statusData.status === 'down') {
        db.run(
          "INSERT INTO incidents (service_id, title, description, status) VALUES (?, ?, ?, ?)",
          [statusData.serviceId, "服务中断", "服务无法访问", "investigating"]
        );
      } else if (row && row.status === 'down' && statusData.status === 'operational') {
        // 如果服务恢复，更新相关事件
        db.run(
          "UPDATE incidents SET end_time = CURRENT_TIMESTAMP, status = 'resolved' WHERE service_id = ? AND end_time IS NULL",
          [statusData.serviceId]
        );
      }
    }
  );
}

// 定时检查所有服务的健康状态（每30秒）
cron.schedule('*/30 * * * * *', () => {
  console.log('运行健康检查...');
  db.all("SELECT * FROM services", async (err, services) => {
    if (err) {
      console.error('获取服务列表出错:', err);
      return;
    }
    
    for (const service of services) {
      const statusData = await checkServiceHealth(service);
      logStatus(statusData);
    }
  });
});

// 每天清理一次超过7天的状态日志
cron.schedule('0 0 * * *', () => {
  console.log('清理旧状态日志...');
  db.run(
    "DELETE FROM status_logs WHERE timestamp < datetime('now', '-7 days')",
    (err) => {
      if (err) {
        console.error('清理旧状态日志出错:', err);
      } else {
        console.log('旧状态日志清理完成');
      }
    }
  );
});

// API路由
// 获取所有服务
app.get('/api/services', (req, res) => {
  db.all("SELECT * FROM services", (err, services) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(services);
  });
});

// 获取服务当前状态
app.get('/api/services/status', (req, res) => {
  db.all(`
    SELECT s.id, s.name, s.description, l.status, l.timestamp
    FROM services s
    LEFT JOIN (
      SELECT service_id, status, timestamp 
      FROM status_logs 
      WHERE id IN (
        SELECT MAX(id) FROM status_logs GROUP BY service_id
      )
    ) l ON s.id = l.service_id
  `, (err, statuses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(statuses);
  });
});

// 获取状态历史
app.get('/api/services/:id/history', (req, res) => {
  const days = req.query.days || 7;
  
  db.all(`
    SELECT status, timestamp
    FROM status_logs
    WHERE service_id = ? AND timestamp >= datetime('now', '-${days} days')
    ORDER BY timestamp ASC
  `, [req.params.id], (err, history) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(history);
  });
});

// 获取未解决的事件
app.get('/api/incidents', (req, res) => {
  db.all(`
    SELECT i.*, s.name as service_name
    FROM incidents i
    JOIN services s ON i.service_id = s.id
    WHERE i.end_time IS NULL
    ORDER BY i.start_time DESC
  `, (err, incidents) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(incidents);
  });
});

// 获取所有事件（用于管理页面）
app.get('/api/incidents/all', requireAuth, (req, res) => {
  db.all(`
    SELECT i.*, s.name as service_name
    FROM incidents i
    JOIN services s ON i.service_id = s.id
    ORDER BY i.start_time DESC
  `, (err, incidents) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(incidents);
  });
});

// 删除事件
app.delete('/api/incidents/:id', requireAuth, (req, res) => {
  const incidentId = req.params.id;
  
  db.run("DELETE FROM incidents WHERE id = ?", [incidentId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: '事件不存在' });
    }
    
    res.json({ success: true, message: '事件已成功删除' });
  });
});

// 管理服务
app.post('/api/services', requireAuth, (req, res) => {
  const { name, url, description } = req.body;
  
  if (!name || !url) {
    return res.status(400).json({ error: '服务名和URL是必需的' });
  }
  
  db.run(
    "INSERT INTO services (name, url, description) VALUES (?, ?, ?)",
    [name, url, description || ''],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.status(201).json({ id: this.lastID, name, url, description });
    }
  );
});

// 删除服务
app.delete('/api/services/:id', requireAuth, (req, res) => {
  const serviceId = req.params.id;
  
  db.run("DELETE FROM status_logs WHERE service_id = ?", [serviceId], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.run("DELETE FROM incidents WHERE service_id = ?", [serviceId], (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.run("DELETE FROM services WHERE id = ?", [serviceId], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: '服务不存在' });
        }
        
        res.json({ success: true, message: '服务已成功删除' });
      });
    });
  });
});

// 前端路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 管理员登录页面
app.get('/login', (req, res) => {
  if (req.session.isAuthenticated) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 处理登录请求
app.post('/login', (req, res) => {
  const { password } = req.body;
  
  if (password === 'Aliyun@2025') {
    req.session.isAuthenticated = true;
    res.redirect('/admin');
  } else {
    res.redirect('/login?error=1');
  }
});

// 管理页面 - 受保护
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 登出
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务状态监控页面运行在 http://localhost:${PORT}`);
}); 