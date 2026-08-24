# 你在做什么？怎么做？

线下「多元工作与多元收入聊天会」的互动网页。参与者端通过腾讯云接口读取历史回答并提交新回答；历史展厅和 GitHub Pages 版本仍然读取本地保存的静态档案。

活动进行时，它不是问卷：主持人提出一个问题，所有人先在手机上匿名回答，回答出现在投影端；大家可以点「想听展开」，主持人再从集体回答里选择线索进入现场谈话。

## 本地启动

```powershell
npm install
npm run dev
```

启动后，主持人在电脑上打开：

- 主持 / 投影端：`http://localhost:3000/host`
- 本地默认是历史数据只读模式；参与者端测试接口时使用 `http://localhost:3000/join?mode=live`
- 主持 / 投影端测试接口时使用 `http://localhost:3000/host?mode=live`

主持端不需要输入口令。它通过本机代理安全地控制公网活动，主持操作只接受来自 `localhost` 的请求。

## 参与者加入

参与者公网入口（可读取、提交和修改回答）：

- `https://agent2026-d5goi0noda51a261b-1446728973.tcloudbaseapp.com/polywork/`

历史档案展厅：

- GitHub Pages：`https://ciaoye.github.io/polywork-income-conversation/`

参与者端不需要连接同一个 Wi-Fi。GitHub Pages 版本不会调用腾讯云，腾讯云参与者入口会读取现有回答并接受新的回答提交。

参与者可自行浏览 1–10 题，并分别提交或修改每一题的回答；主持人切换投影题目不会打断参与者正在填写的题目。

## 已有功能

- 10 道完整活动问题、引入文字与主持讨论提示
- 主持端独立切换投影题目，参与者端可自由选择题目
- 匿名回答与修改自己的回答
- 开放文本、双文本、光谱、单选与组合题型
- 「想听展开」投票
- 主持人高亮、隐藏单条回答，或暂时收起全部回答
- 主持控制只在 localhost 开放，无需手动输入口令
- 活动原始回答保存在 `public/polywork-events.json`，历史展厅和静态参与者页面直接读取这份档案
- ciao os 风格的 Win95 灰色窗口、紫色标题栏与像素感控件

## 检查

```powershell
npm run build
npm run lint
npm test
```
