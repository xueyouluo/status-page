const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 邮件配置
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.163.com',
  port: process.env.SMTP_PORT || 465,
  secure: process.env.SMTP_SECURE !== 'false', // 默认使用SSL
  auth: {
    user: process.env.SMTP_USER || 'rssagent@163.com',
    pass: process.env.SMTP_PASS || 'VBUXFLXZJLLUKKZA'
  }
});

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
  
  // 添加订阅者表
  db.run(`CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// 发送邮件通知
async function sendIncidentEmail(incident, service) {
  try {
    const subscribers = await new Promise((resolve, reject) => {
      db.all("SELECT email FROM subscribers", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    if (subscribers.length === 0) {
      console.log('没有订阅用户，跳过邮件发送');
      return;
    }
    
    const emails = subscribers.map(sub => sub.email);
    
    // 根据事件状态设置颜色
    const isResolved = !!incident.end_time;
    const statusColor = isResolved ? '#10b981' : '#ef4444';
    const statusText = isResolved ? '服务已恢复' : '服务中断';
    
    const mailOptions = {
      from: process.env.SMTP_USER || 'rssagent@163.com',
      to: emails.join(','),
      subject: `[服务状态] ${service.name} - ${incident.title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>服务状态更新</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #333;
              line-height: 1.6;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #f9fafb;
              border-bottom: 1px solid #e5e7eb;
              padding: 20px;
              text-align: center;
            }
            .content {
              padding: 20px;
            }
            .footer {
              background-color: #f9fafb;
              border-top: 1px solid #e5e7eb;
              padding: 20px;
              text-align: center;
              font-size: 0.8em;
              color: #6b7280;
            }
            .status-badge {
              display: inline-block;
              padding: 5px 12px;
              border-radius: 12px;
              background-color: ${statusColor};
              color: white;
              font-weight: bold;
              font-size: 0.9em;
            }
            .button {
              display: inline-block;
              background-color: #3b82f6;
              color: white;
              padding: 10px 20px;
              text-decoration: none;
              border-radius: 5px;
              margin-top: 15px;
            }
            h1 {
              color: #111827;
              font-size: 1.5em;
              margin-top: 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            table td {
              padding: 10px;
              border-bottom: 1px solid #e5e7eb;
            }
            table td:first-child {
              font-weight: bold;
              width: 120px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>服务状态更新</h1>
              <div class="status-badge">${statusText}</div>
            </div>
            <div class="content">
              <h2>${service.name}</h2>
              <table>
                <tr>
                  <td>状态:</td>
                  <td>${incident.title}</td>
                </tr>
                <tr>
                  <td>详情:</td>
                  <td>${incident.description || '无详情'}</td>
                </tr>
                <tr>
                  <td>开始时间:</td>
                  <td>${new Date(incident.start_time).toLocaleString('zh-CN')}</td>
                </tr>
                ${incident.end_time ? `
                <tr>
                  <td>恢复时间:</td>
                  <td>${new Date(incident.end_time).toLocaleString('zh-CN')}</td>
                </tr>
                ` : ''}
              </table>
              
              <p>您收到此邮件是因为您订阅了我们的服务状态更新。</p>
              
              <a href="${process.env.STATUS_PAGE_URL || 'http://localhost:3000'}" class="button">访问状态页面</a>
            </div>
            <div class="footer">
              <p>© 2024 服务状态监控</p>
              <p>
                <a href="${process.env.STATUS_PAGE_URL || 'http://localhost:3000'}/unsubscribe?email=${encodeURIComponent(emails[0])}">
                  取消订阅
                </a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('邮件已发送: %s', info.messageId);
      return true;
    } catch (error) {
      console.error('发送邮件失败:', error);
      return false;
    }
  } catch (error) {
    console.error('发送通知邮件失败:', error);
    return false;
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
        // 查询相关服务信息
        db.get("SELECT * FROM services WHERE id = ?", [statusData.serviceId], (err, service) => {
          if (err) {
            console.error('获取服务信息失败:', err);
            return;
          }
          
          // 创建事件记录
          db.run(
            "INSERT INTO incidents (service_id, title, description, status) VALUES (?, ?, ?, ?)",
            [statusData.serviceId, "服务中断", `服务 ${service.name} 无法访问`, "investigating"],
            function(err) {
              if (err) {
                console.error('创建事件记录失败:', err);
                return;
              }
              
              // 获取新创建的事件
              db.get("SELECT * FROM incidents WHERE id = ?", [this.lastID], (err, incident) => {
                if (err) {
                  console.error('获取新创建的事件失败:', err);
                  return;
                }
                
                // 发送邮件通知
                sendIncidentEmail(incident, service);
              });
            }
          );
        });
      } else if (row && row.status === 'down' && statusData.status === 'operational') {
        // 如果服务恢复，更新相关事件
        db.run(
          "UPDATE incidents SET end_time = CURRENT_TIMESTAMP, status = 'resolved' WHERE service_id = ? AND end_time IS NULL",
          [statusData.serviceId],
          function(err) {
            if (err) {
              console.error('更新事件状态失败:', err);
              return;
            }
            
            if (this.changes > 0) {
              // 查询相关服务和事件信息用于发送恢复通知
              db.get("SELECT * FROM services WHERE id = ?", [statusData.serviceId], (err, service) => {
                if (err) {
                  console.error('获取服务信息失败:', err);
                  return;
                }
                
                db.get(
                  "SELECT * FROM incidents WHERE service_id = ? ORDER BY id DESC LIMIT 1", 
                  [statusData.serviceId], 
                  (err, incident) => {
                    if (err) {
                      console.error('获取事件信息失败:', err);
                      return;
                    }
                    
                    if (incident) {
                      // 修改事件信息以便发送恢复通知
                      incident.title = "服务已恢复";
                      incident.description = `服务 ${service.name} 已恢复正常运行`;
                      
                      // 发送恢复通知
                      sendIncidentEmail(incident, service);
                    }
                  }
                );
              });
            }
          }
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

// 订阅API
app.post('/api/subscribe', (req, res) => {
  const { email } = req.body;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: '无效的邮箱地址' });
  }
  
  db.run("INSERT OR IGNORE INTO subscribers (email) VALUES (?)", [email], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      return res.status(409).json({ message: '此邮箱已订阅' });
    }
    
    res.status(201).json({ success: true, message: '订阅成功' });
  });
});

// 取消订阅
app.get('/unsubscribe', (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.redirect('/?error=无效的取消订阅链接');
  }
  
  db.run("DELETE FROM subscribers WHERE email = ?", [email], function(err) {
    if (err) {
      return res.redirect('/?error=取消订阅失败');
    }
    
    res.redirect('/?message=取消订阅成功');
  });
});

// 获取订阅者列表（仅管理员可见）
app.get('/api/subscribers', requireAuth, (req, res) => {
  db.all("SELECT * FROM subscribers ORDER BY created_at DESC", (err, subscribers) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json(subscribers);
  });
});

// 删除订阅者（仅管理员可用）
app.delete('/api/subscribers/:id', requireAuth, (req, res) => {
  const subscriberId = req.params.id;
  
  db.run("DELETE FROM subscribers WHERE id = ?", [subscriberId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: '订阅者不存在' });
    }
    
    res.json({ success: true, message: '订阅者已成功删除' });
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