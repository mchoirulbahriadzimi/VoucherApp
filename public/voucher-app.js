
(function(){

  // ==========================================
  //  CONSTANTS & REFERENCES
  // ==========================================
  const SESS_KEY = 'voucherapp_session_v1';
  const navLinks = Array.from(document.querySelectorAll('[data-route]'));
  const logoutBtn = document.getElementById('logoutBtn');
  const connBadge = document.getElementById('connBadge');
  const pages = {
    login: document.getElementById('page-login'),
    register: document.getElementById('page-register'),
    dashboard: document.getElementById('page-dashboard'),
    generate: document.getElementById('page-generate'),
    data: document.getElementById('page-data'),
    report: document.getElementById('page-report'),
    settings: document.getElementById('page-settings'),
    profile: document.getElementById('page-profile'),
    about: document.getElementById('page-about')
  };

  // Data cache
  let lastFetchedData = null;
  let lastDataHash = '';
  let hashCheckInterval = null;
  let firstLoadDone = false;
  let profilesLoaded = false;
  let generatedCodes = []; // Track generated codes for copy/export/print
  let currentChartType = 'bar';
  let currentAdminData = null; // Store current admin data from DB

  // ==========================================
  //  TOAST NOTIFICATION SYSTEM
  // ==========================================
  function showToast(message, type){
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    if(!container) return;
    const icons = {success:'\u2713', error:'\u2715', info:'\u2139', warning:'\u26A0'};
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span style="font-size:18px">' + (icons[type]||'\u2139') + '</span><span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(function(){
      if(toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ==========================================
  //  CONNECTION BADGE (Live/Cached/Offline)
  // ==========================================
  function updateConnBadge(state){
    if(!connBadge) return;
    connBadge.className = 'conn-badge ' + state;
    var labels = {live:'Live', cached:'Cached', offline:'Offline'};
    connBadge.innerHTML = '<span class="conn-dot"></span>' + (labels[state] || 'Offline');
  }

  function checkConnectionState(){
    // Try to determine if MikroTik is connected (with timeout)
    var controller = new AbortController();
    var timeoutId = setTimeout(function(){ controller.abort(); }, 5000);
    fetch('/api/router?action=check_connection', {signal: controller.signal})
      .then(function(r){ return r.json(); })
      .then(function(d){
        clearTimeout(timeoutId);
        if(d.connected){
          updateConnBadge('live');
        } else if(d.configured){
          updateConnBadge('cached');
        } else {
          updateConnBadge('offline');
        }
        // Update router IP on data page
        if(d.connected){
          fetch('/api/router?action=get_config').then(function(r){return r.json();}).then(function(cfg){
            var ipEl = document.getElementById('routerIpDisplay');
            if(ipEl && cfg.ip) ipEl.textContent = cfg.ip;
          }).catch(function(){});
        }
      })
      .catch(function(){
        clearTimeout(timeoutId);
        updateConnBadge('offline');
      });
  }

  // ==========================================
  //  PARSE MIKROTIK UPTIME TO SECONDS
  // ==========================================
  function parseUptime(str){
    if(!str || str === '0s') return 0;
    var total = 0;
    var dMatch = str.match(/(\d+)d/);
    var hMatch = str.match(/(\d+)h/);
    var mMatch = str.match(/(\d+)m/);
    var sMatch = str.match(/(\d+)s/);
    if(dMatch) total += parseInt(dMatch[1]) * 86400;
    if(hMatch) total += parseInt(hMatch[1]) * 3600;
    if(mMatch) total += parseInt(mMatch[1]) * 60;
    if(sMatch) total += parseInt(sMatch[1]);
    return total;
  }

  // ==========================================
  //  VOUCHER STATUS LOGIC
  //  Priority: Disabled > Expired > Online > Used > Active
  // ==========================================
  function getVoucherStatus(v){
    // Priority 1: Disabled
    if(v.disabled === 'true'){
      return {cls:'s-disabled', text:'Disabled', icon:'\u26D4', key:'disabled'};
    }
    // Priority 2: Expired — uptime >= limit-uptime OR expired flag from server
    if(v.expired === 'true'){
      return {cls:'s-expired', text:'Expired', icon:'\u23F0', key:'expired'};
    }
    if(v['limit-uptime'] && v['limit-uptime'] !== '' && v['limit-uptime'] !== '0s' && v.uptime && v.uptime !== '0s'){
      var limitSec = parseUptime(v['limit-uptime']);
      var usedSec = parseUptime(v.uptime);
      if(limitSec > 0 && usedSec >= limitSec){
        return {cls:'s-expired', text:'Expired', icon:'\u23F0', key:'expired'};
      }
    }
    // Priority 3: Online — uptime > 0 and caller-id exists
    if(v.uptime && v.uptime !== '0s' && v['caller-id']){
      return {cls:'s-online', text:'Online', icon:'\uD83D\uDFE2', key:'online'};
    }
    // Priority 4: Used — uptime > 0 but not currently online
    if(v.uptime && v.uptime !== '0s'){
      return {cls:'s-used', text:'Terpakai', icon:'\uD83D\uDFE0', key:'used'};
    }
    // Priority 5: Active — unused voucher
    return {cls:'s-valid', text:'Aktif', icon:'\uD83D\uDD35', key:'valid'};
  }

  // ==========================================
  //  COMPUTE STATISTICS
  // ==========================================
  function computeStats(all){
    var total = all.length;
    var aktif=0, online=0, terpakai=0, disabled=0, expired=0;
    all.forEach(function(v){
      var s = getVoucherStatus(v);
      if(s.key==='valid') aktif++;
      else if(s.key==='online') online++;
      else if(s.key==='used') terpakai++;
      else if(s.key==='disabled') disabled++;
      else if(s.key==='expired') expired++;
    });
    return {total:total, aktif:aktif, online:online, terpakai:terpakai, disabled:disabled, expired:expired};
  }

  // ==========================================
  //  ANIMATED COUNTER
  // ==========================================
  function animateCounter(el, target){
    if(!el) return;
    var start = parseInt(el.textContent) || 0;
    var diff = target - start;
    if(diff === 0){ el.textContent = target; return; }
    var duration = 600;
    var startTime = performance.now();
    function step(now){
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + diff * eased);
      if(progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ==========================================
  //  AUTH SYSTEM — DATABASE-BASED
  // ==========================================
  var auth = {
    login: function(adminData){
      localStorage.setItem(SESS_KEY, JSON.stringify({
        user: adminData.username,
        fullname: adminData.fullname || adminData.username,
        avatar: adminData.avatar || '',
        email: adminData.email || '',
        phone: adminData.phone || '',
        bio: adminData.bio || '',
        at: Date.now(),
        loginAt: adminData.login_at || new Date().toISOString(),
        created_at: adminData.created_at || ''
      }));
      currentAdminData = adminData;
    },
    logout: function(){ localStorage.removeItem(SESS_KEY); currentAdminData = null; },
    info: function(){
      try{ return JSON.parse(localStorage.getItem(SESS_KEY)); }
      catch(e){ return null; }
    },
    logged: function(){ return !!localStorage.getItem(SESS_KEY); },
    updateLocal: function(data){
      var existing = auth.info();
      if(!existing) return;
      Object.assign(existing, data);
      localStorage.setItem(SESS_KEY, JSON.stringify(existing));
    }
  };

  // ==========================================
  //  CHECK IF ADMIN EXISTS (on page load)
  // ==========================================
  var hasAdminAccount = false;
  function checkAdminExists(callback){
    fetch('/api/auth?action=check')
      .then(function(r){ return r.json(); })
      .then(function(d){
        hasAdminAccount = d.has_admin;
        if(callback) callback(d.has_admin);
      })
      .catch(function(){
        hasAdminAccount = false;
        if(callback) callback(false);
      });
  }

  // ==========================================
  //  SHOW LOGIN / REGISTER BASED ON DB
  // ==========================================
  function showAuthPage(){
    checkAdminExists(function(hasAdmin){
      if(hasAdmin){
        // Show login, hide register
        pages.login.style.display = 'block';
        pages.login.classList.add('show');
        pages.register.style.display = 'none';
        pages.register.classList.remove('show');
      } else {
        // No admin yet — show register
        pages.login.style.display = 'none';
        pages.login.classList.remove('show');
        pages.register.style.display = 'block';
        pages.register.classList.add('show');
      }
    });
  }

  // ==========================================
  //  UTILITIES — Code Generation
  // ==========================================
  var util = {
    randChunk: function(len){
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      var s = '';
      for(var i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
      return s;
    },
    gen: function(format){
      if(format === 'NNNNNNNN') return String(Math.floor(10000000 + Math.random()*90000000));
      return format.split('-').map(function(p){ return util.randChunk(p.length); }).join('-');
    }
  };

  // ==========================================
  //  SPA ROUTER
  // ==========================================
  function show(page){
    if(page !== 'login' && page !== 'register' && !auth.logged()) page = 'login';

    // Hide ALL main pages first (rob reset)
    Object.keys(pages).forEach(function(k){
      var el = pages[k];
      if(!el) return;
      el.classList.remove('show');
      // Ensure z-index reset and clear any inline styles from page transitions
      el.style.zIndex = '';
      el.style.opacity = '';
      el.style.transform = '';
    });

    // Show the target page
    if(page === 'login' || page === 'register'){
      pages.login.style.display = (page === 'login') ? 'block' : 'none';
      pages.register.style.display = (page === 'register') ? 'block' : 'none';
      if(pages[page]){
        pages[page].classList.add('show');
        pages[page].style.zIndex = '5';
        pages[page].style.opacity = '';
        pages[page].style.transform = '';
      }
    } else {
      pages.login.style.display = 'none';
      pages.register.style.display = 'none';
      if(pages[page]){
        pages[page].classList.add('show');
        pages[page].style.zIndex = '5';
        pages[page].style.opacity = '';
        pages[page].style.transform = '';
      }
    }

    navLinks.forEach(function(a){
      a.classList.toggle('active', a.getAttribute('data-route') === page);
    });
    logoutBtn.style.display = auth.logged() ? 'inline-block' : 'none';

    if(page === 'dashboard') renderDashboard();
    if(page === 'generate') loadProfiles();
    if(page === 'data') renderTable();
    if(page === 'report') renderReport();
    if(page === 'settings'){ loadRouterConfig(); loadProfileList(); }
    if(page === 'profile') loadProfilePage();
  }

  navLinks.forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      show(a.getAttribute('data-route'));
    });
  });

  // ==========================================
  //  LOGIN HANDLERS — DATABASE AUTH
  // ==========================================
  var loginUser = document.getElementById('loginUser');
  var loginPass = document.getElementById('loginPass');
  var btnLogin = document.getElementById('btnLogin');
  var loginMsg = document.getElementById('loginMsg');

  btnLogin.addEventListener('click', function(){
    var u = loginUser.value.trim();
    var p = loginPass.value.trim();
    if(!u || !p){
      loginMsg.textContent = 'Username dan password harus diisi';
      loginMsg.style.color = 'var(--danger)';
      return;
    }
    btnLogin.disabled = true;
    btnLogin.innerHTML = spinnerHTML('spinner-white') + 'Masuk...';
    loginMsg.textContent = '';

    fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'login', username:u, password:p})
    }).then(function(r){ return r.json(); }).then(function(d){
      btnLogin.disabled = false;
      btnLogin.textContent = 'Masuk';
      if(d.success){
        auth.login(d.admin);
        loginMsg.textContent = '';
        navLinks.forEach(function(n){ n.style.display = 'inline-block'; });
        show('dashboard');
        showToast('Login berhasil! Selamat datang, ' + (d.admin.fullname || d.admin.username) + '.', 'success');
        showSuccessCheckmark('Login Berhasil!');
        checkConnectionState();
      } else {
        loginMsg.textContent = d.error || 'Login gagal';
        loginMsg.style.color = 'var(--danger)';
        showToast(d.error || 'Login gagal!', 'error');
      }
    }).catch(function(e){
      btnLogin.disabled = false;
      btnLogin.textContent = 'Masuk';
      loginMsg.textContent = 'Koneksi gagal ke server';
      loginMsg.style.color = 'var(--danger)';
      showToast('Koneksi gagal ke server', 'error');
    });
  });

  loginPass.addEventListener('keydown', function(e){
    if(e.key === 'Enter') btnLogin.click();
  });
  loginUser.addEventListener('keydown', function(e){
    if(e.key === 'Enter') loginPass.focus();
  });

  // Go to Register
  document.getElementById('gotoRegister')?.addEventListener('click', function(e){
    e.preventDefault();
    show('register');
  });

  // Go to Login
  document.getElementById('gotoLogin')?.addEventListener('click', function(e){
    e.preventDefault();
    show('login');
  });

  // ==========================================
  //  REGISTER HANDLER
  // ==========================================
  var regFullname = document.getElementById('regFullname');
  var regUsername = document.getElementById('regUsername');
  var regPassword = document.getElementById('regPassword');
  var regConfirm = document.getElementById('regConfirm');
  var btnRegister = document.getElementById('btnRegister');
  var regMsg = document.getElementById('regMsg');

  btnRegister.addEventListener('click', function(){
    var fn = regFullname.value.trim();
    var u = regUsername.value.trim();
    var p = regPassword.value.trim();
    var c = regConfirm.value.trim();

    if(!fn || !u || !p || !c){
      regMsg.textContent = 'Semua field harus diisi';
      regMsg.style.color = 'var(--danger)';
      return;
    }

    btnRegister.disabled = true;
    btnRegister.innerHTML = spinnerHTML('spinner-white') + 'Mendaftar...';
    regMsg.textContent = '';

    fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'register', username:u, password:p, confirm:c, fullname:fn})
    }).then(function(r){ return r.json(); }).then(function(d){
      btnRegister.disabled = false;
      btnRegister.textContent = 'Daftar Akun';
      if(d.success){
        regMsg.style.color = 'var(--success)';
        regMsg.textContent = d.message;
        showToast(d.message, 'success');
        // Clear form
        regFullname.value = '';
        regUsername.value = '';
        regPassword.value = '';
        regConfirm.value = '';
        // Update admin exists flag
        hasAdminAccount = true;
        // Switch to login after 1.5s
        setTimeout(function(){ show('login'); }, 1500);
      } else {
        regMsg.style.color = 'var(--danger)';
        regMsg.textContent = d.error || 'Gagal mendaftar';
        showToast(d.error || 'Gagal mendaftar', 'error');
      }
    }).catch(function(e){
      btnRegister.disabled = false;
      btnRegister.textContent = 'Daftar Akun';
      regMsg.textContent = 'Koneksi gagal ke server';
      regMsg.style.color = 'var(--danger)';
      showToast('Koneksi gagal ke server', 'error');
    });
  });

  regConfirm.addEventListener('keydown', function(e){
    if(e.key === 'Enter') btnRegister.click();
  });

  logoutBtn.addEventListener('click', function(){
    auth.logout();
    // Hide all nav
    navLinks.forEach(function(n){ n.style.display = 'none'; });
    // Reset hash & data
    lastDataHash = '';
    lastFetchedData = null;
    firstLoadDone = false;
    // Clear login form
    var loginUser = document.getElementById('loginUser');
    var loginPass = document.getElementById('loginPass');
    var loginMsg = document.getElementById('loginMsg');
    if(loginUser) loginUser.value = '';
    if(loginPass) loginPass.value = '';
    if(loginMsg) loginMsg.textContent = '';
    // Check if admin exists and show correct page
    checkAdminExists(function(hasAdmin){
      if(hasAdmin){
        // Admin exists — show login
        show('login');
      } else {
        // No admin — show register
        show('register');
      }
    });
    showToast('Berhasil logout.', 'info');
  });

  // Initial page load — show correct auth page
  if(!auth.logged()){
    navLinks.forEach(function(n){ n.style.display = 'none'; });
    showAuthPage();
  } else {
    navLinks.forEach(function(n){ n.style.display = 'inline-block'; });
    show('dashboard');
    checkConnectionState();
  }

  // ==========================================
  //  FETCH VOUCHERS FROM API
  // ==========================================
  function fetchUsers(){
    return fetch('/api/vouchers')
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data.error) throw new Error(data.error);
        var arr = Array.isArray(data) ? data : [];
        lastFetchedData = arr;
        // Update connection badge based on data freshness
        if(arr.length > 0){
          updateConnBadge('live');
        }
        return arr;
      });
  }

  // ==========================================
  //  REFRESH ALL VISIBLE PAGES
  // ==========================================
  function refreshAll(){
    renderDashboard(true);
    var dataPage = document.getElementById('page-data');
    if(dataPage && dataPage.classList.contains('show')) renderTable(true);
    var reportPage = document.getElementById('page-report');
    if(reportPage && reportPage.classList.contains('show')) renderReport(true);
  }

  // ==========================================
  //  RESET HASH — force next check to refresh
  // ==========================================
  function resetHash(){
    lastDataHash = '';
  }

  // ==========================================
  //  DASHBOARD RENDER
  // ==========================================
  function renderDashboard(skipFetch){
    if(skipFetch && lastFetchedData){
      updateDashboardUI(lastFetchedData);
      return;
    }
    fetchUsers().then(function(all){
      updateDashboardUI(all);
    }).catch(function(){
      updateConnBadge('offline');
      ['stTotal','stActive','stOnline','stUsed','stDisabled','stExpired'].forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.textContent = '-';
      });
    });
  }

  function updateDashboardUI(all){
    var stats = computeStats(all);
    animateCounter(document.getElementById('stTotal'), stats.total);
    animateCounter(document.getElementById('stActive'), stats.aktif);
    animateCounter(document.getElementById('stOnline'), stats.online);
    animateCounter(document.getElementById('stUsed'), stats.terpakai);
    animateCounter(document.getElementById('stDisabled'), stats.disabled);
    animateCounter(document.getElementById('stExpired'), stats.expired);

    var info = auth.info();
    document.getElementById('adminName').textContent = info ? (info.fullname || info.user) : '-';
    document.getElementById('adminSince').textContent = info ? 'Login: ' + new Date(info.at).toLocaleString('id-ID') : '-';

    // Update dashboard avatar
    var dashAvatar = document.getElementById('dashAvatar');
    if(dashAvatar && info){
      var dashAvatarUrl = info.avatar || '';
      if(dashAvatarUrl && dashAvatarUrl.length > 3){
        dashAvatar.innerHTML = '<img src="' + dashAvatarUrl + '" alt="avatar" />';
      } else {
        var dashName = info.fullname || info.user || 'A';
        dashAvatar.innerHTML = dashName.charAt(0).toUpperCase();
      }
    }

    var usedTotal = stats.terpakai + stats.online;
    var pct = stats.total ? Math.round((usedTotal / stats.total) * 100) : 0;
    document.getElementById('usageBar').style.width = pct + '%';
    document.getElementById('usageText').textContent = pct + '% voucher digunakan';

    renderRecent(all);
    renderActivity(all);
    renderDonutChart(stats);
  }

  // ==========================================
  //  TOP 5 RECENT VOUCHERS
  // ==========================================
  function renderRecent(all){
    var el = document.getElementById('recentList');
    if(!all.length){ el.innerHTML = '<div class="muted small">Belum ada voucher</div>'; return; }
    el.innerHTML = all.slice(0,5).map(function(v){
      var s = getVoucherStatus(v);
      return '<div style="padding:10px;border-bottom:1px solid var(--card-border)">' +
        '<div class="mono" style="color:var(--text)">' + v.name + '</div>' +
        '<div class="small muted" style="margin-top:2px">' +
          (v.profile||'-') + ' &bull; ' +
          '<span class="' + s.cls + '" style="padding:2px 6px;border-radius:4px;font-size:11px">' + s.icon + ' ' + s.text + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ==========================================
  //  ACTIVITY FEED
  // ==========================================
  function renderActivity(all){
    var el = document.getElementById('activityFeed');
    if(!all.length){ el.innerHTML = '<div class="muted small">Belum ada aktivitas</div>'; return; }
    el.innerHTML = all.slice(0,8).map(function(v){
      var s = getVoucherStatus(v);
      return '<div style="padding:8px 0;border-bottom:1px solid var(--card-border)">' +
        'Voucher <b style="color:var(--text)">' + v.name + '</b> &mdash; ' +
        '<span class="' + s.cls + '" style="padding:2px 6px;border-radius:4px;font-size:11px">' + s.text + '</span>' +
        (v.uptime && v.uptime !== '0s' ? ' <span class="muted" style="font-size:11px">(uptime: ' + v.uptime + ')</span>' : '') +
      '</div>';
    }).join('');
  }

  // ==========================================
  //  DONUT CHART (Dashboard)
  // ==========================================
  function renderDonutChart(stats){
    var canvas = document.getElementById('donutChart');
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    var w = rect.width, h = rect.height;
    var cx = w/2, cy = h/2;
    var r = Math.min(cx, cy) - 10;

    var total = stats.aktif + stats.online + stats.terpakai + stats.disabled + stats.expired;
    if(total <= 0){
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Belum ada data', cx, cy);
      return;
    }

    var segments = [
      {value:stats.aktif, color:'#0891b2', label:'Aktif'},
      {value:stats.online, color:'#10b981', label:'Online'},
      {value:stats.terpakai, color:'#d97706', label:'Terpakai'},
      {value:stats.disabled, color:'#ef4444', label:'Disabled'},
      {value:stats.expired, color:'#8b5cf6', label:'Expired'}
    ];

    // Animated drawing
    var animDuration = 800;
    var animStart = null;
    if(canvas._donutAnim) cancelAnimationFrame(canvas._donutAnim);

    function drawFrame(ts){
      if(!animStart) animStart = ts;
      var elapsed = ts - animStart;
      var progress = Math.min(elapsed / animDuration, 1);
      var ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic

      ctx.clearRect(0,0,w,h);
      var sweepEnd = -Math.PI/2 + Math.PI*2*ease;
      var start = -Math.PI/2;

      segments.forEach(function(seg){
        if(seg.value <= 0) return;
        var angle = (seg.value / total) * Math.PI * 2;
        var drawEnd = Math.min(start + angle, sweepEnd);
        if(start < sweepEnd){
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.fillStyle = seg.color;
          ctx.arc(cx, cy, r, start, drawEnd);
          ctx.closePath();
          ctx.fill();

          // Segment label
          if(progress > 0.7 && angle > 0.3){
            var midAngle = start + angle/2;
            var lx = cx + (r*0.75)*Math.cos(midAngle);
            var ly = cy + (r*0.75)*Math.sin(midAngle);
            var pct = Math.round((seg.value/total)*100);
            ctx.globalAlpha = (progress - 0.7) / 0.3;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pct + '%', lx, ly);
            ctx.globalAlpha = 1;
          }
        }
        start += angle;
      });

      // Donut hole
      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Center text
      if(progress > 0.5){
        var textAlpha = (progress - 0.5) / 0.5;
        ctx.globalAlpha = textAlpha;
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(total * ease) + ' Voucher', cx, cy);
        ctx.globalAlpha = 1;
      }

      if(progress < 1){
        canvas._donutAnim = requestAnimationFrame(drawFrame);
      }
    }
    canvas._donutAnim = requestAnimationFrame(drawFrame);
  }

  // Dashboard quick nav buttons
  document.getElementById('gotoGenerate')?.addEventListener('click', function(){ show('generate'); });
  document.getElementById('gotoData')?.addEventListener('click', function(){ show('data'); });

  // ==========================================
  //  LOAD PROFILES (for Generate page)
  // ==========================================
  function loadProfiles(){
    var sel = document.getElementById('profile');
    if(!sel) return;
    if(profilesLoaded && sel.options.length > 1) return;
    sel.innerHTML = '<option value="">-- Memuat... --</option>';
    fetch('/api/profiles')
      .then(function(r){ return r.json(); })
      .then(function(data){
        if(data.error){ sel.innerHTML = '<option value="default">default</option>'; return; }
        sel.innerHTML = '';
        data.forEach(function(p){
          var opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.name + (p['rate-limit'] ? ' (' + p['rate-limit'] + ')' : '');
          sel.appendChild(opt);
        });
        profilesLoaded = true;
      })
      .catch(function(){
        sel.innerHTML = '<option value="default">default</option>';
      });
  }

  document.getElementById('refreshProfiles')?.addEventListener('click', function(e){
    e.preventDefault();
    profilesLoaded = false;
    loadProfiles();
  });

  // ==========================================
  //  GENERATE VOUCHER
  // ==========================================
  var genBtn = document.getElementById('genBtn');
  var genPreview = document.getElementById('genPreview');
  var genMsg = document.getElementById('genMsg');
  var genCount = document.getElementById('genCount');

  if(genBtn){
    genBtn.addEventListener('click', async function(){
      var fmt = document.getElementById('genFormat')?.value;
      var qty = Math.max(1, parseInt(document.getElementById('genQty')?.value || 1));
      var profile = document.getElementById('profile')?.value;
      var uptime = document.getElementById('genUptime')?.value || '';
      var comment = document.getElementById('genComment')?.value?.trim() || '';
      if(!fmt){ showToast('Format belum dipilih','warning'); return; }
      if(!profile){ showToast('Profile belum dipilih','warning'); return; }

      genBtn.disabled = true;
      genBtn.innerHTML = spinnerHTML('spinner-white') + 'Generating...';
      genMsg.className = 'small muted';
      genMsg.textContent = 'Sedang membuat ' + qty + ' voucher...';

      var codes = [];
      var errors = 0;
      for(var i=0; i<qty; i++){
        var code = util.gen(fmt);
        try {
          var res = await fetch('/api/generate', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({code:code, profile:profile, uptime:uptime, comment:comment})
          });
          var result = await res.json();
          if(result.error){ errors++; console.error(result.error); continue; }
          codes.push({code:code, profile:profile, uptime:uptime||'unlimited'});
        } catch(e){ errors++; console.error(e); }
      }

      // Update generated codes tracker
      generatedCodes = generatedCodes.concat(codes);

      if(genPreview){
        if(codes.length){
          genPreview.innerHTML = codes.map(function(c){
            return '<div style="padding:12px;border-bottom:1px solid var(--card-border)">' +
              '<pre style="margin:0;color:var(--text);font-size:12px">' +
              'User    : ' + c.code + '\n' +
              'Pass    : ' + c.code + '\n' +
              'Profile : ' + c.profile + '\n' +
              'Limit   : ' + c.uptime +
              '</pre></div>';
          }).join('');
          genPreview.scrollTop = genPreview.scrollHeight;
        } else {
          genPreview.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center">Gagal membuat semua voucher</div>';
        }
      }

      if(codes.length){
        genMsg.style.color = 'var(--success)';
        genMsg.textContent = codes.length + ' voucher berhasil dibuat';
        showToast(codes.length + ' voucher berhasil dibuat!','success');
        fireConfetti(40 + codes.length * 5); // Confetti burst!
        showSuccessCheckmark(codes.length + ' Voucher Berhasil!');
      } else {
        genMsg.style.color = 'var(--danger)';
        genMsg.textContent = 'Generate gagal';
        showToast('Generate gagal!','error');
      }
      if(errors) genMsg.textContent += ' (' + errors + ' gagal)';
      if(genCount) genCount.textContent = 'Total voucher baru: ' + codes.length;

      genBtn.disabled = false;
      genBtn.innerHTML = 'Generate';
      resetHash();
      renderDashboard();
    });
  }

  // Generate 5 shortcut
  document.getElementById('gen5Btn')?.addEventListener('click', function(){
    document.getElementById('genQty').value = 5;
    genBtn.click();
  });

  // Clear preview
  document.getElementById('genClear')?.addEventListener('click', function(){
    generatedCodes = [];
    if(genPreview) genPreview.innerHTML = '<div style="padding:30px;text-align:center">Belum ada voucher dibuat</div>';
    if(genMsg) genMsg.textContent = '';
    if(genCount) genCount.textContent = '';
  });

  // Copy All — copies generated codes or all vouchers
  document.getElementById('copyAll')?.addEventListener('click', function(){
    if(generatedCodes.length > 0){
      var text = generatedCodes.map(function(c){ return c.code; }).join('\n');
      navigator.clipboard.writeText(text);
      showToast(generatedCodes.length + ' kode disalin ke clipboard!','success');
    } else {
      fetchUsers().then(function(data){
        if(!data.length){ showToast('Tidak ada voucher','warning'); return; }
        navigator.clipboard.writeText(data.map(function(v){return v.name;}).join('\n'));
        showToast('Semua kode disalin ke clipboard!','success');
      });
    }
  });

  // Export CSV — exports generated codes or all vouchers
  document.getElementById('exportCsv')?.addEventListener('click', function(){
    var doExport = function(data){
      if(!data.length){ showToast('Tidak ada data','warning'); return; }
      var rows = [
        ['name','password','profile','uptime','limit-uptime','disabled','status']
      ];
      data.forEach(function(d){
        var s = getVoucherStatus(d);
        rows.push([d.name, d.password||d.name, d.profile, d.uptime, d['limit-uptime']||'', d.disabled, s.text]);
      });
      var csv = rows.map(function(r){
        return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(',');
      }).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
      a.download = 'vouchers_' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
      showToast('CSV berhasil diunduh!','success');
    };

    if(generatedCodes.length > 0){
      doExport(generatedCodes.map(function(c){
        return {name:c.code, password:c.code, profile:c.profile, uptime:'0s', 'limit-uptime':c.uptime==='unlimited'?'':c.uptime, disabled:'false'};
      }));
    } else {
      fetchUsers().then(doExport);
    }
  });

  // Print Voucher
  document.getElementById('printVoucher')?.addEventListener('click', function(){
    var doPrint = function(data){
      if(!data.length){ showToast('Tidak ada voucher','warning'); return; }
      var html = '<html><head><title>Print Voucher</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:20px;background:#fff;color:#000}' +
        '.voucher{border:2px dashed #0891b2;padding:16px;margin-bottom:14px;border-radius:10px;page-break-inside:avoid}' +
        '.voucher h3{margin:0 0 10px 0;color:#0891b2;font-size:14px}' +
        '.voucher pre{margin:0;font-size:13px;line-height:1.6}' +
        '</style></head><body>' +
        '<h2 style="text-align:center;color:#0891b2;margin-bottom:20px">HOTSPOT VOUCHER</h2>';
      data.forEach(function(v){
        html += '<div class="voucher">' +
          '<h3>&#128274; HOTSPOT LOGIN</h3>' +
          '<pre>Username : ' + v.name + '\nPassword : ' + (v.password||v.name) + '\nProfile  : ' + (v.profile||'-') + '\nLimit    : ' + (v['limit-uptime']||'unlimited') + '</pre>' +
          '</div>';
      });
      html += '</body></html>';
      var win = window.open('','','width=800,height=600');
      win.document.write(html);
      win.document.close();
      win.print();
    };

    if(generatedCodes.length > 0){
      doPrint(generatedCodes.map(function(c){
        return {name:c.code, password:c.code, profile:c.profile, 'limit-uptime':c.uptime==='unlimited'?'':c.uptime};
      }));
    } else {
      fetchUsers().then(doPrint);
    }
  });

  // ==========================================
  //  DATA TABLE
  // ==========================================
  var tableWrap = document.getElementById('tableWrap');

  function renderTable(skipFetch){
    // Only show shimmer on first load (not auto-refresh)
    if(!skipFetch && !firstLoadDone){
      tableWrap.innerHTML = '<div style="padding:30px;text-align:center">' +
        '<div class="shimmer" style="height:20px;width:60%;margin:0 auto 12px"></div>' +
        '<div class="shimmer" style="height:20px;width:40%;margin:0 auto 12px"></div>' +
        '<div class="shimmer" style="height:20px;width:50%;margin:0 auto"></div>' +
      '</div>';
    }

    var fetchFn = (skipFetch && lastFetchedData) ? Promise.resolve(lastFetchedData) : fetchUsers();
    fetchFn.then(function(data){
      firstLoadDone = true;
      var search = document.getElementById('search')?.value?.toLowerCase() || '';
      var filter = document.getElementById('filter')?.value || 'all';

      var filtered = data;
      if(search) filtered = filtered.filter(function(v){ return v.name.toLowerCase().includes(search); });
      if(filter !== 'all') filtered = filtered.filter(function(v){ return getVoucherStatus(v).key === filter; });

      var totalDataEl = document.getElementById('totalData');
      if(totalDataEl) totalDataEl.innerText = filtered.length + ' voucher ditemukan';

      if(!filtered.length){
        tableWrap.innerHTML = '<div class="empty-state">' +
          '<div class="empty-state-icon">&#127915;</div>' +
          '<div class="empty-state-text">Tidak ada voucher ditemukan</div>' +
        '</div>';
        return;
      }

      tableWrap.innerHTML =
        '<table><thead><tr>' +
        '<th>Nama</th><th>Password</th><th>Profile</th><th>Uptime</th><th>Limit</th><th>Status</th><th>Aksi</th>' +
        '</tr></thead><tbody>' +
        filtered.map(function(d){
          var s = getVoucherStatus(d);
          var toggleBtn = d.disabled === 'true'
            ? '<button class="toggle-btn enable" data-act="enable" data-name="'+d.name+'">Enable</button>'
            : '<button class="toggle-btn disable" data-act="disable" data-name="'+d.name+'">Disable</button>';
          return '<tr>' +
            '<td class="mono" style="color:var(--text)">'+d.name+'</td>' +
            '<td style="color:var(--muted)">'+(d.password||d.name)+'</td>' +
            '<td>'+(d.profile||'-')+'</td>' +
            '<td>'+(d.uptime||'0s')+'</td>' +
            '<td>'+(d['limit-uptime']||'-')+'</td>' +
            '<td><span class="status '+s.cls+'"><span class="status-dot"></span>'+s.text+'</span></td>' +
            '<td><div class="actions">' +
              toggleBtn +
              '<button class="btn-sm btn-danger" data-act="del" data-name="'+d.name+'">Hapus</button>' +
            '</div></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      // Wire up action buttons
      wireTableActions();

    }).catch(function(err){
      console.error(err);
      tableWrap.innerHTML = '<div class="empty-state">' +
        '<div class="empty-state-icon">&#x26A0;&#xFE0F;</div>' +
        '<div class="empty-state-text" style="color:var(--danger)">Gagal load data dari MikroTik</div>' +
      '</div>';
    });
  }

  function wireTableActions(){
    // DELETE handlers
    tableWrap.querySelectorAll('[data-act="del"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(!confirm('Hapus user ' + btn.dataset.name + ' ?')) return;
        btn.disabled = true;
        btn.innerHTML = spinnerHTML('spinner-sm');
        fetch('/api/delete', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({name: btn.dataset.name})
        }).then(function(){
          showToast('User ' + btn.dataset.name + ' dihapus','success');
          resetHash();
          renderTable();
          renderDashboard();
        }).catch(function(){
          showToast('Gagal menghapus user','error');
        });
      });
    });

    // ENABLE handlers
    tableWrap.querySelectorAll('[data-act="enable"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        btn.disabled = true;
        fetch('/api/router', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({action:'enable_voucher', name: btn.dataset.name})
        }).then(function(r){ return r.json(); }).then(function(d){
          if(d.success || !d.error){
            showToast('Voucher ' + btn.dataset.name + ' diaktifkan','success');
            resetHash();
            renderTable();
            renderDashboard();
          } else {
            showToast(d.error || 'Gagal mengaktifkan','error');
          }
        }).catch(function(){ showToast('Gagal mengaktifkan','error'); });
      });
    });

    // DISABLE handlers
    tableWrap.querySelectorAll('[data-act="disable"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        btn.disabled = true;
        fetch('/api/router', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({action:'disable_voucher', name: btn.dataset.name})
        }).then(function(r){ return r.json(); }).then(function(d){
          if(d.success || !d.error){
            showToast('Voucher ' + btn.dataset.name + ' dinonaktifkan','warning');
            resetHash();
            renderTable();
            renderDashboard();
          } else {
            showToast(d.error || 'Gagal menonaktifkan','error');
          }
        }).catch(function(){ showToast('Gagal menonaktifkan','error'); });
      });
    });
  }

  // Data page controls
  document.getElementById('refresh')?.addEventListener('click', function(){ renderTable(); });
  document.getElementById('search')?.addEventListener('input', function(){
    if(lastFetchedData) renderTable(true);
  });
  document.getElementById('filter')?.addEventListener('change', function(){
    if(lastFetchedData) renderTable(true);
    else renderTable();
  });

  // ==========================================
  //  REPORT PAGE
  // ==========================================

  // Chart type toggle
  document.querySelectorAll('.chart-toggle button').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.chart-toggle button').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      currentChartType = btn.dataset.chart;
      document.getElementById('reportBar').style.display = currentChartType === 'bar' ? 'block' : 'none';
      document.getElementById('reportDonut').style.display = currentChartType === 'donut' ? 'block' : 'none';
      if(lastFetchedData) renderReportWithData(lastFetchedData);
    });
  });

  function renderReport(skipFetch){
    var fetchFn = (skipFetch && lastFetchedData) ? Promise.resolve(lastFetchedData) : fetchUsers();
    fetchFn.then(function(all){
      renderReportWithData(all);
    }).catch(function(err){
      console.error(err);
      var el = document.getElementById('lapRekap');
      if(el) el.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center">Gagal load data</div>';
    });
  }

  function renderReportWithData(all){
    var stats = computeStats(all);

    // Detail count
    var detailCount = document.getElementById('detailCount');
    if(detailCount) detailCount.innerHTML = stats.total + ' data';

    // Rekap stats
    var lapRekap = document.getElementById('lapRekap');
    if(lapRekap){
      lapRekap.innerHTML =
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<div class="stat stat-st-total" style="flex:1;min-width:80px"><div class="small muted">Total</div><h2>'+stats.total+'</h2></div>' +
        '<div class="stat stat-st-aktif" style="flex:1;min-width:80px"><div class="small muted">Aktif</div><h2>'+stats.aktif+'</h2></div>' +
        '<div class="stat stat-st-online" style="flex:1;min-width:80px"><div class="small muted">Online</div><h2>'+stats.online+'</h2></div>' +
        '<div class="stat stat-st-terpakai" style="flex:1;min-width:80px"><div class="small muted">Terpakai</div><h2>'+stats.terpakai+'</h2></div>' +
        '<div class="stat stat-st-disabled" style="flex:1;min-width:80px"><div class="small muted">Disabled</div><h2>'+stats.disabled+'</h2></div>' +
        '<div class="stat stat-st-expired" style="flex:1;min-width:80px"><div class="small muted">Expired</div><h2>'+stats.expired+'</h2></div>' +
        '</div>';
    }

    // Per Profile Breakdown
    var profileBreakdown = document.getElementById('profileBreakdown');
    if(profileBreakdown){
      var profileMap = {};
      all.forEach(function(v){
        var p = v.profile || 'default';
        if(!profileMap[p]) profileMap[p] = {total:0, aktif:0, online:0, terpakai:0, disabled:0, expired:0};
        profileMap[p].total++;
        var s = getVoucherStatus(v);
        if(s.key==='valid') profileMap[p].aktif++;
        else if(s.key==='online') profileMap[p].online++;
        else if(s.key==='used') profileMap[p].terpakai++;
        else if(s.key==='disabled') profileMap[p].disabled++;
        else if(s.key==='expired') profileMap[p].expired++;
      });
      var maxTotal = Math.max.apply(null, Object.values(profileMap).map(function(p){return p.total;}).concat([1]));
      var keys = Object.keys(profileMap);
      if(keys.length === 0){
        profileBreakdown.innerHTML = '<div class="muted small" style="text-align:center;padding:20px">Tidak ada data</div>';
      } else {
        profileBreakdown.innerHTML = keys.map(function(name){
          var p = profileMap[name];
          return '<div class="profile-row">' +
            '<div style="min-width:120px"><b style="color:var(--text)">'+name+'</b></div>' +
            '<div class="profile-bar"><div class="profile-bar-fill" style="width:'+Math.round(p.total/maxTotal*100)+'%"></div></div>' +
            '<div class="small muted" style="min-width:220px;text-align:right">' +
              '<span style="color:#0891b2">'+p.aktif+' aktif</span> &bull; ' +
              '<span style="color:#10b981">'+p.online+' online</span> &bull; ' +
              '<span style="color:#d97706">'+p.terpakai+' terpakai</span> &bull; ' +
              '<span style="color:#ef4444">'+p.disabled+' disabled</span> &bull; ' +
              '<span style="color:#8b5cf6">'+p.expired+' expired</span> &bull; ' +
              '<b style="color:var(--text)">'+p.total+' total</b>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }

    // Detail voucher list
    var lapDetail = document.getElementById('lapDetail');
    if(lapDetail){
      if(stats.total){
        lapDetail.innerHTML = all.map(function(v){
          var s = getVoucherStatus(v);
          return '<div class="report-item">' +
            '<div class="mono" style="color:var(--text)">'+v.name+'</div>' +
            '<div style="margin-top:4px;color:var(--muted)">' +
              '<b>Profile:</b> '+(v.profile||'-')+' &nbsp; <b>Uptime:</b> '+(v.uptime||'0s')+' &nbsp; <b>Limit:</b> '+(v['limit-uptime']||'-') +
            '</div>' +
            '<div style="margin-top:6px"><span class="status '+s.cls+'"><span class="status-dot"></span>'+s.text+'</span></div>' +
          '</div>';
        }).join('');
      } else {
        lapDetail.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Tidak ada data</div>';
      }
    }

    // Render charts
    renderReportBar(stats);
    renderReportDonut(stats);
  }

  // ==========================================
  //  REPORT BAR CHART
  // ==========================================
  function renderReportBar(stats){
    var canvas = document.getElementById('reportBar');
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    var w = rect.width, h = rect.height;

    var total = stats.aktif + stats.online + stats.terpakai + stats.disabled + stats.expired;
    var data = [
      {label:'Aktif', value:stats.aktif, color:'#0891b2', bg:'rgba(8,145,178,0.1)'},
      {label:'Online', value:stats.online, color:'#10b981', bg:'rgba(16,185,129,0.1)'},
      {label:'Terpakai', value:stats.terpakai, color:'#d97706', bg:'rgba(217,119,6,0.1)'},
      {label:'Disabled', value:stats.disabled, color:'#ef4444', bg:'rgba(239,68,68,0.1)'},
      {label:'Expired', value:stats.expired, color:'#8b5cf6', bg:'rgba(139,92,246,0.1)'}
    ];

    var pl=50, pr=20, pt=30, pb=50;
    var cw = w-pl-pr, ch = h-pt-pb;

    if(total <= 0){
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle='#64748b'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('Belum ada data voucher', w/2, h/2);
      return;
    }

    var maxVal = Math.max(stats.aktif, stats.online, stats.terpakai, stats.disabled, stats.expired, 1);
    var niceMax = Math.ceil(maxVal * 1.2) || 1;
    var tickCount = 5;
    var tickStep = niceMax / tickCount;

    // Animated drawing
    var animDuration = 900;
    var animStart = null;
    if(canvas._barAnim) cancelAnimationFrame(canvas._barAnim);

    function drawFrame(ts){
      if(!animStart) animStart = ts;
      var elapsed = ts - animStart;
      var progress = Math.min(elapsed / animDuration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);

      ctx.clearRect(0,0,w,h);

      // Y-axis grid lines
      ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.font='11px sans-serif';
      for(var i=0;i<=tickCount;i++){
        var val = Math.round(tickStep*i);
        var y = pt + ch - (val/niceMax)*ch;
        ctx.strokeStyle='rgba(8,145,178,0.06)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(pl,y); ctx.lineTo(pl+cw,y); ctx.stroke();
        ctx.fillStyle='#64748b'; ctx.fillText(val, pl-8, y);
      }

      // X-axis line
      ctx.strokeStyle='rgba(8,145,178,0.1)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(pl, pt+ch); ctx.lineTo(pl+cw, pt+ch); ctx.stroke();

      var gap = cw / data.length;
      var barW = Math.min(60, gap * 0.5);
      ctx.textAlign='center';

      data.forEach(function(d,i){
        var x = pl + gap*i + (gap - barW)/2;
        var barH = (d.value / niceMax) * ch * ease;
        if(d.value > 0 && barH < 6) barH = 6;
        var y = pt + ch - barH;

        // Background bar
        ctx.fillStyle = d.bg;
        roundedRect(ctx, x, pt, barW, ch, 6); ctx.fill();

        // Value bar (animated height)
        if(d.value > 0){
          ctx.fillStyle = d.color;
          roundedRect(ctx, x, y, barW, barH, 6); ctx.fill();
        }

        // Value label (fade in)
        if(progress > 0.6){
          var labelAlpha = (progress - 0.6) / 0.4;
          ctx.globalAlpha = labelAlpha;
          ctx.fillStyle='#1e293b'; ctx.font='bold 13px sans-serif'; ctx.textBaseline='bottom';
          ctx.fillText(d.value, x+barW/2, y-6);

          // Percentage
          if(total > 0){
            var pct = Math.round((d.value/total)*100);
            ctx.fillStyle='#64748b'; ctx.font='11px sans-serif'; ctx.textBaseline='bottom';
            ctx.fillText(pct+'%', x+barW/2, y-22);
          }
          ctx.globalAlpha = 1;
        }

        // Label
        ctx.fillStyle='#334155'; ctx.font='12px sans-serif'; ctx.textBaseline='top';
        ctx.fillText(d.label, x+barW/2, pt+ch+10);
      });

      if(progress < 1){
        canvas._barAnim = requestAnimationFrame(drawFrame);
      }
    }
    canvas._barAnim = requestAnimationFrame(drawFrame);
  }

  // ==========================================
  //  REPORT DONUT CHART
  // ==========================================
  function renderReportDonut(stats){
    var canvas = document.getElementById('reportDonut');
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    var w = rect.width, h = rect.height;
    var cx = w/2, cy = h/2;
    var r = Math.min(cx, cy) - 20;

    var total = stats.aktif + stats.online + stats.terpakai + stats.disabled + stats.expired;
    if(total <= 0){
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle='#64748b'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('Belum ada data', cx, cy);
      return;
    }

    var segments = [
      {value:stats.aktif, color:'#0891b2', label:'Aktif'},
      {value:stats.online, color:'#10b981', label:'Online'},
      {value:stats.terpakai, color:'#d97706', label:'Terpakai'},
      {value:stats.disabled, color:'#ef4444', label:'Disabled'},
      {value:stats.expired, color:'#8b5cf6', label:'Expired'}
    ];

    // Animated drawing
    var animDuration = 900;
    var animStart = null;
    if(canvas._rdonutAnim) cancelAnimationFrame(canvas._rdonutAnim);

    function drawFrame(ts){
      if(!animStart) animStart = ts;
      var elapsed = ts - animStart;
      var progress = Math.min(elapsed / animDuration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);

      ctx.clearRect(0,0,w,h);
      var sweepEnd = -Math.PI/2 + Math.PI*2*ease;
      var start = -Math.PI/2;

      segments.forEach(function(seg){
        if(seg.value <= 0) return;
        var angle = (seg.value/total)*Math.PI*2;
        var drawEnd = Math.min(start + angle, sweepEnd);
        if(start < sweepEnd){
          ctx.beginPath(); ctx.moveTo(cx,cy);
          ctx.fillStyle = seg.color;
          ctx.arc(cx,cy,r,start,drawEnd);
          ctx.closePath(); ctx.fill();

          // Percentage label on segment
          if(progress > 0.7){
            var midAngle = start + angle/2;
            var lx = cx + (r*0.78)*Math.cos(midAngle);
            var ly = cy + (r*0.78)*Math.sin(midAngle);
            var pct = Math.round((seg.value/total)*100);
            ctx.globalAlpha = (progress - 0.7) / 0.3;
            ctx.fillStyle='#f0f6ff'; ctx.font='bold 11px sans-serif';
            ctx.textAlign='center'; ctx.textBaseline='middle';
            if(pct >= 5) ctx.fillText(pct+'%', lx, ly);
            ctx.globalAlpha = 1;
          }
        }
        start += angle;
      });

      // Donut hole
      ctx.beginPath(); ctx.fillStyle='#ffffff';
      ctx.arc(cx,cy,r*0.5,0,Math.PI*2); ctx.fill();

      // Center text
      if(progress > 0.5){
        var textAlpha = (progress - 0.5) / 0.5;
        ctx.globalAlpha = textAlpha;
        ctx.fillStyle='#1e293b'; ctx.font='bold 18px sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(Math.round(total*ease)+'', cx, cy-8);
        ctx.fillStyle='#64748b'; ctx.font='11px sans-serif';
        ctx.fillText('Voucher', cx, cy+10);
        ctx.globalAlpha = 1;
      }

      // Legend (fade in)
      if(progress > 0.6){
        var legendX = cx + r + 30;
        ctx.globalAlpha = (progress - 0.6) / 0.4;
        if(legendX < w - 60){
          segments.forEach(function(seg,i){
            var ly = cy - 40 + i*22;
            ctx.fillStyle = seg.color;
            ctx.fillRect(legendX, ly-5, 12, 12);
            ctx.fillStyle='#334155'; ctx.font='12px sans-serif';
            ctx.textAlign='left'; ctx.textBaseline='middle';
            ctx.fillText(seg.label + ' (' + seg.value + ')', legendX+18, ly+1);
          });
        }
        ctx.globalAlpha = 1;
      }

      if(progress < 1){
        canvas._rdonutAnim = requestAnimationFrame(drawFrame);
      }
    }
    canvas._rdonutAnim = requestAnimationFrame(drawFrame);
  }

  // Rounded rectangle helper
  function roundedRect(ctx, x, y, w, h, r){
    r = Math.min(r, w/2, h/2);
    if(r<0) r=0;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
    ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
    ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
    ctx.closePath();
  }

  document.getElementById('refreshReport')?.addEventListener('click', renderReport);

  // ==========================================
  //  SETTINGS — Router Configuration
  // ==========================================
  function loadRouterConfig(){
    var ipEl = document.getElementById('routerIp');
    var portEl = document.getElementById('routerPort');
    var userEl = document.getElementById('routerUser');
    var passEl = document.getElementById('routerPass');
    var statusEl = document.getElementById('connStatus');
    if(!ipEl || !portEl) return;

    statusEl.innerHTML = '<span class="muted">Memuat konfigurasi...</span>';

    var controller = new AbortController();
    var timeoutId = setTimeout(function(){ controller.abort(); }, 8000);

    fetch('/api/router?action=get_config', {signal: controller.signal}).then(function(r){
      clearTimeout(timeoutId);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(cfg){
      if(!cfg){ statusEl.innerHTML = '<span style="color:var(--danger)">Gagal memuat konfigurasi</span>'; return; }
      ipEl.value = cfg.ip || '';
      portEl.value = cfg.port || '8728';
      userEl.value = cfg.username || '';
      passEl.value = '';
      if(cfg.has_password) passEl.placeholder = '(tersimpan)';

      if(cfg.connected) statusEl.innerHTML = '<span style="color:var(--success)">\u25CF Terhubung</span>';
      else if(cfg.ip) statusEl.innerHTML = '<span style="color:var(--danger)">\u25CF Tidak terhubung</span>';
      else statusEl.innerHTML = '<span class="muted">Belum dikonfigurasi</span>';
    }).catch(function(err){
      clearTimeout(timeoutId);
      console.error('loadRouterConfig error:', err);
      if(err.name === 'AbortError'){
        statusEl.innerHTML = '<span style="color:var(--warning)">Timeout — server terlalu lama merespon</span>';
      } else {
        statusEl.innerHTML = '<span style="color:var(--danger)">Gagal memuat konfigurasi</span>';
      }
    });
  }

  // Test Connection
  document.getElementById('btnTestConn')?.addEventListener('click', function(){
    var msg = document.getElementById('routerMsg');
    msg.textContent='Menguji...';
    msg.style.color = 'var(--muted)';
    var testBtn = document.getElementById('btnTestConn');
    if(testBtn){ testBtn.innerHTML = spinnerHTML('spinner-white') + 'Menguji...'; testBtn.disabled = true; }
    var fd = new FormData();
    fd.append('action','test_connection');
    fd.append('ip', document.getElementById('routerIp').value);
    fd.append('port', document.getElementById('routerPort').value);
    fd.append('username', document.getElementById('routerUser').value);
    fd.append('password', document.getElementById('routerPass').value);
    fetch('/api/router',{method:'POST',body:fd}).then(function(r){ return r.json(); }).then(function(d){
      if(testBtn){ testBtn.textContent = 'Test Koneksi'; testBtn.disabled = false; }
      if(d.success){
        msg.innerHTML='\u25CF '+d.message; msg.style.color='var(--success)';
        document.getElementById('connStatus').innerHTML='<span style="color:var(--success)">\u25CF '+d.message+'</span>';
        updateConnBadge('live');
        showToast('Koneksi berhasil!','success');
      } else {
        msg.innerHTML='\u25CF '+(d.error||'Gagal'); msg.style.color='var(--danger)';
        updateConnBadge('offline');
        showToast(d.error||'Koneksi gagal','error');
      }
    }).catch(function(){
      if(testBtn){ testBtn.textContent = 'Test Koneksi'; testBtn.disabled = false; }
      msg.textContent='\u25CF Error'; msg.style.color='var(--danger)';
      showToast('Error koneksi','error');
    });
  });

  // Save Router Config
  document.getElementById('btnSaveRouter')?.addEventListener('click', function(){
    var msg = document.getElementById('routerMsg');
    msg.textContent = 'Menyimpan...'; msg.style.color = 'var(--muted)';
    var fd = new FormData();
    fd.append('action','save_router');
    fd.append('ip', document.getElementById('routerIp').value);
    fd.append('port', document.getElementById('routerPort').value);
    fd.append('username', document.getElementById('routerUser').value);
    fd.append('password', document.getElementById('routerPass').value);
    fetch('/api/router',{method:'POST',body:fd}).then(function(r){ return r.json(); }).then(function(d){
      if(d.success){
        msg.innerHTML='\u25CF '+d.message; msg.style.color='var(--success)';
        profilesLoaded = false;
        if(d.connected){
          document.getElementById('connStatus').innerHTML='<span style="color:var(--success)">\u25CF Terhubung</span>';
          updateConnBadge('live');
        } else {
          updateConnBadge('cached');
        }
        showToast('Pengaturan tersimpan!','success');
      } else {
        msg.innerHTML='\u25CF '+(d.error||'Gagal'); msg.style.color='var(--danger)';
        showToast(d.error||'Gagal menyimpan','error');
      }
    }).catch(function(){
      msg.textContent='\u25CF Error'; msg.style.color='var(--danger)';
      showToast('Error','error');
    });
  });

  // ==========================================
  //  SETTINGS — Profile Management
  // ==========================================
  function loadProfileList(){
    var el = document.getElementById('profileList');
    if(!el) return;
    el.innerHTML = '<div class="shimmer" style="height:40px"></div>';

    var controller = new AbortController();
    var timeoutId = setTimeout(function(){ controller.abort(); }, 10000);

    fetch('/api/manage-profiles', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'list'}),
      signal: controller.signal
    }).then(function(r){
      clearTimeout(timeoutId);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      if(!data){ el.innerHTML = '<span style="color:var(--danger)">Data tidak valid</span>'; return; }
      if(data.error){ el.innerHTML = '<span style="color:var(--danger)">'+data.error+'</span>'; return; }
      if(!data.length){ el.innerHTML = '<div class="muted small">Tidak ada profile</div>'; return; }
      el.innerHTML = '<table><thead><tr>' +
        '<th>Nama</th><th>Rate Limit</th><th>Shared</th><th>Session</th><th>Idle</th><th>Aksi</th>' +
        '</tr></thead><tbody>' +
        data.map(function(p){
          return '<tr>' +
            '<td class="mono" style="color:var(--text)">'+p.name+'</td>' +
            '<td>'+(p['rate-limit']||'-')+'</td>' +
            '<td>'+(p['shared-users']||'-')+'</td>' +
            '<td>'+(p['session-timeout']||'-')+'</td>' +
            '<td>'+(p['idle-timeout']||'-')+'</td>' +
            '<td>'+(p.name!=='default'?'<button class="btn-sm btn-danger" data-delprof="'+p.id+'">Hapus</button>':'<span class="muted small">default</span>')+'</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      // Delete profile handlers
      el.querySelectorAll('[data-delprof]').forEach(function(btn){
        btn.addEventListener('click', function(){
          if(!confirm('Hapus profile ini?')) return;
          fetch('/api/manage-profiles', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'delete', id:btn.dataset.delprof})
          }).then(function(r){
            if(!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          }).then(function(d){
            if(d.error){ showToast(d.error,'error'); }
            else { showToast('Profile dihapus','success'); loadProfileList(); profilesLoaded=false; }
          }).catch(function(err){
            console.error('Delete profile error:', err);
            showToast('Gagal menghapus profile','error');
          });
        });
      });
    }).catch(function(err){
      clearTimeout(timeoutId);
      console.error('loadProfileList error:', err);
      if(err.name === 'AbortError'){
        el.innerHTML = '<span style="color:var(--warning)">Timeout — MikroTik terlalu lama merespon. Coba refresh.</span>';
      } else {
        el.innerHTML = '<span style="color:var(--danger)">Gagal memuat daftar profile. Coba refresh halaman.</span>';
      }
    });
  }

  // Add Profile
  document.getElementById('btnAddProfile')?.addEventListener('click', function(){
    var msg = document.getElementById('profileMsg');
    var name = document.getElementById('profName').value.trim();
    if(!name){
      msg.textContent='Nama profile harus diisi';
      msg.style.color='var(--danger)';
      showToast('Nama profile harus diisi','warning');
      return;
    }
    var addBtn = document.getElementById('btnAddProfile');
    msg.textContent='Menambahkan...'; msg.style.color='var(--muted)';
    if(addBtn){ addBtn.innerHTML = spinnerHTML('spinner-white') + 'Menambahkan...'; addBtn.disabled = true; }
    var payload = {
      action:'add',
      name:name,
      'rate-limit': document.getElementById('profRate').value.trim(),
      'shared-users': document.getElementById('profShared').value.trim() || '1',
      'session-timeout': document.getElementById('profSession').value.trim(),
      'idle-timeout': document.getElementById('profIdle').value.trim()
    };
    fetch('/api/manage-profiles', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(d){
      if(addBtn){ addBtn.textContent = '+ Tambah Profile'; addBtn.disabled = false; }
      if(d.error){
        msg.innerHTML='\u25CF '+d.error; msg.style.color='var(--danger)';
        showToast(d.error,'error');
      } else {
        msg.innerHTML='\u25CF Profile ditambahkan'; msg.style.color='var(--success)';
        showToast('Profile berhasil ditambahkan!','success');
        document.getElementById('profName').value='';
        document.getElementById('profRate').value='';
        document.getElementById('profSession').value='';
        document.getElementById('profIdle').value='';
        loadProfileList();
        profilesLoaded = false;
      }
    }).catch(function(err){
      if(addBtn){ addBtn.textContent = '+ Tambah Profile'; addBtn.disabled = false; }
      console.error('Add profile error:', err);
      msg.innerHTML='\u25CF Gagal menambahkan profile'; msg.style.color='var(--danger)';
      showToast('Gagal menambahkan profile','error');
    });
  });

  document.getElementById('btnRefreshProfiles')?.addEventListener('click', function(){
    loadProfileList();
  });

  // ==========================================
  //  PROFILE PAGE — Load & Edit
  // ==========================================
  function loadProfilePage(){
    var info = auth.info();
    if(!info) return;

    // Load profile from database
    fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'get_profile', username:info.user})
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d.success && d.admin){
        currentAdminData = d.admin;
        renderProfileUI(d.admin);
      } else {
        // Fallback to local data
        renderProfileUI({
          username: info.user,
          fullname: info.fullname || info.user,
          email: info.email || '',
          phone: info.phone || '',
          bio: info.bio || '',
          created_at: info.created_at || ''
        });
      }
    }).catch(function(){
      renderProfileUI({
        username: info.user,
        fullname: info.fullname || info.user,
        email: info.email || '',
        phone: info.phone || '',
        bio: info.bio || '',
        created_at: info.created_at || ''
      });
    });

    // Also load stats
    if(lastFetchedData){
      var stats = computeStats(lastFetchedData);
      animateCounter(document.getElementById('profileStatTotal'), stats.total);
      animateCounter(document.getElementById('profileStatAktif'), stats.aktif);
      animateCounter(document.getElementById('profileStatOnline'), stats.online);
    } else {
      fetchUsers().then(function(all){
        var stats = computeStats(all);
        animateCounter(document.getElementById('profileStatTotal'), stats.total);
        animateCounter(document.getElementById('profileStatAktif'), stats.aktif);
        animateCounter(document.getElementById('profileStatOnline'), stats.online);
      });
    }
  }

  function renderProfileUI(admin){
    var info = auth.info();
    var name = admin.fullname || admin.username || 'Admin';
    var initial = name.charAt(0).toUpperCase();
    var avatarUrl = admin.avatar || '';
    var hasAvatar = avatarUrl && avatarUrl.length > 3;

    // Avatar — profile page (gunakan <img> tag, bukan backgroundImage)
    var avatarContainer = document.getElementById('profileAvatar');
    if(avatarContainer){
      if(hasAvatar){
        avatarContainer.innerHTML = '<img src="' + avatarUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />' +
          '<div class="avatar-overlay">Ganti Foto</div>';
      } else {
        avatarContainer.innerHTML = '<span id="profileAvatarInitial">' + initial + '</span>' +
          '<div class="avatar-overlay">Ganti Foto</div>';
        avatarContainer.style.backgroundImage = '';
        avatarContainer.style.background = 'linear-gradient(135deg,var(--accent),var(--accent-2))';
      }
    }

    // Avatar — dashboard sidebar
    var dashAvatar = document.getElementById('dashAvatar');
    if(dashAvatar){
      if(hasAvatar){
        dashAvatar.innerHTML = '<img src="' + avatarUrl + '" alt="avatar" />';
      } else {
        dashAvatar.innerHTML = initial;
      }
    }

    // Avatar preview in edit form
    var profPreview = document.getElementById('profAvatarPreview');
    var btnRemove = document.getElementById('btnRemoveAvatar');
    if(profPreview){
      if(hasAvatar){
        profPreview.innerHTML = '<img src="' + avatarUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />';
        if(btnRemove) btnRemove.style.display = 'inline-block';
      } else {
        profPreview.innerHTML = '<span id="profAvatarPreviewInitial">' + initial + '</span>';
        if(btnRemove) btnRemove.style.display = 'none';
      }
    }

    // Display info
    var dn = document.getElementById('profileDisplayName');
    if(dn) dn.textContent = name;
    var du = document.getElementById('profileDisplayUsername');
    if(du) du.textContent = '@' + (admin.username || '-');
    var db = document.getElementById('profileDisplayBio');
    if(db) db.textContent = admin.bio || 'Belum ada bio';
    var de = document.getElementById('profileDisplayEmail');
    if(de) de.textContent = admin.email || '-';
    var dp = document.getElementById('profileDisplayPhone');
    if(dp) dp.textContent = admin.phone || '-';
    var ds = document.getElementById('profileDisplaySince');
    if(ds){
      try{
        var dt = new Date(admin.created_at);
        ds.textContent = 'Bergabung ' + dt.toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'});
      } catch(e){ ds.textContent = '-'; }
    }

    // Account info table
    var au = document.getElementById('acctUsername');
    if(au) au.textContent = admin.username || '-';
    var af = document.getElementById('acctFullname');
    if(af) af.textContent = admin.fullname || '-';
    var ac = document.getElementById('acctCreated');
    if(ac){
      try{
        var dt2 = new Date(admin.created_at);
        ac.textContent = dt2.toLocaleString('id-ID');
      } catch(e){ ac.textContent = '-'; }
    }
    var al = document.getElementById('acctLastLogin');
    if(al) al.textContent = info ? new Date(info.at).toLocaleString('id-ID') : '-';

    // Fill form fields
    var pa = document.getElementById('profAvatar');
    if(pa) pa.value = admin.avatar || '';
    var pf = document.getElementById('profFullname');
    if(pf) pf.value = admin.fullname || '';
    var pe = document.getElementById('profEmail');
    if(pe) pe.value = admin.email || '';
    var pp = document.getElementById('profPhone');
    if(pp) pp.value = admin.phone || '';
    var pb = document.getElementById('profBio');
    if(pb) pb.value = admin.bio || '';
  }

  // Toggle Edit Profile
  document.getElementById('btnToggleEditProfile')?.addEventListener('click', function(){
    var container = document.getElementById('profileFormContainer');
    var btn = document.getElementById('btnToggleEditProfile');
    var btnSave = document.getElementById('btnSaveProfile');
    var btnCancel = document.getElementById('btnCancelProfile');
    var inputs = container.querySelectorAll('input, textarea');

    if(container.classList.contains('profile-form-disabled')){
      // Enable editing
      container.classList.remove('profile-form-disabled');
      container.classList.add('profile-form-enabled');
      inputs.forEach(function(inp){ inp.disabled = false; });
      btnSave.disabled = false;
      btnCancel.style.display = 'inline-block';
      btnCancel.disabled = false;
      btn.textContent = 'Batal';
    } else {
      // Disable editing
      container.classList.remove('profile-form-enabled');
      container.classList.add('profile-form-disabled');
      inputs.forEach(function(inp){ inp.disabled = true; });
      btnSave.disabled = true;
      btnCancel.style.display = 'none';
      btnCancel.disabled = true;
      btn.textContent = 'Edit';
      // Reload original data
      loadProfilePage();
    }
  });

  // Cancel Edit Profile
  document.getElementById('btnCancelProfile')?.addEventListener('click', function(){
    var btn = document.getElementById('btnToggleEditProfile');
    btn.click(); // Toggle off
  });

  // Save Profile
  document.getElementById('btnSaveProfile')?.addEventListener('click', function(){
    var info = auth.info();
    if(!info) return;
    var msg = document.getElementById('profileMsg');
    var btnSave = document.getElementById('btnSaveProfile');

    btnSave.disabled = true;
    btnSave.innerHTML = spinnerHTML('spinner-sm') + 'Menyimpan...';
    msg.textContent = '';

    fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'update_profile',
        username: info.user,
        avatar: document.getElementById('profAvatar').value,
        fullname: document.getElementById('profFullname').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        bio: document.getElementById('profBio').value.trim()
      })
    }).then(function(r){ return r.json(); }).then(function(d){
      btnSave.disabled = false;
      btnSave.textContent = 'Simpan Perubahan';
      if(d.success){
        msg.style.color = 'var(--success)';
        msg.textContent = d.message;
        showToast(d.message, 'success');
        // Update local storage
        auth.updateLocal({
          avatar: d.admin.avatar || '',
          fullname: d.admin.fullname,
          email: d.admin.email,
          phone: d.admin.phone,
          bio: d.admin.bio
        });
        // Re-render
        renderProfileUI(d.admin);
        // Close edit mode
        document.getElementById('btnToggleEditProfile').click();
        // Update dashboard admin name
        var adminNameEl = document.getElementById('adminName');
        if(adminNameEl) adminNameEl.textContent = d.admin.fullname || d.admin.username;
        showSuccessCheckmark('Profil Disimpan!');
      } else {
        msg.style.color = 'var(--danger)';
        msg.textContent = d.error || 'Gagal menyimpan';
        showToast(d.error || 'Gagal menyimpan', 'error');
      }
    }).catch(function(){
      btnSave.disabled = false;
      btnSave.textContent = 'Simpan Perubahan';
      msg.textContent = 'Koneksi gagal';
      msg.style.color = 'var(--danger)';
    });
  });

  // ==========================================
  //  AVATAR FILE UPLOAD — Pilih dari Album
  // ==========================================

  // Klik avatar di halaman profil → buka file picker
  document.getElementById('avatarWrap')?.addEventListener('click', function(){
    document.getElementById('avatarFileInput').click();
  });

  // Klik tombol "Pilih dari Album" di form edit
  document.getElementById('btnPickAvatar')?.addEventListener('click', function(){
    document.getElementById('profAvatarFile').click();
  });

  // Klik tombol "Hapus" avatar
  document.getElementById('btnRemoveAvatar')?.addEventListener('click', function(){
    var profAvatar = document.getElementById('profAvatar');
    if(profAvatar) profAvatar.value = '';
    // Reset preview
    var profPreview = document.getElementById('profAvatarPreview');
    var name = document.getElementById('profFullname')?.value || 'A';
    var initial = name.charAt(0).toUpperCase();
    if(profPreview){
      profPreview.innerHTML = '<span id="profAvatarPreviewInitial">' + initial + '</span>';
    }
    var btnRemove = document.getElementById('btnRemoveAvatar');
    if(btnRemove) btnRemove.style.display = 'none';
    showToast('Foto profil akan dihapus saat simpan', 'info');
  });

  // Fungsi upload avatar ke server (file upload, bukan base64)
  function uploadAvatarToServer(file, callback){
    if(!file) return;
    // Validasi tipe
    if(!file.type.match(/^image\/(jpeg|png|gif|webp|bmp)$/)){
      showToast('Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.', 'error');
      return;
    }
    // Validasi ukuran max 10MB
    if(file.size > 10 * 1024 * 1024){
      showToast('Ukuran file terlalu besar. Maksimal 10MB.', 'error');
      return;
    }
    var info = auth.info();
    if(!info){ showToast('Sesi login tidak valid', 'error'); return; }

    var formData = new FormData();
    formData.append('file', file);
    formData.append('username', info.user);

    fetch('/api/upload-avatar', {
      method: 'POST',
      body: formData
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d.success){
        // d.avatar_url = 'uploads/avatars/xxx.jpg'
        callback(d.avatar_url);
      } else {
        showToast(d.error || 'Gagal upload foto', 'error');
      }
    }).catch(function(){
      showToast('Koneksi gagal saat upload foto', 'error');
    });
  }

  // Handler: klik avatar di profil → upload langsung
  document.getElementById('avatarFileInput')?.addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    // Tampilkan preview sementara
    var tempUrl = URL.createObjectURL(file);
    var avatarContainer = document.getElementById('profileAvatar');
    if(avatarContainer){
      avatarContainer.innerHTML = '<img src="' + tempUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />' +
        '<div class="avatar-overlay">Mengupload...</div>';
    }
    uploadAvatarToServer(file, function(avatarUrl){
      // Update profil di database dengan path file
      fetch('/api/auth', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'update_profile',
          username: auth.info().user,
          avatar: avatarUrl
        })
      }).then(function(r){ return r.json(); }).then(function(d){
        if(d.success){
          auth.updateLocal({ avatar: d.admin.avatar || '' });
          renderProfileUI(d.admin);
          var adminNameEl = document.getElementById('adminName');
          if(adminNameEl) adminNameEl.textContent = d.admin.fullname || d.admin.username;
          showToast('Foto profil berhasil diperbarui!', 'success');
        } else {
          showToast(d.error || 'Gagal menyimpan foto', 'error');
        }
      }).catch(function(){
        showToast('Koneksi gagal', 'error');
      });
    });
    e.target.value = '';
  });

  // Handler: file input dari form edit profil
  document.getElementById('profAvatarFile')?.addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    // Tampilkan preview sementara
    var tempUrl = URL.createObjectURL(file);
    var profPreview = document.getElementById('profAvatarPreview');
    if(profPreview){
      profPreview.innerHTML = '<img src="' + tempUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />';
    }
    var btnRemove = document.getElementById('btnRemoveAvatar');
    if(btnRemove) btnRemove.style.display = 'inline-block';
    // Upload ke server dan simpan path
    uploadAvatarToServer(file, function(avatarUrl){
      var profAvatar = document.getElementById('profAvatar');
      if(profAvatar) profAvatar.value = avatarUrl;
      // Update preview dengan URL file dari server
      if(profPreview){
        profPreview.innerHTML = '<img src="' + avatarUrl + '" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />';
      }
      showToast('Foto diupload. Klik "Simpan Perubahan" untuk menyimpan.', 'info');
    });
    e.target.value = '';
  });

  // Toggle Change Password
  document.getElementById('btnToggleChangePass')?.addEventListener('click', function(){
    var container = document.getElementById('changePassContainer');
    var btn = document.getElementById('btnToggleChangePass');
    var btnChange = document.getElementById('btnChangePassword');
    var btnCancel = document.getElementById('btnCancelChangePass');
    var inputs = container.querySelectorAll('input');

    if(container.classList.contains('profile-form-disabled')){
      container.classList.remove('profile-form-disabled');
      container.classList.add('profile-form-enabled');
      inputs.forEach(function(inp){ inp.disabled = false; inp.value = ''; });
      btnChange.disabled = false;
      btnCancel.style.display = 'inline-block';
      btnCancel.disabled = false;
      btn.textContent = 'Batal';
    } else {
      container.classList.remove('profile-form-enabled');
      container.classList.add('profile-form-disabled');
      inputs.forEach(function(inp){ inp.disabled = true; inp.value = ''; });
      btnChange.disabled = true;
      btnCancel.style.display = 'none';
      btnCancel.disabled = true;
      btn.textContent = 'Ubah';
      document.getElementById('changePassMsg').textContent = '';
    }
  });

  // Cancel Change Password
  document.getElementById('btnCancelChangePass')?.addEventListener('click', function(){
    document.getElementById('btnToggleChangePass').click();
  });

  // Change Password
  document.getElementById('btnChangePassword')?.addEventListener('click', function(){
    var info = auth.info();
    if(!info) return;
    var msg = document.getElementById('changePassMsg');
    var btnChange = document.getElementById('btnChangePassword');
    var oldPass = document.getElementById('oldPassword').value.trim();
    var newPass = document.getElementById('newPassword').value.trim();
    var confirmPass = document.getElementById('confirmNewPassword').value.trim();

    if(!oldPass || !newPass || !confirmPass){
      msg.textContent = 'Semua field harus diisi';
      msg.style.color = 'var(--danger)';
      return;
    }

    btnChange.disabled = true;
    btnChange.innerHTML = spinnerHTML('spinner-sm') + 'Mengubah...';
    msg.textContent = '';

    fetch('/api/auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'change_password',
        username: info.user,
        old_password: oldPass,
        new_password: newPass,
        confirm_password: confirmPass
      })
    }).then(function(r){ return r.json(); }).then(function(d){
      btnChange.disabled = false;
      btnChange.textContent = 'Ubah Password';
      if(d.success){
        msg.style.color = 'var(--success)';
        msg.textContent = d.message;
        showToast(d.message, 'success');
        // Close form
        document.getElementById('btnToggleChangePass').click();
        showSuccessCheckmark('Password Diubah!');
      } else {
        msg.style.color = 'var(--danger)';
        msg.textContent = d.error || 'Gagal mengubah password';
        showToast(d.error || 'Gagal', 'error');
      }
    }).catch(function(){
      btnChange.disabled = false;
      btnChange.textContent = 'Ubah Password';
      msg.textContent = 'Koneksi gagal';
      msg.style.color = 'var(--danger)';
    });
  });

  // ==========================================
  //  INITIALIZATION
  // ==========================================
  if(auth.logged()){
    navLinks.forEach(function(n){ n.style.display = 'inline-block'; });
    show('dashboard');
    checkConnectionState();
  } else {
    showAuthPage();
  }

  // ==========================================
  //  REAL-TIME CLOCK — Dashboard only
  //  Pukul: HH:MM:SS (runs every second)
  //  Preserves the blinking cursor span
  // ==========================================
  setInterval(function(){
    var now = new Date();
    var h = String(now.getHours()).padStart(2,'0');
    var m = String(now.getMinutes()).padStart(2,'0');
    var s = String(now.getSeconds()).padStart(2,'0');
    var dashClock = document.getElementById('dashClock');
    if(dashClock){
      dashClock.textContent = h + ':' + m + ':' + s;
    }
  }, 1000);

  // ==========================================
  //  AUTO-REFRESH via HASH CHECK
  //  Lightweight polling every 3 seconds
  //  Only fetches full data when hash changes
  // ==========================================
  function startHashCheck(){
    if(hashCheckInterval) return;
    hashCheckInterval = setInterval(function(){
      if(!auth.logged()) return;
      fetch('/api/check-hash').then(function(r){ return r.json(); }).then(function(res){
        if(res.hash && lastDataHash && res.hash !== lastDataHash){
          // Data changed! Fetch full data and refresh
          lastDataHash = res.hash;
          fetchUsers().then(function(){
            refreshAll();
            updateConnBadge('live');
            showToast('Data diperbarui', 'info');
          });
        } else if(res.hash && !lastDataHash){
          lastDataHash = res.hash;
        }
      }).catch(function(){
        // Silent fail — don't spam errors
        updateConnBadge('cached');
      });
    }, 3000);
  }

  function stopHashCheck(){
    if(hashCheckInterval){ clearInterval(hashCheckInterval); hashCheckInterval = null; }
  }

  // Start auto-refresh
  startHashCheck();

  // ==========================================
  //  WINDOW RESIZE — re-render charts
  // ==========================================
  var resizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      if(lastFetchedData){
        var dashPage = document.getElementById('page-dashboard');
        if(dashPage && dashPage.classList.contains('show')){
          renderDonutChart(computeStats(lastFetchedData));
        }
        var reportPage = document.getElementById('page-report');
        if(reportPage && reportPage.classList.contains('show')){
          renderReportWithData(lastFetchedData);
        }
      }
    }, 300);
  });

  // ==========================================
  //  FLOATING PARTICLES SYSTEM — REMOVED
  // ==========================================

  // ==========================================
  //  RIPPLE EFFECT ON ALL BUTTONS
  // ==========================================
  document.addEventListener('click', function(e){
    var btn = e.target.closest('button');
    if(!btn || btn.disabled) return;
    if(!btn.style.position || btn.style.position === 'static') btn.style.position = 'relative';
    var rect = btn.getBoundingClientRect();
    var ripple = document.createElement('span');
    ripple.className = 'ripple-all';
    var size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
    btn.appendChild(ripple);
    setTimeout(function(){ if(ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 700);
  });

  // ==========================================
  //  REFRESH BUTTON SPIN ON CLICK
  // ==========================================
  document.querySelectorAll('#refreshProfiles, #btnRefreshProfiles, #refresh, #refreshReport').forEach(function(btn){
    btn.addEventListener('click', function(){
      var icon = btn.innerHTML;
      btn.style.animation = 'spin360 0.6s ease';
      setTimeout(function(){ btn.style.animation = ''; }, 650);
    });
  });

  // ==========================================
  //  REDUCED MOTION CHECK
  //  Skip heavy animations if user prefers reduced motion
  // ==========================================
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==========================================
  //  CONFETTI CELEBRATION — REMOVED
  // ==========================================
  function fireConfetti(count){
    // removed
  }

  // ==========================================
  //  SUCCESS CHECKMARK OVERLAY
  //  Shows an animated checkmark briefly
  // ==========================================
  function showSuccessCheckmark(message, targetEl){
    if(prefersReducedMotion) return;
    var overlay = document.createElement('div');
    overlay.className = 'success-checkmark show';
    overlay.innerHTML = '<svg viewBox="0 0 52 52">'+
      '<circle class="circle-path" cx="26" cy="26" r="24"/>'+
      '<path class="check-path" d="M14 27l8 8 16-16"/>'+
    '</svg>';
    if(message){
      var msgEl = document.createElement('div');
      msgEl.className = 'small';
      msgEl.style.cssText = 'text-align:center;color:var(--success);font-weight:700;margin-top:4px';
      msgEl.textContent = message;
      overlay.appendChild(msgEl);
    }
    overlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'+
      'z-index:10001;background:rgba(255,255,255,0.95);padding:24px 32px;border-radius:16px;'+
      'box-shadow:0 20px 50px rgba(0,0,0,0.2);text-align:center;display:block;'+
      'animation:pageMorphIn 0.4s cubic-bezier(.34,1.56,.64,1)';
    document.body.appendChild(overlay);
    setTimeout(function(){
      overlay.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      overlay.style.opacity = '0';
      overlay.style.transform = 'translate(-50%,-50%) scale(0.9)';
      setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 350);
    }, 1500);
  }

  // ==========================================
  //  SCROLL REVEAL — IntersectionObserver
  //  Elements with .scroll-reveal class animate in when visible
  // ==========================================
  (function(){
    if(!('IntersectionObserver' in window)) return;
    var scrollObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('revealed');
          scrollObserver.unobserve(entry.target);
        }
      });
    }, {threshold: 0.1, rootMargin: '0px 0px -40px 0px'});
    // Observe all existing scroll-reveal elements
    document.querySelectorAll('.scroll-reveal').forEach(function(el){
      scrollObserver.observe(el);
    });
    // Also observe dynamically added elements
    var scrollMutObs = new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes.forEach(function(node){
          if(node.nodeType !== 1) return;
          if(node.classList && node.classList.contains('scroll-reveal')){
            scrollObserver.observe(node);
          }
          var children = node.querySelectorAll ? node.querySelectorAll('.scroll-reveal') : [];
          children.forEach(function(child){ scrollObserver.observe(child); });
        });
      });
    });
    scrollMutObs.observe(document.body, {childList:true, subtree:true});
  })();

  // ==========================================
  //  MAGNETIC HOVER EFFECT FOR BUTTONS
  //  Buttons subtly move toward cursor on hover
  // ==========================================
  (function(){
    // Only apply on non-touch devices and when user doesn't prefer reduced motion
    if('ontouchstart' in window || prefersReducedMotion) return;
    document.querySelectorAll('button, .toggle-btn, .logout, nav a').forEach(function(btn){
      btn.classList.add('magnetic-hover');
      btn.addEventListener('mousemove', function(e){
        var rect = btn.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width/2;
        var y = e.clientY - rect.top - rect.height/2;
        var strength = 0.15; // Subtle pull
        btn.style.transform = 'translate(' + (x*strength) + 'px, ' + (y*strength) + 'px)';
      });
      btn.addEventListener('mouseleave', function(){
        btn.style.transform = '';
      });
    });
  })();

  // ==========================================
  //  PAGE TRANSITION MORPH
  //  Smooth page switching with fade transition
  // ==========================================
  var _originalShow = show;
  show = function(page){
    if(page !== 'login' && page !== 'register' && !auth.logged()) page = 'login';
    // Fade out current page
    var currentVisible = null;
    Object.keys(pages).forEach(function(k){
      if(pages[k] && pages[k].classList.contains('show')) currentVisible = pages[k];
    });
    if(currentVisible && currentVisible !== pages[page]){
      // Use CSS transition for fade out instead of abrupt inline style
      currentVisible.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
      currentVisible.style.opacity = '0';
      currentVisible.style.transform = 'translateY(6px)';
      setTimeout(function(){
        // Clear the fade-out transition before calling original show
        currentVisible.style.transition = '';
        _originalShow(page);
      }, 160);
    } else {
      _originalShow(page);
    }
  };

  // ==========================================
  //  ENHANCED COUNTER — with easing + bounce
  //  Overrides the original animateCounter for
  //  smoother count-up with overshoot
  // ==========================================
  // (Original animateCounter already exists and works well;
  //  we enhance it with bounce easing here)
  var _origAnimateCounter = animateCounter;
  animateCounter = function(el, target){
    if(!el) return;
    var start = parseInt(el.textContent) || 0;
    var diff = target - start;
    if(diff === 0){ el.textContent = target; return; }
    var duration = 700;
    var startTime = performance.now();
    function easeOutBack(t){
      var c1 = 1.70158;
      var c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    function step(now){
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = easeOutBack(progress);
      // Clamp to avoid showing negative or over-target during bounce
      var val = Math.round(start + diff * eased);
      if(progress >= 1) val = target;
      el.textContent = val;
      if(progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  // ==========================================
  //  LOADING SPINNER HELPER
  //  Replaces plain text "..." with animated spinner
  // ==========================================
  function spinnerHTML(sizeClass){
    sizeClass = sizeClass || '';
    return '<span class="spinner ' + sizeClass + '"></span>';
  }

  // Hook: Replace button "..." text with spinner on action buttons
  var btnSpinnerObserver = new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      if(m.type === 'childList' || m.type === 'characterData'){
        var target = m.target;
        if(target.nodeType === 1 && target.tagName === 'BUTTON'){
          if(target.textContent === '...' && !target.querySelector('.spinner')){
            target.innerHTML = spinnerHTML('spinner-white');
          }
        }
      }
    });
  });
  btnSpinnerObserver.observe(document.body, {childList:true, subtree:true, characterData:true});

  // ==========================================
  //  STAGGER ANIMATION FOR DYNAMIC CONTENT
  // ==========================================
  var staggerObserver = new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      if(m.addedNodes){
        m.addedNodes.forEach(function(node){
          if(node.nodeType !== 1) return;
          // Stagger report items
          var items = node.querySelectorAll ? node.querySelectorAll('.report-item') : [];
          items.forEach(function(item, i){
            item.style.animationDelay = (i * 0.04) + 's';
          });
          // Stagger profile rows
          var rows = node.querySelectorAll ? node.querySelectorAll('.profile-row') : [];
          rows.forEach(function(row, i){
            row.style.animationDelay = (i * 0.05) + 's';
          });
          // Stagger table rows
          var trs = node.querySelectorAll ? node.querySelectorAll('tbody tr') : [];
          trs.forEach(function(tr, i){
            if(i < 10) tr.style.animationDelay = (i * 0.02) + 's';
          });
        });
      }
    });
  });
  staggerObserver.observe(document.body, {childList:true, subtree:true});

  // ==========================================
  //  SNOWFALL BACKGROUND
  //  White dots falling like snow across entire page
  // ==========================================
  (function(){
    if(prefersReducedMotion) return;
    var container = document.getElementById('snowContainer');
    if(!container) return;
    var flakeCount = 55;
    var styleCache = []; // track dynamic style tags

    function createFlake(){
      var flake = document.createElement('div');
      flake.className = 'snowflake';
      var size = Math.random() * 4 + 1.5; // 1.5px - 5.5px
      var duration = Math.random() * 14 + 7; // 7s - 21s
      var delay = Math.random() * 12; // 0s - 12s
      var left = Math.random() * 100; // 0% - 100%
      var drift = (Math.random() - 0.5) * 50; // -25px to 25px horizontal drift
      var rand = Math.random();
      var isBlur = rand < 0.25; // 25% blur (far depth)
      var isBright = rand > 0.8; // 20% bright (close/foreground)

      flake.style.width = size + 'px';
      flake.style.height = size + 'px';
      flake.style.left = left + '%';
      flake.style.animationDuration = duration + 's';
      flake.style.animationDelay = delay + 's';
      flake.style.opacity = isBright ? 0.9 : (Math.random() * 0.5 + 0.25);

      if(isBlur) flake.classList.add('blur');
      if(isBright) flake.classList.add('bright');

      // Custom drift via unique keyframes per flake
      var driftName = 'snow_' + Math.random().toString(36).substr(2,6);
      var styleTag = document.createElement('style');
      var startOpacity = isBright ? 0.95 : (Math.random()*0.4+0.3);
      styleTag.textContent =
        '@keyframes ' + driftName + '{' +
        '0%{transform:translateY(-10px) translateX(0);opacity:' + startOpacity + '}' +
        '20%{transform:translateY(20vh) translateX(' + (drift*0.5) + 'px)}' +
        '40%{transform:translateY(40vh) translateX(' + (-drift*0.3) + 'px)}' +
        '60%{transform:translateY(60vh) translateX(' + (drift*0.7) + 'px)}' +
        '80%{transform:translateY(80vh) translateX(' + (-drift*0.2) + 'px);opacity:' + (startOpacity*0.6) + '}' +
        '100%{transform:translateY(110vh) translateX(' + (drift*0.15) + 'px);opacity:0.05}' +
        '}';
      document.head.appendChild(styleTag);
      styleCache.push(styleTag);
      flake.dataset.styleId = styleCache.length - 1;
      flake.style.animationName = driftName;
      container.appendChild(flake);
    }

    for(var i = 0; i < flakeCount; i++){
      createFlake();
    }

    // Recycle: periodically replace old flakes
    setInterval(function(){
      var flakes = container.querySelectorAll('.snowflake');
      if(flakes.length > flakeCount + 8){
        for(var j = 0; j < 2; j++){
          if(flakes[j]){
            // Remove associated style tag
            var idx = flakes[j].dataset.styleId;
            if(idx !== undefined && styleCache[idx]){
              styleCache[idx].remove();
              styleCache[idx] = null;
            }
            flakes[j].remove();
          }
        }
      }
      createFlake();
    }, 2500);
  })();

})();
