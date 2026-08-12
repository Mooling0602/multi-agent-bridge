# Multi-Agent Bridge

基于 [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk) 的多智能体桥接框架。通过 `SessionCoordinator` 协调引擎启动多个 AI 代理会话，并实现代理间的消息路由与群组讨论。

## 技术栈

- **运行时**: Node.js（ESM 模块）
- **SDK**: `@opencode-ai/sdk` ^1.18.16
- **后端**: OpenCode Serve 进程（由协调器自动管理）

## 目录结构

```
multi-agent-bridge/
├── bin/
│   └── agent-bridge.js           # 全局 CLI 入口
├── src/
│   ├── index.js                  # 主 CLI 入口（多智能体场景）
│   ├── cli.js                    # 全局 CLI（会话管理）
│   ├── config.js                 # 鉴权配置管理
│   ├── coordinator.js            # 协调引擎（会话管理、消息路由）
│   ├── types.js                  # JSDoc 类型定义与路由正则
│   ├── scenarios/
│   │   └── code-review.js        # 代码审查双代理场景
│   ├── __tests__/
│   │   └── coordinator.test.js   # 集成测试
│   └── todo/
│       ├── index.js              # TODO CLI 入口
│       ├── cli.js                # 命令行参数解析
│       ├── service.js            # 业务逻辑层
│       ├── store.js              # 内存数据存储
│       └── __tests__/            # 单元测试
├── package.json
└── package-lock.json
```

## 安装

```bash
npm install
```

需要确保本机已安装 `opencode` CLI 并位于 `PATH` 中。

## 使用

### 多智能体场景

```bash
# 查看帮助
npm start help

# 运行演示（群聊、路由、广播）
npm start demo

# 群组讨论
npm start group "什么是软件架构中最重要的因素？"

# 代理层级委托
npm start delegate "设计一个任务管理系统的 REST API"

# 交互式聊天
npm start chat
```

### 接入已有会话

通过全局 CLI 命令 `agent-bridge` 操作，首次使用需配置服务器：

```bash
# 配置本地 opencode 服务器
agent-bridge server add local http://localhost:8787
# 输入密码

# 查看服务器
agent-bridge servers

# 列出当前目录的会话
agent-bridge sessions

# 按关键词搜索
agent-bridge sessions --keyword "code review"

# 交互式连接会话
agent-bridge connect
# 或直接指定
agent-bridge connect ses_abc123

# 连接成功后即可与已有会话对话
> 你好，介绍一下当前项目
```

服务器配置存储在 `~/.config/multi-agent-bridge/config.json`，支持多服务器：

```json
{
  "servers": {
    "local": { "url": "http://localhost:8787", "password": "..." },
    "remote": { "url": "https://example.com", "password": "..." }
  },
  "defaultServer": "local"
}
```

### 代理间通信格式

在提示词或代理回复中使用以下指令：

| 指令 | 说明 |
|---|---|
| `@agent:<name> <message>` | 向指定代理发送直接消息 |
| `@broadcast <message>` | 向所有其他代理广播消息 |
| `@all <message>` | 同广播 |

### 代码审查场景

```bash
npm run code-review ["任务描述"]
```

启动 coder + reviewer 双代理工作流，coder 完成实现后将代码发送给 reviewer 审查。

### TODO CLI

```bash
npm run todo add "完成项目文档"
npm run todo list
npm run todo done <id>
npm run todo rm <id>
```

## 架构说明

`SessionCoordinator` 是项目的核心引擎：

1. 启动 `opencode serve` 进程并建立连接，或接入已有服务器
2. 为每个代理配置创建独立的会话（session），保持对话历史隔离
3. 支持 `adoptSession()` 接入已有会话、`findSessions()` 按目录/关键词检索会话
4. 监控并发请求（最多 2 个并发），通过队列控制吞吐
5. 解析代理回复中的 `@agent:` / `@broadcast` 指令，执行消息路由
6. 支持多轮回合（`turn`）和并行群聊（`groupChat`）

## 许可证

私有项目。
