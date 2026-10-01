/**
 * 4D-MCOM 用户会话共享模块
 *
 * 职责：
 *  - localStorage 持久化登录令牌（同一浏览器"记住登录"）
 *  - 自动带 Bearer 令牌的 fetch 封装
 *  - 当前用户信息的获取与缓存
 *
 * 浏览器安全沙箱禁止网页读取设备名/真实身份，因此"记住我"通过
 * localStorage 令牌实现：清除浏览器数据或更换设备后需重新输入昵称登录。
 */
(function (window) {
  'use strict';

  var TOKEN_KEY = '4dmcom_token';

  // 注册表单选项（与服务端常量保持一致）
  var AGE_GROUPS = ['18岁及以下', '22岁及以下', '26岁及以下', '30岁及以下', '30岁~40岁', '40~50岁', '50岁及以上'];
  var GENDERS = ['男', '女'];

  // 当前登录用户缓存（{user, hasResult, resultId, resultBrief}）
  var meCache = null;
  var mePromise = null;

  function getToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(token) {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch (e) { /* 隐私模式等场景静默失败 */ }
  }

  function clearToken() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
    meCache = null;
    mePromise = null;
  }

  function isLoggedIn() {
    return !!getToken();
  }

  /**
   * 带登录令牌的 fetch 封装
   * @param {string} url 接口地址
   * @param {Object} options fetch 配置
   * @returns {Promise<Response>}
   */
  function authFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    var token = getToken();
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
  }

  /**
   * 拉取当前登录用户信息（带缓存）
   * @param {boolean} force 是否强制刷新
   * @returns {Promise<Object|null>} 用户信息，未登录或令牌失效返回 null
   */
  function getMe(force) {
    if (!getToken()) return Promise.resolve(null);
    if (!force && meCache) return Promise.resolve(meCache);
    if (!force && mePromise) return mePromise;

    mePromise = authFetch('/api/me')
      .then(function (resp) {
        if (resp.status === 401) {
          clearToken();
          return null;
        }
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        meCache = data;
        mePromise = null;
        return data;
      })
      .catch(function () {
        mePromise = null;
        return null;
      });

    return mePromise;
  }

  /**
   * 注册
   * @returns {Promise<{ok:boolean, status:number, data:Object}>}
   */
  function register(nickname, ageGroup, gender) {
    return fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nickname, ageGroup: ageGroup, gender: gender })
    }).then(handleAuthResponse);
  }

  /**
   * 登录（仅凭昵称）
   * @returns {Promise<{ok:boolean, status:number, data:Object}>}
   */
  function login(nickname) {
    return fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nickname })
    }).then(handleAuthResponse);
  }

  function handleAuthResponse(resp) {
    return resp.json().catch(function () { return {}; }).then(function (data) {
      if (resp.ok && data.token) {
        setToken(data.token);
        meCache = null;
        mePromise = null;
      }
      return { ok: resp.ok, status: resp.status, data: data };
    });
  }

  /**
   * 提交答卷（带登录令牌）
   * @param {number[]} answers 60 题答案
   * @returns {Promise<{ok:boolean, status:number, data:Object}>}
   */
  function submitAnswers(answers) {
    return authFetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answers })
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        return { ok: resp.ok, status: resp.status, data: data };
      });
    });
  }

  // 暴露到全局
  window.Auth = {
    AGE_GROUPS: AGE_GROUPS,
    GENDERS: GENDERS,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    isLoggedIn: isLoggedIn,
    authFetch: authFetch,
    getMe: getMe,
    register: register,
    login: login,
    submitAnswers: submitAnswers
  };
})(window);
