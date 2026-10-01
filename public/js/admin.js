/**
 * 4D-MCOM 管理后台逻辑
 *
 * 功能：
 *  1. 密码登录 / Token 本地存储 / 自动登录
 *  2. 拉取全部答卷，展示统计摘要（总数、类型数、最近时间）
 *  3. 16 种类型分布条形图
 *  4. 类型筛选下拉与数据表格（序号/时间/昵称/四维度/类型/详情）
 *  5. 详情弹窗（含 60 道题逐题答案）
 *  6. 导出 Excel
 *  7. 退出登录、Token 过期处理
 */
(function () {
  'use strict';

  // ==================== 常量配置 ====================
  var TOKEN_KEY = '4d_mcom_admin_token'; // localStorage 键名

  // 16 种类型列表（代码 + 名称），用于筛选与分布图
  var TYPE_LIST = [
    { code: 'OCDS', name: '拓荒者' }, { code: 'OCDR', name: '守卫' },
    { code: 'OCMS', name: '工程师' }, { code: 'OCMR', name: '规划师' },
    { code: 'OTDS', name: '先锋' },   { code: 'OTDR', name: '外交官' },
    { code: 'OTMS', name: '导演' },   { code: 'OTMR', name: '协调人' },
    { code: 'ICDS', name: '修行者' }, { code: 'ICDR', name: '治疗师' },
    { code: 'ICMS', name: '理论家' }, { code: 'ICMR', name: '分析师' },
    { code: 'ITDS', name: '洞察者' }, { code: 'ITDR', name: '陪伴者' },
    { code: 'ITMS', name: '评论家' }, { code: 'ITMR', name: '史官' }
  ];

  // 类型代码 → 名称映射
  var TYPE_NAME_MAP = {};
  TYPE_LIST.forEach(function (t) { TYPE_NAME_MAP[t.code] = t.name; });

  // 四维度配置
  var DIMENSIONS = [
    { key: 'exploration',  label: '探索方向', poles: { O: '外向', I: '内向' } },
    { key: 'anticipatory', label: '预判框架', poles: { C: '因果', T: '目的' } },
    { key: 'operational',  label: '操作方式', poles: { D: '直接', M: '间接' } },
    { key: 'reference',    label: '参照框架', poles: { S: '自我', R: '关系' } }
  ];

  // 答案选项文本
  var ANSWER_LABELS = {
    1: '非常不同意', 2: '比较不同意', 3: '不确定', 4: '比较同意', 5: '非常同意'
  };

  // ==================== 状态变量 ====================
  var token = '';             // 管理员令牌
  var responses = [];         // 全部答卷
  var questions = [];         // 题目数组（按 ID 排序，用于详情弹窗）
  var currentFilter = '';     // 当前类型筛选值

  // DOM 简写
  function $(id) { return document.getElementById(id); }

  // ==================== 工具函数 ====================

  /**
   * HTML 特殊字符转义，防止 XSS
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 格式化 ISO 时间为可读字符串
   * @param {string} iso ISO 时间字符串
   * @returns {string} 如 "2026-09-22 16:25"
   */
  function formatTime(iso) {
    if (!iso) return '--';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) {
      return iso;
    }
  }

  /**
   * 显示 Toast 提示
   * @param {string} msg 提示文案
   * @param {number} duration 显示时长（毫秒）
   */
  function showToast(msg, duration) {
    var toast = $('adminToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, duration || 2000);
  }

  /**
   * 获取鉴权请求头
   * @returns {Object}
   */
  function authHeaders() {
    return { 'Authorization': 'Bearer ' + token };
  }

  // ==================== 登录 / 退出 ====================

  /**
   * 执行登录
   * @param {string} password 密码
   */
  async function login(password) {
    var loginBtn = $('loginBtn');
    var loginError = $('loginError');
    if (loginError) loginError.hidden = true;

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = '登录中...';
    }

    try {
      var res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      });
      var data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '登录失败');
      }
      // 存储 Token
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      // 切换到管理面板
      showAdminPanel();
      await loadAdminData();
    } catch (err) {
      console.error('登录失败:', err);
      if (loginError) {
        loginError.textContent = err.message || '密码错误，请重试';
        loginError.hidden = false;
      }
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
      }
    }
  }

  /**
   * 退出登录
   */
  function logout() {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    responses = [];
    $('adminPanel').hidden = true;
    $('loginSection').hidden = false;
    var pwdInput = $('adminPassword');
    if (pwdInput) pwdInput.value = '';
  }

  /**
   * 显示管理面板（隐藏登录区）
   */
  function showAdminPanel() {
    $('loginSection').hidden = true;
    $('adminPanel').hidden = false;
  }

  // ==================== 数据加载 ====================

  /**
   * 加载管理后台数据（答卷 + 题目）
   */
  async function loadAdminData() {
    try {
      // 并行拉取答卷与题目
      var [respResp, quesResp] = await Promise.all([
        fetch('/api/admin/responses', { headers: authHeaders() }),
        fetch('/api/questions')
      ]);

      // Token 过期处理
      if (respResp.status === 401) {
        logout();
        showToast('登录已过期，请重新登录');
        return;
      }
      if (!respResp.ok) {
        throw new Error('获取答卷失败（HTTP ' + respResp.status + '）');
      }
      responses = await respResp.json();

      // 题目加载失败不阻塞主流程（详情弹窗会降级显示）
      if (quesResp.ok) {
        var quesData = await quesResp.json();
        questions = Array.isArray(quesData)
          ? quesData.slice().sort(function (a, b) { return a.id - b.id; })
          : [];
      }
    } catch (err) {
      console.error('加载数据失败:', err);
      showToast('加载数据失败：' + err.message);
    }

    renderStats();
    renderTypeDistribution();
    populateTypeFilter();
    renderTable();
  }

  // ==================== 统计摘要 ====================

  /**
   * 渲染统计卡片
   */
  function renderStats() {
    // 总测评数
    $('totalCount').textContent = responses.length;

    // 已采集类型数
    var typeSet = {};
    responses.forEach(function (r) {
      if (r.typeCode) typeSet[r.typeCode] = true;
    });
    $('typeCount').textContent = Object.keys(typeSet).length;

    // 最近提交时间
    var latest = '';
    if (responses.length > 0) {
      var latestMs = 0;
      responses.forEach(function (r) {
        var t = new Date(r.timestamp).getTime();
        if (!isNaN(t) && t > latestMs) latestMs = t;
      });
      latest = latestMs > 0 ? formatTime(new Date(latestMs).toISOString()) : '--';
    } else {
      latest = '--';
    }
    $('latestTime').textContent = latest;
  }

  // ==================== 类型分布 ====================

  /**
   * 渲染 16 种类型的分布条形图
   */
  function renderTypeDistribution() {
    var container = $('typeBars');
    if (!container) return;
    container.innerHTML = '';

    // 统计各类型数量
    var counts = {};
    TYPE_LIST.forEach(function (t) { counts[t.code] = 0; });
    responses.forEach(function (r) {
      if (r.typeCode && r.typeCode in counts) {
        counts[r.typeCode]++;
      }
    });

    // 最大值用于计算条形宽度比例
    var maxCount = 1;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > maxCount) maxCount = counts[k];
    });

    // 按数量降序排列
    var sorted = TYPE_LIST.slice().sort(function (a, b) {
      return counts[b.code] - counts[a.code];
    });

    sorted.forEach(function (t) {
      var count = counts[t.code] || 0;
      var pct = Math.round(count / maxCount * 100);

      var item = document.createElement('div');
      item.className = 'type-bar-item';

      var label = document.createElement('span');
      label.className = 'type-bar-label';
      label.textContent = t.code + ' ' + t.name;

      var track = document.createElement('div');
      track.className = 'type-bar-track';

      var fill = document.createElement('div');
      fill.className = 'type-bar-fill';
      fill.style.width = (count > 0 ? pct : 0) + '%';

      track.appendChild(fill);

      var countEl = document.createElement('span');
      countEl.className = 'type-bar-count';
      countEl.textContent = count;

      item.appendChild(label);
      item.appendChild(track);
      item.appendChild(countEl);
      container.appendChild(item);
    });
  }

  // ==================== 类型筛选 ====================

  /**
   * 填充类型筛选下拉框
   */
  function populateTypeFilter() {
    var select = $('typeFilter');
    if (!select) return;

    // 保留"全部类型"选项，清除旧选项
    select.innerHTML = '<option value="">全部类型</option>';
    TYPE_LIST.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.code;
      opt.textContent = t.code + ' · ' + t.name;
      select.appendChild(opt);
    });
  }

  // ==================== 数据表格 ====================

  /**
   * 根据筛选渲染表格行
   */
  function renderTable() {
    var tbody = $('dataTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // 筛选
    var filtered = currentFilter
      ? responses.filter(function (r) { return r.typeCode === currentFilter; })
      : responses;

    // 更新筛选计数
    var filterCountEl = $('filterCount');
    if (filterCountEl) filterCountEl.textContent = filtered.length;

    // 空数据
    if (filtered.length === 0) {
      var emptyRow = document.createElement('tr');
      emptyRow.className = 'empty-row';
      emptyRow.innerHTML = '<td colspan="11">' +
        '<div class="empty-state"><div class="empty-icon" aria-hidden="true">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"></path><path d="M3 9h18M9 21V9"></path></svg>' +
        '</div><p>暂无数据</p></div></td>';
      tbody.appendChild(emptyRow);
      return;
    }

    // 渲染每一行
    filtered.forEach(function (r, idx) {
      var tr = document.createElement('tr');

      // 序号
      tr.appendChild(createCell('' + (idx + 1), 'col-index'));
      // 提交时间
      tr.appendChild(createCell(formatTime(r.timestamp), 'col-time'));
      // 昵称
      tr.appendChild(createCell(escapeHtml(r.nickname || '匿名用户'), 'col-nick'));
      // 年龄段 / 性别（历史数据可能缺失）
      tr.appendChild(createCell(escapeHtml(r.ageGroup || '-'), 'col-demo'));
      tr.appendChild(createCell(escapeHtml(r.gender || '-'), 'col-demo'));

      // 四维度：极性 + 得分
      var scores = r.scores || {};
      DIMENSIONS.forEach(function (dim) {
        var ds = scores[dim.key] || {};
        var text = (ds.pole || '-') + ' ' + (ds.total != null ? ds.total : '-');
        tr.appendChild(createCell(text, 'col-dim'));
      });

      // 类型代码 + 名称
      var typeText = (r.typeCode || '--') + ' ' + (r.typeName || TYPE_NAME_MAP[r.typeCode] || '');
      tr.appendChild(createCell(escapeHtml(typeText), 'col-type'));

      // 操作列：查看详情按钮
      var actionTd = document.createElement('td');
      actionTd.className = 'col-action';
      var detailBtn = document.createElement('button');
      detailBtn.type = 'button';
      detailBtn.className = 'btn btn-ghost btn-sm';
      detailBtn.textContent = '查看详情';
      detailBtn.addEventListener('click', function () {
        openDetailModal(r);
      });
      actionTd.appendChild(detailBtn);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });
  }

  /**
   * 创建表格单元格
   * @param {string} html 单元格内容（HTML 字符串）
   * @param {string} cls 附加类名
   * @returns {HTMLTableCellElement}
   */
  function createCell(html, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.innerHTML = html;
    return td;
  }

  // ==================== 详情弹窗 ====================

  /**
   * 打开详情弹窗，渲染完整答卷内容
   * @param {Object} resp 单条答卷数据
   */
  function openDetailModal(resp) {
    var modal = $('detailModal');
    var body = $('modalBody');
    if (!modal || !body) return;

    var scores = resp.scores || {};
    var answers = resp.answers || [];

    var html = '';

    // 基本信息
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">基本信息</h4>';
    html += '<div class="detail-info-grid">';
    html += '<div class="detail-info-item"><span class="detail-label">昵称</span><span class="detail-value">' + escapeHtml(resp.nickname || '匿名用户') + '</span></div>';
    html += '<div class="detail-info-item"><span class="detail-label">年龄段</span><span class="detail-value">' + escapeHtml(resp.ageGroup || '-') + '</span></div>';
    html += '<div class="detail-info-item"><span class="detail-label">性别</span><span class="detail-value">' + escapeHtml(resp.gender || '-') + '</span></div>';
    html += '<div class="detail-info-item"><span class="detail-label">提交时间</span><span class="detail-value">' + escapeHtml(formatTime(resp.timestamp)) + '</span></div>';
    html += '<div class="detail-info-item"><span class="detail-label">类型代码</span><span class="detail-value">' + escapeHtml(resp.typeCode || '--') + '</span></div>';
    html += '<div class="detail-info-item"><span class="detail-label">类型名称</span><span class="detail-value">' + escapeHtml(resp.typeName || TYPE_NAME_MAP[resp.typeCode] || '--') + '</span></div>';
    html += '</div></div>';

    // 四维度得分
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">维度得分</h4>';
    html += '<div class="detail-dim-list">';
    DIMENSIONS.forEach(function (dim) {
      var ds = scores[dim.key] || {};
      var poleText = dim.poles[ds.pole] || '--';
      html += '<div class="detail-dim-item">';
      html += '<span class="detail-dim-name">' + dim.label + '</span>';
      html += '<span class="detail-dim-pole">' + (ds.pole || '-') + ' ' + escapeHtml(poleText) + '</span>';
      html += '<span class="detail-dim-score">' + (ds.total != null ? ds.total : '-') + ' / 75</span>';
      html += '</div>';
    });
    html += '</div></div>';

    // 逐题答案
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">逐题答案（共 ' + answers.length + ' 题）</h4>';
    html += '<div class="detail-answers">';
    for (var i = 0; i < answers.length; i++) {
      var q = questions[i]; // questions 已按 ID 排序，索引 i 对应题目 ID = i+1
      var qText = q ? q.text : ('第 ' + (i + 1) + ' 题');
      var dimLabel = q ? (DIMENSIONS.find(function (d) { return d.key === q.dimension; }) || {}).label || q.dimension : '';
      var ansVal = answers[i];
      var ansLabel = ANSWER_LABELS[ansVal] || '--';

      html += '<div class="detail-answer-item">';
      html += '<span class="detail-answer-num">' + (i + 1) + '</span>';
      html += '<div class="detail-answer-content">';
      html += '<div class="detail-answer-text">' + escapeHtml(qText) + '</div>';
      html += '<div class="detail-answer-meta"><span class="detail-answer-dim">' + escapeHtml(dimLabel) + '</span><span class="detail-answer-value">' + ansVal + ' · ' + escapeHtml(ansLabel) + '</span></div>';
      html += '</div></div>';
    }
    html += '</div></div>';

    body.innerHTML = html;
    modal.hidden = false;
  }

  /**
   * 关闭详情弹窗
   */
  function closeDetailModal() {
    var modal = $('detailModal');
    if (modal) modal.hidden = true;
  }

  // ==================== 导出 Excel ====================

  /**
   * 导出全部数据为 Excel 文件
   */
  async function exportExcel() {
    var exportBtn = $('exportBtn');
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = '导出中...';
    }

    try {
      var res = await fetch('/api/admin/export', { headers: authHeaders() });

      if (res.status === 401) {
        logout();
        showToast('登录已过期，请重新登录');
        return;
      }
      if (!res.ok) {
        throw new Error('导出失败（HTTP ' + res.status + '）');
      }

      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '4d-mcom-responses.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('导出成功');
    } catch (err) {
      console.error('导出失败:', err);
      showToast('导出失败：' + err.message);
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.textContent = '导出Excel';
      }
    }
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 登录表单提交
    var loginForm = $('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var pwd = $('adminPassword');
        if (pwd && pwd.value) {
          login(pwd.value);
        }
      });
    }

    // 退出登录
    var logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    // 导出按钮
    var exportBtn = $('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportExcel);
    }

    // 类型筛选
    var typeFilter = $('typeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', function () {
        currentFilter = this.value;
        renderTable();
      });
    }

    // 弹窗关闭：点击遮罩或关闭按钮
    var modal = $('detailModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-action') &&
            e.target.getAttribute('data-action') === 'close-modal') {
          closeDetailModal();
        }
      });
    }

    // ESC 键关闭弹窗
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = $('detailModal');
        if (m && !m.hidden) closeDetailModal();
      }
    });
  }

  // ==================== 初始化 ====================

  async function init() {
    bindEvents();

    // 尝试从 localStorage 恢复 Token，自动登录
    var savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      token = savedToken;
      // 验证 Token 是否有效
      try {
        var res = await fetch('/api/admin/responses', { headers: authHeaders() });
        if (res.ok) {
          showAdminPanel();
          await loadAdminData();
          return;
        }
      } catch (e) {
        // 网络异常，继续显示登录页
      }
      // Token 无效，清除
      token = '';
      localStorage.removeItem(TOKEN_KEY);
    }

    // 显示登录页
    $('loginSection').hidden = false;
    $('adminPanel').hidden = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
