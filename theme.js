const THEREMEPROJECT_THEME_KEY = 'stock_record_theme';

function getStoredTheme() {
    return localStorage.getItem(THEREMEPROJECT_THEME_KEY);
}

function setStoredTheme(theme) {
    localStorage.setItem(THEREMEPROJECT_THEME_KEY, theme);
}

function updateThemeButton(button) {
    if (!button) return;
    const isDark = document.documentElement.classList.contains('dark-theme');
    button.textContent = isDark ? '🌞 โหมดสว่าง' : '🌙 โหมดมืด';
    button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark-theme', isDark);
    setStoredTheme(theme);
    updateThemeButton(document.getElementById('themeToggleButton'));
}

function toggleTheme() {
    const current = document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

function createThemeToggleButton() {
    if (document.getElementById('themeToggleButton')) return;
    const button = document.createElement('button');
    button.id = 'themeToggleButton';
    button.className = 'theme-toggle-button';
    button.type = 'button';
    button.addEventListener('click', toggleTheme);
    document.body.appendChild(button);
    updateThemeButton(button);
}

function initTheme() {
    const stored = getStoredTheme();
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = stored || (prefersDark ? 'dark' : 'light');
    applyTheme(initial);
    createThemeToggleButton();

    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (event) => {
            if (!getStoredTheme()) {
                applyTheme(event.matches ? 'dark' : 'light');
            }
        });
    }
}

window.addEventListener('DOMContentLoaded', initTheme);
