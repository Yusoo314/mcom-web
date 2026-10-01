/**
 * 4D-MCOM 结果页逻辑
 *
 * 流程：
 *  1. 从 URL 参数获取答卷 id
 *  2. 请求 /api/result/<id> 获取答卷数据（含 typeInfo 类型详情）
 *  3. 渲染类型画像（图片、代码、名称、一句话描述）
 *  4. 渲染四维度得分条与标记
 *  5. 渲染特质、优势、注意点、职业方向、成长建议
 *  6. 分享按钮复制链接到剪贴板；重新测评跳转问卷页
 *
 * 注意：所有类型解析文本均来自服务端 data/types.json，修改文案只需编辑该文件。
 */
(function () {
  'use strict';

  // 四维度配置：键 → 中文标签与两极
  var DIMENSIONS = [
    { key: 'exploration',  label: '探索方向', poles: { O: '外向', I: '内向' } },
    { key: 'anticipatory', label: '预判框架', poles: { C: '因果', T: '目的' } },
    { key: 'operational',  label: '操作方式', poles: { D: '直接', M: '间接' } },
    { key: 'reference',    label: '参照框架', poles: { S: '自我', R: '关系' } }
  ];

  // DOM 简写
  function $(id) { return document.getElementById(id); }

  // ==================== 工具函数 ====================

  /**
   * 从 URL 查询参数中获取 id
   * @returns {string|null}
   */
  function getIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  /**
   * 转义 HTML 特殊字符，防止 XSS
   * @param {string} str
   * @returns {string}
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
   * 显示错误信息
   * @param {string} msg 错误文案
   */
  function showError(msg) {
    var loading = $('resultLoading');
    if (loading) {
      loading.innerHTML = '<p style="color:#e74c3c;">' + escapeHtml(msg) + '</p>';
    }
  }

  // ==================== 渲染逻辑 ====================

  /**
   * 渲染类型头部（图片、代码、名称、一句话描述）
   * @param {Object} data 答卷数据
   */
  function renderTypeHeader(data) {
    var typeInfo = data.typeInfo || {};

    // 类型图片
    var imgEl = $('typeImage');
    if (imgEl && typeInfo.image) {
      imgEl.src = '/images/types/' + encodeURIComponent(typeInfo.image);
      imgEl.alt = data.typeCode + ' ' + (typeInfo.name || data.typeName);
    }

    // 类型代码、名称、一句话描述
    $('typeCode').textContent = data.typeCode || '----';
    $('typeName').textContent = typeInfo.name || data.typeName || '类型名称';
    $('typeTagline').textContent = typeInfo.coreFeature || '';
  }

  /**
   * 渲染四维度得分条
   * 视觉规则：轨道中点（50%）= 分界分 45；分数越极端，标记离中点越远，
   * 填充条从中点向「实际倾向的一侧」延伸。
   *   左极（O/C/D/S，高分 45→75）：标记在中点左侧，50%→0%，紫色
   *   右极（I/T/M/R，低分 45→15）：标记在中点右侧，50%→100%，薄荷绿
   * 极性以后端判定的 pole 字段为准，前端不再自行推断。
   * @param {Object} scores 后端返回的 scores 对象
   */
  function renderDimensions(scores) {
    var LEFT_POLES = { O: 1, C: 1, D: 1, S: 1 };
    var NEUTRAL = 45; // 维度分界分
    var HALF_RANGE = 30; // 分界分到极端分的距离（75-45 或 45-15）

    DIMENSIONS.forEach(function (dim, idx) {
      var num = idx + 1;
      var dimScore = scores[dim.key] || {};
      var total = dimScore.total;
      var pole = dimScore.pole;

      // 极性以后端返回为准；标记位置以中点 50% 为锚，向倾向一侧展开
      var isLeft = !!LEFT_POLES[pole];
      var pos;
      if (isLeft) {
        // 45 分→50%（中点），75 分→0%（最左）
        pos = 50 - Math.min(HALF_RANGE, Math.max(0, total - NEUTRAL)) / HALF_RANGE * 50;
      } else {
        // 45 分→50%（中点），15 分→100%（最右）
        pos = 50 + Math.min(HALF_RANGE, Math.max(0, NEUTRAL - total)) / HALF_RANGE * 50;
      }
      pos = Math.round(pos);

      var item = document.querySelector('.score-bar-item[data-dimension="' + num + '"]');
      if (item) {
        item.classList.toggle('polar-left', isLeft);
        item.classList.toggle('polar-right', !isLeft);
      }

      // 填充条：从倾向侧标记处延伸至中点
      var bar = $('dim' + num + 'Bar');
      if (bar) {
        bar.classList.remove('fill-left', 'fill-right');
        bar.classList.add(isLeft ? 'fill-left' : 'fill-right');
        if (isLeft) {
          bar.style.left = pos + '%';
          bar.style.width = (50 - pos) + '%';
        } else {
          bar.style.left = '50%';
          bar.style.width = (pos - 50) + '%';
        }
      }

      // 标记位置：倾向强度处
      var marker = $('dim' + num + 'Marker');
      if (marker) {
        marker.classList.toggle('marker-left', isLeft);
        marker.classList.toggle('marker-right', !isLeft);
        marker.style.left = pos + '%';
      }

      // 极性结果文字：如 "I 内向"
      var resultEl = $('dim' + num + 'Result');
      if (resultEl) {
        var poleText = dim.poles[pole] || '';
        resultEl.textContent = (pole || '') + ' ' + poleText;
      }

      // 得分数值：原始维度总分（范围 15-75，45 为分界）
      var scoreEl = $('dim' + num + 'Score');
      if (scoreEl) {
        scoreEl.textContent = total;
      }

      // 高亮实际倾向一侧的极标签
      var poleLeftEl = item ? item.querySelector('.score-pole-left') : null;
      var poleRightEl = item ? item.querySelector('.score-pole-right') : null;
      if (poleLeftEl) poleLeftEl.classList.toggle('is-active', isLeft);
      if (poleRightEl) poleRightEl.classList.toggle('is-active', !isLeft);
    });
  }

  /**
   * 渲染核心特质段落
   * @param {Object} typeInfo 类型数据
   */
  function renderTraits(typeInfo) {
    var grid = $('traitsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    if (typeInfo.traits) {
      var card = document.createElement('div');
      card.className = 'trait-card trait-card-full';
      card.textContent = typeInfo.traits;
      grid.appendChild(card);
    }
  }

  /**
   * 渲染列表型内容（优势 / 注意点 / 建议）
   * @param {string} listId 列表元素 ID
   * @param {Array} items 文本数组
   * @param {string} itemClass 列表项附加类名
   */
  function renderList(listId, items, itemClass) {
    var list = $(listId);
    if (!list) return;
    list.innerHTML = '';
    if (!items || items.length === 0) return;
    items.forEach(function (text) {
      var li = document.createElement('li');
      if (itemClass) li.className = itemClass;
      li.textContent = text;
      list.appendChild(li);
    });
  }

  /**
   * 渲染职业标签
   * @param {Array} careers 职业数组
   */
  function renderCareers(careers) {
    var container = $('careerTags');
    if (!container) return;
    container.innerHTML = '';
    if (!careers || careers.length === 0) return;
    careers.forEach(function (name) {
      var tag = document.createElement('span');
      tag.className = 'career-tag';
      tag.textContent = name;
      container.appendChild(tag);
    });
  }

  /**
   * 渲染完整结果页
   * @param {Object} data 答卷数据
   */
  function renderResult(data) {
    var typeInfo = data.typeInfo || {};

    renderTypeHeader(data);
    renderDimensions(data.scores || {});
    renderTraits(typeInfo);
    renderList('advantagesList', typeInfo.advantages, 'advantage-item');
    renderList('cautionsList', typeInfo.cautions, 'caution-item');
    renderCareers(typeInfo.careers);
    renderList('suggestionsList', typeInfo.suggestions, 'suggestion-item');

    // 隐藏加载态，显示内容
    $('resultLoading').hidden = true;
    $('resultContent').hidden = false;
  }

  // ==================== 分享与重新测评 ====================

  /**
   * 分享：复制当前 URL 到剪贴板并显示提示
   */
  async function shareResult() {
    var url = window.location.href;
    var toast = $('shareToast');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // 兼容降级方案
        var textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      if (toast) {
        toast.textContent = '链接已复制到剪贴板';
        toast.classList.add('show');
        setTimeout(function () {
          toast.classList.remove('show');
        }, 2000);
      }
    } catch (err) {
      console.error('复制链接失败:', err);
      if (toast) {
        toast.textContent = '复制失败，请手动复制链接';
        toast.classList.add('show');
        setTimeout(function () {
          toast.classList.remove('show');
        }, 2000);
      }
    }
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 分享按钮
    var shareBtn = $('shareBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', shareResult);
    }

    // 重新测评按钮（HTML 已为 <a href="/survey">，此处补绑确保跳转）
    var retakeBtn = $('retakeBtn');
    if (retakeBtn) {
      retakeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = '/survey';
      });
    }
  }

  // ==================== 初始化 ====================

  async function init() {
    bindEvents();

    var id = getIdFromUrl();
    if (!id) {
      showError('缺少答卷 ID，请从测评完成后跳转查看。');
      return;
    }

    try {
      var res = await fetch('/api/result/' + encodeURIComponent(id));
      if (!res.ok) {
        var errData = await res.json().catch(function () { return {}; });
        throw new Error(errData.error || '获取结果失败（HTTP ' + res.status + '）');
      }
      var data = await res.json();
      renderResult(data);
    } catch (err) {
      console.error('加载结果失败:', err);
      showError('加载结果失败：' + err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
