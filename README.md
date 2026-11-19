# 天枢点单 · 老板端 / 商户后台（boss）

> 天枢点单（多商户扫码点单 SaaS 白标系统）的**老板端入口**静态演示：登录 → 数据看板 → 订单接单/出餐 → 菜品/桌位管理 → 营业额统计 → 平台商户管理。

## 入口网址

| 用途 | 网址 |
| --- | --- |
| **商户后台入口（老板端）** | https://nanliang9178-ui.github.io/boss/ |
| 手机老板台 | https://nanliang9178-ui.github.io/boss/boss |
| 平台运营后台 | https://nanliang9178-ui.github.io/boss/platform |

## 演示账号

| 角色 | 账号 | 密码 | 说明 |
| --- | --- | --- | --- |
| 老板 | `demo` | `demo888` | 主商户「椒香里·川味小馆」，商户编码可留空 |
| 员工 | `staff` | `staff888` | 接单 / 出餐 |
| 店长 | `manager` | `manager888` | 管理角色 |
| 平台运营 | `admin` | `admin888` | 从 `/boss/platform` 登录，可看多商户 |

## 和顾客端的关系

- 顾客扫码点餐端：https://nanliang9178-ui.github.io/Consume/
  （演示桌台 A01 直达地址：https://nanliang9178-ui.github.io/Consume/demo）
- 「桌位管理」里每张桌的桌码图片来自 `Consume` 仓库的 `assets/qr/`，二维码内容为 `https://nanliang9178-ui.github.io/Consume/<scene>`，可直接下载打印。
- 顾客下单后，本后台通过 `assets/live-sync.js`（公开 MQTT）**实时**收到新订单提示与列表刷新；没有真实后端，`assets/mock-*.js` 模拟 `/api/*` 接口。

![顾客扫码点餐入口](https://nanliang9178-ui.github.io/Consume/assets/qr/entry-customer.png)

> 说明：微信小程序码需要注册并认证小程序后生成（后续工作）；当前交付的是普通二维码 + 网页网址。

## 真实源码（`source/`）

根目录这套 `index.html` + `assets/` 是**静态演示站**，GitHub Pages 直接托管它。
安装包里的**原始工程源码**放在 `source/`，与演示站互不影响：

| 路径 | 内容 |
| --- | --- |
| `source/apps/admin` | 商户后台（React 19 + Vite + Tailwind） |
| `source/apps/api` | 服务端（NestJS 11 + Prisma + SQLite） |
| `source/packages/shared` | 共享类型 / 订单状态机 / 金额工具 |
| `source/deploy` | nginx + PM2 配置 |

```bash
cd source
npm install
npm run setup      # 建库 + 灌演示数据（SQLite，无需装数据库）
npm run dev:api    # 终端 A：http://localhost:3000
npm run dev:admin  # 终端 B：http://localhost:5173
```

- 演示账号：`demo` / `demo888`（商户老板）、`staff` / `staff888`（店员）、`admin` / `admin888`（平台运营）。
- 构建时自动加 `/boss/` 前缀，本地开发走根路径。
- 后端的 `.env`、`data/`（SQLite 库）、`uploads/` 已在 `.gitignore` 中排除，不要强推。
