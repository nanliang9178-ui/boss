# boss · 天枢点单老板端（商户后台）

安装包《天枢架构(4)》`apps/admin` 构建产物，UI、路由、文案与源码一致，仅把部署基路径从 `/` 调整为 `/boss/`。

## 入口网址

- 老板端后台入口：<https://nanliang9178-ui.github.io/boss/>
- 登录后自动进入「经营概览」；手机端可直接访问「老板台」（`/boss/boss`）。

## 演示账号

| 角色 | 账号 | 密码 | 说明 |
|---|---|---|---|
| 商户老板 | `demo` | `demo888` | 商户编码 `demo`（登录页已预填，可一键填入） |
| 店员 | `staff` | `staff888` | 商户编码 `demo` |
| 平台运营 | `admin` | `admin888` | 登录页切换到「平台运营」标签 |

## 数据说明

- 页面由安装包 `apps/admin` 源码构建，接口行为由 `assets/t4-shim.js` 在浏览器内模拟，种子数据来自安装包自带 `apps/api/data/app.db` 的真实导出（`assets/t4-seed.js`）。
- 含经营概览、老板台、订单工作台、菜品管理、桌码管理、经营统计、品牌白标、店铺设置、小程序配置、微信支付、平台运营等完整页面。
- 桌码管理里的「桌码地址」指向同站顾客端 `https://nanliang9178-ui.github.io/Consume/t/<sceneCode>`，扫码即进入对应桌位点单页。
- 订单数据保存在浏览器 localStorage；同一浏览器的多个标签页实时同步，跨设备/跨浏览器通过公开 MQTT 通道同步（安装包 Socket.IO 实时推送的演示版）。
- 真实微信支付需要配置商户号与证书，本演示使用安装包的 `ALLOW_MOCK_PAY` 模拟支付。

## 目录

```
index.html          入口（404.html 与之相同，用于 GitHub Pages 深链路 SPA 兜底）
assets/             构建产物 + t4-seed.js（种子数据）+ t4-shim.js（演示数据层）
```


---

source/ 目录为安装包(4)原始工程源码，仅作对照参考，不参与部署。
