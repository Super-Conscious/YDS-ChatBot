(function () {
  'use strict';

  if (window.__ydsHelpWidgetLoaded) return;
  window.__ydsHelpWidgetLoaded = true;

  var SCRIPT = document.currentScript;
  var ORIGIN = (function () {
    try {
      if (SCRIPT && SCRIPT.src) return new URL(SCRIPT.src).origin;
    } catch (e) {}
    return 'https://yds-chatbot.pages.dev';
  })();

  var STORAGE_KEY = 'yds_widget_seen_v1';
  var PANEL_ID = 'yds-help-panel';
  var BUBBLE_ID = 'yds-help-bubble';
  var TOOLTIP_ID = 'yds-help-tooltip';
  var STYLE_ID = 'yds-help-style';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '#' + BUBBLE_ID + ',#' + PANEL_ID + ',#' + TOOLTIP_ID + '{' +
        'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
        'box-sizing:border-box;' +
      '}' +
      '#' + BUBBLE_ID + '{' +
        'position:fixed;bottom:20px;right:20px;z-index:2147483000;' +
        'width:60px;height:60px;border-radius:50%;' +
        'background:#FEDD00;border:none;cursor:pointer;' +
        'box-shadow:0 8px 24px rgba(45,41,38,0.25),0 2px 6px rgba(45,41,38,0.12);' +
        'display:flex;align-items:center;justify-content:center;padding:0;' +
        'transition:transform 0.15s ease,box-shadow 0.15s ease;' +
        '-webkit-tap-highlight-color:transparent;' +
      '}' +
      '#' + BUBBLE_ID + ':hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(45,41,38,0.3),0 4px 8px rgba(45,41,38,0.15);}' +
      '#' + BUBBLE_ID + ':active{transform:translateY(0);}' +
      '#' + BUBBLE_ID + ' svg{width:30px;height:30px;display:block;}' +
      '#' + BUBBLE_ID + '.open .icon-paw{display:none;}' +
      '#' + BUBBLE_ID + ':not(.open) .icon-close{display:none;}' +
      '#' + TOOLTIP_ID + '{' +
        'position:fixed;bottom:92px;right:20px;z-index:2147482999;' +
        'background:#2D2926;color:#fff;padding:12px 16px;border-radius:12px;' +
        'font-size:14px;line-height:1.4;max-width:260px;' +
        'box-shadow:0 8px 24px rgba(45,41,38,0.25);' +
        'opacity:0;transform:translateY(8px);pointer-events:none;' +
        'transition:opacity 0.2s ease,transform 0.2s ease;' +
      '}' +
      '#' + TOOLTIP_ID + '.show{opacity:1;transform:translateY(0);pointer-events:auto;}' +
      '#' + TOOLTIP_ID + '::after{' +
        'content:"";position:absolute;bottom:-6px;right:24px;' +
        'width:12px;height:12px;background:#2D2926;' +
        'transform:rotate(45deg);border-radius:2px;' +
      '}' +
      '#' + TOOLTIP_ID + ' .tip-close{' +
        'position:absolute;top:6px;right:8px;background:none;border:none;' +
        'color:rgba(255,255,255,0.5);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;' +
      '}' +
      '#' + TOOLTIP_ID + ' .tip-close:hover{color:#fff;}' +
      '#' + TOOLTIP_ID + ' .tip-title{font-weight:600;margin-bottom:2px;padding-right:16px;}' +
      '#' + PANEL_ID + '{' +
        'position:fixed;bottom:92px;right:20px;z-index:2147482998;' +
        'width:380px;height:600px;max-height:calc(100vh - 120px);' +
        'border-radius:16px;overflow:hidden;' +
        'background:#fff;border:1px solid #e9e6e1;' +
        'box-shadow:0 20px 48px rgba(45,41,38,0.2),0 6px 16px rgba(45,41,38,0.1);' +
        'opacity:0;transform:translateY(16px) scale(0.96);transform-origin:bottom right;' +
        'pointer-events:none;transition:opacity 0.22s ease,transform 0.22s ease;' +
      '}' +
      '#' + PANEL_ID + '.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}' +
      '#' + PANEL_ID + ' iframe{width:100%;height:100%;border:none;display:block;}' +
      '@media (max-width:560px){' +
        '#' + PANEL_ID + '{' +
          'bottom:0;right:0;left:0;top:0;' +
          'width:100%;height:100%;max-height:100%;' +
          'border-radius:0;border:none;' +
        '}' +
        '#' + BUBBLE_ID + '{bottom:16px;right:16px;width:56px;height:56px;}' +
        '#' + TOOLTIP_ID + '{bottom:84px;right:16px;}' +
      '}';

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  var PAW_SVG =
    '<svg class="icon-paw" viewBox="0 0 32 32" fill="#2D2926" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<ellipse cx="8" cy="10" rx="2.6" ry="3.4"/>' +
      '<ellipse cx="14" cy="7" rx="2.4" ry="3.2"/>' +
      '<ellipse cx="20" cy="7" rx="2.4" ry="3.2"/>' +
      '<ellipse cx="25.5" cy="11" rx="2.5" ry="3.3"/>' +
      '<path d="M16 14.5c-4.2 0-7.5 3.3-7.5 7 0 2.6 2 4.5 4.8 4.5 1.3 0 2.1-.5 2.7-.5s1.4.5 2.7.5c2.8 0 4.8-1.9 4.8-4.5 0-3.7-3.3-7-7.5-7z"/>' +
    '</svg>';

  var CLOSE_SVG =
    '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="#2D2926" stroke-width="2.5" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M6 6l12 12M18 6L6 18"/>' +
    '</svg>';

  function hasSeen() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
  }

  function build() {
    injectStyles();

    var bubble = document.createElement('button');
    bubble.id = BUBBLE_ID;
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Open Yellow Dog Help');
    bubble.innerHTML = PAW_SVG + CLOSE_SVG;

    var tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute('role', 'status');
    tooltip.innerHTML =
      '<button class="tip-close" type="button" aria-label="Dismiss">&times;</button>' +
      '<div class="tip-title">Hi there!</div>' +
      '<div>Have a question about Yellow Dog? Ask our help bot.</div>';

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Yellow Dog Help');

    var iframe = document.createElement('iframe');
    iframe.src = ORIGIN + '/widget/';
    iframe.title = 'Yellow Dog Help';
    iframe.setAttribute('allow', 'clipboard-write');
    panel.appendChild(iframe);

    document.body.appendChild(bubble);
    document.body.appendChild(tooltip);
    document.body.appendChild(panel);

    function openPanel() {
      panel.classList.add('open');
      bubble.classList.add('open');
      bubble.setAttribute('aria-label', 'Close Yellow Dog Help');
      hideTooltip();
      markSeen();
    }

    function closePanel() {
      panel.classList.remove('open');
      bubble.classList.remove('open');
      bubble.setAttribute('aria-label', 'Open Yellow Dog Help');
    }

    function togglePanel() {
      if (panel.classList.contains('open')) closePanel();
      else openPanel();
    }

    function showTooltip() { tooltip.classList.add('show'); }
    function hideTooltip() { tooltip.classList.remove('show'); }

    bubble.addEventListener('click', togglePanel);
    tooltip.querySelector('.tip-close').addEventListener('click', function (e) {
      e.stopPropagation();
      hideTooltip();
      markSeen();
    });
    tooltip.addEventListener('click', function (e) {
      if (e.target.classList.contains('tip-close')) return;
      openPanel();
    });

    window.addEventListener('message', function (e) {
      if (e.origin !== ORIGIN) return;
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'yds-widget-close') closePanel();
    });

    if (!hasSeen()) {
      setTimeout(showTooltip, 1200);
      setTimeout(function () { if (!panel.classList.contains('open')) hideTooltip(); }, 12000);
    }

    window.YDSHelp = { open: openPanel, close: closePanel, toggle: togglePanel };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
