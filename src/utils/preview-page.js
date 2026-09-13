/**
 * preview-page.js — 把 @wdprlib/render 的裸 HTML fragment 包装为完整预览文档
 *
 * @wdprlib/render 输出的是正文片段（无 <html>/<head>/<meta charset>），直接在浏览器打开
 * 中文会乱码、也没有任何客户端交互。这里补全文档外壳，并注入 @wdprlib/runtime：
 *
 *   <script type="module">（内联 runtime 源码 + initWdprRuntime() 引导）放在 body 末尾，
 *   让 tabview / collapsible / TOC / 脚注 / 折叠列表 / 画廊灯箱 / 数学 / 日期 / 邮箱 在
 *   浏览器里可用。runtime 源码自包含（无外部 import），运行时随预览文件一起走，无需网络。
 *
 * runtime 源码通过 import.meta.resolve('@wdprlib/runtime') 在构建时读取并内联。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


let runtimeSourceCache = null;

/** @wdprlib/runtime 的源码（node_modules 里读一次，模块级缓存） */
function runtimeSource() {
  if (runtimeSourceCache == null) {
    const url = import.meta.resolve('@wdprlib/runtime');
    runtimeSourceCache = readFileSync(fileURLToPath(url), 'utf8');
  }
  return runtimeSourceCache;
}

/**
 * 把渲染结果包装成完整预览文档。
 *
 * @param {object} opts
 * @param {string} opts.html @wdprlib/render 输出的正文 fragment（styleMode: 'inline'，
 *                           [[module CSS]] 已含在 html 里）
 * @param {Array<string>} [opts.styles] 收集到的 CSS 段（单独以 <style> 追加）
 * @param {string} [opts.title] 文档标题（默认 "ftml preview"）
 * @returns {string} 完整 HTML 文档字符串
 */

/**
 * 构建预览文档 – 使用 Wikidot 沙盒站模板
 */
export function buildPreviewDocument({ html, styles = [], title = 'ftml preview' }) {
  const styleTags = styles.map((s) => `<style>${s}</style>`).join('\n');
  const runtimeInline = runtimeSource()
    .replace(/<\/script/gi, '<\\/script');

  // 标题转义
  const titleEscaped = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 使用模板字符串直接嵌入完整页面，并插入动态内容
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="cn" lang="cn">

<head>
    <title>${titleEscaped}</title>
    
    <meta http-equiv="content-type" content="text/html;charset=UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta http-equiv="content-language" content="cn"/>

    <style type="text/css" id="internal-style">
        
        /* modules */
        
                
        /* theme */
                    @import url(https://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--theme/base/css/style.css);
                    @import url(https://sigma9.scpwikicn.com/cn/cn/sigma9_ch_sandbox.min.css);
                    .error-block{display:none;}
            </style>
    
    ${styleTags}
        
</head>
<body id="html-body">
<div id="skrollr-body">
<a name="page-top"></a>

<div id="container-wrap-wrap">
    <div id="container-wrap">
        <div id="container">
            <div id="header">
              <h1><a href="/"><span>SCP基金會中文沙盒站</span></a></h1>
                <h2><span>千仞高塔，筑基于此</span></h2>
                <div id="search-top-box" class="form-search">
    <form id="search-top-box-form" action="dummy" class="input-append">
        <input id="search-top-box-input" class="text empty search-query" type="text" size="15" name="query" value="搜索网站" onfocus="if(YAHOO.util.Dom.hasClass(this, 'empty')){YAHOO.util.Dom.removeClass(this,'empty'); this.value='';}"/><input class="button btn" type="submit" name="search" value="搜索"/>
    </form>
</div>
                <div id="top-bar">
                    <div class="top-bar">
<ul>
<li><a href="/">主页</a></li>
<li><a href="https://scp-wiki-cn.wikidot.com">SCP基金会中文主页</a></li>
</ul>
</div>
<div class="mobile-top-bar">
<div class="open-menu">
<p><a href="#side-bar">≡</a></p>
</div>
<ul>
<li><a href="/">主页</a></li>
<li><a href="https://scp-wiki-cn.wikidot.com">SCP基金会中文主页</a></li>
</ul>
</div>
                </div>
                <div id="login-status"><a href="javascript:;" onclick="WIKIDOT.page.listeners.createAccount(event)" class="login-status-create-account btn">建立账户</a> <span>或</span> <a href="javascript:;" onclick="WIKIDOT.page.listeners.loginClick(event)" class="login-status-sign-in btn btn-primary">登入</a> </div>
                <div id="header-extra-div-1"><span></span></div><div id="header-extra-div-2"><span></span></div><div id="header-extra-div-3"><span></span></div>
            </div>
            
            <div id="content-wrap">
                <div id="side-bar">
                    <div class="side-block">
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/home.png" alt="home.png" class="image" /><a href="/">主页</a></div>
<div class="heading">
<p>帮助</p>
</div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/help.png" alt="help.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/wiki-syntax">维基语法</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/default.png" alt="default.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/syntax-quick-reference">语法速查</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/forum.png" alt="forum.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/forum/c-882988/">讨论区：点子及头脑风暴</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/forum.png" alt="forum.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/forum/c-882987/">讨论区：草稿与批判</a></div>
<hr />
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/series.png" alt="series.png" class="image" /><a href="/index">沙盒目录</a></div>
<div class="heading">
<p>SCP-CN维基</p>
</div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/main.png" alt="main.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com">SCP-CN维基</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/help.png" alt="help.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/how-to-write-an-scp">如何撰写一篇SCP文档</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/help.png" alt="help.png" class="image" /><a href="https://scp-wiki-cn.wikidot.com/guide-hub">指导中心</a></div>
</div>
<div class="side-block" style="background-color: #fff0f0;">
<div class="collapsible-block">
<div class="collapsible-block-folded"><a class="collapsible-block-link" href="javascript:;">管理专用</a></div>
<div class="collapsible-block-unfolded" style="display:none">
<div class="collapsible-block-unfolded-link"><a class="collapsible-block-link" href="javascript:;">管理专用</a></div>
<div class="collapsible-block-content">
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/main.png" alt="main.png" class="image" /><a href="/_admin">控制台</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/default.png" alt="default.png" class="image" /><a href="/system:list-all-categories">所有分类</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/default.png" alt="default.png" class="image" /><a href="/system:recent-changes">最近更新</a></div>
<div class="menu-item"><img src="https://scpsandboxcn.wdfiles.com/local--files/nav:side/default.png" alt="default.png" class="image" /><a href="/nav:side">侧栏</a> | <a href="/nav:top">顶栏</a> | <a href="/component:theme">版式</a></div>
</div>
</div>
</div>
</div>
<div style="clear:both; height: 0px; font-size: 1px"></div>
<a class="close-menu" href="###"><br />
<img src="https://scp-wiki.wdfiles.com/local--files/nav%3Aside/black.png" style="z-index=-1; opacity: 0.3;" alt="black.png" class="image" /><br /></a>
                </div>
                
                <div id="main-content">
                    <div id="action-area-top"></div>
                    <div id="page-title">
                        ${titleEscaped}
                    </div>
                    <div id="page-content">
${html}
                    </div>
                    <div id="page-info-break"></div>
                    <div id="page-options-container">
                        <div id="page-info">页面版本: 256, 最后编辑于: <span class="odate time_1788396473 format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%20%28%25O%20%E5%89%8D%29">03 Sep 2026 00:47</span></div>
            <div id="page-options-bottom"  class="page-options-bottom">
            <a href="javascript:;" class="btn btn-default" id="edit-button">编辑</a>
<a href="javascript:;" class="btn btn-default" id="tags-button">标签</a>
<a href="javascript:;" class="btn btn-default" id="history-button">历史记录</a>
<a href="javascript:;" class="btn btn-default" id="files-button">附件</a>
<a href="javascript:;" class="btn btn-default" id="print-button">打印</a>
<a href="javascript:;" class="btn btn-default" id="site-tools-button">网站工具</a>
<a href="javascript:;" class="btn btn-default" id="more-options-button">+&nbsp;选项</a> 
</div>
<div id="page-options-bottom-2" class="page-options-bottom form-actions" style="display:none">
    <a href="javascript:;" class="btn btn-default" id="edit-sections-button">编辑段落</a>
    <a href="javascript:;" class="btn btn-default" id="edit-append-button">附加</a>
    <a href="javascript:;" class="btn btn-default" id="edit-meta-button">编辑元信息</a>
    <a href="javascript:;" class="btn btn-default" id="watchers-button">关注者</a> 
    <a href="javascript:;" class="btn btn-default" id="backlinks-button">反向链接</a> 
    <a href="javascript:;" class="btn btn-default" id="view-source-button">页面源代码</a> 
    <a href="javascript:;" class="btn btn-default" id="parent-page-button">父页面</a> 
    <a href="javascript:;" class="btn btn-default" id="page-block-button">锁定页面</a>    
    <a href="javascript:;" class="btn btn-default" id="rename-move-button">重新命名</a> 
    <a href="javascript:;" class="btn btn-default" id="delete-button">删除</a> 
</div>
<div id="page-options-area-bottom">
</div>
                    </div>
                    <div id="action-area" style="display: none;"></div>
                </div>
            </div>
            
            <div id="footer" style="display: block; visibility: visible;">
                <div class="options" style="display: block; visibility: visible;">
    <a href="http://www.wikidot.com/doc" id="wikidot-help-button">说明</a>
    &nbsp;|
    <a href="http://www.wikidot.com/legal:terms-of-service" id="wikidot-tos-button">服务条款</a>
    &nbsp;|
    <a href="http://www.wikidot.com/legal:privacy-policy" id="wikidot-privacy-button">隐私</a>
    &nbsp;|
    <a href="javascript:;" id="bug-report-button" onclick="WIKIDOT.page.listeners.pageBugReport(event)">报告错误</a>
    &nbsp;|
    <a href="javascript:;" id="abuse-report-button" onclick="WIKIDOT.page.listeners.flagPageObjectionable(event)">标记为令人反感的</a>
    <span id="consent-box" style="display:none">
        &nbsp;|
        <a href="javascript:;"  onclick="window.__cmp('showModal');">更新 Cookie 设置</a>
    </span>
    <script>
    if (window["nitroAds"] && window["nitroAds"].loaded) {
        document.getElementById("consent-box").style.display = window["__tcfapi"] ? "" : "none";
        } else {
        document.addEventListener(
                "nitroAds.loaded",
                () =>
                (document.getElementById("consent-box").style.display = window["__tcfapi"] ? "" : "none")
                );
    }
    </script>
</div>
基于 <a href="http://www.wikidot.com">Wikidot.com</a>
            </div>
            <div id="license-area" class="license-area">
                    除非特别注明，本页内容采用以下授权方式：
 <a rel="license" href="http://creativecommons.org/licenses/by/3.0/">Creative Commons Attribution 3.0 License</a>
            </div>
            <div id="extrac-div-1"><span></span></div><div id="extrac-div-2"><span></span></div><div id="extrac-div-3"><span></span></div>
        </div>
    </div>
<div id="extra-div-1"><span></span></div><div id="extra-div-2"><span></span></div><div id="extra-div-3"><span></span></div>
<div id="extra-div-4"><span></span></div><div id="extra-div-5"><span></span></div><div id="extra-div-6"><span></span></div>
</div>
</div>
<div id="dummy-ondomready-block" style="display: none;" ></div>
    <!-- Google Analytics load -->
    <script type="text/javascript">
        (function() {
            var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
            ga.src = ('https:' == document.location.protocol ? 'https://' : 'http://') + 'stats.g.doubleclick.net/dc.js';
            var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
        })();
    </script>

<div id="page-options-bottom-tips" style="display: none;">
    <div id="edit-button-hovertip">
        点击编辑本页内容。    </div>
</div>
<div id="page-options-bottom-2-tips"  style="display: none;">
    <div id="edit-sections-button-hovertip">
        点击显示页面各部分的编辑按钮（如果可能）。 在标题边会出现“编辑”按钮。    </div>
    <div id="edit-append-button-hovertip">
        在不编辑全部页面源代码的情况下添加内容。    </div>
    <div id="history-button-hovertip">
        查看本页过去是如何沿革的。    </div>
    <div id="discuss-button-hovertip">
        若您想要讨论本页内容，这是最简单的方法。    </div>
    <div id="files-button-hovertip">
        检视并管理本页附件。    </div>
    <div id="site-tools-button-hovertip">
        管理网站的实用工具。    </div>
    <div id="backlinks-button-hovertip">
        检视链接至本页或引用本页的页面。    </div>
    <div id="rename-move-button-hovertip">
        变更页面名称（及 URL 地址，或许会影响分类）。    </div>
    <div id="view-source-button-hovertip">
        在不编辑的情形下检视维基源代码。    </div>
    <div id="parent-page-button-hovertip">  
        检视 / 设定父页面（用以建立浏览足迹与结构化​​配置）。    </div>
            <div id="abuse-report-button-hovertip">
            向管理员举报本页有令人反感的内容。        </div>
        <div id="bug-report-button-hovertip">
            事情不如预期？看看您可以做些什么。        </div>
        <div id="wikidot-help-button-hovertip">
            通用的 Wikidot.com 文件与说明。        </div>
        <div id="wikidot-tos-button-hovertip">
            Wikidot.com 服务条款 — 您可以做的事，您不该做的事之类的。        </div>
        <div id="wikidot-privacy-button-hovertip">
            Wikidot.com 隐私政策。          
        </div>
    </div>
<script type="module">
${runtimeInline}
initWdprRuntime({ root: document.getElementById('page-content') });
</script>
</body>
</html>
`;
}