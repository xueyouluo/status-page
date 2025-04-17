# 简易服务状态监控页面

一个轻量级的服务状态监控网站，可用于展示您的API或其他服务的运行状态。适合在资源有限的环境（如2c2g服务器）上运行。

## 功能特点

- 定期检查配置的服务的健康状态
- 显示当前服务状态（正常/性能下降/服务中断）
- 显示过去30天的服务可用性历史和百分比
- 自动记录并显示服务中断事件
- 提供简单的管理页面用于添加新服务
- 使用SQLite数据库存储数据，无需额外的数据库服务

## 技术栈

- 后端：Node.js + Express
- 数据库：SQLite
- 前端：HTML + CSS + JavaScript

## 安装与运行

### 前提条件

- Node.js 14.x 或更高版本

### 安装步骤

1. 克隆或下载代码到服务器

2. 安装依赖
```bash
cd status-page
npm install
```

3. 启动服务
```bash
npm start
```

服务将在 http://localhost:3000 上运行。

### 配置说明

- 端口：默认运行在3000端口，可通过设置环境变量PORT来修改
- 监控频率：默认每5分钟检查一次服务状态，可在index.js中修改cron表达式

## 使用方法

1. 访问 http://your-server:3000 查看状态页面
2. 访问 http://your-server:3000/admin 管理服务
3. 添加需要监控的服务，输入名称和健康检查URL（该URL应返回HTTP 200表示服务正常）

## 在服务器上部署

### 使用PM2运行（推荐）

```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start index.js --name "status-page"

# 设置开机自启
pm2 startup
pm2 save
```

### 使用Nginx反向代理

如果希望通过80端口访问，可以配置Nginx反向代理：

```nginx
server {
    listen 80;
    server_name status.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 自定义

- 可以修改`public/css/style.css`文件来调整页面样式
- 可以编辑`index.js`中的API路由来添加更多功能

## 注意事项

- 确保您的服务健康检查端点可以被服务器访问
- 如果使用HTTPS，确保SSL证书有效
- 此应用程序暂不包含身份验证功能，如需部署在公网环境，请考虑添加身份验证或使用反向代理的基本认证 