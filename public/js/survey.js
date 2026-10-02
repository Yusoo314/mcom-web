/**
 * 4D-MCOM 问卷页逻辑
 *
 * 流程：
 *  1. 页面加载后获取 /api/questions 并洗牌（每次打开题目随机顺序）
 *  2. 根据登录令牌分流：
 *     - 未登录 → 认证页（注册 / 登录表单切换）
 *     - 已登录 → 欢迎页（展示账号信息与上次结果入口）
 *  3. 已有结果的用户点"重新测评"时弹窗二次确认（覆盖旧记录提示）
 *  4. 答题页逐题作答 → 完成页 → 带令牌提交，成功跳转结果页
 */
(function () {
  'use strict';

  // ==================== 常量配置 ====================
  var TOTAL_QUESTIONS = 60;        // 题目总数
  var ADVANCE_DELAY = 300;         // 选中答案后自动翻页延迟（毫秒）

  // ==================== 状态变量 ====================
  var questions = [];            // 洗牌后的题目数组（呈现顺序）
  var answersByQuestionId = {};  // 以题目原始 ID 为键的答案映射 {1..60: 1..5}
  var currentIndex = 0;          // 当前题目在洗牌数组中的索引
  var startTime = null;          // 答题开始时间戳
  var meData = null;             // 当前登录用户信息（/api/me 返回）
  var regGender = '';            // 注册表单当前选择的性别

  // ==================== DOM 简写 ====================
  function $(id) { return document.getElementById(id); }

  // ==================== 工具函数 ====================

  /**
   * Fisher-Yates 洗牌算法（返回新数组，不改原数组）
   */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /**
   * 切换屏幕显示
   * @param {string} screenName 屏幕标识: auth / welcome / question / complete
   */
  function showScreen(screenName) {
    document.querySelectorAll('[data-screen]').forEach(function (screen) {
      screen.classList.remove('active');
    });
    var target = document.querySelector('[data-screen="' + screenName + '"]');
    if (target) target.classList.add('active');

    // 顶部题号与进度条仅在答题页/完成页显示
    var showProgress = screenName === 'question' || screenName === 'complete';
    var progressInfo = $('surveyProgressInfo');
    var progressBarWrap = $('progressBarWrap');
    if (progressInfo) progressInfo.hidden = !showProgress;
    if (progressBarWrap) progressBarWrap.hidden = !showProgress;
  }

  /**
   * 切换注册/登录表单
   * @param {string} which register / login
   */
  function switchAuthForm(which) {
    var reg = $('registerForm');
    var login = $('loginForm');
    if (which === 'login') {
      reg.classList.remove('active');
      login.classList.add('active');
    } else {
      login.classList.remove('active');
      reg.classList.add('active');
    }
    hideError('registerError');
    hideError('loginError');
  }

  function showError(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideError(id) {
    var el = $(id);
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  function setBtnLoading(btn, loading, normalText) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? '请稍候...' : normalText;
  }

  // ==================== 题目加载 ====================

  async function initQuestions() {
    try {
      var res = await fetch('/api/questions');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('题目数据为空');
      }
      questions = shuffle(data);
      questions.forEach(function (q) {
        if (!(q.id in answersByQuestionId)) answersByQuestionId[q.id] = null;
      });
    } catch (err) {
      console.error('初始化题目失败:', err);
      var textEl = $('questionText');
      if (textEl) textEl.textContent = '题目加载失败，请刷新页面重试。';
    }
  }

  // ==================== 认证页 ====================

  // 填充年龄段下拉
  function initAgeOptions() {
    var sel = $('regAgeGroup');
    if (!sel) return;
    window.Auth.AGE_GROUPS.forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      sel.appendChild(opt);
    });
  }

  // 注册提交
  async function handleRegister(e) {
    e.preventDefault();
    var nickname = $('regNickname').value.trim();
    var ageGroup = $('regAgeGroup').value;
    var btn = $('registerBtn');

    if (!nickname) return showError('registerError', '请输入昵称');
    if (!ageGroup) return showError('registerError', '请选择年龄段');
    if (!regGender) return showError('registerError', '请选择性别');

    setBtnLoading(btn, true);
    var result = await window.Auth.register(nickname, ageGroup, regGender);
    setBtnLoading(btn, false, '注册并开始');

    if (result.ok) {
      enterWelcome(await refreshMe());
    } else {
      showError('registerError', result.data.error || '注册失败，请重试');
    }
  }

  // 登录提交
  async function handleLogin(e) {
    e.preventDefault();
    var nickname = $('loginNickname').value.trim();
    var btn = $('loginBtn');
    if (!nickname) return showError('loginError', '请输入昵称');

    setBtnLoading(btn, true);
    var result = await window.Auth.login(nickname);
    setBtnLoading(btn, false, '登录');

    if (result.ok) {
      enterWelcome(await refreshMe());
    } else if (result.status === 404) {
      showError('loginError', result.data.error || '未找到该账号');
    } else {
      showError('loginError', result.data.error || '登录失败，请重试');
    }
  }

  // 拉取最新的 /api/me
  function refreshMe() {
    return window.Auth.getMe(true);
  }

  // ==================== 欢迎页 ====================

  function enterWelcome(data) {
    meData = data;
    if (!data) {
      // 令牌失效等异常情况：回到认证页
      showScreen('auth');
      switchAuthForm('register');
      return;
    }

    var u = data.user || {};
    $('welcomeTitle').textContent = '你好，' + u.nickname;
    $('welcomeMeta').textContent = (u.ageGroup || '') + (u.gender ? ' · ' + u.gender : '');

    var box = $('lastResultBox');
    var startBtn = $('welcomeStartBtn');
    if (data.hasResult && data.resultBrief) {
      box.hidden = false;
      $('lastType').textContent = (data.resultBrief.typeCode || '') + ' ' + (data.resultBrief.typeName || '');
      $('viewLastResultBtn').href = '/result?id=' + data.resultBrief.id;
      startBtn.textContent = '重新测评';
    } else {
      box.hidden = true;
      startBtn.textContent = '开始答题';
    }
    showScreen('welcome');
  }

  // 点击欢迎页"开始答题 / 重新测评"
  function handleWelcomeStart() {
    if (meData && meData.hasResult) {
      $('retakeConfirm').hidden = false; // 已有结果 → 二次确认
    } else {
      startQuestions();
    }
  }

  function closeRetakeConfirm() {
    $('retakeConfirm').hidden = true;
  }

  function startQuestions() {
    startTime = Date.now();
    showScreen('question');
    renderQuestion();
  }

  // 退出登录
  function handleLogout() {
    window.Auth.clearToken();
    meData = null;
    regGender = '';
    $('regNickname').value = '';
    $('regAgeGroup').value = '';
    document.querySelectorAll('#regGender .gender-option').forEach(function (b) {
      b.classList.remove('is-selected');
    });
    $('loginNickname').value = '';
    switchAuthForm('register');
    showScreen('auth');
  }

  // ==================== 题目渲染 ====================

  function renderQuestion() {
    var q = questions[currentIndex];
    if (!q) return;

    $('currentQuestion').textContent = currentIndex + 1;
    $('progressBar').style.width = (currentIndex / TOTAL_QUESTIONS * 100) + '%';

    $('questionText').textContent = q.text;

    document.querySelectorAll('.answer-option').forEach(function (btn) {
      btn.classList.remove('is-selected');
    });

    var existing = answersByQuestionId[q.id];
    if (existing !== null && existing !== undefined) {
      var selected = document.querySelector('.answer-option[data-value="' + existing + '"]');
      if (selected) selected.classList.add('is-selected');
      $('nextQuestionBtn').disabled = false;
    } else {
      $('nextQuestionBtn').disabled = true;
    }

    $('prevQuestionBtn').disabled = currentIndex === 0;
  }

  // ==================== 答题逻辑 ====================

  function selectAnswer(value) {
    var q = questions[currentIndex];
    if (!q) return;

    var numValue = Number(value);

    document.querySelectorAll('.answer-option').forEach(function (btn) {
      btn.classList.remove('is-selected');
    });
    var selectedBtn = document.querySelector('.answer-option[data-value="' + numValue + '"]');
    if (selectedBtn) selectedBtn.classList.add('is-selected');

    answersByQuestionId[q.id] = numValue;
    $('nextQuestionBtn').disabled = false;

    setTimeout(function () {
      advance();
    }, ADVANCE_DELAY);
  }

  function advance() {
    var q = questions[currentIndex];
    if (!q || answersByQuestionId[q.id] === null || answersByQuestionId[q.id] === undefined) {
      return;
    }

    if (currentIndex === TOTAL_QUESTIONS - 1) {
      showComplete();
      return;
    }
    currentIndex++;
    renderQuestion();
  }

  function prevQuestion() {
    if (currentIndex === 0) return;
    currentIndex--;
    renderQuestion();
  }

  // ==================== 完成页 ====================

  function showComplete() {
    $('progressBar').style.width = '100%';
    if ($('answeredCount')) $('answeredCount').textContent = TOTAL_QUESTIONS;
    if ($('timeUsed') && startTime) {
      var seconds = Math.floor((Date.now() - startTime) / 1000);
      $('timeUsed').textContent = Math.floor(seconds / 60) + '分' + (seconds % 60) + '秒';
    }
    showScreen('complete');
  }

  // ==================== 提交答卷 ====================

  async function submitSurvey() {
    var submitBtn = $('submitSurveyBtn');
    setBtnLoading(submitBtn, true);

    try {
      var orderedAnswers = [];
      for (var i = 1; i <= TOTAL_QUESTIONS; i++) {
        var ans = answersByQuestionId[i];
        if (ans === null || ans === undefined) {
          throw new Error('第 ' + i + ' 题未作答');
        }
        orderedAnswers.push(ans);
      }

      var result = await window.Auth.submitAnswers(orderedAnswers);
      if (!result.ok) {
        if (result.status === 401) {
          // 登录失效：回到认证页
          window.Auth.clearToken();
          showScreen('auth');
          switchAuthForm('login');
          throw new Error('登录已失效，请重新登录后再提交');
        }
        throw new Error(result.data.error || '提交失败');
      }

      window.location.href = '/result?id=' + result.data.id;
    } catch (err) {
      console.error('提交失败:', err);
      alert('提交失败：' + err.message + '，请重试。');
      setBtnLoading(submitBtn, false, '提交并查看结果');
    }
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 注册 / 登录表单切换
    $('goLogin').addEventListener('click', function (e) {
      e.preventDefault();
      switchAuthForm('login');
    });
    $('goRegister').addEventListener('click', function (e) {
      e.preventDefault();
      switchAuthForm('register');
    });

    // 表单提交
    $('registerForm').addEventListener('submit', handleRegister);
    $('loginForm').addEventListener('submit', handleLogin);

    // 性别单选按钮
    document.querySelectorAll('#regGender .gender-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#regGender .gender-option').forEach(function (b) {
          b.classList.remove('is-selected');
        });
        this.classList.add('is-selected');
        regGender = this.getAttribute('data-gender');
        hideError('registerError');
      });
    });

    // 欢迎页
    $('welcomeStartBtn').addEventListener('click', handleWelcomeStart);
    $('logoutBtn').addEventListener('click', handleLogout);

    // 重测确认弹窗
    $('retakeCancel').addEventListener('click', closeRetakeConfirm);
    $('retakeConfirmBtn').addEventListener('click', function () {
      closeRetakeConfirm();
      startQuestions();
    });
    document.querySelector('#retakeConfirm .confirm-mask').addEventListener('click', closeRetakeConfirm);

    // 答案选项
    document.querySelectorAll('.answer-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectAnswer(this.getAttribute('data-value'));
      });
    });

    // 上一题 / 下一题 / 提交
    $('prevQuestionBtn').addEventListener('click', prevQuestion);
    $('nextQuestionBtn').addEventListener('click', advance);
    $('submitSurveyBtn').addEventListener('click', submitSurvey);
  }

  // ==================== 初始化 ====================

  async function init() {
    initAgeOptions();
    bindEvents();
    await initQuestions();

    // 根据登录状态分流
    if (window.Auth.isLoggedIn()) {
      var data = await refreshMe();
      if (data) {
        // 从首页"重新测评"确认后跳转过来：直接进入答题
        var wantRetake = new URLSearchParams(window.location.search).get('retake') === '1';
        if (wantRetake && data.hasResult) {
          meData = data;
          startQuestions();
        } else {
          enterWelcome(data);
        }
        return;
      }
      window.Auth.clearToken();
    }
    showScreen('auth');
    switchAuthForm('register');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
