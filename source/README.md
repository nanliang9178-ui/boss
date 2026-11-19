# boss · 老板端后台

天枢点单系统的**商户端**：电脑完整工作台 + 手机「老板台」，附带 NestJS 服务端。

## 入口网址

| 入口 | 网址 | 说明 |
| --- | --- | --- |
| 登录页 | https://nanliang9178-ui.github.io/boss/ | 打开后自动跳到 `/login` |
| 电脑后台 | https://nanliang9178-ui.github.io/boss/ | 订单、菜品、桌码、统计、设置 |
| 手机老板台 | https://nanliang9178-ui.github.io/boss/boss | 今日盈利 / 待做订单 / 我的菜品 |

> 目前是**静态托管**（GitHub Pages），登录和所有数据都需要后端 API 才能用。
> 后端代码在本仓库 `apps/api`，部署后把前端 `src/lib/api.ts` 的 `BASE` 改成线上地址即可。

## 演示账号（后端启动后可用）

| 角色 | 账号 | 密码 | 商户编码 |
| --- | --- | --- | --- |
| 商户老板 | `demo` | `demo888` | `demo` |
| 店员 | `staff` | `staff888` | `demo` |
| 平台运营 | `admin` | `admin888` | — |

## 目录结构

```
boss/
├─ apps/
│  ├─ admin/        # 管理后台（React 19 + Vite + Tailwind）
│  └─ api/          # 服务端（NestJS 11 + Prisma + SQLite）
├─ packages/shared/ # 前后端共享类型、订单状态机、金额工具
├─ deploy/          # nginx + PM2 配置
├─ docs/            # 已构建的静态站点，GitHub Pages 从这里发布
└─ package.json
```

## 本地跑起来

```bash
npm install
npm run setup      # 建库 + 灌演示数据（SQLite，无需装数据库）
npm run dev:api    # 终端 A：http://localhost:3000
npm run dev:admin  # 终端 B：http://localhost:5173
```

## 重新构建前端

```bash
npm run build -w @tianshu/admin
# 把 apps/admin/dist 的内容覆盖到 docs/，提交推送
```

## 与 Consume 仓库的关系

| | Consume | boss |
| --- | --- | --- |
| 谁用 | 到店顾客 | 老板 / 店长 / 店员 |
| 怎么进 | 扫桌面二维码 | 打开网址并登录 |
| 免登录 | 是 | 否 |

顾客点单页的源码在 `Consume` 仓库，两个仓库共用同一套后端数据结构。
