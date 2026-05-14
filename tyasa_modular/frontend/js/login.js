// login.js - Autenticación de acceso al sistema TYASA
(function () {
    var VALID_USER = 'Logistica';
    var VALID_PASS = 'TAY2026';
    var AUTH_KEY   = 'tyasa-auth-session';

    function isAuthenticated() {
        return sessionStorage.getItem(AUTH_KEY) === '1';
    }

    function spawnParticles() {
        var container = document.getElementById('loginParticles');
        if (!container) return;
        var colors = ['rgba(59,130,246,0.7)', 'rgba(6,182,212,0.5)', 'rgba(16,185,129,0.4)'];
        for (var i = 0; i < 30; i++) {
            var p = document.createElement('div');
            p.className = 'login-particle';
            p.style.setProperty('--x', (Math.random() * 100) + '%');
            p.style.setProperty('--dur', (10 + Math.random() * 15) + 's');
            p.style.animationDelay = (Math.random() * 15) + 's';
            p.style.background = colors[Math.floor(Math.random() * colors.length)];
            p.style.width = (1 + Math.random() * 3) + 'px';
            p.style.height = p.style.width;
            container.appendChild(p);
        }
    }

    function showError(msg) {
        var el = document.getElementById('loginError');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
    }

    function dismissLogin(immediate) {
        var overlay = document.getElementById('loginOverlay');
        if (!overlay) return;
        if (immediate) {
            overlay.style.display = 'none';
            return;
        }
        overlay.classList.add('login-exit');
        setTimeout(function () { overlay.style.display = 'none'; }, 700);
    }

    function handleSubmit(e) {
        e.preventDefault();
        var userEl = document.getElementById('loginUser');
        var passEl = document.getElementById('loginPass');
        var btn    = document.getElementById('loginBtn');
        if (!userEl || !passEl) return;

        var user = userEl.value.trim();
        var pass = passEl.value;

        if (user === VALID_USER && pass === VALID_PASS) {
            sessionStorage.setItem(AUTH_KEY, '1');
            if (btn) btn.classList.add('login-btn-success');
            setTimeout(function () { dismissLogin(false); }, 500);
        } else {
            showError('Usuario o contraseña incorrectos');
            passEl.value = '';
            userEl.value = '';
            userEl.focus();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (isAuthenticated()) {
            dismissLogin(true);
            return;
        }

        spawnParticles();

        var form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', handleSubmit);

        // Auto-focus with a slight delay to allow card animation to start
        setTimeout(function () {
            var u = document.getElementById('loginUser');
            if (u) u.focus();
        }, 650);
    });
})();
