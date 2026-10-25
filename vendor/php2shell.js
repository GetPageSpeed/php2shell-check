/**
 * /php2shell checkers.
 *
 * 1. Package checker (runs entirely in the browser): parses pasted `rpm -qa`,
 *    `dpkg -l`, `apk info -v` or `php -v` output and judges every PHP runtime
 *    against the shared rule table (inc/php2shell-data.json, embedded in the page
 *    as #gps-p2s-data). Vendor rules come first because distributions backport
 *    the fix without changing the upstream version string.
 * 2. URL check: calls /wp-json/getpagespeed/v1/php2shell-check and explains
 *    the advertised version. It never claims a site is safe.
 *
 * Vanilla JS, no dependencies. window.gpsPhp2Shell is exposed for tests.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('gps-p2s-data');
  var DATA = {};
  try { DATA = JSON.parse(dataEl ? dataEl.textContent : '{}'); } catch (e) { DATA = {}; }
  var FIXED = DATA.fixed_upstream || {};
  var RULES = DATA.rules || [];

  function gpsTrack(evt, params) {
    if (!window.gtag) { return; }
    try { gtag('event', evt, Object.assign({ tool: 'php2shell' }, params || {})); } catch (e) {}
  }

  // ---------- version comparison (rpmvercmp/dpkg hybrid, "~" sorts first) ----------
  function splitSegments(s) {
    var out = [];
    var re = /~|\^|\d+|[a-zA-Z]+/g;
    var m;
    while ((m = re.exec(s)) !== null) { out.push(m[0]); }
    return out;
  }

  function vercmp(a, b) {
    if (a === b) { return 0; }
    var x = splitSegments(a);
    var y = splitSegments(b);
    var n = Math.max(x.length, y.length);
    for (var i = 0; i < n; i++) {
      var p = x[i];
      var q = y[i];
      if (p === q) { continue; }
      if (p === '~' || q === '~') {
        if (p === '~' && q !== '~') { return -1; }
        if (q === '~' && p !== '~') { return 1; }
      }
      if (p === undefined) { return -1; }
      if (q === undefined) { return 1; }
      var pn = /^\d+$/.test(p);
      var qn = /^\d+$/.test(q);
      if (pn && qn) {
        var d = parseInt(p, 10) - parseInt(q, 10);
        if (d !== 0) { return d > 0 ? 1 : -1; }
        continue;
      }
      if (pn) { return 1; }  // numeric segments are newer than alpha ones
      if (qn) { return -1; }
      if (p < q) { return -1; }
      if (p > q) { return 1; }
    }
    return 0;
  }

  function upstreamOf(version) {
    var m = /^(\d+)\.(\d+)\.(\d+)/.exec(version || '');
    return m ? { full: m[1] + '.' + m[2] + '.' + m[3], branch: m[1] + '.' + m[2] } : null;
  }

  function upstreamStatus(version) {
    var u = upstreamOf(version);
    if (!u) { return { status: 'unknown' }; }
    if (vercmp(u.full, DATA.min_affected || '5.4.0') < 0) { return { status: 'unknown', branch: u.branch, ancient: true }; }
    var fixed = FIXED[u.branch];
    if (!fixed) { return { status: 'eol', branch: u.branch }; }
    return { status: vercmp(u.full, fixed) >= 0 ? 'fixed' : 'vulnerable', branch: u.branch, fixed: fixed };
  }

  // ---------- parsing ----------
  var ARCH = /\.(x86_64|aarch64|noarch|i686|i386|ppc64le|s390x|src)$/;

  function parseLine(line) {
    line = line.replace(/\s+$/, '');
    var t = line.trim();
    if (!t) { return null; }

    // php -v
    var pv = /^PHP (\d+\.\d+\.\d+)\S*\s+\((cli|cgi-fcgi|fpm-fcgi|apache2handler|litespeed|frankenphp)/i.exec(t);
    if (pv) { return { type: 'phpv', name: 'php', version: pv[1], raw: t }; }

    // dpkg -l: "ii  php8.2-fpm  8.2.35-1~deb12u1  amd64  ..."
    var dk = /^[a-z][a-z]\s+(\S+)\s+(\S+)\s+\S+/.exec(t);
    if (dk && /^php/.test(dk[1].replace(/:.*$/, ''))) {
      var dver = dk[2].replace(/^\d+:/, '');
      return { type: 'deb', name: dk[1].replace(/:.*$/, ''), full: dver, version: dver, raw: t };
    }

    // dpkg-query / apt list style: "php8.3-fpm/noble-updates 8.3.6-0ubuntu0.24.04.6 amd64" or "php8.3-fpm 8.3.6-0ubuntu..."
    var al = /^(php[\w.+-]*)(?:\/\S+)?\s+(\d[^\s]*)/.exec(t);
    if (al && /[~+]|ubuntu|deb\d|\bsury\b/.test(al[2])) {
      var aver = al[2].replace(/^\d+:/, '');
      return { type: 'deb', name: al[1], full: aver, version: aver, raw: t };
    }

    // apk: php83-fpm-8.3.36-r0
    var ap = /^(php\d*(?:-[a-z0-9_]+)*)-(\d+\.\d+\.\d+[^-\s]*)-(r\d+)$/.exec(t);
    if (ap) { return { type: 'apk', name: ap[1], version: ap[2], release: ap[3], full: ap[2] + '-' + ap[3], raw: t }; }

    // rpm NEVRA: name-[epoch:]version-release[.arch]
    var noArch = t.split(/\s+/)[0].replace(ARCH, '');
    var rp = /^(.+?)-(?:(\d+):)?(\d[^-]*)-([^-]+)$/.exec(noArch);
    if (rp && /^(alt-|ea-|plesk-)?php/.test(rp[1])) {
      return { type: 'rpm', name: rp[1], version: rp[3], release: rp[4], full: rp[3] + '-' + rp[4], raw: t };
    }
    return null;
  }

  // Runtime packages say something about the PHP binary; pear/pecl add-ons do not.
  var RUNTIME = /(^|-)php\d*(-(fpm|cli|common|cgi|litespeed|embedded|dbg|devel))?$|^libapache2-mod-php|^php\d+\.\d+(-(fpm|cli|common|cgi|phpdbg))?$|^php\d*-(fpm|cli|common|cgi|litespeed)$/;

  function isRuntime(pkg) {
    if (pkg.type === 'phpv') { return true; }
    if (/pecl|pear|-ioncube|-imagick|-redis|-memcache|-apcu|-xdebug|-igbinary|-msgpack|-mcrypt|-oci8|-sodium/.test(pkg.name)) { return false; }
    return RUNTIME.test(pkg.name);
  }

  function familyKey(pkg) {
    var m = /^((?:alt-|ea-|plesk-)?php\d*(?:\.\d+)?(?:-php)?)/.exec(pkg.name);
    return (m ? m[1] : pkg.name) + '|' + pkg.type;
  }

  // ---------- judging ----------
  function fillFix(template, pkg, branch) {
    var scl = (/^(php\d+)-php/.exec(pkg.name) || [])[1] || '';
    return String(template)
      .replace(/\{scl\}/g, scl)
      .replace(/\{nodot\}/g, (branch || '').replace('.', ''))
      .replace(/\{branch\}/g, branch || '')
      .replace(/\{pkg\}/g, pkg.name);
  }

  function ruleById(id) {
    for (var i = 0; i < RULES.length; i++) { if (RULES[i].id === id) { return RULES[i]; } }
    return null;
  }

  function gpsFixFor(pkg, branch) {
    var rule = /^php\d+-php/.test(pkg.name) ? ruleById('gps-el7-scl') : ruleById('gps-el7-base');
    return rule ? fillFix(rule.fix, pkg, branch) : '';
  }

  function judgeWithRule(rule, pkg) {
    if (rule.type !== pkg.type) { return null; }
    if (!new RegExp(rule.name).test(pkg.name)) { return null; }
    var subject = pkg.type === 'deb' ? pkg.full : pkg.release;
    if (rule.release && !new RegExp(rule.release).test(subject || '')) { return null; }
    if (rule.upstream && !new RegExp(rule.upstream).test(pkg.version)) { return null; }

    var u = upstreamOf(pkg.version);
    var branch = u ? u.branch : '';

    if (rule.verdict === 'vulnerable') {
      var fix = rule.fix_by_branch && rule.fix_by_branch[branch] === 'gps-el7' ? gpsFixFor(pkg, branch) : fillFix(rule.fix, pkg, branch);
      return { verdict: 'vulnerable', vendor: rule.vendor, note: rule.note || '', fix: fix };
    }
    if (rule.verdict === 'patched') {
      return { verdict: 'patched', vendor: rule.vendor, note: rule.note || '' };
    }
    // A vendor's explicit backport entry for this branch beats the generic
    // upstream mode: Surý, for example, rebases 8.2+ (upstream version is
    // authoritative) but backports the fix into EOL branches it still builds.
    var fixedMap = rule.fixed || {};
    var target = u ? (fixedMap[u.full] || fixedMap[branch]) : null;
    if (target) {
      var installed = pkg.type === 'deb' ? pkg.full : pkg.version + '-' + pkg.release;
      if (vercmp(installed, target) >= 0) {
        return { verdict: 'patched', vendor: rule.vendor, fixedIn: target, note: rule.note || '' };
      }
      return { verdict: 'vulnerable', vendor: rule.vendor, fixedIn: target, note: rule.note || '', fix: fillFix(rule.fix, pkg, branch) };
    }

    if (rule.mode === 'upstream') {
      // This vendor rebases to the fixed upstream release, so the version number is authoritative.
      var st = upstreamStatus(pkg.version);
      if (st.status === 'fixed') {
        return { verdict: 'patched', vendor: rule.vendor, fixedIn: st.fixed, note: rule.note || '' };
      }
      if (st.status === 'vulnerable') {
        return { verdict: 'vulnerable', vendor: rule.vendor, fixedIn: st.fixed, note: 'PHP ' + pkg.version + ' predates the fix.', fix: fillFix(rule.fix, pkg, branch) };
      }
      return { verdict: 'unknown', vendor: rule.vendor, note: rule.eol_note || '', fix: fillFix(rule.fix, pkg, branch) };
    }

    // No entry for this branch: upstream 8.2+ carries the fix regardless of vendor
    // once the version is high enough, so let later rules or the generic judge decide.
    return null;
  }

  function genericFix(pkg) {
    if (pkg.type === 'deb') { return "sudo apt update && sudo apt install --only-upgrade $(dpkg -l 'php*' | awk '/^ii/{print $2}')"; }
    if (pkg.type === 'apk') { return 'apk update && apk upgrade'; }
    if (pkg.type === 'rpm') {
      if (/\.el7/.test(pkg.release || '')) { return 'yum-config-manager --enable getpagespeed-extras-php84 && yum install php84-getpagespeed-stack'; }
      return "sudo dnf upgrade 'php*'";
    }
    return '';
  }

  function judge(pkg) {
    for (var i = 0; i < RULES.length; i++) {
      var r = judgeWithRule(RULES[i], pkg);
      if (r) { r.pkg = pkg; return r; }
    }
    var s = upstreamStatus(pkg.version);
    var out = { pkg: pkg, vendor: '', branch: s.branch };
    if (s.status === 'fixed') {
      out.verdict = 'patched';
      out.note = 'PHP ' + pkg.version + ' carries the upstream fix (first fixed: ' + s.fixed + ').';
      return out;
    }
    if (s.status === 'unknown') {
      out.verdict = 'unknown';
      out.note = s.ancient
        ? 'PHP ' + pkg.version + ' is older than every branch the advisories assessed and has had no security fixes for years. Treat it as compromised-ready and replace it.'
        : 'Could not read a PHP version from this line.';
      return out;
    }
    if (pkg.type === 'phpv') {
      out.verdict = 'unknown';
      out.note = s.status === 'eol'
        ? 'PHP ' + s.branch + ' got no upstream fix, so this build is vulnerable unless your vendor backported it, and php -v cannot show that. Paste your package list (rpm -qa or dpkg -l) for a definite answer.'
        : 'Upstream PHP ' + pkg.version + ' is vulnerable (fixed in ' + s.fixed + '), but distributions backport the fix without changing this number. Paste your package list (rpm -qa or dpkg -l) for a definite answer.';
      return out;
    }
    out.verdict = 'unknown';
    out.note = (s.status === 'eol'
      ? 'PHP ' + s.branch + ' got no upstream release with the fix.'
      : 'Upstream ' + pkg.version + ' predates the fix (' + s.fixed + ').') +
      ' This package comes from a vendor we have no rule for yet, so only its changelog can say whether the fix was backported: rpm -q --changelog ' + pkg.name + ' | grep -E "2026-10961[89]" (or apt changelog ' + pkg.name + ').';
    out.fix = genericFix(pkg);
    return out;
  }

  var RANK = { vulnerable: 3, unknown: 2, patched: 1 };

  function check(text) {
    var lines = String(text || '').split(/\r?\n/);
    var gpsBuilt = /Built by GetPageSpeed LLC/i.test(text || '');
    var families = {};
    var order = [];
    for (var i = 0; i < lines.length; i++) {
      var pkg = parseLine(lines[i]);
      if (!pkg || !isRuntime(pkg)) { continue; }
      var key = familyKey(pkg);
      if (!families[key]) { families[key] = []; order.push(key); }
      families[key].push(pkg);
    }
    var results = [];
    for (var k = 0; k < order.length; k++) {
      var group = families[order[k]];
      var worst = null;
      for (var j = 0; j < group.length; j++) {
        var r = judge(group[j]);
        if (!worst || RANK[r.verdict] > RANK[worst.verdict]) { worst = r; }
      }
      if (worst.pkg.type === 'phpv' && gpsBuilt) {
        worst.note += ' This binary was built by GetPageSpeed: run rpm -qa \'php*-common\' to see its release.';
      }
      results.push(worst);
    }
    var overall = 'none';
    for (var x = 0; x < results.length; x++) {
      if (overall === 'none' || RANK[results[x].verdict] > RANK[overall]) { overall = results[x].verdict; }
    }
    return { overall: overall, results: results };
  }

  // ---------- rendering ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  var HEADLINES = {
    vulnerable: 'Vulnerable: patch this server now',
    unknown: 'Cannot confirm the fix',
    patched: 'Patched against PHP2Shell',
    none: 'No PHP packages found'
  };
  var LABELS = { vulnerable: 'Vulnerable', unknown: 'Unconfirmed', patched: 'Patched' };

  function render(report, target) {
    // Verdict class only: what the user pasted never leaves the browser.
    gpsTrack('result_shown', { mode: 'packages', verdict: report.overall });
    target.innerHTML = '';
    var card = el('div', 'gps-p2s-verdict gps-p2s-verdict-' + report.overall);
    card.appendChild(el('p', 'gps-p2s-verdict-title', HEADLINES[report.overall]));
    if (report.overall === 'none') {
      card.appendChild(el('p', null, 'Paste the output of one of the commands above. The checker reads rpm, dpkg, apk and php -v output.'));
      target.appendChild(card);
      return;
    }
    var list = el('ul', 'gps-p2s-findings');
    report.results.forEach(function (r) {
      var li = el('li', 'gps-p2s-finding gps-p2s-finding-' + r.verdict);
      var head = el('p', 'gps-p2s-finding-head');
      head.appendChild(el('span', 'gps-p2s-badge gps-p2s-badge-' + r.verdict, LABELS[r.verdict]));
      head.appendChild(el('code', null, r.pkg.type === 'phpv' ? 'php -v: ' + r.pkg.version : r.pkg.name + ' ' + (r.pkg.full || r.pkg.version)));
      li.appendChild(head);
      var detail = [];
      if (r.vendor) { detail.push(r.vendor + '.'); }
      if (r.fixedIn) { detail.push('First fixed build: ' + r.fixedIn + '.'); }
      if (r.note) { detail.push(r.note); }
      if (detail.length) { li.appendChild(el('p', 'gps-p2s-finding-note', detail.join(' '))); }
      if (r.fix && r.verdict !== 'patched') {
        li.appendChild(el('p', 'gps-p2s-finding-fixlabel', 'Fix'));
        li.appendChild(el('pre', 'gps-p2s-code', r.fix));
      }
      list.appendChild(li);
    });
    card.appendChild(list);
    var after = el('p', 'gps-p2s-verdict-after');
    after.textContent = report.overall === 'patched'
      ? 'Restart every PHP process after patching (php-fpm, httpd, lsphp), or old workers keep running vulnerable code.'
      : 'After upgrading, restart every PHP process (php-fpm, httpd, lsphp) and run the check again.';
    card.appendChild(after);
    target.appendChild(card);
    if (window.gpsCopyCode) { window.gpsCopyCode.init(); }
  }

  // ---------- URL check ----------
  var URL_MESSAGES = {
    vulnerable_version: function (r) {
      return r.eol
        ? 'The site advertises PHP ' + r.version + '. Branch ' + r.branch + ' got no upstream fix, so it is exposed unless the host installed a vendor backport (GetPageSpeed for CentOS 7, Debian LTS, Ubuntu Pro, cPanel, CloudLinux and others).'
        : 'The site advertises PHP ' + r.version + ', which predates the upstream fix (' + r.fixed_upstream + '). It is vulnerable unless the distribution backported the fix without changing the version number.';
    },
    fixed_version: function (r) {
      return 'The site advertises PHP ' + r.version + ', which carries the upstream fix. Headers can come from a CDN or one backend only, so still check every server with the package checker.';
    },
    unknown_version: function (r) {
      return 'The site advertises PHP ' + r.version + ', a version the advisories do not cover. Treat it as unpatched.';
    },
    hidden: function () {
      return 'The site runs PHP but hides its version. That is good hygiene, not protection: check the server itself with the package checker.';
    },
    no_signal: function () {
      return 'Nothing in the response identifies PHP. The site may not use it, or a proxy may strip the headers. Check the server itself to be sure.';
    }
  };
  var URL_STATE = { vulnerable_version: 'vulnerable', fixed_version: 'patched', unknown_version: 'vulnerable', hidden: 'unknown', no_signal: 'unknown' };
  var URL_TITLES = {
    vulnerable_version: 'Exposed version looks vulnerable',
    fixed_version: 'Exposed version is fixed upstream',
    unknown_version: 'Unrecognised PHP version',
    hidden: 'PHP version hidden',
    no_signal: 'No PHP signature found'
  };

  function renderUrl(r, target) {
    gpsTrack('result_shown', { mode: 'url', verdict: r.verdict });
    target.innerHTML = '';
    var state = URL_STATE[r.verdict] || 'unknown';
    var card = el('div', 'gps-p2s-verdict gps-p2s-verdict-' + state);
    card.appendChild(el('p', 'gps-p2s-verdict-title', URL_TITLES[r.verdict] || 'Result'));
    card.appendChild(el('p', null, (URL_MESSAGES[r.verdict] || URL_MESSAGES.no_signal)(r)));
    if (r.evidence) {
      var ev = el('p', 'gps-p2s-finding-note');
      ev.appendChild(document.createTextNode('Evidence: '));
      ev.appendChild(el('code', null, r.evidence));
      card.appendChild(ev);
    }
    target.appendChild(card);
  }

  function initUi() {
    var form = document.getElementById('gps-p2s-pkg-form');
    var input = document.getElementById('gps-p2s-pkg-input');
    var out = document.getElementById('gps-p2s-pkg-result');
    if (form && input && out) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        gpsTrack('tool_run', { mode: 'packages' });
        render(check(input.value), out);
        out.focus();
      });
    }

    var sample = document.getElementById('gps-p2s-sample');
    if (sample && input) {
      sample.addEventListener('click', function () {
        input.value = 'php74-php-common-7.4.33-15.el7.remi.x86_64\nphp74-php-fpm-7.4.33-15.el7.remi.x86_64\nphp74-php-pecl-redis5-5.3.7-1.el7.remi.x86_64';
        input.focus();
      });
    }

    var tabs = document.querySelectorAll('.gps-p2s-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () { selectTab(tab); });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') { return; }
        var group = Array.prototype.slice.call(tab.parentNode.querySelectorAll('.gps-p2s-tab'));
        var idx = group.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
        var next = group[(idx + group.length) % group.length];
        selectTab(next);
        next.focus();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('a[data-gps-cta]'), function (a) {
      a.addEventListener('click', function () {
        gpsTrack('cta_click', { cta_target: a.getAttribute('data-gps-cta') });
      });
    });

    var urlForm = document.getElementById('gps-p2s-url-form');
    var urlInput = document.getElementById('gps-p2s-url-input');
    var urlOut = document.getElementById('gps-p2s-url-result');
    if (urlForm && urlInput && urlOut) {
      urlForm.addEventListener('submit', function (e) {
        e.preventDefault();
        gpsTrack('tool_run', { mode: 'url' });
        var btn = urlForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Checking…';
        urlOut.innerHTML = '';
        fetch(urlForm.getAttribute('data-endpoint') + '?url=' + encodeURIComponent(urlInput.value.trim()), { headers: { Accept: 'application/json' } })
          .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (r) {
            if (!r.ok) {
              var card = el('div', 'gps-p2s-verdict gps-p2s-verdict-unknown');
              card.appendChild(el('p', 'gps-p2s-verdict-title', 'Check did not run'));
              card.appendChild(el('p', null, (r.body && r.body.message) || 'The check failed. Try again in a minute.'));
              urlOut.appendChild(card);
              return;
            }
            renderUrl(r.body, urlOut);
          })
          .catch(function () {
            var card = el('div', 'gps-p2s-verdict gps-p2s-verdict-unknown');
            card.appendChild(el('p', 'gps-p2s-verdict-title', 'Check did not run'));
            card.appendChild(el('p', null, 'The request failed. Check your connection and try again.'));
            urlOut.appendChild(card);
          })
          .then(function () {
            btn.disabled = false;
            btn.textContent = 'Check site';
            urlOut.focus();
          });
      });
    }
  }

  function selectTab(tab) {
    var list = tab.parentNode;
    Array.prototype.forEach.call(list.querySelectorAll('.gps-p2s-tab'), function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) { panel.hidden = !on; }
    });
  }

  window.gpsPhp2Shell = { check: check, vercmp: vercmp, parseLine: parseLine };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUi);
  } else {
    initUi();
  }
})();
