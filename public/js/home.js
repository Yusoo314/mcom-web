/**
 * 4D-MCOM 首页逻辑
 * - 设置页脚当前年份
 * - 锚点平滑滚动 / 维度卡片悬停
 * - 登录态渲染：
 *    未登录 → "开始测评"跳转注册
 *    已登录无结果 → "开始测评"
 *    已登录有结果 → "查看我的结果" + "重新测评"（覆盖确认弹窗）
 * - 导航用户菜单（我的结果 / 退出登录）
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ==================== 页脚年份 ====================
  var footerYear = $('footerYear');
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  // ==================== 锚点平滑滚动 ====================
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId && targetId.length > 1) {
        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // ==================== 维度卡片悬停 ====================
  document.querySelectorAll('[data-dimension]').forEach(function (card) {
    card.addEventListener('mouseenter', function () { this.classList.add('is-hover'); });
    card.addEventListener('mouseleave', function () { this.classList.remove('is-hover'); });
    card.addEventListener('focus', function () { this.classList.add('is-hover'); });
    card.addEventListener('blur', function () { this.classList.remove('is-hover'); });
  });

  // ==================== 登录态 ====================

  var meData = null;

  function renderLoggedIn(data) {
    meData = data;
    var u = data.user || {};

    // 导航用户菜单
    $('userMenu').hidden = false;
    $('userChipName').textContent = u.nickname || '';

    var hasResult = data.hasResult && data.resultId;
    var resultUrl = hasResult ? '/result?id=' + data.resultId : '#';
    $('navMyResult').href = resultUrl;
    $('heroMyResult').href = resultUrl;

    var startBtn = $('startSurveyBtn');
    var ctaBtn = $('ctaStartBtn');

    if (hasResult) {
      // 有结果：主行动是查看结果，开始按钮降级为"重新测评"（描边样式）
      $('heroMyResult').hidden = false;
      $('startSurveyText').textContent = '重新测评';
      startBtn.classList.remove('btn-primary');
      startBtn.classList.add('btn-ghost');
      ctaBtn.textContent = '重新测评';
    } else {
      $('heroMyResult').hidden = true;
      $('startSurveyText').textContent = '开始测评';
      startBtn.classList.add('btn-primary');
      startBtn.classList.remove('btn-ghost');
      ctaBtn.textContent = '立即开始';
    }
  }

  function renderLoggedOut() {
    meData = null;
    $('userMenu').hidden = true;
    $('heroMyResult').hidden = true;
    $('startSurveyText').textContent = '开始测评';
    var startBtn = $('startSurveyBtn');
    startBtn.classList.add('btn-primary');
    startBtn.classList.remove('btn-ghost');
    $('ctaStartBtn').textContent = '立即开始';
  }

  // ==================== 重新测评确认弹窗 ====================

  function openRetakeConfirm(e) {
    // 仅登录且有结果时拦截
    if (meData && meData.hasResult) {
      e.preventDefault();
      $('retakeConfirm').hidden = false;
    }
    // 其余情况保持默认跳转 /survey
  }

  function closeRetakeConfirm() {
    $('retakeConfirm').hidden = true;
  }

  // ==================== 用户下拉菜单 ====================

  function initUserMenu() {
    var chip = $('userChip');
    var dropdown = $('userDropdown');
    if (!chip || !dropdown) return;

    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.hidden && !dropdown.contains(e.target)) {
        dropdown.hidden = true;
      }
    });

    $('navLogout').addEventListener('click', function () {
      window.Auth.clearToken();
      dropdown.hidden = true;
      renderLoggedOut();
    });

    $('navMyResult').addEventListener('click', function (e) {
      if (!(meData && meData.hasResult)) e.preventDefault();
    });
  }

  // ==================== 启动 ====================

  function init() {
    initUserMenu();

    $('startSurveyBtn').addEventListener('click', openRetakeConfirm);
    $('ctaStartBtn').addEventListener('click', openRetakeConfirm);

    $('retakeCancel').addEventListener('click', closeRetakeConfirm);
    $('retakeConfirmBtn').addEventListener('click', function () {
      window.location.href = '/survey?retake=1';
    });
    document.querySelector('#retakeConfirm .confirm-mask').addEventListener('click', closeRetakeConfirm);

    // 检查登录态
    if (window.Auth.isLoggedIn()) {
      window.Auth.getMe().then(function (data) {
        if (data) renderLoggedIn(data);
        else renderLoggedOut();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
