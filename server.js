/**
 * 4D-MCOM 四维动机建构取向问卷测评网站 - Express 服务器
 *
 * 功能模块：
 *  1. 静态文件服务（前端 HTML/CSS/JS/图片）
 *  2. 问卷题目接口
 *  3. 答卷提交与计分
 *  4. 结果查询
 *  5. 管理员登录与数据管理
 *  6. Excel 导出
 *  7. 飞书多维表格实时同步（可选，失败不影响主流程）
 *
 * 计分模型：
 *  - 正向题（forward）：得分 = 原始分（1-5）
 *  - 反向题（reverse）：得分 = 6 - 原始分
 *  - 四维度各 15 题，总分范围 15-75，中点 45
 *  - >= 45 取第一极（O/C/D/S），< 45 取第二极（I/T/M/R）
 *  - 四极组合 → 16 类型代码（如 "OTDS"）
 */

// ==================== 依赖加载 ====================
require('dotenv').config(); // 加载 .env 环境变量

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 数据文件路径 ====================
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const TYPES_FILE = path.join(DATA_DIR, 'types.json');
const RESPONSES_FILE = path.join(DATA_DIR, 'responses.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ==================== 注册表单常量 ====================
// 年龄段（按需求原文提供的 7 个选项）
const AGE_GROUPS = ['18岁及以下', '22岁及以下', '26岁及以下', '30岁及以下', '30岁~40岁', '40~50岁', '50岁及以上'];
const GENDERS = ['男', '女'];
const NICKNAME_MIN = 1;
const NICKNAME_MAX = 20;

// ==================== 数据读写工具函数 ====================

/**
 * 读取 JSON 文件
 * @param {string} filePath 文件绝对路径
 * @param {*} defaultValue 读取失败时的默认值
 * @returns {*} 解析后的 JSON 或默认值
 */
function readJsonFile(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`读取文件失败 ${filePath}:`, err.message);
    return defaultValue;
  }
}

/**
 * 写入 JSON 文件（格式化缩进 2 空格）
 * @param {string} filePath 文件绝对路径
 * @param {*} data 待写入数据
 * @returns {boolean} 是否写入成功
 */
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`写入文件失败 ${filePath}:`, err.message);
    return false;
  }
}

// 读取题目数组
function getQuestions() {
  return readJsonFile(QUESTIONS_FILE, []);
}

// 读取 16 类型数组
function getTypes() {
  return readJsonFile(TYPES_FILE, []);
}

// 读取所有答卷（文件不存在则自动创建空数组）
function getResponses() {
  if (!fs.existsSync(RESPONSES_FILE)) {
    writeJsonFile(RESPONSES_FILE, []);
  }
  return readJsonFile(RESPONSES_FILE, []);
}

// 追加一条答卷并持久化
function appendResponse(response) {
  const responses = getResponses();
  responses.push(response);
  writeJsonFile(RESPONSES_FILE, responses);
}

// 按 id 查找答卷
function findResponseById(id) {
  const responses = getResponses();
  return responses.find(r => r.id === id);
}

// 查找某用户的最新答卷（同一用户仅保留一份）
function findResponseByUserId(userId) {
  const responses = getResponses();
  // 理论上每个用户只剩一条；按时间倒序取最新，兼容历史脏数据
  return responses
    .filter(r => r.userId === userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
}

/**
 * 用新答卷覆盖指定用户的旧答卷（旧记录从统计中删除）
 * @param {string} userId 用户昵称
 * @param {Object} newResponse 新答卷对象
 * @returns {Object|null} 被覆盖的旧答卷（用于同步删除外部记录）
 */
function replaceUserResponse(userId, newResponse) {
  const responses = getResponses();
  const remaining = responses.filter(r => r.userId !== userId);
  const oldResponse = responses.find(r => r.userId === userId) || null;
  remaining.push(newResponse);
  writeJsonFile(RESPONSES_FILE, remaining);
  return oldResponse;
}

// ==================== 用户数据 ====================

// 读取所有用户（文件不存在则自动创建空数组）
function getUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    writeJsonFile(USERS_FILE, []);
  }
  return readJsonFile(USERS_FILE, []);
}

// 持久化全部用户
function saveUsers(users) {
  writeJsonFile(USERS_FILE, users);
}

// 按昵称精确查找用户
function findUserByNickname(nickname) {
  return getUsers().find(u => u.nickname === nickname) || null;
}

// 按登录令牌查找用户
function findUserByToken(token) {
  if (!token) return null;
  return getUsers().find(u => u.token === token) || null;
}

/**
 * 生成用户登录令牌（随机字符串，持久化于 users.json，服务重启不失效）
 * @returns {string}
 */
function generateUserToken() {
  return 'ut_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// 返回可对外暴露的用户信息（不含 token）
function publicUser(user) {
  return {
    nickname: user.nickname,
    ageGroup: user.ageGroup,
    gender: user.gender,
    createdAt: user.createdAt
  };
}

/**
 * 一次性迁移：为缺少 userId 的历史答卷补归属（userId = 昵称）
 */
function migrateResponses() {
  if (!fs.existsSync(RESPONSES_FILE)) return;
  const responses = readJsonFile(RESPONSES_FILE, null);
  if (!Array.isArray(responses)) return;
  let changed = false;
  responses.forEach(r => {
    if (!r.userId) {
      r.userId = r.nickname || '匿名用户';
      changed = true;
    }
  });
  if (changed) writeJsonFile(RESPONSES_FILE, responses);
}

// ==================== 鉴权模块 ====================

// 已发放的有效 token 集合（内存存储，服务重启后失效）
const validTokens = new Set();

/**
 * 生成 base64 token
 * @returns {string} base64 编码的令牌
 */
function generateToken() {
  const raw = `${process.env.ADMIN_PASSWORD || 'admin4d'}:${Date.now()}:${Math.random()}`;
  return Buffer.from(raw).toString('base64');
}

/**
 * 鉴权中间件：校验 Authorization: Bearer <token>
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供授权令牌' });
  }
  const token = authHeader.slice(7); // 去掉 "Bearer " 前缀
  if (!validTokens.has(token)) {
    return res.status(401).json({ error: '授权令牌无效或已过期' });
  }
  next();
}

/**
 * 普通用户鉴权中间件：校验 Authorization: Bearer <用户token>
 * 校验通过后把 user 挂到 req.user
 */
function userAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  const token = authHeader.slice(7);
  const user = findUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
  req.user = user;
  next();
}

// ==================== 计分逻辑 ====================

/**
 * 计算四维度得分与类型代码
 * @param {number[]} answers 60 道题的原始分（1-5）
 * @param {Array} questions 题目数组
 * @returns {{scores: Object, typeCode: string}}
 */
function calculateScores(answers, questions) {
  // 四维度累加器
  const totals = {
    exploration: 0,
    anticipatory: 0,
    operational: 0,
    reference: 0
  };

  // 遍历 60 题，按计分方向累加到对应维度
  questions.forEach((q, idx) => {
    const raw = answers[idx];
    // 越界或非数字按中性值 3 处理（理论上前端已校验）
    const safeRaw = (typeof raw === 'number' && raw >= 1 && raw <= 5) ? raw : 3;
    const score = q.scoring === 'reverse' ? (6 - safeRaw) : safeRaw;
    totals[q.dimension] += score;
  });

  // 中点 45：>= 45 取第一极，否则取第二极
  const poleOf = (total) => total >= 45;

  const scores = {
    exploration: {
      total: totals.exploration,
      pole: poleOf(totals.exploration) ? 'O' : 'I' // O=外向探索 / I=内向反思
    },
    anticipatory: {
      total: totals.anticipatory,
      pole: poleOf(totals.anticipatory) ? 'C' : 'T' // C=规律预判 / T=人心揣摩
    },
    operational: {
      total: totals.operational,
      pole: poleOf(totals.operational) ? 'D' : 'M' // D=直接操作 / M=流程中介
    },
    reference: {
      total: totals.reference,
      pole: poleOf(totals.reference) ? 'S' : 'R' // S=自我参照 / R=关系参照
    }
  };

  // 组合四字母类型代码
  const typeCode =
    scores.exploration.pole +
    scores.anticipatory.pole +
    scores.operational.pole +
    scores.reference.pole;

  return { scores, typeCode };
}

/**
 * 根据类型代码查询类型名
 * @param {string} typeCode 四字母类型代码
 * @returns {string} 类型名（未匹配时返回 "未知类型"）
 */
function getTypeName(typeCode) {
  const types = getTypes();
  const t = types.find(item => item.code === typeCode);
  return t ? t.name : '未知类型';
}

// ==================== 飞书多维表格同步（可选） ====================

/**
 * 获取飞书 tenant_access_token；未配置凭证或失败时返回 null
 */
async function getLarkTenantToken() {
  const { LARK_APP_ID, LARK_APP_SECRET } = process.env;
  if (!LARK_APP_ID || !LARK_APP_SECRET) return null;
  const resp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET })
    }
  );
  const data = await resp.json();
  return data.tenant_access_token || null;
}

// 飞书凭证是否齐全
function larkConfigured() {
  const { LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_TOKEN, LARK_TABLE_ID } = process.env;
  return !!(LARK_APP_ID && LARK_APP_SECRET && LARK_BASE_TOKEN && LARK_TABLE_ID);
}

/**
 * 删除飞书表中的一条旧记录（用户重测覆盖时调用）
 * 失败仅记录日志，不影响主流程
 * @param {string} tenantToken
 * @param {string} recordId
 */
async function deleteLarkRecord(tenantToken, recordId) {
  const { LARK_BASE_TOKEN, LARK_TABLE_ID } = process.env;
  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${LARK_BASE_TOKEN}/tables/${LARK_TABLE_ID}/records/${recordId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${tenantToken}` }
      }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      console.warn('飞书同步：删除旧记录失败', data);
    }
  } catch (err) {
    console.error('飞书同步：删除旧记录异常:', err.message);
  }
}

/**
 * 将一条答卷新增到飞书多维表格
 * 仅在 LARK_* 凭证均配置时启用；失败仅记录日志，不影响主流程
 * @param {Object} response 已保存的答卷对象
 * @returns {string|null} 新建记录的 record_id（失败/未配置返回 null）
 */
async function syncToLark(response) {
  if (!larkConfigured()) return null;

  try {
    const tenantAccessToken = await getLarkTenantToken();
    if (!tenantAccessToken) {
      console.warn('飞书同步：获取 tenant_access_token 失败');
      return null;
    }

    const { LARK_BASE_TOKEN, LARK_TABLE_ID } = process.env;
    const fields = {
      '昵称': response.nickname,
      '年龄段': response.ageGroup || '',
      '性别': response.gender || '',
      '提交时间': response.timestamp,
      '探索方向得分': response.scores.exploration.total,
      '预判框架得分': response.scores.anticipatory.total,
      '操作方式得分': response.scores.operational.total,
      '参照框架得分': response.scores.reference.total,
      '类型代码': response.typeCode,
      '类型名': response.typeName,
      '答案': response.answers.join(',')
    };

    const recordResp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${LARK_BASE_TOKEN}/tables/${LARK_TABLE_ID}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tenantAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );
    const recordData = await recordResp.json();
    if (recordData.code !== 0) {
      console.warn('飞书同步：新增记录失败', recordData);
      return null;
    }
    console.log('飞书同步：新增记录成功', response.id);
    return recordData.data && recordData.data.record && recordData.data.record.record_id;
  } catch (err) {
    // 同步失败仅记录日志，不抛出
    console.error('飞书同步异常:', err.message);
    return null;
  }
}

// ==================== 中间件 ====================
app.use(cors());                       // 跨域支持
app.use(express.json());               // 解析 JSON 请求体
app.use(express.static(path.join(__dirname, 'public'))); // 静态文件服务

// ==================== 页面路由（简洁 URL） ====================
app.get('/survey', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey.html'));
});
app.get('/result', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'result.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== API 路由 ====================

/**
 * 1. 获取所有题目
 * GET /api/questions
 */
app.get('/api/questions', (req, res) => {
  const questions = getQuestions();
  if (!questions.length) {
    return res.status(500).json({ error: '题目数据未配置' });
  }
  res.json(questions);
});

/**
 * 2. 注册账号
 * POST /api/register
 * Body: { nickname, ageGroup, gender }
 * 返回: { token, user }
 * 昵称唯一，重复返回 409
 */
app.post('/api/register', (req, res) => {
  const { nickname, ageGroup, gender } = req.body || {};

  // 昵称校验：trim 后 1-20 字符
  const cleanName = typeof nickname === 'string' ? nickname.trim() : '';
  if (cleanName.length < NICKNAME_MIN || cleanName.length > NICKNAME_MAX) {
    return res.status(400).json({ error: `昵称长度需为 ${NICKNAME_MIN}-${NICKNAME_MAX} 个字符` });
  }
  if (!AGE_GROUPS.includes(ageGroup)) {
    return res.status(400).json({ error: '请选择年龄段' });
  }
  if (!GENDERS.includes(gender)) {
    return res.status(400).json({ error: '请选择性别' });
  }

  const users = getUsers();
  if (users.some(u => u.nickname === cleanName)) {
    return res.status(409).json({ error: '该昵称已被使用，请换一个昵称' });
  }

  const user = {
    nickname: cleanName,
    ageGroup,
    gender,
    token: generateUserToken(),
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);

  res.json({ token: user.token, user: publicUser(user) });
});

/**
 * 3. 登录（仅凭昵称，无密码）
 * POST /api/login
 * Body: { nickname }
 * 返回: { token, user, hasResult }
 */
app.post('/api/login', (req, res) => {
  const { nickname } = req.body || {};
  const cleanName = typeof nickname === 'string' ? nickname.trim() : '';
  if (!cleanName) {
    return res.status(400).json({ error: '请输入昵称' });
  }

  const users = getUsers();
  const user = users.find(u => u.nickname === cleanName);
  if (!user) {
    return res.status(404).json({ error: '未找到该昵称的账号，请先注册' });
  }

  // 重新签发 token（支持更换浏览器/设备登录）
  user.token = generateUserToken();
  saveUsers(users);

  const latest = findResponseByUserId(user.nickname);
  res.json({
    token: user.token,
    user: publicUser(user),
    hasResult: !!latest,
    resultId: latest ? latest.id : null
  });
});

/**
 * 4. 获取当前登录用户信息
 * GET /api/me （Bearer 用户 token）
 * 返回: { user, hasResult, resultId, resultBrief }
 */
app.get('/api/me', userAuthMiddleware, (req, res) => {
  const latest = findResponseByUserId(req.user.nickname);
  res.json({
    user: publicUser(req.user),
    hasResult: !!latest,
    resultId: latest ? latest.id : null,
    resultBrief: latest ? {
      id: latest.id,
      timestamp: latest.timestamp,
      typeCode: latest.typeCode,
      typeName: latest.typeName
    } : null
  });
});

/**
 * 5. 获取我的测评结果（最新一份，含类型详情）
 * GET /api/my/result （Bearer 用户 token）
 */
app.get('/api/my/result', userAuthMiddleware, (req, res) => {
  const response = findResponseByUserId(req.user.nickname);
  if (!response) {
    return res.status(404).json({ error: '你还没有测评记录' });
  }
  const types = getTypes();
  const typeInfo = types.find(t => t.code === response.typeCode) || null;
  res.json({ ...response, typeInfo });
});

/**
 * 6. 提交答卷（需登录；同一用户覆盖旧答卷）
 * POST /api/submit （Bearer 用户 token）
 * Body: { answers: number[60] (1-5) }
 * 返回: { id, typeCode, typeName }
 */
app.post('/api/submit', userAuthMiddleware, async (req, res) => {
  const { answers } = req.body || {};

  // 基础校验：answers 必须为 60 个 1-5 的数字
  if (!Array.isArray(answers) || answers.length !== 60) {
    return res.status(400).json({ error: '答案数量必须为 60 条' });
  }
  const invalid = answers.find(a => typeof a !== 'number' || a < 1 || a > 5);
  if (invalid !== undefined) {
    return res.status(400).json({ error: '每题答案必须是 1-5 的数字' });
  }

  const questions = getQuestions();
  if (!questions.length) {
    return res.status(500).json({ error: '题目数据未配置' });
  }

  // 计分并确定类型
  const { scores, typeCode } = calculateScores(answers, questions);
  const typeName = getTypeName(typeCode);

  // 生成唯一 id 与时间戳，答卷归属当前登录用户
  const id = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response = {
    id,
    timestamp: new Date().toISOString(),
    userId: req.user.nickname,
    nickname: req.user.nickname,
    ageGroup: req.user.ageGroup,
    gender: req.user.gender,
    answers,
    scores,
    typeCode,
    typeName
  };

  // 飞书同步：先删除该用户旧记录（若有 record_id），再新增
  if (larkConfigured()) {
    try {
      const oldResponse = findResponseByUserId(req.user.nickname);
      const tenantToken = await getLarkTenantToken();
      if (tenantToken && oldResponse && oldResponse.feishuRecordId) {
        await deleteLarkRecord(tenantToken, oldResponse.feishuRecordId);
      }
    } catch (err) {
      console.error('飞书同步：清理旧记录异常:', err.message);
    }
  }

  // 本地覆盖保存（旧答卷从统计中删除）
  replaceUserResponse(req.user.nickname, response);

  // 同步飞书新增记录并回写 record_id（失败不影响主流程）
  if (larkConfigured()) {
    const recordId = await syncToLark(response);
    if (recordId) {
      response.feishuRecordId = recordId;
      replaceUserResponse(req.user.nickname, response);
    }
  }

  // 返回结果摘要
  res.json({ id, typeCode, typeName });
});

/**
 * 3. 查询单条答卷结果
 * GET /api/result/:id
 */
app.get('/api/result/:id', (req, res) => {
  const response = findResponseById(req.params.id);
  if (!response) {
    return res.status(404).json({ error: '未找到该答卷' });
  }
  // 附带类型详情，避免前端维护重复数据
  const types = getTypes();
  const typeInfo = types.find(t => t.code === response.typeCode) || null;
  res.json({ ...response, typeInfo });
});

/**
 * 4. 管理员登录
 * POST /api/admin/login
 * Body: { password: string }
 * 返回: { token: string }
 */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin4d';
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: '密码错误' });
  }
  const token = generateToken();
  validTokens.add(token);
  res.json({ token });
});

/**
 * 5. 获取所有答卷（需鉴权）
 * GET /api/admin/responses
 */
app.get('/api/admin/responses', authMiddleware, (req, res) => {
  const responses = getResponses();
  res.json(responses);
});

/**
 * 6. 导出 Excel（需鉴权）
 * GET /api/admin/export
 * 返回 .xlsx 文件
 * 列：序号 / 提交时间 / 昵称 / 四维度得分 / 类型代码 / 类型名 / Q1-Q60
 */
app.get('/api/admin/export', authMiddleware, (req, res) => {
  const responses = getResponses();

  // 表头
  const header = [
    '序号', '提交时间', '昵称', '年龄段', '性别',
    '探索方向得分', '预判框架得分', '操作方式得分', '参照框架得分',
    '类型代码', '类型名'
  ];
  for (let i = 1; i <= 60; i++) header.push(`Q${i}`);

  // 数据行
  const rows = responses.map((r, idx) => {
    const row = [
      idx + 1,
      r.timestamp,
      r.nickname,
      r.ageGroup || '-',
      r.gender || '-',
      r.scores.exploration.total,
      r.scores.anticipatory.total,
      r.scores.operational.total,
      r.scores.reference.total,
      r.typeCode,
      r.typeName
    ];
    // 追加 Q1-Q60 答案
    for (let i = 0; i < 60; i++) row.push(r.answers[i] ?? '');
    return row;
  });

  // 构造工作表并写入工作簿
  const aoa = [header, ...rows];
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '答卷数据');

  // 导出为 Buffer 返回
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="4d-mcom-responses.xlsx"');
  res.send(buf);
});

// ==================== 启动初始化 ====================

// 确保 data 目录与数据文件存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(RESPONSES_FILE)) {
  writeJsonFile(RESPONSES_FILE, []);
}
if (!fs.existsSync(USERS_FILE)) {
  writeJsonFile(USERS_FILE, []);
}

// 一次性迁移：为历史答卷补 userId 归属
migrateResponses();

// 根路径路由：返回首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动 HTTP 服务
app.listen(PORT, () => {
  console.log(`4D-MCOM 服务器已启动：http://localhost:${PORT}`);
});

module.exports = app; // 便于测试或被其他模块引用
